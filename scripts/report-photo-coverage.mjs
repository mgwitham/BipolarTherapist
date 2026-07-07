#!/usr/bin/env node
// Read-only photo-coverage report. Prints the headline KPI (% of live
// listings with a photo) split by claim status, plus the sourcing/review
// pipeline counts. Use it to track the public-source photo campaign and
// spot where coverage is stuck. Modifies nothing.
//
// Usage:
//   node scripts/report-photo-coverage.mjs
//   node scripts/report-photo-coverage.mjs --json

import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@sanity/client";
import { summarizePhotoCoverage } from "../shared/photo-sourcing-domain.mjs";

const AS_JSON = process.argv.includes("--json");

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .reduce((acc, line) => {
      const t = line.trim();
      if (!t || t.startsWith("#")) return acc;
      const i = t.indexOf("=");
      if (i === -1) return acc;
      acc[t.slice(0, i).trim()] = t.slice(i + 1).trim();
      return acc;
    }, {});
}

function bar(pct) {
  const filled = Math.round((pct / 100) * 24);
  return "█".repeat(filled) + "░".repeat(24 - filled);
}

async function main() {
  const root = process.cwd();
  const env = readEnvFile(path.join(root, ".env"));
  const client = createClient({
    projectId: process.env.VITE_SANITY_PROJECT_ID || env.VITE_SANITY_PROJECT_ID,
    dataset: process.env.VITE_SANITY_DATASET || env.VITE_SANITY_DATASET || "production",
    apiVersion: process.env.VITE_SANITY_API_VERSION || env.VITE_SANITY_API_VERSION || "2026-04-02",
    token: process.env.SANITY_API_TOKEN || env.SANITY_API_TOKEN,
    useCdn: false,
  });

  const rows = await client.fetch(
    `*[_type == "therapist" && listingActive != false]{
      claimStatus, website, photoSourceType, photoSuppressed, photoCandidateStatus,
      "photo": photo{asset}
    }`,
  );
  const s = summarizePhotoCoverage(rows);

  if (AS_JSON) {
    console.log(JSON.stringify(s, null, 2));
    return;
  }

  console.log("\nPhoto coverage — live listings\n" + "=".repeat(40));
  console.log(`  ${bar(s.withPhotoPct)}  ${s.withPhotoPct}%  (${s.withPhoto}/${s.total})`);
  console.log("\n  By claim status");
  console.log(
    `    Claimed:   ${s.claimed.withPhotoPct}%  (${s.claimed.withPhoto}/${s.claimed.total})`,
  );
  console.log(
    `    Unclaimed: ${s.unclaimed.withPhotoPct}%  (${s.unclaimed.withPhoto}/${s.unclaimed.total})`,
  );
  console.log("\n  Public-source pipeline");
  console.log(`    Published (public-source): ${s.publicSource}`);
  console.log(`    Pending admin review:      ${s.pendingReview}`);
  console.log(`    Opted out (suppressed):    ${s.suppressed}`);
  console.log(
    `    Sourceable now (unclaimed, no photo, has site): ${s.sourceableUnclaimedNoPhoto}`,
  );
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
