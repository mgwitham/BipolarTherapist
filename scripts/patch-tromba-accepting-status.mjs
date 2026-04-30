#!/usr/bin/env node
// One-shot patch for Christopher Joel Tromba's therapist document.
// His acceptingNewPatients field was set to false at ingest time, which
// triggers a hard constraint failure in the matching model and removes
// him from all match results entirely. Unsetting the field (null) downgrades
// to the soft "status not confirmed" caution path instead.
//
// Usage:
//   node scripts/patch-tromba-accepting-status.mjs            # dry run
//   node scripts/patch-tromba-accepting-status.mjs --apply    # commit
import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@sanity/client";

const APPLY = process.argv.includes("--apply");
const THERAPIST_ID = "therapist-christopher-joel-tromba-los-angeles-ca";

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

  const doc = await client.fetch(`*[_id == $id][0]{ _id, _type, name, acceptingNewPatients }`, {
    id: THERAPIST_ID,
  });

  if (!doc) {
    console.error(`Document not found: ${THERAPIST_ID}`);
    process.exitCode = 1;
    return;
  }

  if (doc._type !== "therapist") {
    console.error(`Unexpected type "${doc._type}" for ${THERAPIST_ID}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Document: ${doc.name} (${doc._id})`);
  console.log(`Current acceptingNewPatients: ${JSON.stringify(doc.acceptingNewPatients)}`);

  if (doc.acceptingNewPatients === null || doc.acceptingNewPatients === undefined) {
    console.log("Field is already null/unset — nothing to do.");
    return;
  }

  console.log(
    APPLY
      ? "Unsetting acceptingNewPatients…"
      : "DRY RUN — would unset acceptingNewPatients (pass --apply to commit)",
  );

  if (APPLY) {
    await client.patch(THERAPIST_ID).unset(["acceptingNewPatients"]).commit();
    const after = await client.fetch(`*[_id == $id][0]{ _id, name, acceptingNewPatients }`, {
      id: THERAPIST_ID,
    });
    console.log(`After: acceptingNewPatients = ${JSON.stringify(after.acceptingNewPatients)}`);
    console.log("Done.");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
