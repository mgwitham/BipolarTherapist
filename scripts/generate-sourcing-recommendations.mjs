import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";

const ROOT = process.cwd();
const API_VERSION = "2026-04-02";
const OUTPUT_CSV = path.join(ROOT, "data", "import", "generated-sourcing-recommendations.csv");
const OUTPUT_MD = path.join(ROOT, "data", "import", "generated-sourcing-recommendations.md");
const OUTPUT_SEED_CSV = path.join(ROOT, "data", "import", "generated-coverage-source-seeds.csv");

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

function csvEscape(value) {
  const stringValue = String(value ?? "");
  if (!/[",\n]/.test(stringValue)) {
    return stringValue;
  }
  return `"${stringValue.replace(/"/g, '""')}"`;
}

function showHelp() {
  console.log(`
Generate sourcing recommendations and a source-seed CSV from the live therapist graph.

Outputs:
- data/import/generated-sourcing-recommendations.csv
- data/import/generated-sourcing-recommendations.md
- data/import/generated-coverage-source-seeds.csv

Usage:
  node scripts/generate-sourcing-recommendations.mjs
`);
}

function inferCoverageRole(item) {
  const title = String(item.title || "").toLowerCase();
  const credentials = String(item.credentials || "").toLowerCase();
  if (item.medicationManagement || title.includes("psychiatrist") || credentials.includes("md")) {
    return "psychiatry";
  }
  return "therapy";
}

function getFieldTrustAttentionCount(item) {
  const fieldTrust = item.fieldTrustMeta || {};
  return Object.values(fieldTrust).filter(function (entry) {
    if (!entry || typeof entry !== "object") {
      return false;
    }
    const reviewState = String(entry.reviewState || "").toLowerCase();
    const staleAfterAt = entry.staleAfterAt ? new Date(entry.staleAfterAt).getTime() : 0;
    const confidenceScore = Number(entry.confidenceScore || 0);
    return (
      reviewState === "needs_reconfirmation" ||
      reviewState === "needs_review" ||
      (staleAfterAt && staleAfterAt < Date.now()) ||
      confidenceScore < 65
    );
  }).length;
}

function buildCoverageInsights(therapists) {
  const byCity = new Map();

  (therapists || []).forEach(function (item) {
    const cityKey = [item.city, item.state].filter(Boolean).join(", ") || "Unknown";
    const entry = byCity.get(cityKey) || {
      city: item.city || "Unknown",
      state: item.state || "",
      total: 0,
      therapy: 0,
      psychiatry: 0,
      telehealth: 0,
      accepting: 0,
      trustRisk: 0,
    };
    entry.total += 1;
    entry[inferCoverageRole(item)] += 1;
    if (item.acceptsTelehealth) {
      entry.telehealth += 1;
    }
    if (item.acceptingNewPatients) {
      entry.accepting += 1;
    }
    if (getFieldTrustAttentionCount(item) > 0) {
      entry.trustRisk += 1;
    }
    byCity.set(cityKey, entry);
  });

  return Array.from(byCity.values())
    .sort(function (a, b) {
      const aScore =
        (a.psychiatry === 0 ? 2 : 0) + (a.telehealth === 0 ? 1 : 0) + (a.accepting === 0 ? 1 : 0);
      const bScore =
        (b.psychiatry === 0 ? 2 : 0) + (b.telehealth === 0 ? 1 : 0) + (b.accepting === 0 ? 1 : 0);
      return bScore - aScore || a.total - b.total || a.city.localeCompare(b.city);
    })
    .filter(function (row) {
      return row.total <= 3 || row.psychiatry === 0 || row.telehealth === 0 || row.accepting === 0;
    });
}

function buildSourcePerformanceInsights(candidates) {
  const bySourceType = new Map();

  (candidates || []).forEach(function (item) {
    const key = item.sourceType || "unknown";
    const entry = bySourceType.get(key) || {
      key,
      total: 0,
      ready: 0,
      published: 0,
      needsConfirmation: 0,
      duplicates: 0,
    };
    entry.total += 1;
    if (item.reviewStatus === "ready_to_publish" || item.publishRecommendation === "ready") {
      entry.ready += 1;
    }
    if (item.reviewStatus === "published") {
      entry.published += 1;
    }
    if (
      item.reviewStatus === "needs_confirmation" ||
      item.publishRecommendation === "needs_confirmation"
    ) {
      entry.needsConfirmation += 1;
    }
    if (item.dedupeStatus === "possible_duplicate" || item.dedupeStatus === "rejected_duplicate") {
      entry.duplicates += 1;
    }
    bySourceType.set(key, entry);
  });

  return Array.from(bySourceType.values()).map(function (item) {
    const total = item.total || 1;
    return {
      ...item,
      publishableRate: Math.round(((item.ready + item.published) / total) * 100),
      duplicateRate: Math.round((item.duplicates / total) * 100),
      confirmationRate: Math.round((item.needsConfirmation / total) * 100),
    };
  });
}

function buildBestSourcingBets(coverageRows, sourceRows) {
  const sourceRank = new Map(sourceRows.map((item) => [item.key, item]));

  function chooseSource(role, gaps) {
    const options =
      role === "psychiatrist"
        ? ["practice_website", "manual_research", "directory_profile"]
        : ["practice_website", "directory_profile", "manual_research"];

    return options
      .map(function (key) {
        const source = sourceRank.get(key) || {
          key,
          publishableRate: 0,
          duplicateRate: 0,
          confirmationRate: 0,
        };
        const gapBonus =
          (gaps.includes("psychiatry") && key === "practice_website" ? 15 : 0) +
          (gaps.includes("telehealth") && key !== "directory_profile" ? 10 : 0);
        const score =
          source.publishableRate -
          source.duplicateRate -
          Math.round(source.confirmationRate / 2) +
          gapBonus;
        return {
          source,
          score,
        };
      })
      .sort((a, b) => b.score - a.score)[0];
  }

  return coverageRows.slice(0, 8).map(function (city) {
    const gaps = []
      .concat(city.psychiatry === 0 ? ["psychiatry"] : [])
      .concat(city.telehealth === 0 ? ["telehealth"] : [])
      .concat(city.accepting === 0 ? ["accepting"] : []);
    const role = city.psychiatry === 0 ? "psychiatrist" : "therapist";
    const sourceChoice = chooseSource(role, gaps);
    const cityLabel = [city.city, city.state].filter(Boolean).join(", ");
    const searchParts = ["bipolar", role, cityLabel];
    if (gaps.includes("telehealth")) {
      searchParts.push("telehealth");
    }
    if (gaps.includes("accepting")) {
      searchParts.push("accepting new patients");
    }
    return {
      city: cityLabel,
      role,
      gaps,
      recommendedSourceType: sourceChoice.source.key,
      expectedPublishableRate: sourceChoice.source.publishableRate,
      expectedDuplicateRate: sourceChoice.source.duplicateRate,
      expectedConfirmationRate: sourceChoice.source.confirmationRate,
      query: searchParts.join(" "),
      targetSources:
        role === "psychiatrist"
          ? "Practice sites, psychiatry clinics, medication-management groups"
          : "Private practice sites, therapy group practices, bipolar-focused clinician pages",
    };
  });
}

function buildRecommendationsMarkdown(rows) {
  const lines = [
    "# Sourcing Recommendations",
    "",
    "This packet combines live graph coverage gaps with actual source-type yield.",
    "",
  ];

  rows.forEach(function (row, index) {
    lines.push(`## ${index + 1}. ${row.city}`);
    lines.push(`- Role to prioritize: ${row.role}`);
    lines.push(`- Gaps: ${row.gaps.length ? row.gaps.join(", ") : "general coverage"}`);
    lines.push(`- Best source type: ${row.recommendedSourceType}`);
    lines.push(`- Expected publishable rate: ${row.expectedPublishableRate}%`);
    lines.push(`- Expected duplicate risk: ${row.expectedDuplicateRate}%`);
    lines.push(`- Expected confirmation burden: ${row.expectedConfirmationRate}%`);
    lines.push(`- Search query: ${row.query}`);
    lines.push(`- Target sources: ${row.targetSources}`);
    lines.push("");
  });

  return lines.join("\n");
}

function buildRecommendationsCsv(rows) {
  const headers = [
    "city",
    "role",
    "gaps",
    "recommended_source_type",
    "expected_publishable_rate",
    "expected_duplicate_rate",
    "expected_confirmation_rate",
    "query",
    "target_sources",
  ];

  return [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((header) =>
          csvEscape(
            {
              city: row.city,
              role: row.role,
              gaps: row.gaps.join("|"),
              recommended_source_type: row.recommendedSourceType,
              expected_publishable_rate: row.expectedPublishableRate,
              expected_duplicate_rate: row.expectedDuplicateRate,
              expected_confirmation_rate: row.expectedConfirmationRate,
              query: row.query,
              target_sources: row.targetSources,
            }[header],
          ),
        )
        .join(","),
    ),
  ].join("\n");
}

function buildSeedCsv(rows) {
  const headers = [
    "sourceUrl",
    "sourceType",
    "name",
    "credentials",
    "title",
    "practiceName",
    "city",
    "state",
    "zip",
    "country",
    "licenseState",
    "licenseNumber",
    "email",
    "phone",
    "website",
    "bookingUrl",
    "supportingSourceUrls",
    "clientPopulations",
    "insuranceAccepted",
    "telehealthStates",
    "estimatedWaitTime",
    "sessionFeeMin",
    "sessionFeeMax",
    "slidingScale",
    "notes",
  ];

  return [
    headers.join(","),
    ...rows.map(function (row) {
      const parts = row.city.split(",").map((part) => part.trim());
      const city = parts[0] || "";
      const state = parts[1] || "";
      const values = [
        "",
        "manual_research",
        "",
        "",
        row.role === "psychiatrist" ? "Psychiatrist" : "Therapist",
        "",
        city,
        state,
        "",
        "US",
        state,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        row.gaps.includes("telehealth") ? state : "",
        "",
        "",
        "",
        "false",
        [
          "Generated from sourcing recommendation engine",
          "Best source type: " + row.recommendedSourceType,
          "Query: " + row.query,
          "Expected publishable rate: " + row.expectedPublishableRate + "%",
        ].join(" · "),
      ];
      return values.map(csvEscape).join(",");
    }),
  ].join("\n");
}

async function fetchData(client) {
  return client.fetch(`{
    "therapists": *[_type == "therapist" && listingActive != false]{
      name,
      title,
      credentials,
      city,
      state,
      acceptsTelehealth,
      acceptingNewPatients,
      medicationManagement,
      fieldTrustMeta
    },
    "candidates": *[_type == "therapistCandidate"]{
      sourceType,
      reviewStatus,
      publishRecommendation,
      dedupeStatus
    }
  }`);
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    showHelp();
    return;
  }

  const config = getConfig();
  if (!config.projectId || !config.dataset || !config.token) {
    throw new Error(
      "Missing Sanity config. Set SANITY_PROJECT_ID, SANITY_DATASET, and SANITY_API_TOKEN.",
    );
  }

  const client = createClient({
    projectId: config.projectId,
    dataset: config.dataset,
    apiVersion: config.apiVersion,
    token: config.token,
    useCdn: false,
  });

  const data = await fetchData(client);
  const coverageRows = buildCoverageInsights(data.therapists || []);
  const sourceRows = buildSourcePerformanceInsights(data.candidates || []);
  const recommendations = buildBestSourcingBets(coverageRows, sourceRows);

  fs.writeFileSync(OUTPUT_MD, `${buildRecommendationsMarkdown(recommendations)}\n`, "utf8");
  fs.writeFileSync(OUTPUT_CSV, `${buildRecommendationsCsv(recommendations)}\n`, "utf8");
  fs.writeFileSync(OUTPUT_SEED_CSV, `${buildSeedCsv(recommendations)}\n`, "utf8");

  console.log(
    `Generated ${recommendations.length} sourcing recommendations to ${path.relative(ROOT, OUTPUT_MD)}, ${path.relative(ROOT, OUTPUT_CSV)}, and ${path.relative(ROOT, OUTPUT_SEED_CSV)}.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
