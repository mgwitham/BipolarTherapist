#!/usr/bin/env node
// Decode stored HTML entities in therapist text fields. Companion to
// scripts/audit-html-entities-in-therapists.mjs — the audit identified
// 9 live therapist documents where text like "don&#039;t" is stored
// literally, which the public site then renders as the visible string
// "don&#039;t" because the renderer (correctly) escapes the ampersand
// when emitting HTML.
//
// Root cause is the ingestion pipeline — earlier scrapers preserved
// HTML entities from source pages. Going forward the ingester should
// decode at ingest time; this script repairs the existing rows.
//
// We decode every string value on a therapist document (not just bio)
// so any field with entity contamination gets fixed in one pass.
// Decoding is iterative (handles double-encoding like `&amp;amp;`).
//
// Usage:
//   node scripts/decode-html-entities-in-therapists.mjs            # dry run
//   node scripts/decode-html-entities-in-therapists.mjs --apply    # commit
import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@sanity/client";

const APPLY = process.argv.includes("--apply");

// Named HTML entities we'll see in bipolar-therapist scraped content.
// Mapped to their canonical character. We intentionally decode &nbsp;
// to a regular space so prose flows naturally — the bios are body
// copy, not formatted markup where U+00A0 carries meaning.
const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  copy: "©",
  reg: "®",
  trade: "™",
  bull: "•",
  middot: "·",
  laquo: "«",
  raquo: "»",
  deg: "°",
};

function decodeOnce(input) {
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _m;
    })
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _m;
    })
    .replace(/&([a-zA-Z]+);/g, (_m, name) => {
      const repl = NAMED_ENTITIES[name.toLowerCase()];
      return repl != null ? repl : _m;
    });
}

// Decode iteratively until stable (handles &amp;#039; → &#039; → ').
// Bounded to avoid pathological loops on hand-crafted inputs.
function decodeEntitiesFully(input) {
  let prev = input;
  for (let i = 0; i < 5; i++) {
    const next = decodeOnce(prev);
    if (next === prev) return next;
    prev = next;
  }
  return prev;
}

// Common-pattern entity detector. Same set used by the audit script —
// keep them in sync.
const ENTITY_RE = /&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/;

function hasEntities(s) {
  return typeof s === "string" && ENTITY_RE.test(s);
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .reduce((acc, line) => {
      const t = line.trim();
      if (!t || t.startsWith("#")) return acc;
      const i = t.indexOf("=");
      if (i === -1) return acc;
      acc[t.slice(0, i).trim()] = t.slice(i + 1).trim();
      return acc;
    }, {});
}

// Build a flat patch object for top-level string fields that changed.
// For nested fields (e.g. arrays of objects) Sanity's set() expects a
// dotted path; we handle the common shape but skip arrays/objects to
// stay safe — the audit shows all affected fields on therapists are
// top-level strings (bio, bioPreview, careApproach), so this is
// sufficient for the current data.
function buildPatch(doc) {
  const changes = {};
  for (const [key, value] of Object.entries(doc)) {
    if (key.startsWith("_")) continue;
    if (typeof value !== "string") continue;
    if (!hasEntities(value)) continue;
    const decoded = decodeEntitiesFully(value);
    if (decoded !== value) {
      changes[key] = { before: value, after: decoded };
    }
  }
  return changes;
}

function truncate(s, max = 100) {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

async function main() {
  const root = process.cwd();
  const env = readEnvFile(path.join(root, ".env"));

  const client = createClient({
    projectId: process.env.VITE_SANITY_PROJECT_ID || env.VITE_SANITY_PROJECT_ID,
    dataset: process.env.VITE_SANITY_DATASET || env.VITE_SANITY_DATASET || "production",
    apiVersion: process.env.VITE_SANITY_API_VERSION || env.VITE_SANITY_API_VERSION || "2026-04-02",
    token: process.env.SANITY_API_TOKEN || env.SANITY_API_TOKEN,
    useCdn: false,
  });

  console.log("Fetching live therapists…");
  const docs = await client.fetch(
    `*[_type == "therapist"
        && listingActive == true
        && status == "active"
        && visibilityIntent == "listed"]
      | order(name asc)`,
  );
  console.log(`Scanning ${docs.length} document(s).\n`);

  const plans = [];
  for (const doc of docs) {
    const changes = buildPatch(doc);
    if (Object.keys(changes).length > 0) {
      plans.push({ doc, changes });
    }
  }

  if (plans.length === 0) {
    console.log("Nothing to decode. Done.");
    return;
  }

  console.log(`${plans.length} therapist(s) will be cleaned:\n`);
  for (const { doc, changes } of plans) {
    console.log(`  ${doc.name || "(no name)"}  [${doc._id}]`);
    for (const [field, { before, after }] of Object.entries(changes)) {
      console.log(`    .${field}:`);
      console.log(`      − ${truncate(before)}`);
      console.log(`      + ${truncate(after)}`);
    }
    console.log("");
  }

  if (!APPLY) {
    console.log("DRY RUN — pass --apply to commit.");
    return;
  }

  console.log("Applying patches…");
  let tx = client.transaction();
  for (const { doc, changes } of plans) {
    const setPayload = {};
    for (const [field, { after }] of Object.entries(changes)) {
      setPayload[field] = after;
    }
    tx = tx.patch(doc._id, (p) => p.set(setPayload));
  }
  const result = await tx.commit();
  console.log(`Committed ${result.results.length} patch(es).`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exitCode = 1;
});
