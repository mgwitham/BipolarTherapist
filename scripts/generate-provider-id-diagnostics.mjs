import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";

const ROOT = process.cwd();
const API_VERSION = "2026-04-02";
const OUTPUT_JSON = path.join(ROOT, "data", "import", "generated-provider-id-diagnostics.json");

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
    limit: Number.isFinite(limit) && limit > 0 ? limit : 500,
  };
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeLicense(value) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function summarizeIdentity(doc) {
  return {
    id: normalizeText(doc._id),
    type: normalizeText(doc._type),
    name: normalizeText(doc.name),
    city: normalizeText(doc.city),
    state: normalizeText(doc.state),
    licenseState: normalizeText(doc.licenseState),
    licenseNumber: normalizeText(doc.licenseNumber),
    normalizedLicense: [
      normalizeText(doc.licenseState).toLowerCase(),
      normalizeLicense(doc.licenseNumber),
    ]
      .filter(Boolean)
      .join(":"),
    website: normalizeText(doc.website || doc.sourceUrl),
    sourceUrl: normalizeText(doc.sourceUrl),
  };
}

function uniqueValues(items, key) {
  return Array.from(
    new Set(
      items
        .map((item) => normalizeText(item[key]))
        .filter(Boolean),
    ),
  );
}

function buildSuspicionReasons(providerId, docs) {
  const reasons = [];
  const docTypes = uniqueValues(docs, "type");
  const names = uniqueValues(docs, "name");
  const cities = uniqueValues(docs, "city");
  const normalizedLicenses = uniqueValues(docs, "normalizedLicense");

  if (/^provider-\d+$/.test(providerId)) {
    reasons.push("timestamp_fallback_provider_id");
  }
  if (names.length > 1) {
    reasons.push("multiple_distinct_names");
  }
  if (cities.length > 1) {
    reasons.push("multiple_distinct_cities");
  }
  if (normalizedLicenses.length > 1) {
    reasons.push("multiple_distinct_licenses");
  }
  if (docTypes.length > 1 && !normalizedLicenses.length) {
    reasons.push("cross_type_shared_id_without_license_anchor");
  }
  return reasons;
}

async function fetchData(client, limit) {
  return client.fetch(
    `*[_type in ["therapist", "therapistApplication", "therapistCandidate", "licensureRecord"]][0...$limit]{
      _id,
      _type,
      providerId,
      name,
      city,
      state,
      licenseState,
      licenseNumber,
      website,
      sourceUrl
    }`,
    { limit },
  );
}

function buildDiagnostics(records) {
  const grouped = records.reduce((accumulator, record) => {
    const providerId = normalizeText(record.providerId);
    if (!providerId) {
      return accumulator;
    }
    if (!accumulator.has(providerId)) {
      accumulator.set(providerId, []);
    }
    accumulator.get(providerId).push(summarizeIdentity(record));
    return accumulator;
  }, new Map());

  const groups = Array.from(grouped.entries())
    .map(([providerId, docs]) => {
      const reasons = buildSuspicionReasons(providerId, docs);
      return {
        providerId,
        reasons,
        documentCount: docs.length,
        documentTypes: uniqueValues(docs, "type"),
        names: uniqueValues(docs, "name"),
        cities: uniqueValues(docs, "city"),
        normalizedLicenses: uniqueValues(docs, "normalizedLicense"),
        docs,
      };
    });

  const suspicious = groups
    .filter((item) => item.reasons.length > 0)
    .sort((a, b) => b.documentCount - a.documentCount);

  return {
    generatedAt: new Date().toISOString(),
    totalProviderIds: grouped.size,
    suspiciousProviderIds: suspicious.length,
    topProviderGroups: groups.sort((a, b) => b.documentCount - a.documentCount).slice(0, 10),
    suspicious,
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

  const records = await fetchData(client, args.limit);
  const diagnostics = buildDiagnostics(records);

  fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(diagnostics, null, 2), "utf8");

  console.log(`Analyzed ${records.length} records across ${diagnostics.totalProviderIds} provider IDs.`);
  console.log(`Flagged ${diagnostics.suspiciousProviderIds} suspicious provider IDs.`);
  console.log(`Saved diagnostics to ${OUTPUT_JSON}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
