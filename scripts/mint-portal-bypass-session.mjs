// One-off: bypass the magic-link email flow for local portal testing.
//
// 1. Ensures the hidden smoke-test therapist exists and is marked as claimed.
// 2. Mints a therapist session JWT signed with REVIEW_API_SESSION_SECRET.
// 3. Prints a browser-console snippet to paste into the portal page.
//
// Usage (from repo root or this worktree):
//   node scripts/mint-portal-bypass-session.mjs
//
// The smoke therapist has listingActive=false + status=inactive so it
// never appears in the public directory or match results.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";

import { createTherapistSession } from "../server/review-http-auth.mjs";

const ROOT = process.cwd();
const API_VERSION = "2026-04-02";

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .reduce(function (acc, line) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return acc;
      const eq = trimmed.indexOf("=");
      if (eq === -1) return acc;
      acc[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
      return acc;
    }, {});
}

const envRoot = readEnvFile(path.join(ROOT, ".env"));
const envStudio = readEnvFile(path.join(ROOT, "studio", ".env"));

const projectId =
  process.env.VITE_SANITY_PROJECT_ID ||
  envRoot.VITE_SANITY_PROJECT_ID ||
  envStudio.SANITY_STUDIO_PROJECT_ID;
const dataset =
  process.env.VITE_SANITY_DATASET || envRoot.VITE_SANITY_DATASET || envStudio.SANITY_STUDIO_DATASET;
const sanityToken = process.env.SANITY_API_TOKEN || envRoot.SANITY_API_TOKEN;
const sessionSecret = process.env.REVIEW_API_SESSION_SECRET || envRoot.REVIEW_API_SESSION_SECRET;

if (!projectId || !dataset || !sanityToken) {
  console.error("Missing Sanity config. Check .env (VITE_SANITY_* and SANITY_API_TOKEN).");
  process.exit(1);
}
if (!sessionSecret) {
  console.error("Missing REVIEW_API_SESSION_SECRET in .env.");
  process.exit(1);
}

const SMOKE_ID = "therapist-smoke-test";
const SMOKE_SLUG = "smoke-test-bipolartherapyhub";
const SMOKE_EMAIL = "mgwitham@gmail.com";

const client = createClient({
  projectId,
  dataset,
  apiVersion: API_VERSION,
  token: sanityToken,
  useCdn: false,
  perspective: "raw",
});

async function main() {
  const existing = await client.fetch(`*[_id == $id][0]`, { id: SMOKE_ID });

  if (!existing) {
    console.log(
      "No smoke-test therapist found. Run scripts/create-smoke-test-therapist.mjs first.",
    );
    process.exit(1);
  }

  const now = new Date().toISOString();
  await client
    .patch(SMOKE_ID)
    .set({
      claimStatus: "claimed",
      claimedByEmail: SMOKE_EMAIL,
      claimedAt: existing.claimedAt || now,
    })
    .commit({ visibility: "sync" });

  // Same TTL default as the runtime (24h).
  const sessionTtlMs = 24 * 60 * 60 * 1000;
  const token = createTherapistSession(
    { sessionSecret, therapistSessionTtlMs: sessionTtlMs },
    { slug: SMOKE_SLUG, email: SMOKE_EMAIL },
  );

  const portalUrl = `http://localhost:5173/portal.html?slug=${SMOKE_SLUG}`;

  console.log("");
  console.log("Smoke therapist marked as claimed (dataset: " + dataset + ")");
  console.log("  slug:  " + SMOKE_SLUG);
  console.log("  email: " + SMOKE_EMAIL);
  console.log("");
  console.log("Session token (valid 24h):");
  console.log(token);
  console.log("");
  console.log("To log in:");
  console.log("  1. Open " + portalUrl);
  console.log("  2. Open DevTools console and paste:");
  console.log("");
  console.log(
    `     localStorage.setItem("bt_therapist_session_v1", ${JSON.stringify(token)}); location.reload();`,
  );
  console.log("");
}

main().catch(function (error) {
  console.error(error);
  process.exit(1);
});
