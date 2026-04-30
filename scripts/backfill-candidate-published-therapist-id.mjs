#!/usr/bin/env node
// One-shot backfill: candidates with empty publishedTherapistId that match
// a published therapist by license number.
//
// The candidate-publish flow in server/review-candidate-routes.mjs sets
// publishedTherapistId at promotion time; older import-script publishes
// did not. The Needs Attention queue's duplicate detector specifically
// requires publishedTherapistId on a candidate before it's considered
// "converted" — so these stragglers surface as duplicate-detected blockers
// even though they're effectively ghosts.
//
// Matching rule: license number, exact match. License is the highest-
// confidence identity key in the dataset (it's what DCA verification keys
// off, and what the existing dedupe logic in shared/profile-live-status.mjs
// uses). matchedTherapistId on the candidate is informational only — some
// candidates have it pointing at a therapist that no longer exists, others
// have it pointing at a therapist with a CONFLICTING license (the
// ambiguous Ken Howard case). License match avoids both pitfalls.
//
// What this script does for each match:
//   - sets publishedTherapistId = matched therapist's _id
//   - sets publishedAt = candidate._updatedAt (best available proxy for
//     "when this was archived")
//
// Idempotent: candidates that already have publishedTherapistId set are
// skipped.
//
// Usage:
//   node scripts/backfill-candidate-published-therapist-id.mjs            # dry run
//   node scripts/backfill-candidate-published-therapist-id.mjs --apply    # commit
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";

const APPLY = process.argv.includes("--apply");
const ROOT = process.cwd();

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

function lcKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

async function main() {
  const env = readEnvFile(path.join(ROOT, ".env"));
  const client = createClient({
    projectId: process.env.VITE_SANITY_PROJECT_ID || env.VITE_SANITY_PROJECT_ID,
    dataset: process.env.VITE_SANITY_DATASET || env.VITE_SANITY_DATASET || "production",
    apiVersion: process.env.VITE_SANITY_API_VERSION || env.VITE_SANITY_API_VERSION || "2026-04-02",
    token: process.env.SANITY_API_TOKEN || env.SANITY_API_TOKEN,
    useCdn: false,
  });

  console.log("Fetching candidates with empty publishedTherapistId…");
  const candidates = await client.fetch(
    `*[
      _type == "therapistCandidate" &&
      (!defined(publishedTherapistId) || publishedTherapistId == "")
    ]{ _id, _updatedAt, name, reviewStatus, licenseNumber, email }`,
  );
  console.log(`  Found ${candidates.length} candidates`);

  console.log("Fetching all therapist documents for license lookup…");
  const therapists = await client.fetch(`*[_type == "therapist"]{ _id, licenseNumber, email }`);
  console.log(`  Found ${therapists.length} therapists`);

  // Build license → therapist[] map. We collect all matches per license so
  // we can detect collisions (two therapists with the same license = data
  // problem, skip rather than guess).
  const therapistsByLicense = new Map();
  for (const t of therapists) {
    const lic = lcKey(t.licenseNumber);
    if (!lic) continue;
    if (!therapistsByLicense.has(lic)) therapistsByLicense.set(lic, []);
    therapistsByLicense.get(lic).push(t);
  }

  const matched = [];
  const noLicense = [];
  const noLicenseMatch = [];
  const ambiguousLicense = [];
  for (const c of candidates) {
    const lic = lcKey(c.licenseNumber);
    if (!lic) {
      noLicense.push(c);
      continue;
    }
    const hits = therapistsByLicense.get(lic) || [];
    if (hits.length === 0) noLicenseMatch.push(c);
    else if (hits.length > 1) ambiguousLicense.push({ c, hits });
    else matched.push({ c, t: hits[0] });
  }

  console.log("\n=== Backfill plan ===");
  console.log(`  Will backfill (1:1 license match):  ${matched.length}`);
  console.log(`  Skip — candidate has no license:    ${noLicense.length}`);
  console.log(`  Skip — no matching therapist:       ${noLicenseMatch.length}`);
  console.log(`  Skip — multiple license matches:    ${ambiguousLicense.length}`);

  if (matched.length === 0) {
    console.log("\nNothing to do. Migration is idempotent.");
    return;
  }

  console.log("\nMatches to backfill:");
  for (const { c, t } of matched) {
    console.log(
      `  ${c._id}  →  ${t._id}  (license ${c.licenseNumber}, status ${c.reviewStatus || "none"})`,
    );
  }

  if (ambiguousLicense.length) {
    console.log("\nAmbiguous license collisions (review manually):");
    for (const { c, hits } of ambiguousLicense) {
      console.log(`  ${c._id} matches: ${hits.map((h) => h._id).join(", ")}`);
    }
  }

  if (!APPLY) {
    console.log("\nDRY RUN — pass --apply to commit.");
    return;
  }

  console.log("\nApplying patches…");
  let patched = 0;
  for (const { c, t } of matched) {
    await client
      .patch(c._id)
      .set({
        publishedTherapistId: t._id,
        publishedAt: c._updatedAt || new Date().toISOString(),
      })
      .commit();
    patched += 1;
  }
  console.log(`Applied ${patched} patches. Re-run to verify idempotence.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
