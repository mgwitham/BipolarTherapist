import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";

import {
  buildMatchOutcomeDocument,
  buildMatchRequestDocument,
} from "../shared/match-persistence-domain.mjs";

const ROOT = process.cwd();
const API_VERSION = "2026-04-02";
const SMOKE_REQUEST_ID = "smoke-journey-2026-04-09";
const SMOKE_PROVIDER_ID = "provider-ca-88804";
const SMOKE_THERAPIST_SLUG = "aubri-gomez-los-angeles-ca";

function parseArgs(argv) {
  return {
    cleanup: argv.includes("--cleanup"),
  };
}

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = getConfig();
  if (!config.projectId || !config.dataset) {
    throw new Error("Missing Sanity configuration. Set project ID and dataset env vars first.");
  }
  if (!config.token) {
    throw new Error("Missing SANITY_API_TOKEN for smoke write.");
  }

  const client = createClient({
    projectId: config.projectId,
    dataset: config.dataset,
    apiVersion: config.apiVersion,
    token: config.token,
    useCdn: false,
  });

  const request = buildMatchRequestDocument({
    request_id: SMOKE_REQUEST_ID,
    source_surface: "match_flow",
    created_at: "2026-04-09T16:30:00.000Z",
    request_summary: "State: CA • Insurance: Aetna • Priority: Best overall fit",
    care_state: "CA",
    care_format: "Telehealth",
    care_intent: "Therapy",
    needs_medication_management: "Open to either",
    insurance: "Aetna",
    budget_max: 200,
    priority_mode: "Best overall fit",
    urgency: "Within 2 weeks",
    bipolar_focus: ["Bipolar II"],
    preferred_modalities: ["CBT"],
    population_fit: ["Adults"],
    language_preferences: ["English"],
  });

  const outcome = buildMatchOutcomeDocument({
    request_id: SMOKE_REQUEST_ID,
    provider_id: SMOKE_PROVIDER_ID,
    therapist_slug: SMOKE_THERAPIST_SLUG,
    therapist_name: "Aubri Gomez, LCSW",
    rank_position: 1,
    result_count: 3,
    top_slug: SMOKE_THERAPIST_SLUG,
    route_type: "profile",
    outcome: "booked_consult",
    request_summary: "State: CA • Insurance: Aetna • Priority: Best overall fit",
    recorded_at: "2026-04-09T16:35:00.000Z",
    context: {
      summary: "State: CA • Insurance: Aetna • Priority: Best overall fit",
      strategy: {
        match_action: "help",
        directory_sort: "best_match",
      },
    },
  });

  if (args.cleanup) {
    await client
      .transaction()
      .delete(request._id)
      .delete(outcome._id)
      .commit({ visibility: "sync" });

    console.log(
      JSON.stringify(
        {
          ok: true,
          cleanup: true,
          deleted: [request._id, outcome._id],
        },
        null,
        2,
      ),
    );
    return;
  }

  await client.transaction().createOrReplace(request).createOrReplace(outcome).commit({
    visibility: "sync",
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        requestId: request._id,
        outcomeId: outcome._id,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
