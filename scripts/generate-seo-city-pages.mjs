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
import { pathToFileURL } from "node:url";
import { createClient } from "@sanity/client";

import { formatNameList, summarizeProviders } from "../shared/seo-provider-stats.mjs";

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
  const stats = computeCityStats(providers);
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
    buildCityFaqJsonLd(city, stats),
  ];
}

// Two-letter initials from a name. Skips credentials in parens, prefers
// first + last initial. Used for the small avatar tile on provider cards.
function getInitials(name) {
  const parts = String(name || "")
    .replace(/\(.*?\)/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Stable tone index 0-5 from a string so providers consistently get the
// same avatar color across rebuilds. Mirrors the .profile-hero-avatar
// tone palette in therapist-page.css.
function toneForName(name) {
  let hash = 0;
  const str = String(name || "");
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 6;
}

function buildProviderCardsHtml(providers) {
  return providers
    .map(function (p) {
      const fullName = String(p.name || "").trim();
      const credentials = String(p.credentials || "").trim();
      const role = String(p.title || "").trim();
      const initials = getInitials(fullName);
      const tone = toneForName(fullName);
      const href = "/therapists/" + encodeURIComponent(String(p.slug || "").trim()) + "/";
      return (
        '<a class="city-provider-card" href="' +
        escapeAttribute(href) +
        '">' +
        '<div class="city-provider-avatar city-provider-avatar--tone-' +
        tone +
        '" aria-hidden="true">' +
        escapeHtml(initials) +
        "</div>" +
        '<div class="city-provider-body">' +
        '<div class="city-provider-name">' +
        escapeHtml(fullName) +
        (credentials
          ? '<span class="city-provider-creds">' + escapeHtml(credentials) + "</span>"
          : "") +
        "</div>" +
        (role ? '<div class="city-provider-role">' + escapeHtml(role) + "</div>" : "") +
        '<div class="city-provider-cta">View profile <span aria-hidden="true">&rarr;</span></div>' +
        "</div>" +
        "</a>"
      );
    })
    .join("");
}

function buildCityHeroHtml(city, state, providers) {
  const count = providers.length;
  const countLabel = count === 1 ? "1 verified specialist" : count + " verified specialists";
  return (
    '<section class="city-hero">' +
    '<div class="city-hero-deco" aria-hidden="true">' +
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 400" preserveAspectRatio="xMidYMid slice">' +
    '<defs><radialGradient id="cityHeroGlow" cx="20%" cy="30%" r="60%">' +
    '<stop offset="0%" stop-color="#6dbdd4" stop-opacity="0.18"/>' +
    '<stop offset="100%" stop-color="#0b2530" stop-opacity="0"/>' +
    "</radialGradient></defs>" +
    '<rect width="1200" height="400" fill="url(#cityHeroGlow)"/>' +
    "</svg>" +
    "</div>" +
    '<div class="city-hero-inner">' +
    '<p class="city-hero-eyebrow"><span class="city-hero-eyebrow-dot" aria-hidden="true"></span>Bipolar-informed care &middot; California</p>' +
    '<h1 class="city-hero-h1">' +
    "Find a <em>bipolar specialist</em><br/>in " +
    escapeHtml(city) +
    ", " +
    escapeHtml(state) +
    "</h1>" +
    '<p class="city-hero-sub">' +
    countLabel +
    " in " +
    escapeHtml(city) +
    " with documented bipolar care experience. License-verified. No paid rankings. No generalists." +
    "</p>" +
    '<div class="city-hero-pills">' +
    '<span class="city-hero-pill"><svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm3.6 5.4-4.3 4.3a.8.8 0 0 1-1.1 0L4 8.5a.8.8 0 0 1 1.1-1.1l1.6 1.6 3.7-3.7a.8.8 0 1 1 1.2 1.1Z"/></svg>License verified</span>' +
    '<span class="city-hero-pill"><svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm3.6 5.4-4.3 4.3a.8.8 0 0 1-1.1 0L4 8.5a.8.8 0 0 1 1.1-1.1l1.6 1.6 3.7-3.7a.8.8 0 1 1 1.2 1.1Z"/></svg>Bipolar specialists only</span>' +
    '<span class="city-hero-pill"><svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm3.6 5.4-4.3 4.3a.8.8 0 0 1-1.1 0L4 8.5a.8.8 0 0 1 1.1-1.1l1.6 1.6 3.7-3.7a.8.8 0 1 1 1.2 1.1Z"/></svg>Free for patients</span>' +
    "</div>" +
    '<div class="city-hero-ctas">' +
    '<a class="city-hero-cta-primary" href="/match">Get a personalized match <span aria-hidden="true">&rarr;</span></a>' +
    '<a class="city-hero-cta-secondary" href="#cityProviders">Browse all ' +
    count +
    ' <span aria-hidden="true">&darr;</span></a>' +
    "</div>" +
    "</div>" +
    "</section>"
  );
}

function buildCityContextHtml(city, state, cityContent, stats) {
  const fee = formatFeeRange(stats);
  const feeClause = fee
    ? " Among the specialists listed here, session fees typically run " + fee + "."
    : "";
  const fallback =
    "Finding a therapist who specializes in bipolar disorder in " +
    city +
    " means looking past general mood disorder listings and confirming real bipolar-specific experience. Every clinician on this page has been verified for that, so you can compare options without the usual guesswork." +
    feeClause;
  const blurb = (cityContent && cityContent.context) || fallback;
  return (
    '<section class="city-context">' +
    '<div class="city-section-inner">' +
    '<p class="city-section-kicker">Why this city</p>' +
    '<h2 class="city-section-h2">What makes bipolar care different in ' +
    escapeHtml(city) +
    "</h2>" +
    '<p class="city-context-blurb">' +
    escapeHtml(blurb) +
    "</p>" +
    "</div>" +
    "</section>"
  );
}

// Plain-text lede for the providers section, enriched with real
// availability/modality facts so each city page reads distinctly. Caller
// escapes the result.
function buildCityProvidersLede(providers) {
  let sentence =
    "Each profile lists training, modalities, insurance, and years of bipolar-specific experience.";
  const stats = summarizeProviders(providers);
  const facts = [];
  if (stats.acceptingCount > 0) {
    facts.push(
      stats.acceptingCount +
        " " +
        (stats.acceptingCount === 1 ? "is" : "are") +
        " accepting new patients",
    );
  }
  if (stats.telehealthCount > 0) {
    facts.push(stats.telehealthCount + " offer telehealth");
  }
  if (facts.length) {
    sentence += " Of these, " + formatNameList(facts, 2) + ".";
  }
  if (stats.topModalities.length) {
    sentence += " Common approaches here include " + formatNameList(stats.topModalities, 3) + ".";
  }
  return sentence;
}

function buildCityProvidersHtml(city, providers) {
  return (
    '<section class="city-providers" id="cityProviders">' +
    '<div class="city-section-inner">' +
    '<p class="city-section-kicker">Verified specialists</p>' +
    '<h2 class="city-section-h2">' +
    providers.length +
    " clinicians in " +
    escapeHtml(city) +
    "</h2>" +
    '<p class="city-section-lede">' +
    escapeHtml(buildCityProvidersLede(providers)) +
    "</p>" +
    '<div class="city-provider-grid">' +
    buildProviderCardsHtml(providers) +
    "</div>" +
    "</div>" +
    "</section>"
  );
}

function buildWhatToLookForHtml(city) {
  const items = [
    {
      title: "Bipolar listed explicitly",
      body: 'Look for "bipolar disorder" in their specialties, not just "mood disorders" or "depression." The distinction matters more than it sounds.',
    },
    {
      title: "Bipolar I vs Bipolar II fluency",
      body: "A specialist should be comfortable explaining how each diagnosis shapes the treatment plan, not just collapse them into one category.",
    },
    {
      title: "Coordinates with a prescriber",
      body: "Most bipolar care involves both therapy and medication. Ask whether the clinician routinely communicates with the psychiatrist or NP managing your meds.",
    },
    {
      title: "Knows mood-stabilizer side effects",
      body: "Lithium, lamotrigine, valproate, and the major antipsychotics each have their own profile. A good therapist recognizes when something is off and flags it.",
    },
    {
      title: "Trained in a bipolar-specific modality",
      body: "IPSRT, family-focused therapy, or DBT adapted for bipolar are evidence-based for mood disorders. Generic CBT is fine, but specificity matters.",
    },
  ];
  return (
    '<section class="city-criteria">' +
    '<div class="city-section-inner">' +
    '<p class="city-section-kicker">How to choose</p>' +
    '<h2 class="city-section-h2">What to look for in a ' +
    escapeHtml(city) +
    " bipolar specialist</h2>" +
    '<ol class="city-criteria-list">' +
    items
      .map(function (item, idx) {
        const n = String(idx + 1).padStart(2, "0");
        return (
          '<li class="city-criteria-item">' +
          '<div class="city-criteria-num" aria-hidden="true">' +
          n +
          "</div>" +
          '<div class="city-criteria-body">' +
          '<h3 class="city-criteria-title">' +
          escapeHtml(item.title) +
          "</h3>" +
          '<p class="city-criteria-text">' +
          escapeHtml(item.body) +
          "</p>" +
          "</div>" +
          "</li>"
        );
      })
      .join("") +
    "</ol>" +
    "</div>" +
    "</section>"
  );
}

// Single source of truth for the city FAQ, consumed by both the visible
// HTML and the JSON-LD FAQPage so the two never drift.
function getCityFaqItems(city, stats) {
  const cityFee = stats ? formatFeeRange(stats) : "";
  const costAnswer = cityFee
    ? "Among the bipolar specialists listed in " +
      city +
      ", typical session fees run " +
      cityFee +
      ". Across California, out-of-pocket rates generally range from $150 to $300, with the highest in San Francisco and West Los Angeles. Many therapists accept commercial insurance, a smaller number accept Medi-Cal, and some offer sliding scale. Each provider lists their fee range and insurance acceptance on their profile."
    : "Out-of-pocket sessions in California generally range from $150 to $300, with the highest rates in San Francisco and West Los Angeles. Many therapists accept commercial insurance, and a smaller number accept Medi-Cal or offer sliding scale. Each provider on this page lists their fee range and insurance acceptance on their profile.";
  return [
    {
      q: "Do I need a psychiatrist or a therapist for bipolar?",
      a:
        "Usually both. A psychiatrist or psychiatric nurse practitioner manages medication, which is the foundation of bipolar treatment. A therapist provides ongoing support, psychoeducation, and skills for managing mood episodes. Many people in " +
        city +
        " see both, and the two clinicians coordinate on your care.",
    },
    {
      q: "How much does bipolar therapy typically cost in " + city + "?",
      a: costAnswer,
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
}

// Visible FAQ. Structured data now lives in the JSON-LD FAQPage (see
// buildCityFaqJsonLd), so no microdata attributes here — carrying both
// would risk duplicate FAQ structured data.
function buildCityFaqHtml(city, stats) {
  const items = getCityFaqItems(city, stats);
  return (
    '<section class="city-faq">' +
    '<div class="city-section-inner">' +
    '<p class="city-section-kicker">Common questions</p>' +
    '<h2 class="city-section-h2">Frequently asked</h2>' +
    '<dl class="city-faq-list">' +
    items
      .map(function (item) {
        return (
          '<div class="city-faq-item">' +
          '<dt class="city-faq-q">' +
          escapeHtml(item.q) +
          "</dt>" +
          '<dd class="city-faq-a">' +
          escapeHtml(item.a) +
          "</dd>" +
          "</div>"
        );
      })
      .join("") +
    "</dl>" +
    "</div>" +
    "</section>"
  );
}

function buildCityFaqJsonLd(city, stats) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: getCityFaqItems(city, stats).map(function (item) {
      return {
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      };
    }),
  };
}

function buildCityCtaBandHtml(city) {
  return (
    '<section class="city-cta-band">' +
    '<div class="city-cta-band-inner">' +
    '<h2 class="city-cta-band-h2">Want a personalized shortlist?</h2>' +
    '<p class="city-cta-band-p">Skip the exhausting search. Two questions and we\'ll shortlist the ' +
    escapeHtml(city) +
    " specialists who fit you.</p>" +
    '<a class="city-cta-band-button" href="/match">Get matched <span aria-hidden="true">&rarr;</span></a>' +
    "</div>" +
    "</section>"
  );
}

// Real session-fee range for a city, derived from provider data. This is
// the one trustworthy datum that genuinely varies city to city, so it is
// woven into the context blurb and the cost FAQ to de-templatize them.
// (Accepting/telehealth/in-person booleans are uniformly true across the
// dataset, so they are not surfaced — they would read as filler and may
// be defaults rather than verified facts.)
function computeCityStats(providers) {
  let feeMin = null;
  let feeMax = null;
  for (const p of providers || []) {
    const lo = Number(p && p.sessionFeeMin);
    const hi = Number((p && p.sessionFeeMax) || (p && p.sessionFeeMin));
    if (Number.isFinite(lo) && lo > 0) feeMin = feeMin === null ? lo : Math.min(feeMin, lo);
    if (Number.isFinite(hi) && hi > 0) feeMax = feeMax === null ? hi : Math.max(feeMax, hi);
  }
  return { feeMin, feeMax };
}

function formatFeeRange(stats) {
  if (!stats || stats.feeMin === null) return "";
  if (stats.feeMax && stats.feeMax !== stats.feeMin) {
    return "$" + stats.feeMin + "–$" + stats.feeMax;
  }
  return "$" + stats.feeMin;
}

function buildFallbackBodyHtml(city, state, providers, cityContent) {
  const stats = computeCityStats(providers);
  return (
    '<div class="seo-city-fallback" data-static-seo-city>' +
    buildCityHeroHtml(city, state, providers) +
    buildCityContextHtml(city, state, cityContent, stats) +
    buildCityProvidersHtml(city, providers) +
    buildWhatToLookForHtml(city) +
    buildCityFaqHtml(city, stats) +
    buildCityCtaBandHtml(city) +
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

// Static stylesheet that owns all city-page visuals. Lives in public/
// so Vite copies it verbatim (no hashing) and we can reference a stable
// path from the generated HTML. Loaded only on the city + hub pages so
// it doesn't bloat the homepage / directory / match bundles.
const CITY_STYLESHEET_LINK = '<link rel="stylesheet" href="/seo-city-pages.css" />';

function injectStylesheet(html) {
  return html.replace(/<\/head>/, "    " + CITY_STYLESHEET_LINK + "\n  </head>");
}

export function stripDirectoryTemplateSeoHead(html) {
  return String(html || "")
    .replace(/\s*<meta\b(?=[^>]*\bid="dirPageDescription")[^>]*\/?>/gi, "")
    .replace(/\s*<link\b(?=[^>]*\bid="dirPageCanonical")[^>]*\/?>/gi, "")
    .replace(/\s*<meta\b(?=[^>]*\bid="dirRobots")[^>]*\/?>/gi, "")
    .replace(/\s*<script\b(?=[^>]*\bid="dirJsonLd")[^>]*>[\s\S]*?<\/script>/gi, "");
}

export function injectSeo(template, city, state, slug, providers, cityContent) {
  return injectStylesheet(
    stripDirectoryTemplateSeoHead(template)
      .replace(/<title[^>]*>[\s\S]*?<\/title>/, buildHeadTags(city, state, slug, providers))
      .replace(/href="(?:\.\.\/)*favicon/g, 'href="/favicon')
      .replace(/href="(?:\.\.\/)*assets\//g, 'href="/assets/')
      .replace(/src="(?:\.\.\/)*assets\//g, 'src="/assets/')
      .replace(/<header class="dir-header">[\s\S]*?<\/header>/, "")
      .replace(
        /<main[^>]*>[\s\S]*?<\/main>/,
        '<main class="seo-city-main">\n      ' +
          buildFallbackBodyHtml(city, state, providers, cityContent) +
          "\n    </main>",
      ),
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
  const totalProviders = eligibleCities.reduce(function (sum, c) {
    return sum + c.providers.length;
  }, 0);
  const items = eligibleCities
    .slice()
    .sort(function (a, b) {
      return a.city.localeCompare(b.city);
    })
    .map(function (bucket) {
      const slug = citySlug(bucket.city, bucket.state);
      const count = bucket.providers.length;
      const label = count === 1 ? "1 specialist" : count + " specialists";
      return (
        '<a class="city-hub-card" href="' +
        escapeAttribute(buildCityPath(slug)) +
        '">' +
        '<div class="city-hub-card-body">' +
        '<div class="city-hub-card-name">' +
        escapeHtml(bucket.city) +
        "</div>" +
        '<div class="city-hub-card-meta">' +
        label +
        "</div>" +
        "</div>" +
        '<div class="city-hub-card-arrow" aria-hidden="true">&rarr;</div>' +
        "</a>"
      );
    })
    .join("");
  return (
    '<div class="seo-city-hub" data-static-seo-city-hub>' +
    '<section class="city-hero">' +
    '<div class="city-hero-deco" aria-hidden="true">' +
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 400" preserveAspectRatio="xMidYMid slice">' +
    '<defs><radialGradient id="hubHeroGlow" cx="20%" cy="30%" r="60%">' +
    '<stop offset="0%" stop-color="#6dbdd4" stop-opacity="0.18"/>' +
    '<stop offset="100%" stop-color="#0b2530" stop-opacity="0"/>' +
    "</radialGradient></defs>" +
    '<rect width="1200" height="400" fill="url(#hubHeroGlow)"/>' +
    "</svg>" +
    "</div>" +
    '<div class="city-hero-inner">' +
    '<p class="city-hero-eyebrow"><span class="city-hero-eyebrow-dot" aria-hidden="true"></span>Bipolar-informed care &middot; California</p>' +
    '<h1 class="city-hero-h1">Find a <em>bipolar therapist</em><br/>by city</h1>' +
    '<p class="city-hero-sub">' +
    totalProviders +
    " license-verified specialists across " +
    eligibleCities.length +
    " California cities. Pick your city, or get matched in two minutes." +
    "</p>" +
    '<div class="city-hero-ctas">' +
    '<a class="city-hero-cta-primary" href="/match">Get a personalized match <span aria-hidden="true">&rarr;</span></a>' +
    '<a class="city-hero-cta-secondary" href="#cityHubGrid">Browse cities <span aria-hidden="true">&darr;</span></a>' +
    "</div>" +
    "</div>" +
    "</section>" +
    '<section class="city-hub-list" id="cityHubGrid">' +
    '<div class="city-section-inner">' +
    '<p class="city-section-kicker">Browse by city</p>' +
    '<h2 class="city-section-h2">California cities with bipolar specialists</h2>' +
    '<p class="city-section-lede">Each city below has at least ' +
    MIN_PROVIDERS +
    " license-verified bipolar specialists.</p>" +
    '<div class="city-hub-grid">' +
    items +
    "</div>" +
    "</div>" +
    "</section>" +
    "</div>"
  );
}

function injectHubSeo(template, eligibleCities) {
  return injectStylesheet(
    template
      .replace(/<title[^>]*>[\s\S]*?<\/title>/, buildHubHeadTags())
      .replace(/href="(?:\.\.\/)*favicon/g, 'href="/favicon')
      .replace(/href="(?:\.\.\/)*assets\//g, 'href="/assets/')
      .replace(/src="(?:\.\.\/)*assets\//g, 'src="/assets/')
      .replace(/<header class="dir-header">[\s\S]*?<\/header>/, "")
      .replace(
        /<main[^>]*>[\s\S]*?<\/main>/,
        '<main class="seo-city-main">\n      ' + buildHubBodyHtml(eligibleCities) + "\n    </main>",
      ),
  );
}

// =============================================================
// Browse by City footer block.
//
// Replaces a `<!-- BROWSE-BY-CITY-LIST -->` placeholder in any
// dist/*.html file with a real link list of the top N cities.
// Pages that don't have the placeholder are skipped silently.
// =============================================================

function buildBrowseByCityLinks(eligibleCities) {
  return eligibleCities
    .slice(0, FOOTER_BROWSE_CITY_COUNT)
    .map(function (bucket) {
      const slug = citySlug(bucket.city, bucket.state);
      return (
        '<a href="' + escapeAttribute(buildCityPath(slug)) + '">' + escapeHtml(bucket.city) + "</a>"
      );
    })
    .join("\n          ");
}

// Multi-column variant. Slots into index.html's .footer-top grid as a
// fifth column. .footer-col gets block-stacked links from home.css.
function buildBrowseByCityColumn(eligibleCities) {
  return (
    '<div class="footer-col footer-col-cities">\n' +
    "          <h4>Browse by City</h4>\n          " +
    buildBrowseByCityLinks(eligibleCities) +
    '\n          <a href="/bipolar-therapists/" class="footer-city-all">See all cities</a>\n        </div>'
  );
}

// Inline variant for pages with a single-column centered footer
// (directory, match, therapist, city pages). Styled by styles.css
// (.footer-cities-inline) and therapist-page.css.
function buildBrowseByCityInline(eligibleCities) {
  return (
    '<div class="footer-cities-inline">\n' +
    "        <h4>Browse by City</h4>\n        " +
    buildBrowseByCityLinks(eligibleCities) +
    '\n        <a href="/bipolar-therapists/" class="footer-city-all">See all cities</a>\n      </div>'
  );
}

// Pick the right variant by detecting whether the page uses the
// multi-column home-style footer (has .footer-top) or a minimal
// centered one.
function pickFooterVariant(html, eligibleCities) {
  if (html.includes('class="footer-top"')) {
    return buildBrowseByCityColumn(eligibleCities);
  }
  return buildBrowseByCityInline(eligibleCities);
}

function injectFooterCityBlock(html, eligibleCities) {
  const placeholder = /<!--\s*BROWSE-BY-CITY-LIST\s*-->/;
  if (!placeholder.test(html)) return null;
  return html.replace(placeholder, pickFooterVariant(html, eligibleCities));
}

function walkHtmlFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip Vite's hashed asset chunks; only HTML lives elsewhere.
      if (entry.name === "assets") continue;
      out.push(...walkHtmlFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      out.push(full);
    }
  }
  return out;
}

function injectFooterIntoDistFiles(eligibleCities) {
  const htmlFiles = walkHtmlFiles(DIST_DIR);
  let touched = 0;
  for (const filePath of htmlFiles) {
    const original = fs.readFileSync(filePath, "utf8");
    const updated = injectFooterCityBlock(original, eligibleCities);
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
       "slug": slug.current, name, credentials, title, city, state,
       sessionFeeMin, sessionFeeMax, acceptsTelehealth, acceptsInPerson,
       acceptingNewPatients, treatmentModalities, specialties
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(function (error) {
    console.error("[seo-city-pages] Unexpected error:", error);
    process.exitCode = 1;
  });
}
