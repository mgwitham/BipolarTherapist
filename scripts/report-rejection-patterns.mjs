#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";

const ROOT = process.cwd();
const API_VERSION = "2026-04-02";

const REASON_LABELS = {
  not_a_specialist: "Not a true bipolar specialist",
  dead_site: "Dead or abandoned website",
  group_practice: "Group practice, no individual profile",
  aggregator_url: "Aggregator URL (PT, Headway, etc.)",
  out_of_state: "Out of California",
  license_unverifiable: "License unverifiable or inactive",
  duplicate: "Duplicate of existing clinician",
  other: "Other",
};

const TUNING_HINTS = {
  not_a_specialist:
    "Tighten prompt hard-requirement 3(b). Add more concrete rejection examples.",
  dead_site: "Add a freshness-check step with stronger 2022-cutoff rule.",
  group_practice:
    "Strengthen hard-requirement 1 and exclude service-page URL patterns.",
  aggregator_url:
    "Reinforce hard-exclusion list; list any new aggregators surfacing here.",
  out_of_state: "Add explicit CA-physical-location check to verification step.",
  license_unverifiable:
    "Run npm run cms:verify-licenses before import to catch these pre-review.",
  duplicate: "Normal — dedupe layer catches these. No prompt change needed.",
  other: "Review the rejectionNotes field for recurring patterns.",
};

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .reduce((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return acc;
      const sep = trimmed.indexOf("=");
      if (sep === -1) return acc;
      acc[trimmed.slice(0, sep).trim()] = trimmed.slice(sep + 1).trim();
      return acc;
    }, {});
}

function getSanityConfig() {
  const rootEnv = readEnvFile(path.join(ROOT, ".env"));
  const studioEnv = readEnvFile(path.join(ROOT, "studio", ".env"));
  return {
    projectId:
      process.env.SANITY_PROJECT_ID ||
      process.env.VITE_SANITY_PROJECT_ID ||
      rootEnv.VITE_SANITY_PROJECT_ID ||
      studioEnv.SANITY_STUDIO_PROJECT_ID,
    dataset:
      process.env.SANITY_DATASET ||
      process.env.VITE_SANITY_DATASET ||
      rootEnv.VITE_SANITY_DATASET ||
      studioEnv.SANITY_STUDIO_DATASET,
    apiVersion: process.env.SANITY_API_VERSION || rootEnv.VITE_SANITY_API_VERSION || API_VERSION,
    token: process.env.SANITY_API_TOKEN || rootEnv.SANITY_API_TOKEN || studioEnv.SANITY_API_TOKEN || "",
  };
}

function parseArgs(argv) {
  const options = { days: 30 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--days" && next) {
      options.days = Number(next) || 30;
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/report-rejection-patterns.mjs [--days 30]

Queries rejected therapistCandidate records and prints a markdown summary
grouped by rejectionReason. Use the output to tune the discovery prompt.

Options:
  --days N    Look back N days (default: 30)
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const config = getSanityConfig();
  if (!config.projectId || !config.dataset) {
    console.error("Missing Sanity project config. Check .env and studio/.env.");
    process.exit(1);
  }
  const client = createClient({
    projectId: config.projectId,
    dataset: config.dataset,
    apiVersion: config.apiVersion,
    token: config.token || undefined,
    useCdn: !config.token,
  });

  const sinceIso = new Date(Date.now() - options.days * 24 * 60 * 60 * 1000).toISOString();
  const query = `*[_type == "therapistCandidate" && publishRecommendation == "reject" && _updatedAt > $since]{
    _id, name, city, rejectionReason, rejectionNotes, sourceUrl, _updatedAt
  } | order(_updatedAt desc)`;

  const rows = await client.fetch(query, { since: sinceIso });

  if (!rows.length) {
    console.log(`# Rejection report — last ${options.days} days\n`);
    console.log("No rejected candidates in the window. Either you've been lenient, or the prompt is well-tuned.");
    return;
  }

  const byReason = new Map();
  for (const row of rows) {
    const key = row.rejectionReason || "unspecified";
    if (!byReason.has(key)) byReason.set(key, []);
    byReason.get(key).push(row);
  }

  const total = rows.length;
  const sorted = Array.from(byReason.entries()).sort((a, b) => b[1].length - a[1].length);

  console.log(`# Rejection report — last ${options.days} days\n`);
  console.log(`**Total rejections:** ${total}\n`);
  console.log("## Pattern breakdown\n");
  console.log("| Reason | Count | Share | Tuning hint |");
  console.log("|---|---|---|---|");
  for (const [reason, entries] of sorted) {
    const label = REASON_LABELS[reason] || reason;
    const share = ((entries.length / total) * 100).toFixed(0) + "%";
    const hint = TUNING_HINTS[reason] || "";
    console.log(`| ${label} | ${entries.length} | ${share} | ${hint} |`);
  }

  console.log("\n## Sample rejections per reason\n");
  for (const [reason, entries] of sorted) {
    const label = REASON_LABELS[reason] || reason;
    console.log(`### ${label} (${entries.length})\n`);
    for (const entry of entries.slice(0, 5)) {
      const notes = entry.rejectionNotes ? ` — ${entry.rejectionNotes}` : "";
      const city = entry.city ? ` (${entry.city})` : "";
      console.log(`- **${entry.name}**${city}${notes}`);
      if (entry.sourceUrl) console.log(`  ${entry.sourceUrl}`);
    }
    if (entries.length > 5) console.log(`\n  ... and ${entries.length - 5} more`);
    console.log("");
  }

  const unspecifiedCount = byReason.get("unspecified")?.length || 0;
  if (unspecifiedCount / total > 0.3) {
    console.log("\n> ⚠️  More than 30% of rejections have no reason code. Reviewers should be selecting one when rejecting, or the feedback loop won't work.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
