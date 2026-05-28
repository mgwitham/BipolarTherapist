#!/usr/bin/env node
// Companion to decode-html-entities-in-therapists.mjs for the
// licensureRecord doc type. The audit-html-entities-everywhere.mjs
// scan found `License Renewed &amp; Current` baked into three
// licensureRecord documents — captured verbatim from the CA license
// boards' HTML pages at verification time.
//
// These records are admin-only (not rendered on patient pages and
// not used for active/inactive logic, which keys off the numeric
// primaryStatusCode), so the bug is benign. We clean anyway to keep
// the dataset free of the ingestion artifact.
//
// Unlike the therapist decoder this walks NESTED string fields so it
// can patch licensureVerification.primaryStatus etc. via Sanity's
// dotted-path set().
//
// Usage:
//   node scripts/decode-html-entities-in-licensure-records.mjs            # dry run
//   node scripts/decode-html-entities-in-licensure-records.mjs --apply    # commit
import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@sanity/client";

const APPLY = process.argv.includes("--apply");

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

function decodeEntitiesFully(input) {
  let prev = input;
  for (let i = 0; i < 5; i++) {
    const next = decodeOnce(prev);
    if (next === prev) return next;
    prev = next;
  }
  return prev;
}

const ENTITY_RE = /&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/;
function hasEntities(s) {
  return typeof s === "string" && ENTITY_RE.test(s);
}

// Walk the document and emit { path, before, after } for every string
// field (any depth) that contains entities. Arrays are skipped because
// none of the affected fields are inside arrays — keeps the dotted-
// path patch logic simple. Future contamination inside an array would
// be flagged by the everywhere-audit and we'd extend this then.
function findEntityFields(doc) {
  const out = [];
  function walk(value, pathParts) {
    if (value == null) return;
    if (typeof value === "string") {
      if (hasEntities(value)) {
        const decoded = decodeEntitiesFully(value);
        if (decoded !== value) {
          out.push({ path: pathParts.join("."), before: value, after: decoded });
        }
      }
      return;
    }
    if (Array.isArray(value)) return;
    if (typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        if (k.startsWith("_")) continue;
        walk(v, pathParts.concat(k));
      }
    }
  }
  walk(doc, []);
  return out;
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

  console.log("Fetching licensure records…");
  const docs = await client.fetch(`*[_type == "licensureRecord"] | order(_id asc)`);
  console.log(`Scanning ${docs.length} document(s).\n`);

  const plans = [];
  for (const doc of docs) {
    const changes = findEntityFields(doc);
    if (changes.length > 0) plans.push({ doc, changes });
  }

  if (plans.length === 0) {
    console.log("Nothing to decode. Done.");
    return;
  }

  console.log(`${plans.length} licensure record(s) will be cleaned:\n`);
  for (const { doc, changes } of plans) {
    console.log(`  ${doc._id}`);
    for (const { path: fieldPath, before, after } of changes) {
      console.log(`    .${fieldPath}:`);
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
    // Build a dotted-path patch object — Sanity's set() supports
    // dotted paths for nested fields like
    // "licensureVerification.primaryStatus".
    const setPayload = {};
    for (const { path: fieldPath, after } of changes) {
      setPayload[fieldPath] = after;
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
