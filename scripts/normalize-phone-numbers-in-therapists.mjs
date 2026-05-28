#!/usr/bin/env node
// One-pass normalization of stored therapist phone numbers to the
// canonical US display format `(NNN) NNN-NNNN`. Most of the corpus
// already matches; this script picks up the few records that came in
// as bare digits, E.164, dashed, or otherwise non-canonical.
//
// Going forward all three write paths (signup, portal editor, CSV
// importers) run input through formatPhoneUS at the boundary so
// drift can't reappear. This script is just for the existing rows.
//
// Usage:
//   node scripts/normalize-phone-numbers-in-therapists.mjs            # dry run
//   node scripts/normalize-phone-numbers-in-therapists.mjs --apply    # commit
import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@sanity/client";

import { formatPhoneUS } from "../shared/phone-format.mjs";

const APPLY = process.argv.includes("--apply");

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
        && visibilityIntent == "listed"
        && defined(phone) && phone != ""]{ _id, name, phone }`,
  );
  console.log(`Scanning ${docs.length} document(s) with non-empty phone.\n`);

  const plans = [];
  for (const doc of docs) {
    const before = String(doc.phone || "").trim();
    const after = formatPhoneUS(before);
    if (after !== before && after !== "") {
      plans.push({ doc, before, after });
    }
  }

  if (plans.length === 0) {
    console.log("Nothing to normalize. Done.");
    return;
  }

  console.log(`${plans.length} therapist(s) will be normalized:\n`);
  for (const { doc, before, after } of plans) {
    console.log(`  ${doc.name.padEnd(38)}  ${before}  →  ${after}`);
  }

  if (!APPLY) {
    console.log("\nDRY RUN — pass --apply to commit.");
    return;
  }

  console.log("\nApplying patches…");
  let tx = client.transaction();
  for (const { doc, after } of plans) {
    tx = tx.patch(doc._id, (p) => p.set({ phone: after }));
  }
  const result = await tx.commit();
  console.log(`Committed ${result.results.length} patch(es).`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exitCode = 1;
});
