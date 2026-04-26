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
import { createClient } from "@sanity/client";

const ROOT = process.cwd();
const API_VERSION = "2026-04-02";
const SITE_URL = "https://www.bipolartherapyhub.com";
const OUTPUT_PATH = path.join(ROOT, "public", "sitemap.xml");
const PROFILE_PATH_PREFIX = "/therapists/";

// Static routes we always want indexed. Portal/admin deliberately
// excluded (robots.txt also disallows them).
const STATIC_ROUTES = [
  { loc: "/", changefreq: "weekly", priority: "1.0" },
  { loc: "/directory", changefreq: "daily", priority: "0.9" },
  { loc: "/match", changefreq: "weekly", priority: "0.8" },
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
    `*[_type == "therapist" && listingActive == true && defined(slug.current)]{
      "slug": slug.current, city, state, _updatedAt
    }`,
  );
}

function buildTherapistPath(slug) {
  return `${PROFILE_PATH_PREFIX}${encodeURIComponent(String(slug || "").trim())}/`;
}

const CITY_PATH_PREFIX = "/bipolar-therapists/";
const CITY_MIN_PROVIDERS = 2;

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

function bucketTherapistsByCity(therapists) {
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

function buildSitemapXml(entries) {
  const header = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;
  const body = entries.map(buildUrlEntry).join("\n");
  const footer = `</urlset>\n`;
  return `${header}\n${body}\n${footer}`;
}

function writeStaticFallback() {
  const entries = STATIC_ROUTES.map((r) => ({
    ...r,
    lastmod: new Date().toISOString().slice(0, 10),
  }));
  fs.writeFileSync(OUTPUT_PATH, buildSitemapXml(entries), "utf8");
  console.warn(`[sitemap] Sanity not configured — wrote static-only sitemap to ${OUTPUT_PATH}`);
}

async function main() {
  const config = getConfig();
  if (!config.projectId || !config.dataset) {
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
  cityBuckets.forEach(function (bucket) {
    entries.push({
      loc: CITY_PATH_PREFIX + bucket.slug + "/",
      lastmod: (bucket.lastmod || "").slice(0, 10) || now,
      changefreq: "weekly",
      priority: "0.8",
    });
  });

  fs.writeFileSync(OUTPUT_PATH, buildSitemapXml(entries), "utf8");
  console.log(
    `[sitemap] Wrote ${entries.length} URLs (${therapists.length} therapist profiles + ${cityBuckets.length} city pages + ${STATIC_ROUTES.length} static) to ${OUTPUT_PATH}`,
  );
}

main().catch((error) => {
  console.error("[sitemap] Unexpected error:", error);
  // Don't fail the build — ship static fallback instead
  try {
    writeStaticFallback();
  } catch (_fallbackError) {
    // if even fallback fails, still don't block build
  }
});
