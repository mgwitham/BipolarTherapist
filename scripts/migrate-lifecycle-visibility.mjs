#!/usr/bin/env node
// One-shot migration: backfill `lifecycle` and `visibilityIntent` on every
// existing therapist document.
//
// Mapping:
//   - listingActive === true && status === "active" → lifecycle="approved",
//     visibilityIntent="listed"
//   - everything else → lifecycle="draft", visibilityIntent="hidden"
//
// Idempotent: documents that already have the correct lifecycle and
// visibilityIntent are skipped (no patch is written).
//
// Usage:
//   node scripts/migrate-lifecycle-visibility.mjs            # dry run
//   node scripts/migrate-lifecycle-visibility.mjs --apply    # commit changes
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";

const APPLY = process.argv.includes("--apply");
const ROOT = process.cwd();

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

function expectedFields(doc) {
  if (doc.listingActive === true && doc.status === "active") {
    return { lifecycle: "approved", visibilityIntent: "listed" };
  }
  return { lifecycle: "draft", visibilityIntent: "hidden" };
}

async function main() {
  const env = readEnvFile(path.join(ROOT, ".env"));

  const client = createClient({
    projectId: process.env.VITE_SANITY_PROJECT_ID || env.VITE_SANITY_PROJECT_ID,
    dataset: process.env.VITE_SANITY_DATASET || env.VITE_SANITY_DATASET || "production",
    apiVersion: process.env.VITE_SANITY_API_VERSION || env.VITE_SANITY_API_VERSION || "2026-04-02",
    token: process.env.SANITY_API_TOKEN || env.SANITY_API_TOKEN,
    useCdn: false,
  });

  console.log("Fetching all therapist documents…");
  const docs = await client.fetch(
    `*[_type == "therapist"]{
      _id, name, status, listingActive, lifecycle, visibilityIntent
    }`,
  );
  console.log(`  Found ${docs.length} therapists`);

  const distribution = {
    approved_listed: 0,
    draft_hidden: 0,
  };
  const toPatch = [];
  let alreadyOk = 0;

  for (const doc of docs) {
    const want = expectedFields(doc);
    if (want.lifecycle === "approved") distribution.approved_listed += 1;
    else distribution.draft_hidden += 1;

    if (doc.lifecycle === want.lifecycle && doc.visibilityIntent === want.visibilityIntent) {
      alreadyOk += 1;
      continue;
    }
    toPatch.push({
      id: doc._id,
      name: doc.name,
      from: { lifecycle: doc.lifecycle || null, visibilityIntent: doc.visibilityIntent || null },
      to: want,
    });
  }

  console.log("\n=== Migration plan ===");
  console.log(`  Resulting distribution:`);
  console.log(`    approved + listed:  ${distribution.approved_listed}`);
  console.log(`    draft + hidden:     ${distribution.draft_hidden}`);
  console.log(`  Already at target:    ${alreadyOk}`);
  console.log(`  Will patch:           ${toPatch.length}`);

  if (!toPatch.length) {
    console.log("\nNothing to do. Migration is idempotent — no further runs needed.");
    return;
  }

  if (!APPLY) {
    console.log("\nDRY RUN — would patch (sample first 10):");
    for (const entry of toPatch.slice(0, 10)) {
      console.log(
        `  ${entry.id}  ${JSON.stringify(entry.from)} → ${JSON.stringify(entry.to)}  (${entry.name})`,
      );
    }
    console.log("\nPass --apply to commit.");
    return;
  }

  console.log("\nApplying patches…");
  let patched = 0;
  for (const entry of toPatch) {
    await client.patch(entry.id).set(entry.to).commit();
    patched += 1;
    if (patched % 25 === 0) console.log(`  …${patched}/${toPatch.length}`);
  }
  console.log(`\nApplied ${patched} patches. Re-run the script to verify idempotence.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
