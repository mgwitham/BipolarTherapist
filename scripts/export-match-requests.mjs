import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";
import { annotateMatchRequestForDisplay } from "../shared/match-persistence-domain.mjs";

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
  const formatArg = argv.find((item) => item.startsWith("--format="));
  const outputArg = argv.find((item) => item.startsWith("--output="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : 200;
  const format = String((formatArg && formatArg.split("=")[1]) || "json").trim().toLowerCase();
  const outputPath = outputArg ? String(outputArg.split("=")[1] || "").trim() : "";
  return {
    limit: Number.isFinite(limit) && limit > 0 ? limit : 200,
    format: format === "csv" ? "csv" : "json",
    outputPath,
  };
}

function stringifyValue(value) {
  if (Array.isArray(value)) {
    return value.join(" | ");
  }
  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }
  return value == null ? "" : String(value);
}

function formatCsvCell(value) {
  const text = stringifyValue(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildCsv(rows) {
  const columns = [
    ["requestId", "request_id"],
    ["careState", "care_state"],
    ["careFormat", "care_format"],
    ["careIntent", "care_intent"],
    ["needsMedicationManagement", "needs_medication_management"],
    ["insurancePreference", "insurance_preference"],
    ["budgetMax", "budget_max"],
    ["priorityMode", "priority_mode"],
    ["urgency", "urgency"],
    ["bipolarFocus", "bipolar_focus"],
    ["preferredModalities", "preferred_modalities"],
    ["populationFit", "population_fit"],
    ["languagePreferences", "language_preferences"],
    ["requestSummary", "request_summary"],
    ["sourceSurface", "source_surface"],
    ["createdAt", "created_at"],
  ];

  return [columns.map(([, header]) => formatCsvCell(header)).join(",")]
    .concat(
      rows.map(function (row) {
        return columns
          .map(function ([key]) {
            return formatCsvCell(row[key]);
          })
          .join(",");
      }),
    )
    .join("\n");
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

  const requests = await client.fetch(
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
  );

  const items = Array.isArray(requests) ? requests.map(annotateMatchRequestForDisplay) : [];
  const output =
    args.format === "csv"
      ? buildCsv(items)
      : JSON.stringify(
          {
            count: items.length,
            requests: items,
          },
          null,
          2,
        );

  if (args.outputPath) {
    const resolved = path.resolve(ROOT, args.outputPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, output);
    console.log(
      JSON.stringify(
        {
          ok: true,
          format: args.format,
          count: items.length,
          outputPath: resolved,
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
