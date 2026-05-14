#!/usr/bin/env node
// Override acceptingNewPatients=true on every live therapist on the public
// directory. Product call: legacy ingested profiles or admin-toggled ones
// were silently filtering themselves out of search and matching. Reset the
// baseline so every live profile is accepting; therapists can flip the
// toggle in their portal if they're actually full.
//
// "Live" mirrors the public directory query in server/public-content-handler.mjs:
//   listingActive == true && status == "active" && visibilityIntent == "listed"
//
// Usage:
//   node scripts/backfill-accepting-new-patients.mjs            # dry run
//   node scripts/backfill-accepting-new-patients.mjs --apply    # commit
import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@sanity/client";

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
  const root = process.cwd();
  const env = readEnvFile(path.join(root, ".env"));

  const client = createClient({
    projectId: process.env.VITE_SANITY_PROJECT_ID || env.VITE_SANITY_PROJECT_ID,
    dataset: process.env.VITE_SANITY_DATASET || env.VITE_SANITY_DATASET || "production",
    apiVersion: process.env.VITE_SANITY_API_VERSION || env.VITE_SANITY_API_VERSION || "2026-04-02",
    token: process.env.SANITY_API_TOKEN || env.SANITY_API_TOKEN,
    useCdn: false,
  });

  const docs = await client.fetch(
    `*[_type == "therapist"
        && listingActive == true
        && status == "active"
        && visibilityIntent == "listed"]
      | order(name asc){ _id, name, acceptingNewPatients }`,
  );

  console.log(`Found ${docs.length} live therapist(s).`);

  const needsUpdate = docs.filter((d) => d.acceptingNewPatients !== true);
  const alreadyAccepting = docs.length - needsUpdate.length;

  console.log(`  ${alreadyAccepting} already acceptingNewPatients=true (skip)`);
  console.log(`  ${needsUpdate.length} will be flipped to true`);

  if (needsUpdate.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  console.log("\nProfiles to update:");
  for (const d of needsUpdate) {
    console.log(
      `  - ${d.name} (${d._id}) — current=${JSON.stringify(d.acceptingNewPatients ?? null)}`,
    );
  }

  if (!APPLY) {
    console.log("\nDRY RUN — pass --apply to commit.");
    return;
  }

  console.log("\nApplying patches…");
  let tx = client.transaction();
  for (const d of needsUpdate) {
    tx = tx.patch(d._id, (p) => p.set({ acceptingNewPatients: true }));
  }
  const result = await tx.commit();
  console.log(`Committed ${result.results.length} patch(es).`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
