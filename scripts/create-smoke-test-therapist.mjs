// One-off smoke-test helper. Creates (or resets) a hidden therapist
// record used to exercise the real signup → claim → subscribe → portal
// flow without exposing a fake clinician in the public directory or
// match results.
//
// The doc has listingActive=false AND status="inactive" — both gates
// that the public queries in assets/cms.js filter on, so patients
// never see it.
//
// Usage (from repo root, not the worktree):
//   node scripts/create-smoke-test-therapist.mjs
//
// To remove the smoke therapist entirely:
//   node scripts/create-smoke-test-therapist.mjs --delete

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";

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
  process.env.SANITY_PROJECT_ID ||
  process.env.VITE_SANITY_PROJECT_ID ||
  envRoot.VITE_SANITY_PROJECT_ID ||
  envStudio.SANITY_STUDIO_PROJECT_ID;
const dataset =
  process.env.SANITY_DATASET ||
  process.env.VITE_SANITY_DATASET ||
  envRoot.VITE_SANITY_DATASET ||
  envStudio.SANITY_STUDIO_DATASET;
const token = process.env.SANITY_API_TOKEN || envRoot.SANITY_API_TOKEN;

if (!projectId || !dataset || !token) {
  console.error("Missing Sanity config. Run from repo root with .env present.");
  process.exit(1);
}

const client = createClient({
  projectId,
  dataset,
  apiVersion: API_VERSION,
  token,
  useCdn: false,
  perspective: "raw",
});

const SMOKE_ID = "therapist-smoke-test";
const SMOKE_SLUG = "smoke-test-bipolartherapyhub";
const SMOKE_EMAIL = "mgwitham@asu.edu";

async function main() {
  const wantDelete = process.argv.includes("--delete");

  if (wantDelete) {
    await client.delete(SMOKE_ID);
    console.log("Deleted", SMOKE_ID);
    return;
  }

  const doc = {
    _id: SMOKE_ID,
    _type: "therapist",
    name: "Smoke Test Therapist",
    slug: { _type: "slug", current: SMOKE_SLUG },
    credentials: "LMFT",
    title: "Smoke Test (hidden from directory + match)",
    bio:
      "This is a hidden smoke-test profile used to exercise the signup, claim, " +
      "subscribe, and portal flows end-to-end without exposing a fake clinician to " +
      "patients. Safe to delete at any time via --delete.",
    bioPreview: "Hidden smoke-test profile. Not a real clinician.",
    city: "San Francisco",
    state: "CA",
    zip: "94102",
    email: SMOKE_EMAIL,
    phone: "",
    website: "",
    licenseNumber: "SMOKE000",
    licenseState: "CA",
    specialties: ["bipolar"],
    populations: ["adults"],
    modalities: ["telehealth"],
    insuranceAccepted: [],
    acceptingNewPatients: true,
    // Gates. Both must be false/non-active for the doc to stay out of
    // public directory + match results (see assets/cms.js).
    listingActive: false,
    status: "inactive",
    // Claim state so the portal claim flow can pick this up.
    claimStatus: "unclaimed",
    // Tag for easy discovery in Studio.
    internalNote: "SMOKE TEST — do not publish, do not display.",
  };

  const result = await client.createOrReplace(doc);
  console.log("Wrote", result._id);
  console.log("  slug:", SMOKE_SLUG);
  console.log("  email:", SMOKE_EMAIL);
  console.log("  listingActive:", false, "  status:", "inactive");
  console.log("");
  console.log("Smoke-test URLs:");
  console.log("  Claim page: https://www.bipolartherapyhub.com/claim?slug=" + SMOKE_SLUG);
  console.log("  Portal (after claim): https://www.bipolartherapyhub.com/portal?slug=" + SMOKE_SLUG);
  console.log("");
  console.log("To remove: node scripts/create-smoke-test-therapist.mjs --delete");
}

main().catch(function (error) {
  console.error(error);
  process.exit(1);
});
