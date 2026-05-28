#!/usr/bin/env node
// Audit therapist documents in Sanity for stored HTML entities (e.g.
// `don&#039;t` instead of `don't`). The public site escapes content
// before rendering, so any entity that was baked into the stored data
// will appear as literal text in the browser — visible bug on bios
// and free-text fields like the "In their own words" panel.
//
// Audit only — does NOT write. Run with --apply on a follow-up script
// (decode-html-entities-in-therapists.mjs) to actually clean.
//
// Usage:
//   node scripts/audit-html-entities-in-therapists.mjs
//   node scripts/audit-html-entities-in-therapists.mjs --include-unpublished
import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@sanity/client";

const INCLUDE_UNPUBLISHED = process.argv.includes("--include-unpublished");

// Patterns that strongly indicate stored HTML entities. We match each
// separately so the report shows which entity appeared.
const ENTITY_PATTERNS = [
  { name: "&#039; / &#39; (apostrophe)", re: /&#0?39;/g },
  { name: "&apos; (apostrophe)", re: /&apos;/g },
  { name: "&quot; (double quote)", re: /&quot;/g },
  { name: "&amp; (ampersand)", re: /&amp;/g },
  { name: "&lt; (less-than)", re: /&lt;/g },
  { name: "&gt; (greater-than)", re: /&gt;/g },
  { name: "&nbsp; (non-breaking space)", re: /&nbsp;/g },
  // Catch-all for any other numeric or named entity not in the list above.
  { name: "other &#NNN; / &name;", re: /&(?:#\d+|[a-zA-Z]+);/g },
];

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

// Walk a document recursively. For each string value, run it through
// the patterns and record any hits. Returns a list of
// { path, value, hits } where hits is a list of pattern names.
function scanDocument(doc) {
  const findings = [];
  function walk(value, pathParts) {
    if (value == null) return;
    if (typeof value === "string") {
      const hits = [];
      const seen = new Set();
      for (const { name, re } of ENTITY_PATTERNS) {
        re.lastIndex = 0;
        const matches = value.match(re);
        if (matches && matches.length > 0) {
          // De-dupe: the catch-all will fire alongside specific
          // entries; only record the catch-all if NOTHING specific
          // matched.
          if (name.startsWith("other ")) {
            // Skip if a specific pattern already fired.
            if (hits.length > 0) continue;
          }
          if (!seen.has(name)) {
            hits.push({ name, count: matches.length, sample: matches[0] });
            seen.add(name);
          }
        }
      }
      if (hits.length > 0) {
        findings.push({
          path: pathParts.join("."),
          value,
          hits,
        });
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, idx) => walk(item, pathParts.concat(`[${idx}]`)));
      return;
    }
    if (typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        if (k.startsWith("_")) continue; // skip _id, _type, _rev, etc.
        walk(v, pathParts.concat(k));
      }
    }
  }
  walk(doc, []);
  return findings;
}

function truncate(str, max = 120) {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + "…";
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

  const filter = INCLUDE_UNPUBLISHED
    ? '*[_type == "therapist"]'
    : '*[_type == "therapist" && listingActive == true && status == "active" && visibilityIntent == "listed"]';

  console.log(`Fetching ${INCLUDE_UNPUBLISHED ? "ALL" : "live"} therapists…`);
  const docs = await client.fetch(`${filter} | order(name asc)`);
  console.log(`Scanning ${docs.length} document(s) for stored HTML entities.\n`);

  const affected = [];
  const entityTotals = new Map();

  for (const doc of docs) {
    const findings = scanDocument(doc);
    if (findings.length > 0) {
      affected.push({ doc, findings });
      for (const f of findings) {
        for (const h of f.hits) {
          entityTotals.set(h.name, (entityTotals.get(h.name) || 0) + h.count);
        }
      }
    }
  }

  if (affected.length === 0) {
    console.log("Clean — no stored HTML entities detected.");
    return;
  }

  console.log(`Affected therapists: ${affected.length} / ${docs.length}\n`);
  console.log("Entity occurrence totals:");
  for (const [name, count] of [...entityTotals.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name.padEnd(34)} ${count}`);
  }

  console.log("\nPer-therapist breakdown (path → sample → entities):");
  for (const { doc, findings } of affected) {
    console.log(`\n  ${doc.name || "(no name)"}  [${doc._id}]  slug=${doc.slug?.current || ""}`);
    for (const f of findings) {
      const entityList = f.hits.map((h) => `${h.name}×${h.count}`).join(", ");
      console.log(`    .${f.path}`);
      console.log(`      ${truncate(f.value)}`);
      console.log(`      → ${entityList}`);
    }
  }

  console.log(
    `\nDone. ${affected.length} therapist document(s) contain HTML entities in stored text.`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exitCode = 1;
});
