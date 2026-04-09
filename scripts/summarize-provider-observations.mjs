import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";
import { annotateProviderFieldObservationForDisplay } from "../shared/provider-field-observation-domain.mjs";

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
  const outputArg = argv.find((item) => item.startsWith("--output="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : 500;
  const outputPath = outputArg ? String(outputArg.split("=")[1] || "").trim() : "";
  return {
    providerId: String(providerId || "").trim(),
    limit: Number.isFinite(limit) && limit > 0 ? limit : 500,
    outputPath,
  };
}

function bumpCounter(map, key) {
  const normalized = String(key || "").trim();
  if (!normalized) {
    return;
  }
  map.set(normalized, (map.get(normalized) || 0) + 1);
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

function summarize(providerId, observations) {
  const fieldCounts = new Map();
  const sourceTypeCounts = new Map();
  const verificationMethodCounts = new Map();
  const currentStateCounts = new Map();
  let withConfidence = 0;
  let totalConfidence = 0;
  let oldestObservedAt = "";
  let newestObservedAt = "";

  observations.forEach(function (observation) {
    bumpCounter(fieldCounts, observation.labels && observation.labels.fieldName ? observation.labels.fieldName : observation.fieldName);
    bumpCounter(sourceTypeCounts, observation.labels && observation.labels.sourceType ? observation.labels.sourceType : observation.sourceType);
    bumpCounter(
      verificationMethodCounts,
      observation.labels && observation.labels.verificationMethod
        ? observation.labels.verificationMethod
        : observation.verificationMethod,
    );
    bumpCounter(currentStateCounts, observation.labels && observation.labels.currentState ? observation.labels.currentState : observation.isCurrent ? "Current" : "Historical");

    if (typeof observation.confidenceScore === "number" && Number.isFinite(observation.confidenceScore)) {
      withConfidence += 1;
      totalConfidence += observation.confidenceScore;
    }

    if (observation.observedAt) {
      if (!oldestObservedAt || observation.observedAt < oldestObservedAt) {
        oldestObservedAt = observation.observedAt;
      }
      if (!newestObservedAt || observation.observedAt > newestObservedAt) {
        newestObservedAt = observation.observedAt;
      }
    }
  });

  return {
    generatedAt: new Date().toISOString(),
    providerId,
    totals: {
      observations: observations.length,
      current: observations.filter((item) => item.isCurrent !== false).length,
      historical: observations.filter((item) => item.isCurrent === false).length,
      fieldsCovered: new Set(observations.map((item) => item.fieldName).filter(Boolean)).size,
      avgConfidence:
        withConfidence > 0 ? Number((totalConfidence / withConfidence).toFixed(2)) : null,
    },
    recency: {
      oldestObservedAt,
      newestObservedAt,
    },
    breakdowns: {
      fields: topEntries(fieldCounts, 20),
      sourceTypes: topEntries(sourceTypeCounts, 10),
      verificationMethods: topEntries(verificationMethodCounts, 10),
      currentStates: topEntries(currentStateCounts, 10),
    },
    notes: observations.length === 0 ? ["No provider observations found for this provider ID yet."] : [],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.providerId) {
    throw new Error(
      "Missing provider ID. Usage: node scripts/summarize-provider-observations.mjs provider-ca-12345",
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

  const rawObservations = await client.fetch(
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

  const observations = Array.isArray(rawObservations)
    ? rawObservations.map(annotateProviderFieldObservationForDisplay)
    : [];
  const summary = summarize(args.providerId, observations);
  const output = JSON.stringify(summary, null, 2);

  if (args.outputPath) {
    const resolved = path.resolve(ROOT, args.outputPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, output);
    console.log(
      JSON.stringify(
        {
          ok: true,
          providerId: args.providerId,
          outputPath: resolved,
          observations: observations.length,
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
