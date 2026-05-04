#!/usr/bin/env node
// Audit script: find live therapist records whose slug city segment does not
// match their stored city field.
//
// A slug is expected to follow the pattern: {name-kebab}-{city-kebab}-ca
// This script derives the expected city slug from therapist.city and compares
// it against what is actually embedded in therapist.slug.current.
//
// A mismatch means the slug was generated (at publish time) using a different
// city value than what is currently stored — typically because the source
// profile listed a metro area ("Los Angeles") rather than the therapist's
// actual city ("Inglewood").
//
// Output: JSON report saved to scripts/reports/slug-city-mismatch-<timestamp>.json
//
// Usage:
//   node scripts/audit-slug-city-mismatch.mjs
//   node scripts/audit-slug-city-mismatch.mjs --all   # include inactive/unlisted
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";

const ROOT = process.cwd();
const REPORTS_DIR = path.join(ROOT, "scripts", "reports");

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

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function extractCitySegmentFromSlug(slug, state) {
  // Slug format: name-parts...-city-parts...-state
  // Strip trailing -ca (or other state) to isolate the city+name section
  const stateSlug = slugify(state || "ca");
  const suffix = "-" + stateSlug;
  if (!slug.endsWith(suffix)) return null;
  return slug.slice(0, -suffix.length);
}

async function main() {
  const args = process.argv.slice(2);
  const includeAll = args.includes("--all");

  const env = readEnvFile(path.join(ROOT, ".env"));

  const client = createClient({
    projectId: process.env.VITE_SANITY_PROJECT_ID || env.VITE_SANITY_PROJECT_ID,
    dataset: process.env.VITE_SANITY_DATASET || env.VITE_SANITY_DATASET || "production",
    apiVersion: process.env.VITE_SANITY_API_VERSION || env.VITE_SANITY_API_VERSION || "2026-04-02",
    token: process.env.SANITY_API_TOKEN || env.SANITY_API_TOKEN,
    useCdn: false,
  });

  const filter = includeAll
    ? `_type == "therapist"`
    : `_type == "therapist" && listingActive == true && status == "active" && visibilityIntent == "listed"`;

  console.log(`Fetching therapist records (${includeAll ? "all" : "live only"})…`);
  const therapists = await client.fetch(
    `*[${filter}]{
      _id,
      name,
      city,
      state,
      "slug": slug.current,
      listingActive,
      status,
      visibilityIntent
    }`,
  );
  console.log(`  Found ${therapists.length} therapist(s)`);

  const mismatches = [];
  const noSlug = [];
  const noCity = [];

  for (const t of therapists) {
    const slug = String(t.slug || "").trim();
    const city = String(t.city || "").trim();
    const state = String(t.state || "CA").trim();

    if (!slug) {
      noSlug.push({ _id: t._id, name: t.name });
      continue;
    }
    if (!city) {
      noCity.push({ _id: t._id, name: t.name, slug });
      continue;
    }

    const expectedCitySlug = slugify(city);
    const slugWithoutState = extractCitySegmentFromSlug(slug, state);

    if (!slugWithoutState) {
      // Slug doesn't follow expected pattern — can't parse
      continue;
    }

    // The slug without state should end with the city slug
    // e.g. "fidelia-nnachetam-inglewood" ends with "inglewood"
    if (
      !slugWithoutState.endsWith("-" + expectedCitySlug) &&
      slugWithoutState !== expectedCitySlug
    ) {
      // Try to extract what city the slug actually encodes:
      // We know the name slugified; the city is what follows
      const nameSlug = slugify(t.name);
      let slugCityGuess = null;
      if (slugWithoutState.startsWith(nameSlug + "-")) {
        slugCityGuess = slugWithoutState.slice(nameSlug.length + 1);
      }

      mismatches.push({
        _id: t._id,
        name: t.name,
        city_in_record: city,
        expected_city_slug: expectedCitySlug,
        slug_city_segment: slugCityGuess || "(unknown)",
        current_slug: slug,
        expected_slug: slugify([t.name, city, state].join(" ")),
        profile_url: "https://www.bipolartherapyhub.com/therapists/" + slug + "/",
      });
    }
  }

  console.log(`\nResults:`);
  console.log(`  Mismatches (slug city ≠ record city): ${mismatches.length}`);
  console.log(`  Missing slug:                         ${noSlug.length}`);
  console.log(`  Missing city:                         ${noCity.length}`);

  if (mismatches.length > 0) {
    console.log(`\nMismatches:`);
    for (const m of mismatches) {
      console.log(`  ${m.name}`);
      console.log(
        `    Record city:   ${m.city_in_record} → expected slug segment: ${m.expected_city_slug}`,
      );
      console.log(`    Slug city:     ${m.slug_city_segment}`);
      console.log(`    Current slug:  ${m.current_slug}`);
      console.log(`    Expected slug: ${m.expected_slug}`);
      console.log(`    Profile URL:   ${m.profile_url}`);
      console.log(`    Sanity ID:     ${m._id}`);
    }
  }

  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outPath = path.join(REPORTS_DIR, `slug-city-mismatch-${timestamp}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        scope: includeAll ? "all" : "live",
        summary: {
          total_checked: therapists.length,
          mismatches: mismatches.length,
          no_slug: noSlug.length,
          no_city: noCity.length,
        },
        mismatches,
        no_slug: noSlug,
        no_city: noCity,
      },
      null,
      2,
    ),
  );
  console.log(`\nReport saved → ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
