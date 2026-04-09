import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";
import {
  annotateMatchOutcomeForDisplay,
  annotateMatchRequestForDisplay,
} from "../shared/match-persistence-domain.mjs";

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
  const limitArg = argv.find((item) => item.startsWith("--limit="));
  const outputArg = argv.find((item) => item.startsWith("--output="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : 500;
  const outputPath = outputArg ? String(outputArg.split("=")[1] || "").trim() : "";
  return {
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

function topEntries(map, limit = 5) {
  return Array.from(map.entries())
    .sort(function (left, right) {
      return right[1] - left[1] || left[0].localeCompare(right[0]);
    })
    .slice(0, limit)
    .map(function ([value, count]) {
      return { value, count };
    });
}

function summarize(requests, outcomes) {
  const outcomesByRequestId = new Map();
  const outcomeCounts = new Map();
  const routeTypeCounts = new Map();
  const careStateCounts = new Map();
  const careFormatCounts = new Map();
  const careIntentCounts = new Map();
  const priorityModeCounts = new Map();
  const urgencyCounts = new Map();
  const providerOutcomeCounts = new Map();

  outcomes.forEach(function (outcome) {
    const requestId = String(outcome.requestId || "").trim();
    if (requestId) {
      outcomesByRequestId.set(requestId, (outcomesByRequestId.get(requestId) || 0) + 1);
    }
    bumpCounter(outcomeCounts, outcome.labels && outcome.labels.outcome ? outcome.labels.outcome : outcome.outcome);
    bumpCounter(routeTypeCounts, outcome.labels && outcome.labels.routeType ? outcome.labels.routeType : outcome.routeType);
    bumpCounter(providerOutcomeCounts, outcome.providerId || outcome.therapistSlug || "");
  });

  requests.forEach(function (request) {
    bumpCounter(careStateCounts, request.careState);
    bumpCounter(careFormatCounts, request.labels && request.labels.careFormat ? request.labels.careFormat : request.careFormat);
    bumpCounter(careIntentCounts, request.labels && request.labels.careIntent ? request.labels.careIntent : request.careIntent);
    bumpCounter(priorityModeCounts, request.labels && request.labels.priorityMode ? request.labels.priorityMode : request.priorityMode);
    bumpCounter(urgencyCounts, request.labels && request.labels.urgency ? request.labels.urgency : request.urgency);
  });

  const requestsWithOutcomes = requests.filter(function (request) {
    return outcomesByRequestId.has(String(request.requestId || "").trim());
  }).length;

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      requests: requests.length,
      outcomes: outcomes.length,
      requestsWithOutcomes,
      requestsWithoutOutcomes: Math.max(0, requests.length - requestsWithOutcomes),
      avgOutcomesPerRequest:
        requests.length > 0 ? Number((outcomes.length / requests.length).toFixed(2)) : 0,
    },
    breakdowns: {
      outcomes: topEntries(outcomeCounts, 10),
      routeTypes: topEntries(routeTypeCounts, 10),
      careStates: topEntries(careStateCounts, 10),
      careFormats: topEntries(careFormatCounts, 10),
      careIntents: topEntries(careIntentCounts, 10),
      priorityModes: topEntries(priorityModeCounts, 10),
      urgencies: topEntries(urgencyCounts, 10),
      providersWithRecordedOutcomes: topEntries(providerOutcomeCounts, 10),
    },
    notes: [
      requests.length === 0 ? "No persisted match requests found yet." : "",
      outcomes.length === 0 ? "No persisted match outcomes found yet." : "",
    ].filter(Boolean),
  };
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

  const [rawRequests, rawOutcomes] = await Promise.all([
    client.fetch(
      `*[_type == "matchRequest"] | order(coalesce(createdAt, _createdAt) desc)[0...$limit]{
        _id,
        requestId,
        sessionId,
        userId,
        careState,
        careFormat,
        careIntent,
        needsMedicationManagement,
        insurancePreference,
        budgetMax,
        priorityMode,
        urgency,
        bipolarFocus,
        preferredModalities,
        populationFit,
        languagePreferences,
        culturalPreferences,
        requestSummary,
        sourceSurface,
        createdAt
      }`,
      { limit: args.limit },
    ),
    client.fetch(
      `*[_type == "matchOutcome"] | order(coalesce(recordedAt, _createdAt) desc)[0...$limit]{
        _id,
        outcomeId,
        requestId,
        providerId,
        therapistSlug,
        therapistName,
        rankPosition,
        resultCount,
        topSlug,
        routeType,
        shortcutType,
        pivotAt,
        recommendedWaitWindow,
        outcome,
        requestSummary,
        contextSummary,
        strategySnapshot,
        recordedAt
      }`,
      { limit: args.limit },
    ),
  ]);

  const requests = Array.isArray(rawRequests) ? rawRequests.map(annotateMatchRequestForDisplay) : [];
  const outcomes = Array.isArray(rawOutcomes) ? rawOutcomes.map(annotateMatchOutcomeForDisplay) : [];
  const summary = summarize(requests, outcomes);
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
          requests: requests.length,
          outcomes: outcomes.length,
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
