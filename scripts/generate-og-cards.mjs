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

import { loadFonts, renderCardPng, renderPageCardPng } from "../shared/og-card.mjs";

const ROOT = process.cwd();
const API_VERSION = "2026-04-02";
const OUTPUT_DIR = path.join(ROOT, "dist", "og", "therapists");

// Promotable page share cards — one brand-consistent template, page-
// specific copy. `out` is relative to dist/. Home overrides the static
// og-image.png fallback. Keep copy punchy; no em-dashes.
const PAGE_CARDS = [
  {
    out: "og-image.png",
    card: {
      lines: ["Not every therapist", "gets bipolar.", { text: "These do.", accent: true }],
      subtitle: "A calmer way to find bipolar care.",
      footnote: "Free  ·  No account  ·  No insurance needed",
    },
  },
  {
    out: "og/directory.png",
    card: {
      lines: ["Browse California's", { text: "bipolar specialists.", accent: true }],
      subtitle: "Filter by insurance, fees, telehealth, and approach.",
      footnote: "Free  ·  No account  ·  No insurance needed",
    },
  },
  {
    out: "og/about.png",
    card: {
      lines: ["Why we built", { text: "BipolarTherapyHub.", accent: true }],
      subtitle: "How every therapist is verified and ranked by fit, not payment.",
    },
  },
  {
    out: "og/signup.png",
    card: {
      kicker: "For California clinicians",
      lines: ["Get found by patients", { text: "searching for bipolar care.", accent: true }],
      subtitle: "List your practice free. Instant license verification.",
    },
  },
  {
    out: "og/pricing.png",
    card: {
      kicker: "For California clinicians",
      lines: ["Know where your", { text: "next patient came from.", accent: true }],
      subtitle: "Free listing for every therapist. $19/mo for visibility analytics.",
    },
  },
  {
    out: "og/claim.png",
    card: {
      kicker: "For California clinicians",
      lines: ["Claim your free", { text: "directory listing.", accent: true }],
      subtitle: "Built from public California license records. Take ownership in minutes.",
    },
  },
];

async function generatePageCards(fonts) {
  let written = 0;
  for (const { out, card } of PAGE_CARDS) {
    const target = path.join(ROOT, "dist", out);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const png = await renderPageCardPng(card, fonts);
    fs.writeFileSync(target, png);
    written += 1;
  }
  console.log(`[og-cards] Wrote ${written} page share cards`);
}

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
  // Fonts are fetched from a CDN; a restricted/offline environment (e.g. a
  // local build without network, or a sandboxed CI) can't reach it. Treat
  // that like the Sanity-not-configured case below: warn and skip rather than
  // failing the whole `npm run build`. OG cards aren't committed, so they
  // simply regenerate on the next build that has network access.
  let fonts;
  try {
    fonts = await loadFonts();
  } catch (err) {
    console.warn(
      `[og-cards] Could not load fonts (${String(err?.message || err)}) — skipping OG card generation.`,
    );
    process.exit(0);
  }

  // Page cards first — they don't need Sanity, so they're generated even
  // if therapist data is unavailable.
  await generatePageCards(fonts);

  const config = getConfig();
  if (!config.projectId || !config.dataset) {
    console.error("[og-cards] Missing Sanity project/dataset config — skipping therapist cards.");
    process.exit(0);
  }

  const therapists = await fetchTherapists(config);
  if (!Array.isArray(therapists) || therapists.length === 0) {
    console.error("[og-cards] No therapists returned — skipping.");
    process.exit(0);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

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
