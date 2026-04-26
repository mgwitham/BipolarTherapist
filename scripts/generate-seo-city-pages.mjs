#!/usr/bin/env node
// Post-build city landing page generator. For each city with at least
// MIN_PROVIDERS active therapists in Sanity, writes
// /bipolar-therapists/[city-slug]/index.html with city-specific
// title, meta, canonical, JSON-LD, h1, and a static fallback list of
// the providers in that city. The client SPA still hydrates above
// this — but Google sees a real page that matches "bipolar therapist
// [city]" queries.
//
// Skips cleanly when Sanity isn't configured. Idempotent.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";

const ROOT = process.cwd();
const API_VERSION = "2026-04-02";
const SITE_URL = "https://www.bipolartherapyhub.com";
const DIST_DIR = path.join(ROOT, "dist");
const TEMPLATE_PATH = path.join(DIST_DIR, "directory.html");
const CITY_OUTPUT_DIR = path.join(DIST_DIR, "bipolar-therapists");

// Only build a city page when there's enough provider density to make
// the page useful to a real searcher. A page with 1 provider feels
// thin and risks being treated as low-quality by Google.
const MIN_PROVIDERS = 2;

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

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function citySlug(city, state) {
  return (
    String(city || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") +
    "-" +
    String(state || "")
      .trim()
      .toLowerCase()
  );
}

function buildCityPath(slug) {
  return "/bipolar-therapists/" + slug + "/";
}

function buildCanonicalUrl(slug) {
  return SITE_URL + buildCityPath(slug);
}

function buildTitle(city, state, count) {
  return (
    "Bipolar Therapists in " +
    city +
    ", " +
    state +
    " - " +
    count +
    " Verified Specialist" +
    (count === 1 ? "" : "s")
  );
}

function buildDescription(city, state, count) {
  return (
    "Find " +
    count +
    " licensed therapists in " +
    city +
    ", " +
    state +
    " who specialize in bipolar disorder. Each provider is license-verified, with bipolar-specific clinical evidence on every profile."
  );
}

function buildJsonLd(city, state, slug, providers) {
  const canonicalUrl = buildCanonicalUrl(slug);
  return [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "Bipolar Therapists in " + city + ", " + state,
      url: canonicalUrl,
      about: {
        "@type": "MedicalCondition",
        name: "Bipolar disorder",
      },
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
    },
  ];
}

function buildProviderListHtml(providers) {
  return providers
    .map(function (p) {
      const name = escapeHtml((p.name || "") + (p.credentials ? ", " + p.credentials : ""));
      const role = p.title ? '<p class="provider-role">' + escapeHtml(p.title) + "</p>" : "";
      const href = "/therapists/" + encodeURIComponent(String(p.slug || "").trim()) + "/";
      return (
        '<li class="city-provider">' +
        '<a href="' +
        escapeAttribute(href) +
        '"><strong>' +
        name +
        "</strong></a>" +
        role +
        "</li>"
      );
    })
    .join("");
}

function buildFallbackBodyHtml(city, state, providers) {
  return (
    '<div class="seo-city-fallback" data-static-seo-city>' +
    '<section class="city-hero">' +
    '<p class="section-kicker">Bipolar-informed care</p>' +
    "<h1>Bipolar Therapists in " +
    escapeHtml(city) +
    ", " +
    escapeHtml(state) +
    "</h1>" +
    "<p>Every clinician below is California-licensed, has been verified for bipolar-specific practice, and lists evidence of treating bipolar disorder. Pick a name to read their profile, or use the match flow to get a personalized shortlist.</p>" +
    '<p><a class="cta-link" href="/match">Get a personalized match</a></p>' +
    "</section>" +
    '<section class="city-providers"><h2>Verified specialists in ' +
    escapeHtml(city) +
    "</h2>" +
    '<ol class="city-provider-list">' +
    buildProviderListHtml(providers) +
    "</ol></section>" +
    "</div>"
  );
}

function buildHeadTags(city, state, slug, providers) {
  const canonicalUrl = buildCanonicalUrl(slug);
  const title = buildTitle(city, state, providers.length) + " - BipolarTherapyHub";
  const description = buildDescription(city, state, providers.length);
  return [
    "<title>" + escapeHtml(title) + "</title>",
    '<meta name="description" content="' + escapeAttribute(description) + '" />',
    '<link rel="canonical" href="' + escapeAttribute(canonicalUrl) + '" />',
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="BipolarTherapyHub" />',
    '<meta property="og:url" content="' + escapeAttribute(canonicalUrl) + '" />',
    '<meta property="og:title" content="' +
      escapeAttribute(buildTitle(city, state, providers.length)) +
      '" />',
    '<meta property="og:description" content="' + escapeAttribute(description) + '" />',
    '<script type="application/ld+json" id="city-jsonld">' +
      JSON.stringify(buildJsonLd(city, state, slug, providers)) +
      "</script>",
  ].join("\n    ");
}

function injectSeo(template, city, state, slug, providers) {
  return template
    .replace(/<title>[\s\S]*?<\/title>/, buildHeadTags(city, state, slug, providers))
    .replace(/href="(?:\.\.\/)*favicon/g, 'href="/favicon')
    .replace(/href="(?:\.\.\/)*assets\//g, 'href="/assets/')
    .replace(/src="(?:\.\.\/)*assets\//g, 'src="/assets/')
    .replace(/href="index\.html"/g, 'href="/"')
    .replace(/href="directory\.html"/g, 'href="/directory"')
    .replace(/href="match\.html"/g, 'href="/match"')
    .replace(/href="signup\.html"/g, 'href="/signup"')
    .replace(/href="claim\.html"/g, 'href="/claim"')
    .replace(
      /<main[^>]*>[\s\S]*?<\/main>/,
      "<main>\n      " + buildFallbackBodyHtml(city, state, providers) + "\n    </main>",
    );
}

async function fetchTherapists(config) {
  const client = createClient({
    projectId: config.projectId,
    dataset: config.dataset,
    apiVersion: API_VERSION,
    useCdn: true,
  });
  return client.fetch(
    `*[_type == "therapist" && listingActive == true && status == "active" && defined(slug.current) && defined(city)] | order(name asc) {
       "slug": slug.current, name, credentials, title, city, state
     }`,
  );
}

function bucketByCity(therapists) {
  const map = new Map();
  for (const t of therapists || []) {
    const city = String((t && t.city) || "").trim();
    if (!city) continue;
    const state = String((t && t.state) || "CA").trim();
    const key = city + "|" + state;
    if (!map.has(key)) {
      map.set(key, { city, state, providers: [] });
    }
    map.get(key).providers.push(t);
  }
  return [...map.values()].sort(function (a, b) {
    return b.providers.length - a.providers.length;
  });
}

async function main() {
  const config = getConfig();
  if (!config.projectId || !config.dataset) {
    console.warn("[seo-city-pages] Sanity not configured; skipped city page generation.");
    return;
  }
  if (!fs.existsSync(TEMPLATE_PATH)) {
    console.warn(
      "[seo-city-pages] Missing " + TEMPLATE_PATH + "; run vite build before this script.",
    );
    return;
  }

  const template = fs.readFileSync(TEMPLATE_PATH, "utf8");
  const therapists = await fetchTherapists(config);
  const cities = bucketByCity(therapists);

  let written = 0;
  let skipped = 0;
  for (const city of cities) {
    if (city.providers.length < MIN_PROVIDERS) {
      skipped += 1;
      continue;
    }
    const slug = citySlug(city.city, city.state);
    if (!slug) continue;
    const outputDir = path.join(CITY_OUTPUT_DIR, slug);
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(
      path.join(outputDir, "index.html"),
      injectSeo(template, city.city, city.state, slug, city.providers),
      "utf8",
    );
    written += 1;
  }

  console.log(
    "[seo-city-pages] Wrote " +
      written +
      " city landing pages to " +
      CITY_OUTPUT_DIR +
      " (skipped " +
      skipped +
      " cities with <" +
      MIN_PROVIDERS +
      " providers)",
  );
}

main().catch(function (error) {
  console.error("[seo-city-pages] Unexpected error:", error);
  process.exitCode = 1;
});
