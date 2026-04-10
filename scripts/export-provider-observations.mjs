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
  const providerId = argv.find((item) => !item.startsWith("--")) || "";
  const limitArg = argv.find((item) => item.startsWith("--limit="));
  const formatArg = argv.find((item) => item.startsWith("--format="));
  const outputArg = argv.find((item) => item.startsWith("--output="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : 200;
  const format = String((formatArg && formatArg.split("=")[1]) || "json")
    .trim()
    .toLowerCase();
  const outputPath = outputArg ? String(outputArg.split("=")[1] || "").trim() : "";
  return {
    providerId: String(providerId || "").trim(),
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
    ["providerId", "provider_id"],
    ["fieldName", "field_name"],
    ["rawValue", "raw_value"],
    ["normalizedValue", "normalized_value"],
    ["parsedRawValue", "parsed_raw_value"],
    ["parsedNormalizedValue", "parsed_normalized_value"],
    ["sourceType", "source_type"],
    ["sourceDocumentType", "source_document_type"],
    ["sourceDocumentId", "source_document_id"],
    ["sourceUrl", "source_url"],
    ["observedAt", "observed_at"],
    ["verifiedAt", "verified_at"],
    ["confidenceScore", "confidence_score"],
    ["verificationMethod", "verification_method"],
    ["isCurrent", "is_current"],
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
  if (!args.providerId) {
    throw new Error(
      "Missing provider ID. Usage: node scripts/export-provider-observations.mjs provider-ca-12345",
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

  const items = Array.isArray(observations)
    ? observations.map(annotateProviderFieldObservationForDisplay)
    : [];
  const output =
    args.format === "csv"
      ? buildCsv(items)
      : JSON.stringify(
          {
            providerId: args.providerId,
            count: items.length,
            observations: items,
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
          providerId: args.providerId,
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
