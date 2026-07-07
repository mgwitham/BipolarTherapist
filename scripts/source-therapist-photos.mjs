#!/usr/bin/env node
// Source candidate headshots for unclaimed listings from the therapist's
// OWN website, into the review vault (photoCandidate, status=pending).
// Nothing published: an admin approves each one in the photo review queue
// before it goes live (see server/review-candidate-routes: photo review).
//
// Only own-site images are considered — aggregators (Psychology Today, etc.)
// are blocked by the shared domain module, which also rejects logos and
// placeholders. Each downloaded image is validated with sharp (real raster,
// sane dimensions, roughly portrait/square) before upload.
//
// Usage:
//   node scripts/source-therapist-photos.mjs                 # dry run
//   node scripts/source-therapist-photos.mjs --apply         # commit
//   node scripts/source-therapist-photos.mjs --limit 25      # cap count
//   node scripts/source-therapist-photos.mjs --slug foo-bar  # single doc

import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@sanity/client";
import sharp from "sharp";
import {
  isEligibleForSourcing,
  isSourceablePhotoUrl,
  extractPhotoCandidatesFromHtml,
  buildCandidatePatch,
  extractHost,
} from "../shared/photo-sourcing-domain.mjs";

const APPLY = process.argv.includes("--apply");
const LIMIT = readIntFlag("--limit", Infinity);
const ONLY_SLUG = readStrFlag("--slug", "");
const FETCH_TIMEOUT_MS = 12000;
const POLITE_DELAY_MS = 1500;
const USER_AGENT =
  "BipolarTherapyHubBot/1.0 (+https://www.bipolartherapyhub.com/about; photo sourcing for directory listings)";

function readIntFlag(flag, fallback) {
  const i = process.argv.indexOf(flag);
  if (i === -1 || i === process.argv.length - 1) return fallback;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
function readStrFlag(flag, fallback) {
  const i = process.argv.indexOf(flag);
  if (i === -1 || i === process.argv.length - 1) return fallback;
  return String(process.argv[i + 1]);
}
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithTimeout(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...opts,
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT, ...(opts.headers || {}) },
    });
  } finally {
    clearTimeout(timer);
  }
}

// Download a candidate image and validate it looks like a real headshot:
// a decodable raster of reasonable size and aspect ratio. Returns
// { buffer, contentType, width, height } or null with a reason logged.
async function fetchValidImage(url) {
  let res;
  try {
    res = await fetchWithTimeout(url);
  } catch (err) {
    return { error: `fetch failed: ${err.message || err}` };
  }
  if (!res.ok) return { error: `HTTP ${res.status}` };
  const contentType = String(res.headers.get("content-type") || "").toLowerCase();
  if (!contentType.startsWith("image/")) return { error: `not an image (${contentType})` };
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length < 3 * 1024) return { error: `too small (${buffer.length}b)` };
  if (buffer.length > 8 * 1024 * 1024) return { error: `too large (${buffer.length}b)` };

  let meta;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    return { error: "not decodable by sharp" };
  }
  const w = meta.width || 0;
  const h = meta.height || 0;
  if (w < 150 || h < 150) return { error: `dimensions too small (${w}x${h})` };
  const ratio = w / h;
  // Headshots are portrait-to-square-ish. Reject wide banners/logos.
  if (ratio < 0.5 || ratio > 1.6) return { error: `aspect ratio ${ratio.toFixed(2)} not headshot` };
  return { buffer, contentType, width: w, height: h };
}

async function main() {
  const root = process.cwd();
  const env = readEnvFile(path.join(root, ".env"));
  const token = process.env.SANITY_API_TOKEN || env.SANITY_API_TOKEN;
  if (APPLY && !token) {
    console.error("SANITY_API_TOKEN required with --apply.");
    process.exit(1);
  }
  const client = createClient({
    projectId: process.env.VITE_SANITY_PROJECT_ID || env.VITE_SANITY_PROJECT_ID,
    dataset: process.env.VITE_SANITY_DATASET || env.VITE_SANITY_DATASET || "production",
    apiVersion: process.env.VITE_SANITY_API_VERSION || env.VITE_SANITY_API_VERSION || "2026-04-02",
    token,
    useCdn: false,
  });

  const filter = ONLY_SLUG ? `&& slug.current == "${ONLY_SLUG}"` : "";
  const docs = await client.fetch(
    `*[_type == "therapist" ${filter}]{
      _id, name, "slug": slug.current, website,
      claimStatus, photoSuppressed, photoCandidateStatus,
      "photo": photo{asset}
    } | order(name asc)`,
  );

  const eligible = docs.filter(isEligibleForSourcing);
  console.log(
    `${docs.length} therapist(s); ${eligible.length} eligible for sourcing` +
      (ONLY_SLUG ? ` (slug=${ONLY_SLUG})` : "") +
      `. ${APPLY ? "APPLY" : "DRY RUN"}.\n`,
  );

  let sourced = 0;
  let scanned = 0;
  for (const t of eligible) {
    if (sourced >= LIMIT) {
      console.log(`\nReached --limit ${LIMIT}. Stopping.`);
      break;
    }
    scanned += 1;
    const label = `${t.name} (${t.slug || t._id})`;

    let pageRes;
    try {
      pageRes = await fetchWithTimeout(t.website);
    } catch (err) {
      console.log(`  ✗ ${label}: site fetch failed — ${err.message || err}`);
      await sleep(POLITE_DELAY_MS);
      continue;
    }
    if (!pageRes.ok) {
      console.log(`  ✗ ${label}: site HTTP ${pageRes.status}`);
      await sleep(POLITE_DELAY_MS);
      continue;
    }
    const html = await pageRes.text();
    const finalUrl = pageRes.url || t.website;

    const candidates = extractPhotoCandidatesFromHtml(html, finalUrl).filter((url) =>
      isSourceablePhotoUrl(url, t.website),
    );
    if (!candidates.length) {
      console.log(`  – ${label}: no sourceable candidate on ${extractHost(t.website)}`);
      await sleep(POLITE_DELAY_MS);
      continue;
    }

    let picked = null;
    for (const url of candidates) {
      const img = await fetchValidImage(url);
      if (img.error) {
        console.log(`      skip ${url} — ${img.error}`);
        continue;
      }
      picked = { url, ...img };
      break;
    }
    if (!picked) {
      console.log(`  – ${label}: candidates found but none passed image validation`);
      await sleep(POLITE_DELAY_MS);
      continue;
    }

    console.log(
      `  ✓ ${label}: ${picked.url} (${picked.width}x${picked.height}, ${picked.contentType})`,
    );
    sourced += 1;

    if (APPLY) {
      try {
        const asset = await client.assets.upload("image", picked.buffer, {
          filename: `${t.slug || t._id}-sourced`,
          contentType: picked.contentType,
        });
        const nowIso = new Date().toISOString();
        await client
          .patch(t._id)
          .set(buildCandidatePatch({ assetRef: asset._id, sourceUrl: picked.url, nowIso }))
          .commit({ visibility: "sync" });
      } catch (err) {
        console.log(`      ! upload/patch failed — ${err.message || err}`);
        sourced -= 1;
      }
    }
    await sleep(POLITE_DELAY_MS);
  }

  console.log(
    `\nScanned ${scanned} site(s). ${sourced} candidate(s) ${APPLY ? "queued for review" : "would be queued"}.`,
  );
  if (!APPLY && sourced > 0) console.log("DRY RUN — pass --apply to commit.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
