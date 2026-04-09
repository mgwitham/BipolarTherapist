import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";

const ROOT = process.cwd();
const API_VERSION = "2026-04-02";

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
  const providerId = argv.find((item) => !item.startsWith("--")) || "";
  const limitArg = argv.find((item) => item.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : 50;
  return {
    providerId: String(providerId || "").trim(),
    limit: Number.isFinite(limit) && limit > 0 ? limit : 50,
  };
}

function summarize(observations) {
  const fields = Array.from(
    new Set(
      observations
        .map((item) => String(item.fieldName || "").trim())
        .filter(Boolean),
    ),
  ).sort();

  return {
    observationCount: observations.length,
    fields,
    observations,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.providerId) {
    throw new Error(
      "Missing provider ID. Usage: node scripts/inspect-provider-observations.mjs provider-ca-12345",
    );
  }

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

  const observations = await client.fetch(
    `*[_type == "providerFieldObservation" && providerId == $providerId] | order(fieldName asc)[0...$limit]{
      _id,
      providerId,
      fieldName,
      rawValue,
      normalizedValue,
      sourceType,
      sourceDocumentType,
      sourceDocumentId,
      sourceUrl,
      observedAt,
      verifiedAt,
      confidenceScore,
      verificationMethod,
      isCurrent
    }`,
    {
      providerId: args.providerId,
      limit: args.limit,
    },
  );

  console.log(JSON.stringify(summarize(observations || []), null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
