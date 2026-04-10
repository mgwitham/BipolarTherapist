import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";

import { buildProviderFieldObservationsFromSource } from "../shared/provider-field-observation-domain.mjs";

const ROOT = process.cwd();
const API_VERSION = "2026-04-02";
const OUTPUT_JSON = path.join(
  ROOT,
  "data",
  "import",
  "generated-provider-field-observations-preview.json",
);

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

      accumulator[trimmed.slice(0, separatorIndex).trim()] = trimmed
        .slice(separatorIndex + 1)
        .trim();
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
  return {
    write: argv.includes("--write"),
    limit: (() => {
      const arg = argv.find((item) => item.startsWith("--limit="));
      const value = arg ? Number(arg.split("=")[1]) : 25;
      return Number.isFinite(value) && value > 0 ? value : 25;
    })(),
  };
}

async function fetchData(client, limit) {
  return client.fetch(
    `{
      "therapists": *[_type == "therapist"][0...$limit]{
        _id,
        _type,
        _updatedAt,
        providerId,
        name,
        city,
        state,
        licenseState,
        licenseNumber,
        sourceUrl,
        sourceReviewedAt,
        therapistReportedConfirmedAt,
        specialties,
        treatmentModalities,
        clientPopulations,
        insuranceAccepted,
        languages,
        telehealthStates,
        estimatedWaitTime,
        bipolarYearsExperience,
        acceptsTelehealth,
        acceptsInPerson,
        acceptingNewPatients,
        medicationManagement,
        sessionFeeMin,
        sessionFeeMax,
        slidingScale
      },
      "applications": *[_type == "therapistApplication"][0...$limit]{
        _id,
        _type,
        _updatedAt,
        providerId,
        name,
        city,
        state,
        licenseState,
        licenseNumber,
        sourceUrl,
        sourceReviewedAt,
        therapistReportedConfirmedAt,
        specialties,
        treatmentModalities,
        clientPopulations,
        insuranceAccepted,
        languages,
        telehealthStates,
        estimatedWaitTime,
        bipolarYearsExperience,
        acceptsTelehealth,
        acceptsInPerson,
        acceptingNewPatients,
        medicationManagement,
        sessionFeeMin,
        sessionFeeMax,
        slidingScale
      },
      "candidates": *[_type == "therapistCandidate"][0...$limit]{
        _id,
        _type,
        _updatedAt,
        providerId,
        name,
        city,
        state,
        licenseState,
        licenseNumber,
        sourceUrl,
        sourceReviewedAt,
        specialties,
        treatmentModalities,
        clientPopulations,
        insuranceAccepted,
        languages,
        telehealthStates,
        estimatedWaitTime,
        acceptsTelehealth,
        acceptsInPerson,
        acceptingNewPatients,
        medicationManagement,
        sessionFeeMin,
        sessionFeeMax,
        slidingScale
      }
    }`,
    { limit },
  );
}

function flattenObservations(data) {
  const therapists = (data.therapists || []).flatMap((doc) =>
    buildProviderFieldObservationsFromSource(doc, {
      sourceType: "therapist",
      sourceDocumentType: "therapist",
      verificationMethod: "editorial_review",
      confidenceScore: 90,
    }),
  );
  const applications = (data.applications || []).flatMap((doc) =>
    buildProviderFieldObservationsFromSource(doc, {
      sourceType: "therapistApplication",
      sourceDocumentType: "therapistApplication",
      verificationMethod: "therapist_confirmed",
      confidenceScore: 82,
    }),
  );
  const candidates = (data.candidates || []).flatMap((doc) =>
    buildProviderFieldObservationsFromSource(doc, {
      sourceType: "therapistCandidate",
      sourceDocumentType: "therapistCandidate",
      verificationMethod: "import_pipeline",
      confidenceScore: 72,
    }),
  );

  return therapists.concat(applications, candidates);
}

function buildDuplicateProviderSummary(observations) {
  const counts = observations.reduce((accumulator, observation) => {
    const providerId = String(observation.providerId || "").trim();
    if (!providerId) {
      return accumulator;
    }
    accumulator.set(providerId, (accumulator.get(providerId) || 0) + 1);
    return accumulator;
  }, new Map());

  return Array.from(counts.entries())
    .filter((entry) => entry[1] > 15)
    .sort((a, b) => b[1] - a[1])
    .map((entry) => ({
      providerId: entry[0],
      observationCount: entry[1],
    }));
}

async function writeObservations(client, observations) {
  if (!observations.length) {
    return { created: 0 };
  }

  const transaction = client.transaction();
  observations.forEach((observation) => {
    transaction.createOrReplace(observation);
  });
  await transaction.commit();
  return { created: observations.length };
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

  const data = await fetchData(client, args.limit);
  const observations = flattenObservations(data);

  fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
  fs.writeFileSync(
    OUTPUT_JSON,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        limit: args.limit,
        observationCount: observations.length,
        duplicateProviderSummary: buildDuplicateProviderSummary(observations),
        observations,
      },
      null,
      2,
    ),
    "utf8",
  );

  if (args.write) {
    const result = await writeObservations(client, observations);
    console.log(`Wrote ${result.created} provider field observations.`);
    return;
  }

  console.log(`Previewed ${observations.length} provider field observations.`);
  console.log(`Saved preview to ${OUTPUT_JSON}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
