#!/usr/bin/env node
// Build a copy-paste list of X (Twitter) share URLs for every live directory
// listing that has a photo. X caches link cards by exact URL, so each URL
// carries a throwaway `?x=N` cache-buster — bump the number (or re-run with
// --bust=<n>) to force X to re-scrape a stale card. Read-only; modifies nothing.
//
// Usage:
//   node scripts/generate-x-share-urls.mjs            # write scripts/reports/x-share-urls.md
//   node scripts/generate-x-share-urls.mjs --urls     # also write a bare-URL .txt
//   node scripts/generate-x-share-urls.mjs --bust=2   # use ?x=2 instead of ?x=1
//   node scripts/generate-x-share-urls.mjs --stdout   # print instead of writing files

import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@sanity/client";

const SITE_ORIGIN = "https://www.bipolartherapyhub.com";

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

function readFlag(name) {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  const eq = hit.indexOf("=");
  return eq === -1 ? true : hit.slice(eq + 1);
}

function shareUrl(slug, bust) {
  return `${SITE_ORIGIN}/therapists/${encodeURIComponent(slug)}/?x=${bust}`;
}

async function main() {
  const root = process.cwd();
  const env = readEnvFile(path.join(root, ".env"));
  const projectId = process.env.VITE_SANITY_PROJECT_ID || env.VITE_SANITY_PROJECT_ID;
  if (!projectId || projectId === "your-project-id") {
    console.error(
      "Missing VITE_SANITY_PROJECT_ID. Set it in .env (or the environment) before running.",
    );
    process.exitCode = 1;
    return;
  }

  const client = createClient({
    projectId,
    dataset: process.env.VITE_SANITY_DATASET || env.VITE_SANITY_DATASET || "production",
    apiVersion: process.env.VITE_SANITY_API_VERSION || env.VITE_SANITY_API_VERSION || "2026-04-02",
    token: process.env.SANITY_API_TOKEN || env.SANITY_API_TOKEN,
    useCdn: true,
  });

  // Mirror the public directory query (server/public-content-handler.mjs):
  // listed, active, live — plus require a resolvable photo asset, since a
  // card without an image is the thing we do not want to share.
  const rows = await client.fetch(
    `*[_type == "therapist"
        && listingActive == true
        && status == "active"
        && visibilityIntent == "listed"
        && defined(photo.asset)]
      | order(name asc){
        name,
        "slug": slug.current
      }`,
  );

  const listings = rows.filter((r) => r && r.slug);
  const bust = String(readFlag("bust") || "1");

  if (readFlag("stdout")) {
    listings.forEach((r) => console.log(shareUrl(r.slug, bust)));
    console.error(`\n${listings.length} listing(s) with a photo.`);
    return;
  }

  const outDir = path.join(root, "scripts", "reports");
  fs.mkdirSync(outDir, { recursive: true });

  const lines = [];
  lines.push("# X (Twitter) share URLs — live listings with a photo");
  lines.push("");
  lines.push(`- Listings with a photo: **${listings.length}**`);
  lines.push(`- Cache-buster: \`?x=${bust}\` (bump with \`--bust=<n>\` to force X to re-scrape)`);
  lines.push("");
  lines.push("Paste any URL into an X post. X caches cards by exact URL, so the");
  lines.push("`?x=` param makes each one look fresh and forces a re-scrape.");
  lines.push("");
  lines.push("## Copy-paste list");
  lines.push("");
  lines.push("```");
  listings.forEach((r) => lines.push(shareUrl(r.slug, bust)));
  lines.push("```");
  lines.push("");
  lines.push("## With names");
  lines.push("");
  listings.forEach((r) => lines.push(`- ${r.name || r.slug} — ${shareUrl(r.slug, bust)}`));
  lines.push("");

  const mdPath = path.join(outDir, "x-share-urls.md");
  fs.writeFileSync(mdPath, lines.join("\n"));
  console.log(`Wrote ${listings.length} URL(s) → ${path.relative(root, mdPath)}`);

  if (readFlag("urls")) {
    const txtPath = path.join(outDir, "x-share-urls.txt");
    fs.writeFileSync(txtPath, listings.map((r) => shareUrl(r.slug, bust)).join("\n") + "\n");
    console.log(`Wrote bare URL list → ${path.relative(root, txtPath)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
