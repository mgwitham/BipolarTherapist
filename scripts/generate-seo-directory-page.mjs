#!/usr/bin/env node
// Post-build pre-render for the main /directory page. The directory is a
// client-rendered SPA: without JS it shows a loading spinner, and its
// JSON-LD is empty until directory.js runs. This script injects a static,
// crawlable fallback into dist/directory.html so Googlebot sees a real
// page on first fetch:
//   - a grid of every listing-active therapist (links to each profile)
//   - CollectionPage + ItemList JSON-LD in the initial HTML
//   - Open Graph / Twitter card tags (the SPA shell has none)
// directory.js still hydrates over all of this for interactive users
// (it overwrites #resultsGrid and #dirJsonLd on load), so the fallback
// is purely for crawlers and no-JS visitors.
//
// Reuses the city-page card styles (seo-city-pages.css). Skips cleanly
// when Sanity isn't configured. Idempotent.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { escapeHtml } from "../shared/escape-html.mjs";
import { buildProviderCardHtml } from "../shared/seo-provider-card.mjs";
import { pathToFileURL } from "node:url";
import { createClient } from "@sanity/client";
// The static page-1 reuses the browser's own pipeline (normalize → order →
// view model → card markup) so the pre-rendered cards are the SAME design
// the hydrated app paints. Before this, the static grid used the plain
// city-page card style and hydration visibly swapped the whole page design
// (the "directory flash"). All four modules are pure and Node-importable.
import { normalizeTherapist } from "../assets/cms.js";
import { compareTherapistsWithFilters } from "../assets/directory-logic.js";
import { buildCardViewModel } from "../assets/directory-view-model.js";
import { renderCardMarkup } from "../assets/directory-render.js";
import { DIRECTORY_PAGE_SIZE } from "../assets/directory-controller.js";
import { PUBLIC_THERAPIST_LIST_QUERY } from "../server/public-content-handler.mjs";

// Deterministic build-time stand-in for the client's session-seeded
// stable_random sort: same comparator, no shuffle map, so the static order
// is "accepting first, most-complete first, name asc". The client reshuffles
// within those bands on hydrate (fairness rotation) — same-design cards
// reordering reads as content settling, not a page flash.
const STATIC_ORDER_FILTERS = { sortBy: "stable_random", stableOrderMap: null, sortZip: "" };

const ROOT = process.cwd();
const API_VERSION = "2026-04-02";
const SITE_URL = "https://www.bipolartherapyhub.com";
const DIST_DIR = path.join(ROOT, "dist");
const TARGET_PATH = path.join(DIST_DIR, "directory.html");
const CANONICAL_URL = SITE_URL + "/directory";
const OG_TITLE = "Browse Bipolar-Informed Therapists in California · BipolarTherapyHub";
const OG_DESCRIPTION =
  "Browse bipolar informed therapists and psychiatrists in California. Filter by location, insurance, and format. Save providers and reach out on your terms.";
const CITY_STYLESHEET_LINK = '<link rel="stylesheet" href="/seo-city-pages.css" />';

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
      acc[trimmed.slice(0, sep).trim()] = trimmed
        .slice(sep + 1)
        .trim()
        .replace(/^"(.*)"$/, "$1");
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

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function buildProviderCardsHtml(providers) {
  return providers
    .map(function (p) {
      const role = String(p.title || "").trim();
      const city = String(p.city || "").trim();
      return buildProviderCardHtml(p, [role, city].filter(Boolean).join(" · "));
    })
    .join("");
}

function buildJsonLd(providers) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Bipolar Therapists in California",
    url: CANONICAL_URL,
    description: OG_DESCRIPTION,
    about: { "@type": "MedicalCondition", name: "Bipolar disorder" },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: providers.length,
      itemListElement: providers.map(function (p, index) {
        return {
          "@type": "ListItem",
          position: index + 1,
          url: SITE_URL + "/therapists/" + encodeURIComponent(String(p.slug || "").trim()) + "/",
          name: (p.name || "") + (p.credentials ? ", " + p.credentials : ""),
        };
      }),
    },
  };
}

function buildHeadTags() {
  return [
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="BipolarTherapyHub" />',
    '<meta property="og:url" content="' + CANONICAL_URL + '" />',
    '<meta property="og:title" content="' + escapeAttribute(OG_TITLE) + '" />',
    '<meta property="og:description" content="' + escapeAttribute(OG_DESCRIPTION) + '" />',
    '<meta property="og:image" content="' + SITE_URL + '/og/directory.png?v3" />',
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    '<meta name="twitter:card" content="summary_large_image" />',
    '<meta name="twitter:title" content="' + escapeAttribute(OG_TITLE) + '" />',
    '<meta name="twitter:description" content="' + escapeAttribute(OG_DESCRIPTION) + '" />',
    '<meta name="twitter:image" content="' + SITE_URL + '/og/directory.png?v3" />',
  ].join("\n    ");
}

// Apply one string replacement and fail loudly if the anchor is missing.
// A no-op replace here means directory.html drifted from what this script
// targets (e.g. a page redesign), and we'd otherwise rewrite the file with
// no changes while still logging "Pre-rendered ... cards" — shipping a
// crawler-blind /directory that looks done. That exact silent regression is
// what this guards against. The throw propagates to main().catch, which sets
// a non-zero exit code and fails the build. Sanity-unreachable stays soft
// (see main()): an infra blip must not block deploys, but template drift is a
// code bug that must.
function applyAnchoredReplace(html, label, pattern, replacement) {
  // Pass replacement as a function so $-sequences in dynamic content are
  // treated literally rather than as String.replace substitution patterns.
  const next = html.replace(pattern, () => replacement);
  if (next === html) {
    throw new Error(
      `[seo-directory] injection anchor not found: ${label}. directory.html changed — ` +
        `update injectSeo() in scripts/generate-seo-directory-page.mjs. Refusing to ship a ` +
        `/directory page that silently lost its crawlable ${label}.`,
    );
  }
  return next;
}

function buildInteractiveCardsHtml(providers) {
  return providers
    .map(function (therapist) {
      return renderCardMarkup({
        model: buildCardViewModel({
          therapist: therapist,
          filters: STATIC_ORDER_FILTERS,
          shortlist: [],
          isShortlisted: function () {
            return false;
          },
        }),
      });
    })
    .join("");
}

function injectSeo(html, providers) {
  const headBlock = buildHeadTags();
  const jsonLd = JSON.stringify(buildJsonLd(providers));
  const sorted = providers.slice().sort(function (a, b) {
    return compareTherapistsWithFilters(STATIC_ORDER_FILTERS, a, b);
  });
  // Page 1 in the hydrated design (direct grid children so #resultsGrid's
  // CSS grid lays them out exactly like the live render); every remaining
  // provider stays crawlable in the compact link list below the fold.
  // Both live inside #resultsGrid, so directory.js's first repaint clears
  // the whole static block at once.
  const cardsHtml =
    buildInteractiveCardsHtml(sorted.slice(0, DIRECTORY_PAGE_SIZE)) +
    '<div class="city-provider-grid" data-static-seo-directory style="grid-column:1/-1">' +
    buildProviderCardsHtml(sorted.slice(DIRECTORY_PAGE_SIZE)) +
    "</div>";

  let out = html;

  // OG/Twitter tags + city card styles, before </head>.
  out = applyAnchoredReplace(
    out,
    "head tags",
    /<\/head>/i,
    "    " + headBlock + "\n    " + CITY_STYLESHEET_LINK + "\n  </head>",
  );

  // Replace the shell's placeholder JSON-LD (a bare ItemList stub) with a
  // richer CollectionPage built from the live provider list. Keyed on the
  // unique #dirJsonLd id so it never touches other ld+json blocks.
  out = applyAnchoredReplace(
    out,
    "JSON-LD (#dirJsonLd)",
    /<script type="application\/ld\+json" id="dirJsonLd">[\s\S]*?<\/script>/i,
    '<script type="application/ld+json" id="dirJsonLd">' + jsonLd + "</script>",
  );

  // Swap the skeleton placeholders inside #resultsGrid for real, crawlable
  // provider cards. directory.js repaints #resultsGrid on load, so this
  // static list is purely for crawlers and no-JS visitors. The lookahead
  // pins the match to the grid's own closing tag (the one followed by
  // #dirLoadMoreWrap), never a nested card's </div>.
  out = applyAnchoredReplace(
    out,
    "results grid (#resultsGrid)",
    /<div[^>]*id="resultsGrid"[^>]*>[\s\S]*?<\/div>(?=\s*(?:<!--[\s\S]*?-->\s*)?<div[^>]*id="dirLoadMoreWrap")/i,
    '<div class="therapist-grid dir-vb-grid" id="resultsGrid" aria-live="polite" aria-label="Therapist results">' +
      cardsHtml +
      "</div>",
  );

  return out;
}

async function fetchTherapists(config) {
  const client = createClient({
    projectId: config.projectId,
    dataset: config.dataset,
    apiVersion: API_VERSION,
    useCdn: true,
  });
  // The exact query the live /api/public/therapists endpoint runs — same
  // visibility gates (the old inline query here was missing the
  // visibilityIntent == "listed" clause, so opted-out therapists could leak
  // into the static SEO page) and the full projection the card renderer
  // needs. Docs are then shaped with the browser's own normalizeTherapist.
  const docs = await client.fetch(PUBLIC_THERAPIST_LIST_QUERY);
  return (Array.isArray(docs) ? docs : []).map(normalizeTherapist);
}

async function main() {
  const config = getConfig();
  if (!config.projectId || !config.dataset) {
    console.warn("[seo-directory] Sanity not configured; skipped directory pre-render.");
    return;
  }
  if (!fs.existsSync(TARGET_PATH)) {
    console.warn("[seo-directory] Missing " + TARGET_PATH + "; run vite build before this script.");
    return;
  }

  let therapists = [];
  try {
    therapists = await fetchTherapists(config);
  } catch (err) {
    console.warn("[seo-directory] Failed to fetch therapists:", err.message, "- skipped.");
    return;
  }
  if (!therapists.length) {
    console.warn("[seo-directory] No therapists returned; left SPA shell untouched.");
    return;
  }

  const html = fs.readFileSync(TARGET_PATH, "utf8");
  fs.writeFileSync(TARGET_PATH, injectSeo(html, therapists), "utf8");
  console.log(
    "[seo-directory] Pre-rendered /directory with " +
      therapists.length +
      " provider cards + CollectionPage JSON-LD + OG tags",
  );
}

// Only run the build when invoked directly (node scripts/...). Importing the
// module — e.g. from tests that exercise injectSeo — must not trigger a real
// Sanity fetch and file write.
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch(function (error) {
    console.error("[seo-directory] Unexpected error:", error);
    process.exitCode = 1;
  });
}

export { injectSeo, buildJsonLd, buildProviderCardsHtml };
