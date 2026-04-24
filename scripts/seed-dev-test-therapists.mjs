// Seeds three claimed test therapists for local portal testing. Used
// with the dev-login bypass (see docs/README in CONTRIBUTING.md). All
// three records are gated off the public directory + match results via
// listingActive=false + status=inactive.
//
// Usage (from repo root or this worktree):
//   node scripts/seed-dev-test-therapists.mjs           # create/update
//   node scripts/seed-dev-test-therapists.mjs --delete  # remove all

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
  process.env.VITE_SANITY_PROJECT_ID ||
  envRoot.VITE_SANITY_PROJECT_ID ||
  envStudio.SANITY_STUDIO_PROJECT_ID;
const dataset =
  process.env.VITE_SANITY_DATASET || envRoot.VITE_SANITY_DATASET || envStudio.SANITY_STUDIO_DATASET;
const sanityToken = process.env.SANITY_API_TOKEN || envRoot.SANITY_API_TOKEN;

if (!projectId || !dataset || !sanityToken) {
  console.error("Missing Sanity config. Check .env (VITE_SANITY_* and SANITY_API_TOKEN).");
  process.exit(1);
}

const client = createClient({
  projectId,
  dataset,
  apiVersion: API_VERSION,
  token: sanityToken,
  useCdn: false,
  perspective: "raw",
});

// Shared invisibility gates. Both must be set so these records never
// appear in the public directory or match results.
const HIDDEN = {
  listingActive: false,
  status: "inactive",
  internalNote: "DEV TEST — do not publish, do not display.",
};

const NOW = new Date().toISOString();

const FIXTURES = [
  {
    _id: "therapist-dev-test-complete",
    _type: "therapist",
    name: "Dev Test Complete",
    slug: { _type: "slug", current: "dev-test-complete" },
    credentials: "LMFT, PhD",
    title: "Dev Test Complete — all contact fields populated",
    bio:
      "Dev test account used to exercise the fully-populated portal state. " +
      "Every public contact method is filled in and the preferred contact " +
      "method is set to email. Also used to verify the 'verified' badge copy.",
    bioPreview: "Dev test — fully populated contact fields.",
    city: "San Francisco",
    state: "CA",
    zip: "94102",
    email: "complete-public@example-dev-hidden.invalid",
    phone: "415-867-2345",
    website: "https://example-dev-hidden.invalid",
    bookingUrl: "https://example-dev-hidden.invalid/book",
    preferredContactMethod: "email",
    preferredContactLabel: "Email me",
    contactGuidance:
      "Tell me your state, whether you're looking for therapy or meds, and your insurance.",
    firstStepExpectation: "I respond within 2 business days and schedule a free 15-minute consult.",
    licenseNumber: "DEVTEST001",
    licenseState: "CA",
    specialties: ["Bipolar I", "Bipolar II", "Mood stabilization"],
    insuranceAccepted: ["Aetna", "Blue Shield"],
    languages: ["English"],
    acceptingNewPatients: true,
    acceptsTelehealth: true,
    acceptsInPerson: true,
    verificationStatus: "editorially_verified",
    claimStatus: "claimed",
    claimedByEmail: "test-complete@dev.bipolartherapyhub.invalid",
    claimedAt: NOW,
    ...HIDDEN,
  },
  {
    _id: "therapist-dev-test-minimal",
    _type: "therapist",
    name: "Dev Test Minimal",
    slug: { _type: "slug", current: "dev-test-minimal" },
    credentials: "LCSW",
    title: "Dev Test Minimal — only phone populated",
    bio:
      "Dev test account used to exercise the minimal portal state. Only a " +
      "phone number is populated for public contact. No email, website, or " +
      "booking URL. Preferred contact method is intentionally unset.",
    bioPreview: "Dev test — phone only.",
    city: "Oakland",
    state: "CA",
    zip: "94612",
    email: "",
    phone: "510-867-2345",
    website: "",
    bookingUrl: "",
    preferredContactMethod: "",
    licenseNumber: "DEVTEST002",
    licenseState: "CA",
    specialties: ["Bipolar II"],
    languages: ["English"],
    acceptingNewPatients: true,
    acceptsTelehealth: true,
    acceptsInPerson: false,
    verificationStatus: "under_review",
    claimStatus: "claimed",
    claimedByEmail: "test-minimal@dev.bipolartherapyhub.invalid",
    claimedAt: NOW,
    ...HIDDEN,
  },
  {
    _id: "therapist-dev-test-empty",
    _type: "therapist",
    name: "Dev Test Empty",
    slug: { _type: "slug", current: "dev-test-empty" },
    credentials: "LMFT",
    title: "Dev Test Empty — zero public contacts",
    bio:
      "Dev test account used to exercise the presence-validation rule. This " +
      "record is claimed but has no public contact methods populated, so any " +
      "portal save that doesn't add one should be blocked server-side.",
    bioPreview: "Dev test — no public contacts.",
    city: "San Jose",
    state: "CA",
    zip: "95110",
    email: "",
    phone: "",
    website: "",
    bookingUrl: "",
    preferredContactMethod: "",
    licenseNumber: "DEVTEST003",
    licenseState: "CA",
    specialties: ["Bipolar I"],
    languages: ["English"],
    acceptingNewPatients: true,
    acceptsTelehealth: true,
    acceptsInPerson: false,
    verificationStatus: "under_review",
    claimStatus: "claimed",
    claimedByEmail: "test-empty@dev.bipolartherapyhub.invalid",
    claimedAt: NOW,
    ...HIDDEN,
  },
];

async function main() {
  const wantDelete = process.argv.includes("--delete");

  if (wantDelete) {
    for (const fixture of FIXTURES) {
      try {
        await client.delete(fixture._id);
        console.log("Deleted", fixture._id);
      } catch (error) {
        console.warn("Failed to delete", fixture._id, error.message || error);
      }
    }
    return;
  }

  const tx = client.transaction();
  FIXTURES.forEach(function (doc) {
    tx.createOrReplace(doc);
  });
  await tx.commit({ visibility: "sync" });

  console.log("Seeded " + FIXTURES.length + " dev test therapists (dataset: " + dataset + ")");
  FIXTURES.forEach(function (doc) {
    console.log(
      "  " + doc.claimedByEmail + " -> slug: " + doc.slug.current + " (" + doc.title + ")",
    );
  });
  console.log("");
  console.log("With NODE_ENV=development and ALLOW_DEV_LOGIN=true set, log in via:");
  FIXTURES.forEach(function (doc) {
    console.log(
      "  http://localhost:5173/portal.html?dev_login=" + encodeURIComponent(doc.claimedByEmail),
    );
  });
  console.log("");
  console.log("To remove: node scripts/seed-dev-test-therapists.mjs --delete");
}

main().catch(function (error) {
  console.error(error);
  process.exit(1);
});
