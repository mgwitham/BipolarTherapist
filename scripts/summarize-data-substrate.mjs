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
  const sampleLimitArg = argv.find((item) => item.startsWith("--sample-limit="));
  const outputArg = argv.find((item) => item.startsWith("--output="));
  const sampleLimit = sampleLimitArg ? Number(sampleLimitArg.split("=")[1]) : 500;
  const outputPath = outputArg ? String(outputArg.split("=")[1] || "").trim() : "";
  return {
    sampleLimit: Number.isFinite(sampleLimit) && sampleLimit > 0 ? sampleLimit : 500,
    outputPath,
  };
}

function topEntries(map, limit = 10) {
  return Array.from(map.entries())
    .sort(function (left, right) {
      return right[1] - left[1] || left[0].localeCompare(right[0]);
    })
    .slice(0, limit)
    .map(function ([value, count]) {
      return { value, count };
    });
}

function bumpCounter(map, key) {
  const normalized = String(key || "").trim();
  if (!normalized) {
    return;
  }
  map.set(normalized, (map.get(normalized) || 0) + 1);
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

  const [observations, requests, outcomes] = await Promise.all([
    client.fetch(
      `*[_type == "providerFieldObservation"][0...$limit]{
        providerId,
        fieldName,
        sourceType,
        verificationMethod,
        isCurrent
      }`,
      { limit: args.sampleLimit },
    ),
    client.fetch(
      `*[_type == "matchRequest"][0...$limit]{
        requestId,
        careState,
        careFormat,
        careIntent,
        priorityMode,
        urgency
      }`,
      { limit: args.sampleLimit },
    ),
    client.fetch(
      `*[_type == "matchOutcome"][0...$limit]{
        outcomeId,
        requestId,
        providerId,
        routeType,
        outcome
      }`,
      { limit: args.sampleLimit },
    ),
  ]);

  const fieldCounts = new Map();
  const providerCounts = new Map();
  const sourceTypeCounts = new Map();
  const verificationMethodCounts = new Map();
  const outcomeCounts = new Map();
  const routeTypeCounts = new Map();
  const careStateCounts = new Map();

  (Array.isArray(observations) ? observations : []).forEach(function (item) {
    bumpCounter(fieldCounts, item.fieldName);
    bumpCounter(providerCounts, item.providerId);
    bumpCounter(sourceTypeCounts, item.sourceType);
    bumpCounter(verificationMethodCounts, item.verificationMethod);
  });

  (Array.isArray(outcomes) ? outcomes : []).forEach(function (item) {
    bumpCounter(outcomeCounts, item.outcome);
    bumpCounter(routeTypeCounts, item.routeType);
  });

  (Array.isArray(requests) ? requests : []).forEach(function (item) {
    bumpCounter(careStateCounts, item.careState);
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    sampleLimit: args.sampleLimit,
    totals: {
      providerObservations: Array.isArray(observations) ? observations.length : 0,
      providersWithObservations: providerCounts.size,
      matchRequests: Array.isArray(requests) ? requests.length : 0,
      matchOutcomes: Array.isArray(outcomes) ? outcomes.length : 0,
    },
    readiness: {
      providerObservationLayerReady: providerCounts.size > 0,
      matchLearningLayerReady:
        (Array.isArray(requests) ? requests.length : 0) > 0 || (Array.isArray(outcomes) ? outcomes.length : 0) > 0,
    },
    breakdowns: {
      providerObservationFields: topEntries(fieldCounts, 15),
      providersWithMostObservations: topEntries(providerCounts, 10),
      providerObservationSourceTypes: topEntries(sourceTypeCounts, 10),
      providerObservationVerificationMethods: topEntries(verificationMethodCounts, 10),
      matchOutcomes: topEntries(outcomeCounts, 10),
      matchRouteTypes: topEntries(routeTypeCounts, 10),
      matchCareStates: topEntries(careStateCounts, 10),
    },
    notes: [
      providerCounts.size === 0 ? "No provider observations found in the current sample." : "",
      (Array.isArray(requests) ? requests.length : 0) === 0 ? "No persisted match requests found in the current sample." : "",
      (Array.isArray(outcomes) ? outcomes.length : 0) === 0 ? "No persisted match outcomes found in the current sample." : "",
    ].filter(Boolean),
  };

  const output = JSON.stringify(summary, null, 2);
  if (args.outputPath) {
    const resolved = path.resolve(ROOT, args.outputPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, output);
    console.log(
      JSON.stringify(
        {
          ok: true,
          outputPath: resolved,
          totals: summary.totals,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(output);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
