// Build-time OG share-card generator.
//
// Renders a branded 1200×630 RGB PNG for every listing-active therapist
// into dist/og/therapists/<slug>.png, served as a static asset and
// referenced by og:image / twitter:image in the profile pages.
//
// Runs after `build:seo-pages` in the build chain (same Sanity data,
// same therapist set, so every generated page has a matching card).
// See shared/og-card.mjs for why this is build-time + static rather
// than a serverless/edge function (sharp + X's RGBA rejection).

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";

import { loadFonts, renderCardPng } from "../shared/og-card.mjs";

const ROOT = process.cwd();
const API_VERSION = "2026-04-02";
const OUTPUT_DIR = path.join(ROOT, "dist", "og", "therapists");

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
      const value = trimmed.slice(sep + 1).trim();
      acc[trimmed.slice(0, sep).trim()] = value.replace(/^"(.*)"$/, "$1");
      return acc;
    }, {});
}

function getConfig() {
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
  };
}

async function fetchTherapists(config) {
  const client = createClient({
    projectId: config.projectId,
    dataset: config.dataset,
    apiVersion: API_VERSION,
    useCdn: true,
  });
  // Mirror generate-seo-profile-pages.mjs's therapist set so every page
  // gets a card. Only the fields the card needs.
  return client.fetch(
    `*[_type == "therapist" && listingActive == true && status == "active" && defined(slug.current)] | order(name asc) {
      name,
      credentials,
      city,
      state,
      acceptingNewPatients,
      "photoUrl": photo.asset->url,
      "slug": slug.current
    }`,
  );
}

async function main() {
  const config = getConfig();
  if (!config.projectId || !config.dataset) {
    console.error("[og-cards] Missing Sanity project/dataset config — skipping.");
    process.exit(0);
  }

  const therapists = await fetchTherapists(config);
  if (!Array.isArray(therapists) || therapists.length === 0) {
    console.error("[og-cards] No therapists returned — skipping.");
    process.exit(0);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const fonts = await loadFonts();

  let written = 0;
  const failures = [];
  for (const t of therapists) {
    if (!t.slug) continue;
    try {
      const png = await renderCardPng(t, fonts);
      fs.writeFileSync(path.join(OUTPUT_DIR, `${t.slug}.png`), png);
      written += 1;
    } catch (err) {
      failures.push({ slug: t.slug, error: String(err?.message || err) });
    }
  }

  console.log(`[og-cards] Wrote ${written} share cards to ${OUTPUT_DIR}`);
  if (failures.length > 0) {
    // Loud, not silent — a missing card means a broken share preview.
    console.error(`[og-cards] ${failures.length} card(s) FAILED to render:`);
    for (const f of failures) console.error(`  - ${f.slug}: ${f.error}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[og-cards] Fatal error:", err);
  process.exit(1);
});
