// One-shot: backfill providerId + licenseState for therapist docs that
// have a licenseNumber but no providerId. Pre-cleanup tidy so all 156
// live therapists become first-class addressable docs.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";

const ROOT = process.cwd();
const API_VERSION = "2026-04-02";

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .reduce((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return acc;
      const sep = trimmed.indexOf("=");
      if (sep === -1) return acc;
      acc[trimmed.slice(0, sep).trim()] = trimmed.slice(sep + 1).trim();
      return acc;
    }, {});
}

function getConfig() {
  const rootEnv = readEnvFile(path.join(ROOT, ".env"));
  const studioEnv = readEnvFile(path.join(ROOT, "studio", ".env"));
  return {
    projectId:
      process.env.SANITY_PROJECT_ID ||
      process.env.VITE_SANITY_PROJECT_ID ||
      rootEnv.VITE_SANITY_PROJECT_ID ||
      studioEnv.SANITY_STUDIO_PROJECT_ID,
    dataset:
      process.env.SANITY_DATASET ||
      process.env.VITE_SANITY_DATASET ||
      rootEnv.VITE_SANITY_DATASET ||
      studioEnv.SANITY_STUDIO_DATASET,
    apiVersion: process.env.SANITY_API_VERSION || rootEnv.VITE_SANITY_API_VERSION || API_VERSION,
    token:
      process.env.SANITY_API_TOKEN || rootEnv.SANITY_API_TOKEN || studioEnv.SANITY_API_TOKEN || "",
  };
}

function buildProviderId(licenseState, licenseNumber) {
  const state = String(licenseState || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const license = String(licenseNumber || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (!state || !license) return null;
  return `provider-${state}-${license}`;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const config = getConfig();
  if (!config.token) {
    console.error("Missing SANITY_API_TOKEN");
    process.exit(1);
  }
  const client = createClient({ ...config, useCdn: false });

  const docs = await client.fetch(
    `*[_type=='therapist' && !defined(providerId) && defined(licenseNumber)]{_id, name, licenseNumber, licenseState, slug}`,
  );

  console.log(`Found ${docs.length} therapist docs without providerId.\n`);

  const tx = client.transaction();
  const ops = [];
  for (const doc of docs) {
    const state = doc.licenseState || "CA";
    const providerId = buildProviderId(state, doc.licenseNumber);
    if (!providerId) {
      console.log(`  SKIP ${doc._id} — cannot mint providerId (state=${state}, license=${doc.licenseNumber})`);
      continue;
    }
    const patch = { providerId };
    if (!doc.licenseState) patch.licenseState = state;
    ops.push({ id: doc._id, name: doc.name, patch });
    tx.patch(doc._id, { set: patch });
    console.log(`  ${doc._id}`);
    console.log(`    name: ${doc.name}`);
    console.log(`    set: ${JSON.stringify(patch)}`);
  }

  if (!ops.length) {
    console.log("\nNothing to patch.");
    return;
  }

  if (dryRun) {
    console.log(`\nDRY RUN — ${ops.length} docs would be patched. Re-run without --dry-run to commit.`);
    return;
  }

  console.log(`\nCommitting ${ops.length} patches...`);
  await tx.commit();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
