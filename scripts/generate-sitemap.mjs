// Build-time sitemap generator. Queries Sanity for all listing-active
// therapist records, emits public/sitemap.xml with static routes +
// one clean <url> entry per therapist. Runs before vite build so the
// generated file lands in dist/.
//
// Skips gracefully (with a warning, not an error) if Sanity isn't
// configured — so local `npm run build` still works without .env.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { createClient } from "@sanity/client";

import { articles } from "../content/resources/articles.mjs";
import { bucketTherapistsByInsurance, insuranceSlug } from "./generate-seo-insurance-pages.mjs";

const ROOT = process.cwd();
const API_VERSION = "2026-04-02";
const SITE_URL = "https://www.bipolartherapyhub.com";
const OUTPUT_PATH = path.join(ROOT, "public", "sitemap.xml");
const PROFILE_PATH_PREFIX = "/therapists/";

// Static routes we always want indexed. Portal/admin and transient
// matching surfaces are deliberately excluded because they carry
// noindex directives.
export const STATIC_ROUTES = [
  { loc: "/", changefreq: "weekly", priority: "1.0" },
  { loc: "/directory", changefreq: "daily", priority: "0.9" },
  { loc: "/about", changefreq: "monthly", priority: "0.7" },
  { loc: "/signup", changefreq: "monthly", priority: "0.7" },
  { loc: "/claim", changefreq: "monthly", priority: "0.7" },
  { loc: "/pricing", changefreq: "monthly", priority: "0.6" },
];

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
      // Strip surrounding quotes (Vercel env pull wraps values).
      const unquoted = value.replace(/^"(.*)"$/, "$1");
      acc[trimmed.slice(0, sep).trim()] = unquoted;
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

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildUrlEntry({ loc, lastmod, changefreq, priority }) {
  const parts = [
    `    <loc>${escapeXml(SITE_URL + loc)}</loc>`,
    lastmod ? `    <lastmod>${escapeXml(lastmod)}</lastmod>` : null,
    changefreq ? `    <changefreq>${escapeXml(changefreq)}</changefreq>` : null,
    priority ? `    <priority>${escapeXml(priority)}</priority>` : null,
  ].filter(Boolean);
  return `  <url>\n${parts.join("\n")}\n  </url>`;
}

async function fetchTherapistSlugs(config) {
  const client = createClient({
    projectId: config.projectId,
    dataset: config.dataset,
    apiVersion: API_VERSION,
    useCdn: true,
  });
  return client.fetch(
    `*[_type == "therapist" && listingActive == true && status == "active" && defined(slug.current)]{
      "slug": slug.current, city, state, _updatedAt, insuranceAccepted
    }`,
  );
}

function buildTherapistPath(slug) {
  return `${PROFILE_PATH_PREFIX}${encodeURIComponent(String(slug || "").trim())}/`;
}

const CITY_PATH_PREFIX = "/bipolar-therapists/";
const CITY_MIN_PROVIDERS = 2;
const INSURANCE_PATH_PREFIX = "/insurance/";

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

export function bucketTherapistsByCity(therapists) {
  const map = new Map();
  for (const t of therapists || []) {
    const city = String((t && t.city) || "").trim();
    if (!city) continue;
    const state = String((t && t.state) || "CA").trim();
    const key = citySlug(city, state);
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, { slug: key, count: 0, lastmod: "" });
    }
    const bucket = map.get(key);
    bucket.count += 1;
    const updated = (t && t._updatedAt) || "";
    if (updated > bucket.lastmod) bucket.lastmod = updated;
  }
  return [...map.values()].filter(function (entry) {
    return entry.count >= CITY_MIN_PROVIDERS;
  });
}

// Static resource/guide pages. Fully static content (no Sanity), so
// these are included in every sitemap, including the offline fallback.
export function buildResourceEntries(now) {
  const list = Array.isArray(articles) ? articles : [];
  const latest = list
    .map((a) => (a.dateModified || a.datePublished || "").slice(0, 10))
    .filter(Boolean)
    .sort()
    .pop();
  const entries = [
    {
      loc: "/resources/",
      lastmod: latest || now,
      changefreq: "weekly",
      priority: "0.6",
    },
  ];
  for (const a of list) {
    if (!a || !a.slug) continue;
    entries.push({
      loc: "/resources/" + a.slug + "/",
      lastmod: (a.dateModified || a.datePublished || "").slice(0, 10) || now,
      changefreq: "monthly",
      priority: "0.7",
    });
  }
  return entries;
}

export function buildSitemapXml(entries) {
  const header = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;
  const body = entries.map(buildUrlEntry).join("\n");
  const footer = `</urlset>\n`;
  return `${header}\n${body}\n${footer}`;
}

function writeStaticFallback() {
  const now = new Date().toISOString().slice(0, 10);
  const entries = STATIC_ROUTES.map((r) => ({ ...r, lastmod: now }));
  entries.push(...buildResourceEntries(now));
  fs.writeFileSync(OUTPUT_PATH, buildSitemapXml(entries), "utf8");
  console.warn(`[sitemap] Sanity not configured — wrote static-only sitemap to ${OUTPUT_PATH}`);
}

// A static-only fallback in a PRODUCTION build means every therapist
// profile + city + insurance URL is missing from the sitemap — a real
// long-tail indexing regression. Fail the build so a missing Sanity env
// surfaces loudly instead of silently shipping an ~11-URL sitemap.
// Preview/local builds (VERCEL_ENV unset or "preview"/"development")
// still fall back gracefully.
function guardProductionFallback(reason) {
  if (process.env.VERCEL_ENV === "production") {
    console.error(
      `[sitemap] Refusing to ship a static-only sitemap in production: ${reason}. ` +
        `Check SANITY_PROJECT_ID / VITE_SANITY_PROJECT_ID + dataset in the build env.`,
    );
    process.exit(1);
  }
}

async function main() {
  const config = getConfig();
  if (!config.projectId || !config.dataset) {
    guardProductionFallback("Sanity project/dataset not configured");
    writeStaticFallback();
    return;
  }

  let therapists = [];
  try {
    therapists = await fetchTherapistSlugs(config);
  } catch (error) {
    console.warn(
      `[sitemap] Failed to fetch therapists from Sanity: ${error.message}. Falling back to static routes only.`,
    );
    guardProductionFallback(`Sanity fetch failed: ${error.message}`);
    writeStaticFallback();
    return;
  }

  const now = new Date().toISOString().slice(0, 10);
  const entries = [];
  STATIC_ROUTES.forEach((r) => {
    entries.push({ ...r, lastmod: now });
  });
  (therapists || []).forEach((t) => {
    if (!t || !t.slug) return;
    entries.push({
      loc: buildTherapistPath(t.slug),
      lastmod: (t._updatedAt || "").slice(0, 10) || now,
      changefreq: "weekly",
      priority: "0.7",
    });
  });

  const cityBuckets = bucketTherapistsByCity(therapists);
  if (cityBuckets.length) {
    const latestCityLastmod = cityBuckets
      .map((bucket) => bucket.lastmod)
      .filter(Boolean)
      .sort()
      .pop();
    entries.push({
      loc: CITY_PATH_PREFIX,
      lastmod: (latestCityLastmod || "").slice(0, 10) || now,
      changefreq: "weekly",
      priority: "0.8",
    });
  }
  cityBuckets.forEach(function (bucket) {
    entries.push({
      loc: CITY_PATH_PREFIX + bucket.slug + "/",
      lastmod: (bucket.lastmod || "").slice(0, 10) || now,
      changefreq: "weekly",
      priority: "0.8",
    });
  });

  const insuranceBuckets = bucketTherapistsByInsurance(therapists);
  if (insuranceBuckets.length) {
    const latestInsuranceLastmod = insuranceBuckets
      .map((bucket) => bucket.lastmod)
      .filter(Boolean)
      .sort()
      .pop();
    entries.push({
      loc: INSURANCE_PATH_PREFIX,
      lastmod: (latestInsuranceLastmod || "").slice(0, 10) || now,
      changefreq: "weekly",
      priority: "0.7",
    });
  }
  insuranceBuckets.forEach(function (bucket) {
    entries.push({
      loc: INSURANCE_PATH_PREFIX + insuranceSlug(bucket.name) + "/",
      lastmod: (bucket.lastmod || "").slice(0, 10) || now,
      changefreq: "weekly",
      priority: "0.7",
    });
  });

  const resourceEntries = buildResourceEntries(now);
  entries.push(...resourceEntries);

  fs.writeFileSync(OUTPUT_PATH, buildSitemapXml(entries), "utf8");
  console.log(
    `[sitemap] Wrote ${entries.length} URLs (${therapists.length} therapist profiles + ${cityBuckets.length} city pages + ${insuranceBuckets.length} insurance pages + ${resourceEntries.length} resource pages + ${STATIC_ROUTES.length} static) to ${OUTPUT_PATH}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("[sitemap] Unexpected error:", error);
    // In production, surface the failure rather than silently shipping a
    // static-only sitemap (process.exit inside the guard). Outside
    // production, fall back so local/preview builds aren't blocked.
    guardProductionFallback(`unexpected error: ${error && error.message}`);
    try {
      writeStaticFallback();
    } catch (_fallbackError) {
      // if even fallback fails, still don't block build
    }
  });
}
