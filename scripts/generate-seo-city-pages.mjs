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
const CITY_CONTENT_PATH = path.join(ROOT, "data", "seo-city-content.json");

// Cities shown in the global "Browse by City" footer column. Keys are
// city-state slugs (e.g. "los-angeles-ca"). Ordered by current
// provider count; refresh by checking the build log.
const FOOTER_BROWSE_CITY_COUNT = 12;

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

function buildCityContextHtml(city, state, cityContent) {
  const fallback =
    "Finding a therapist who specializes in bipolar disorder in " +
    city +
    " means looking past general mood disorder listings and confirming real bipolar-specific experience. Every clinician on this page has been verified for that, so you can compare options without the usual guesswork.";
  const blurb = (cityContent && cityContent.context) || fallback;
  return (
    '<section class="city-context">' +
    "<h2>What makes bipolar care different in " +
    escapeHtml(city) +
    "</h2>" +
    "<p>" +
    escapeHtml(blurb) +
    "</p>" +
    "</section>"
  );
}

function buildWhatToLookForHtml(city) {
  return (
    '<section class="city-criteria">' +
    "<h2>What to look for in a " +
    escapeHtml(city) +
    " bipolar specialist</h2>" +
    "<ul>" +
    '<li><strong>Bipolar listed explicitly in their specialties</strong>, not just "mood disorders" or "depression." The distinction matters.</li>' +
    "<li><strong>Comfort with the bipolar I and bipolar II distinction</strong>, and how each shapes the treatment plan.</li>" +
    "<li><strong>Willingness to coordinate with a prescriber</strong>, since most bipolar care involves both therapy and medication management.</li>" +
    "<li><strong>Familiarity with mood-stabilizer side effects</strong>, so they can recognize when something is off and flag it.</li>" +
    "<li><strong>Experience with bipolar-specific therapy modalities</strong> like IPSRT, family-focused therapy, or DBT adapted for bipolar.</li>" +
    "</ul>" +
    "</section>"
  );
}

function buildCityFaqHtml(city, state) {
  const items = [
    {
      q: "Do I need a psychiatrist or a therapist for bipolar?",
      a:
        "Usually both. A psychiatrist or psychiatric nurse practitioner manages medication, which is the foundation of bipolar treatment. A therapist provides ongoing support, psychoeducation, and skills for managing mood episodes. Many people in " +
        city +
        " see both, and the two clinicians coordinate on your care.",
    },
    {
      q: "How much does bipolar therapy typically cost in " + city + "?",
      a: "Out-of-pocket sessions in California generally range from $150 to $300, with the highest rates in San Francisco and West Los Angeles. Many therapists accept commercial insurance, and a smaller number accept Medi-Cal or offer sliding scale. Each provider on this page lists their fee range and insurance acceptance on their profile.",
    },
    {
      q: "What if I can't find an in-network bipolar specialist?",
      a: "Out-of-network reimbursement is often easier to get for bipolar than for general mental health, because bipolar is recognized as a serious mental illness under California parity laws. Ask the therapist's office for a superbill (an itemized receipt your insurance can reimburse against), and contact your insurer to confirm out-of-network mental health benefits.",
    },
    {
      q: "Are the therapists on this page accepting new patients?",
      a: "Availability changes frequently. Each profile shows whether the clinician is currently accepting new patients, but the most reliable confirmation comes from contacting them directly. Most respond within a few business days.",
    },
    {
      q: "Can a therapist diagnose bipolar disorder?",
      a: "Licensed therapists (LMFT, LCSW, LPCC) can identify symptoms consistent with bipolar disorder, but formal diagnosis and medication management require a psychiatrist, psychiatric nurse practitioner, or in some cases a psychologist with prescribing authority. If you suspect bipolar, ask any therapist you talk to whether they can refer you to a prescriber.",
    },
  ];
  return (
    '<section class="city-faq" itemscope itemtype="https://schema.org/FAQPage">' +
    "<h2>Frequently asked questions</h2>" +
    "<dl>" +
    items
      .map(function (item) {
        return (
          '<div itemscope itemprop="mainEntity" itemtype="https://schema.org/Question">' +
          '<dt itemprop="name">' +
          escapeHtml(item.q) +
          "</dt>" +
          '<dd itemscope itemprop="acceptedAnswer" itemtype="https://schema.org/Answer">' +
          '<span itemprop="text">' +
          escapeHtml(item.a) +
          "</span>" +
          "</dd>" +
          "</div>"
        );
      })
      .join("") +
    "</dl>" +
    "</section>"
  );
}

function buildFallbackBodyHtml(city, state, providers, cityContent) {
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
    buildCityContextHtml(city, state, cityContent) +
    buildWhatToLookForHtml(city) +
    buildCityFaqHtml(city, state) +
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

function injectSeo(template, city, state, slug, providers, cityContent) {
  return template
    .replace(/<title>[\s\S]*?<\/title>/, buildHeadTags(city, state, slug, providers))
    .replace(/href="(?:\.\.\/)*favicon/g, 'href="/favicon')
    .replace(/href="(?:\.\.\/)*assets\//g, 'href="/assets/')
    .replace(/src="(?:\.\.\/)*assets\//g, 'src="/assets/')
    .replace(
      /<main[^>]*>[\s\S]*?<\/main>/,
      "<main>\n      " +
        buildFallbackBodyHtml(city, state, providers, cityContent) +
        "\n    </main>",
    );
}

function loadCityContentMap() {
  if (!fs.existsSync(CITY_CONTENT_PATH)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(CITY_CONTENT_PATH, "utf8"));
    if (!raw || typeof raw !== "object") return {};
    const out = {};
    for (const [key, value] of Object.entries(raw)) {
      if (key.startsWith("_")) continue;
      if (value && typeof value === "object") out[key] = value;
    }
    return out;
  } catch (err) {
    console.warn("[seo-city-pages] Failed to parse city content JSON:", err.message);
    return {};
  }
}

// =============================================================
// City hub page: /bipolar-therapists/index.html
//
// Lists every CA city with at least MIN_PROVIDERS therapists,
// linking to the per-city landing page. Acts as an internal SEO
// hub for Google + a "see all cities" target for the footer.
// =============================================================

function buildHubHeadTags() {
  const canonicalUrl = SITE_URL + "/bipolar-therapists/";
  const title = "Bipolar Therapists by City in California - BipolarTherapyHub";
  const description =
    "Browse bipolar disorder specialists by California city. Every clinician is license-verified and listed with bipolar-specific clinical evidence.";
  return [
    "<title>" + escapeHtml(title) + "</title>",
    '<meta name="description" content="' + escapeAttribute(description) + '" />',
    '<link rel="canonical" href="' + escapeAttribute(canonicalUrl) + '" />',
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="BipolarTherapyHub" />',
    '<meta property="og:url" content="' + escapeAttribute(canonicalUrl) + '" />',
    '<meta property="og:title" content="' + escapeAttribute(title) + '" />',
    '<meta property="og:description" content="' + escapeAttribute(description) + '" />',
  ].join("\n    ");
}

function buildHubBodyHtml(eligibleCities) {
  const items = eligibleCities
    .slice()
    .sort(function (a, b) {
      return a.city.localeCompare(b.city);
    })
    .map(function (bucket) {
      const slug = citySlug(bucket.city, bucket.state);
      const count = bucket.providers.length;
      return (
        '<li class="city-hub-item"><a href="' +
        escapeAttribute(buildCityPath(slug)) +
        '"><strong>' +
        escapeHtml(bucket.city) +
        "</strong>, " +
        escapeHtml(bucket.state) +
        " <span>(" +
        count +
        ")</span></a></li>"
      );
    })
    .join("");
  return (
    '<div class="seo-city-hub" data-static-seo-city-hub>' +
    '<section class="city-hub-hero">' +
    '<p class="section-kicker">Bipolar-informed care</p>' +
    "<h1>Find a bipolar therapist by city</h1>" +
    "<p>Each city below has at least " +
    MIN_PROVIDERS +
    " license-verified bipolar specialists. Pick a city to see the full list, or use the match flow if you'd rather get a personalized shortlist.</p>" +
    '<p><a class="cta-link" href="/match">Get a personalized match</a></p>' +
    "</section>" +
    '<section class="city-hub-list">' +
    "<h2>California cities with bipolar specialists</h2>" +
    '<ul class="city-hub-grid">' +
    items +
    "</ul>" +
    "</section>" +
    "</div>"
  );
}

function injectHubSeo(template, eligibleCities) {
  return template
    .replace(/<title>[\s\S]*?<\/title>/, buildHubHeadTags())
    .replace(/href="(?:\.\.\/)*favicon/g, 'href="/favicon')
    .replace(/href="(?:\.\.\/)*assets\//g, 'href="/assets/')
    .replace(/src="(?:\.\.\/)*assets\//g, 'src="/assets/')
    .replace(
      /<main[^>]*>[\s\S]*?<\/main>/,
      "<main>\n      " + buildHubBodyHtml(eligibleCities) + "\n    </main>",
    );
}

// =============================================================
// Browse by City footer block.
//
// Replaces a `<!-- BROWSE-BY-CITY-LIST -->` placeholder in any
// dist/*.html file with a real link list of the top N cities.
// Pages that don't have the placeholder are skipped silently.
// =============================================================

function buildBrowseByCityFooterColumn(eligibleCities) {
  const top = eligibleCities.slice(0, FOOTER_BROWSE_CITY_COUNT);
  const links = top
    .map(function (bucket) {
      const slug = citySlug(bucket.city, bucket.state);
      return (
        '<a href="' + escapeAttribute(buildCityPath(slug)) + '">' + escapeHtml(bucket.city) + "</a>"
      );
    })
    .join("\n          ");
  return (
    '<div class="footer-col footer-col-cities">\n' +
    "          <h4>Browse by City</h4>\n          " +
    links +
    '\n          <a href="/bipolar-therapists/" class="footer-city-all">See all cities</a>\n        </div>'
  );
}

function injectFooterCityBlock(html, columnHtml) {
  const placeholder = /<!--\s*BROWSE-BY-CITY-LIST\s*-->/;
  if (!placeholder.test(html)) return null;
  return html.replace(placeholder, columnHtml);
}

function injectFooterIntoDistFiles(eligibleCities) {
  const columnHtml = buildBrowseByCityFooterColumn(eligibleCities);
  const distEntries = fs.readdirSync(DIST_DIR, { withFileTypes: true });
  let touched = 0;
  for (const entry of distEntries) {
    if (!entry.isFile() || !entry.name.endsWith(".html")) continue;
    const filePath = path.join(DIST_DIR, entry.name);
    const original = fs.readFileSync(filePath, "utf8");
    const updated = injectFooterCityBlock(original, columnHtml);
    if (updated && updated !== original) {
      fs.writeFileSync(filePath, updated, "utf8");
      touched += 1;
    }
  }
  return touched;
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
  const cityContentMap = loadCityContentMap();
  const eligibleCities = cities.filter(function (c) {
    return c.providers.length >= MIN_PROVIDERS;
  });

  let written = 0;
  let skipped = cities.length - eligibleCities.length;
  for (const city of eligibleCities) {
    const slug = citySlug(city.city, city.state);
    if (!slug) continue;
    const outputDir = path.join(CITY_OUTPUT_DIR, slug);
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(
      path.join(outputDir, "index.html"),
      injectSeo(template, city.city, city.state, slug, city.providers, cityContentMap[slug]),
      "utf8",
    );
    written += 1;
  }

  // City hub page at /bipolar-therapists/index.html
  fs.mkdirSync(CITY_OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(CITY_OUTPUT_DIR, "index.html"),
    injectHubSeo(template, eligibleCities),
    "utf8",
  );

  // Browse by City footer block, injected into every dist/*.html that
  // has the BROWSE-BY-CITY-LIST placeholder.
  const footerTouched = injectFooterIntoDistFiles(eligibleCities);

  console.log(
    "[seo-city-pages] Wrote " +
      written +
      " city landing pages + 1 hub page to " +
      CITY_OUTPUT_DIR +
      " (skipped " +
      skipped +
      " cities with <" +
      MIN_PROVIDERS +
      " providers, footer injected into " +
      footerTouched +
      " HTML files)",
  );
}

main().catch(function (error) {
  console.error("[seo-city-pages] Unexpected error:", error);
  process.exitCode = 1;
});
