#!/usr/bin/env node
// CLI wrapper over the shared sourcing runner (server/photo-sourcing.mjs)
// — the same code the /api/review/cron/source-photos endpoint runs.
// Sources candidate headshots for unclaimed listings from the therapist's
// OWN website into the review vault (photoCandidate, status=pending).
// Nothing publishes: an admin approves each one in the Portal →
// "Sourced photo review" panel first.
//
// Usage:
//   node scripts/source-therapist-photos.mjs                 # dry run
//   node scripts/source-therapist-photos.mjs --apply         # commit
//   node scripts/source-therapist-photos.mjs --limit 25      # cap count
//   node scripts/source-therapist-photos.mjs --slug foo-bar  # single doc

import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@sanity/client";
import { runPhotoSourcingBatch } from "../server/photo-sourcing.mjs";

const APPLY = process.argv.includes("--apply");
const LIMIT = readIntFlag("--limit", 1000);
const ONLY_SLUG = readStrFlag("--slug", "");
const POLITE_DELAY_MS = 1500;

function readIntFlag(flag, fallback) {
  const i = process.argv.indexOf(flag);
  if (i === -1 || i === process.argv.length - 1) return fallback;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
function readStrFlag(flag, fallback) {
  const i = process.argv.indexOf(flag);
  if (i === -1 || i === process.argv.length - 1) return fallback;
  return String(process.argv[i + 1]);
}
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Politeness shim: the serverless runner keeps batches small so it needs
// no delay, but a local sweep can hit hundreds of sites — space out the
// page fetches (first request per listing) instead of hammering.
let lastPageFetchAt = 0;
async function politeFetch(url, opts) {
  const sincePage = Date.now() - lastPageFetchAt;
  const isPageFetch = !/\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(String(url));
  if (isPageFetch && sincePage < POLITE_DELAY_MS) {
    await sleep(POLITE_DELAY_MS - sincePage);
  }
  if (isPageFetch) lastPageFetchAt = Date.now();
  return fetch(url, opts);
}

async function main() {
  const root = process.cwd();
  const env = readEnvFile(path.join(root, ".env"));
  const token = process.env.SANITY_API_TOKEN || env.SANITY_API_TOKEN;
  if (APPLY && !token) {
    console.error("SANITY_API_TOKEN required with --apply.");
    process.exit(1);
  }
  const client = createClient({
    projectId: process.env.VITE_SANITY_PROJECT_ID || env.VITE_SANITY_PROJECT_ID,
    dataset: process.env.VITE_SANITY_DATASET || env.VITE_SANITY_DATASET || "production",
    apiVersion: process.env.VITE_SANITY_API_VERSION || env.VITE_SANITY_API_VERSION || "2026-04-02",
    token,
    useCdn: false,
  });

  console.log(`Photo sourcing — ${APPLY ? "APPLY" : "DRY RUN"}\n`);
  const summary = await runPhotoSourcingBatch({
    client,
    limit: LIMIT,
    deadlineMs: Infinity,
    dryRun: !APPLY,
    slug: ONLY_SLUG,
    fetchImpl: politeFetch,
    onEvent(e) {
      const mark = e.outcome === "queued" ? "✓" : e.outcome === "no_candidate" ? "–" : "✗";
      console.log(`  ${mark} ${e.name} (${e.slug}): ${e.detail}`);
    },
  });

  console.log(
    `\nEligible: ${summary.eligible} · processed: ${summary.processed} · ` +
      `queued: ${summary.queued} · no candidate: ${summary.noCandidate} · ` +
      `site errors: ${summary.siteErrors}`,
  );
  if (!APPLY && summary.queued > 0) console.log("DRY RUN — pass --apply to commit.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
