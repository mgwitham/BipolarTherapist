#!/usr/bin/env node
// Read-only SEO coverage audit. Inspects dist/ + public/ + Sanity (if
// available) and reports what's indexed today: which static pages
// exist, how many therapist profile pages were generated, how many
// cities have provider coverage, and what's missing.
//
// Run after `npm run build`. Doesn't fail or modify anything — just
// prints a report. Use it to spot SEO regressions or to plan new
// landing pages (cities with high provider counts but no dedicated
// page = highest-leverage gaps).

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const DIST_DIR = path.join(ROOT, "dist");
const PUBLIC_DIR = path.join(ROOT, "public");
const SITEMAP_PATH = path.join(PUBLIC_DIR, "sitemap.xml");
const PROFILE_DIR = path.join(DIST_DIR, "therapists");
const CITY_DIR = path.join(DIST_DIR, "bipolar-therapists");

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

function getSanityConfig() {
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

function countDirEntries(dir) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).length;
}

function listStaticHtmlPages() {
  if (!fs.existsSync(DIST_DIR)) return [];
  return fs
    .readdirSync(DIST_DIR)
    .filter((name) => name.endsWith(".html"))
    .sort();
}

function readSitemap() {
  if (!fs.existsSync(SITEMAP_PATH)) return { count: 0, locs: [] };
  const xml = fs.readFileSync(SITEMAP_PATH, "utf8");
  const matches = xml.match(/<loc>([^<]+)<\/loc>/g) || [];
  const locs = matches.map((m) => m.replace(/<\/?loc>/g, ""));
  return { count: locs.length, locs };
}

async function fetchTherapistCoverage(config) {
  if (!config.projectId || !config.dataset) return null;
  const { createClient } = await import("@sanity/client");
  const client = createClient({
    projectId: config.projectId,
    dataset: config.dataset,
    apiVersion: "2026-04-02",
    useCdn: true,
  });
  return client.fetch(
    `*[_type == "therapist" && listingActive == true && status == "active" && defined(slug.current)]{
       "slug": slug.current, city, state
     }`,
  );
}

function bucketByCity(therapists) {
  const map = new Map();
  for (const t of therapists || []) {
    const city = String((t && t.city) || "").trim();
    if (!city) continue;
    const state = String((t && t.state) || "").trim() || "CA";
    const key = city + ", " + state;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()]
    .map(function ([city, count]) {
      return { city, count };
    })
    .sort(function (a, b) {
      return b.count - a.count;
    });
}

function pad(value, width) {
  return String(value).padEnd(width);
}

function formatHeader(text) {
  return "\n" + text + "\n" + "-".repeat(text.length);
}

async function main() {
  const lines = [];
  lines.push("BipolarTherapyHub SEO coverage audit");
  lines.push("Generated: " + new Date().toISOString());

  lines.push(formatHeader("Static HTML pages in dist/"));
  const pages = listStaticHtmlPages();
  if (!pages.length) {
    lines.push("  (none — run `npm run build` first)");
  } else {
    pages.forEach(function (p) {
      lines.push("  - " + p);
    });
  }

  lines.push(formatHeader("Therapist profile pages"));
  const profilePageCount = countDirEntries(PROFILE_DIR);
  lines.push("  Generated: " + profilePageCount);

  lines.push(formatHeader("City landing pages"));
  const cityPageCount = countDirEntries(CITY_DIR);
  lines.push("  Generated: " + cityPageCount);

  lines.push(formatHeader("Sitemap"));
  const sitemap = readSitemap();
  lines.push("  Total URLs: " + sitemap.count);
  if (sitemap.count > 0) {
    const profileUrls = sitemap.locs.filter(function (loc) {
      return loc.includes("/therapists/");
    }).length;
    const cityUrls = sitemap.locs.filter(function (loc) {
      return loc.includes("/bipolar-therapists/");
    }).length;
    lines.push("  /therapists/ entries: " + profileUrls);
    lines.push("  /bipolar-therapists/ entries: " + cityUrls);
    lines.push("  Other (static) entries: " + (sitemap.count - profileUrls - cityUrls));
  }

  const config = getSanityConfig();
  if (!config.projectId || !config.dataset) {
    lines.push(formatHeader("Sanity coverage"));
    lines.push("  Sanity not configured — skipping live therapist + city analysis.");
    lines.push("  Set VITE_SANITY_PROJECT_ID + VITE_SANITY_DATASET in .env to enable.");
    console.log(lines.join("\n"));
    return;
  }

  let therapists = [];
  try {
    therapists = (await fetchTherapistCoverage(config)) || [];
  } catch (error) {
    lines.push(formatHeader("Sanity coverage"));
    lines.push("  Fetch failed: " + (error && error.message ? error.message : String(error)));
    console.log(lines.join("\n"));
    return;
  }

  lines.push(formatHeader("Live therapist coverage (Sanity)"));
  lines.push("  Listing-active + status==active: " + therapists.length);
  if (therapists.length !== profilePageCount) {
    lines.push(
      "  WARNING: " +
        therapists.length +
        " active therapists in Sanity but " +
        profilePageCount +
        " profile pages on disk. Re-run build:seo-pages.",
    );
  }

  const cities = bucketByCity(therapists);
  lines.push(formatHeader("Cities with active providers (top 15)"));
  if (!cities.length) {
    lines.push("  (no cities recorded)");
  } else {
    cities.slice(0, 15).forEach(function (entry) {
      lines.push(
        "  " +
          pad(entry.city, 32) +
          " " +
          entry.count +
          " provider" +
          (entry.count === 1 ? "" : "s"),
      );
    });
    if (cities.length > 15) {
      lines.push("  ... and " + (cities.length - 15) + " more cities");
    }
  }

  if (cityPageCount === 0 && cities.length > 0) {
    lines.push("");
    lines.push(
      "OPPORTUNITY: 0 city landing pages generated, but " +
        cities.length +
        " cities have at least one active provider. Run `npm run build:seo-city-pages` to add them.",
    );
  } else if (cityPageCount > 0 && cityPageCount < cities.length) {
    lines.push("");
    lines.push(
      "GAP: " +
        cityPageCount +
        " city pages generated vs " +
        cities.length +
        " cities with providers. Some cities may be skipped (check threshold in generator).",
    );
  }

  console.log(lines.join("\n"));
}

main().catch(function (error) {
  console.error("[audit-seo-coverage] failed:", error);
  process.exit(1);
});
