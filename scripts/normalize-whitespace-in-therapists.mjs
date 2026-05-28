#!/usr/bin/env node
// Collapse runs of 3+ consecutive spaces, runs of 3+ newlines, and
// stray tab characters in therapist text fields. Also trims leading/
// trailing whitespace.
//
// Caught one therapist (Nathaniel Mills) where the earlier &nbsp;
// → " " decode left "License:   23861   Psychotherapy" (multiple
// spaces). Cosmetic but worth cleaning up while we're polishing the
// corpus.
//
// Read-only by default. Use --apply to commit.
//
// Usage:
//   node scripts/normalize-whitespace-in-therapists.mjs
//   node scripts/normalize-whitespace-in-therapists.mjs --apply
import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@sanity/client";

const APPLY = process.argv.includes("--apply");

// Same patient-facing fields as the audit. We're conservative and
// don't touch admin-only fields (notes, rejectionReason, etc.) — those
// can have intentional structure we don't want to mash.
const FIELDS = [
  "name",
  "credentials",
  "title",
  "practiceName",
  "city",
  "bio",
  "bioPreview",
  "careApproach",
  "contactGuidance",
  "firstStepExpectation",
  "estimatedWaitTime",
];

// Normalize a single string. Returns the cleaned form, which equals
// the input when there was nothing to fix.
function normalize(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(/\t/g, " ") // tabs → single space
    .replace(/ {2,}/g, " ") // 2+ spaces → 1
    .replace(/\n{3,}/g, "\n\n") // 3+ newlines → paragraph break
    .replace(/[ \t]+$/gm, "") // trim trailing space on each line
    .trim();
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
  const env = readEnvFile(path.join(process.cwd(), ".env"));
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
    const changes = {};
    for (const field of FIELDS) {
      const original = doc[field];
      if (typeof original !== "string") continue;
      const cleaned = normalize(original);
      if (cleaned !== original) {
        changes[field] = { before: original, after: cleaned };
      }
    }
    if (Object.keys(changes).length > 0) {
      plans.push({ doc, changes });
    }
  }

  if (plans.length === 0) {
    console.log("Nothing to normalize. Done.");
    return;
  }

  console.log(`${plans.length} therapist(s) will be normalized:\n`);
  for (const { doc, changes } of plans) {
    console.log(`  ${doc.name}  [${doc._id}]`);
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
