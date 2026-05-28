#!/usr/bin/env node
// Broader audit than scripts/audit-html-entities-in-therapists.mjs —
// scans EVERY document type in Sanity (including drafts) for stored
// HTML entities. Catches any therapist applications, candidates, or
// other content that might contain the same ingestion artifact as the
// 9 live therapist documents already cleaned.
//
// Read-only. Reports counts per doc-type so we can decide which types
// need a follow-up decode.
//
// Usage:
//   node scripts/audit-html-entities-everywhere.mjs
import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@sanity/client";

const ENTITY_PATTERNS = [
  { name: "&#039; / &#39; (apostrophe)", re: /&#0?39;/g },
  { name: "&apos; (apostrophe)", re: /&apos;/g },
  { name: "&quot; (double quote)", re: /&quot;/g },
  { name: "&amp; (ampersand)", re: /&amp;/g },
  { name: "&lt; / &gt; (angle brackets)", re: /&(?:lt|gt);/g },
  { name: "&nbsp; (non-breaking space)", re: /&nbsp;/g },
  { name: "other &#NNN; / &#xHHH; / &name;", re: /&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g },
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

function scanDocument(doc) {
  const findings = [];
  function walk(value, pathParts) {
    if (value == null) return;
    if (typeof value === "string") {
      const hits = [];
      for (const { name, re } of ENTITY_PATTERNS) {
        re.lastIndex = 0;
        const matches = value.match(re);
        if (matches && matches.length > 0) {
          if (name.startsWith("other ") && hits.length > 0) continue;
          hits.push({ name, count: matches.length, sample: matches[0] });
        }
      }
      if (hits.length > 0) {
        findings.push({ path: pathParts.join("."), value, hits });
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, idx) => walk(item, pathParts.concat(`[${idx}]`)));
      return;
    }
    if (typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        if (k.startsWith("_")) continue;
        walk(v, pathParts.concat(k));
      }
    }
  }
  walk(doc, []);
  return findings;
}

function truncate(s, max = 140) {
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

  // First find every distinct document type in the dataset.
  console.log("Discovering document types…");
  const typeCounts = await client.fetch(
    `array::unique(*[]._type) | order(@ asc)
       | { "types": @ }`,
  );
  // Sanity returns the projection result directly; normalize:
  const types = Array.isArray(typeCounts?.types)
    ? typeCounts.types
    : await client.fetch(`array::unique(*[]._type)`);
  console.log(`Found ${types.length} document type(s): ${types.join(", ")}\n`);

  const perTypeReport = [];

  for (const type of types) {
    // Include drafts by fetching ALL documents of this type (drafts
    // live under `drafts.<id>` and are returned by *[_type==...] when
    // the query is unauthenticated to the public dataset; with the
    // SANITY_API_TOKEN they're visible explicitly).
    const docs = await client.fetch(`*[_type == $type]`, { type });
    const affected = [];
    for (const doc of docs) {
      const findings = scanDocument(doc);
      if (findings.length > 0) affected.push({ doc, findings });
    }
    perTypeReport.push({ type, total: docs.length, affected });
  }

  console.log("Per-type summary:");
  console.log("─".repeat(72));
  for (const { type, total, affected } of perTypeReport) {
    const flag = affected.length > 0 ? "⚠ " : "  ";
    console.log(`${flag}${type.padEnd(38)} ${affected.length.toString().padStart(4)} / ${total}`);
  }

  const anyAffected = perTypeReport.some((r) => r.affected.length > 0);
  if (!anyAffected) {
    console.log("\nClean — no stored HTML entities detected anywhere in the dataset.");
    return;
  }

  console.log("\n\nDetailed findings for types with hits:");
  console.log("═".repeat(72));
  for (const { type, affected } of perTypeReport) {
    if (affected.length === 0) continue;
    console.log(`\n■ ${type}  (${affected.length} affected document(s))`);
    for (const { doc, findings } of affected) {
      const label = doc.name || doc.title || doc.email || doc._id;
      console.log(`\n  ${label}  [${doc._id}]`);
      for (const f of findings) {
        const entityList = f.hits.map((h) => `${h.name}×${h.count}`).join(", ");
        console.log(`    .${f.path}`);
        console.log(`      ${truncate(f.value)}`);
        console.log(`      → ${entityList}`);
      }
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exitCode = 1;
});
