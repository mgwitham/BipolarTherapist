import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";

import { buildProviderId } from "../shared/therapist-domain.mjs";

const ROOT = process.cwd();
const API_VERSION = "2026-04-02";
const OUTPUT_JSON = path.join(ROOT, "data", "import", "generated-provider-id-backfill-preview.json");

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .reduce((accumulator, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return accumulator;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) {
        return accumulator;
      }

      accumulator[trimmed.slice(0, separatorIndex).trim()] = trimmed.slice(separatorIndex + 1).trim();
      return accumulator;
    }, {});
}

function getConfig() {
  const rootEnv = readEnvFile(path.join(ROOT, ".env"));
  const studioEnv = readEnvFile(path.join(ROOT, "studio", ".env"));

  return {
    projectId:
      process.env.SANITY_PROJECT_ID ||
      process.env.VITE_SANITY_PROJECT_ID ||
      process.env.SANITY_STUDIO_PROJECT_ID ||
      rootEnv.VITE_SANITY_PROJECT_ID ||
      studioEnv.SANITY_STUDIO_PROJECT_ID,
    dataset:
      process.env.SANITY_DATASET ||
      process.env.VITE_SANITY_DATASET ||
      process.env.SANITY_STUDIO_DATASET ||
      rootEnv.VITE_SANITY_DATASET ||
      studioEnv.SANITY_STUDIO_DATASET,
    apiVersion: process.env.SANITY_API_VERSION || rootEnv.VITE_SANITY_API_VERSION || API_VERSION,
    token:
      process.env.SANITY_API_TOKEN || rootEnv.SANITY_API_TOKEN || studioEnv.SANITY_API_TOKEN || "",
  };
}

function parseArgs(argv) {
  const limitArg = argv.find((item) => item.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : 500;
  return {
    write: argv.includes("--write"),
    limit: Number.isFinite(limit) && limit > 0 ? limit : 500,
  };
}

function normalizeText(value) {
  return String(value || "").trim();
}

async function fetchData(client, limit) {
  return client.fetch(
    `*[_type in ["therapist", "therapistApplication", "therapistCandidate", "licensureRecord"] && !defined(providerId)][0...$limit]{
      _id,
      _type,
      providerId,
      name,
      city,
      state,
      licenseState,
      licenseNumber
    }`,
    { limit },
  );
}

function buildPatches(records) {
  return records.map((record) => ({
    id: normalizeText(record._id),
    type: normalizeText(record._type),
    currentProviderId: normalizeText(record.providerId),
    nextProviderId: buildProviderId(record),
    name: normalizeText(record.name),
    city: normalizeText(record.city),
    state: normalizeText(record.state),
    licenseState: normalizeText(record.licenseState),
    licenseNumber: normalizeText(record.licenseNumber),
  }));
}

async function applyPatches(client, patches) {
  if (!patches.length) {
    return { updated: 0 };
  }

  const transaction = client.transaction();
  patches.forEach((patch) => {
    transaction.patch(patch.id, (builder) => builder.set({ providerId: patch.nextProviderId }));
  });
  await transaction.commit();
  return { updated: patches.length };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = getConfig();

  if (!config.projectId || !config.dataset) {
    throw new Error("Missing Sanity configuration. Set project ID and dataset env vars first.");
  }

  const client = createClient({
    projectId: config.projectId,
    dataset: config.dataset,
    apiVersion: config.apiVersion,
    token: config.token || undefined,
    useCdn: false,
  });

  const records = await fetchData(client, args.limit);
  const patches = buildPatches(records);

  fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
  fs.writeFileSync(
    OUTPUT_JSON,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        recordCount: records.length,
        patches,
      },
      null,
      2,
    ),
    "utf8",
  );

  if (args.write) {
    const result = await applyPatches(client, patches);
    console.log(`Updated ${result.updated} records with provider IDs.`);
    return;
  }

  console.log(`Prepared ${patches.length} provider ID backfill patches.`);
  console.log(`Saved preview to ${OUTPUT_JSON}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
