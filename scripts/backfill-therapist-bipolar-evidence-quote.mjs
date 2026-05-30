#!/usr/bin/env node
// One-shot backfill: copy `bipolarEvidenceQuote` from review candidates onto
// the published therapist documents that predate the field.
//
// PR #969 added `bipolarEvidenceQuote` to the published `therapist` schema and
// wired the candidate-publish flow to carry it over. But the field has always
// lived on `therapistCandidate`, so every therapist published *before* #969
// has an empty quote and renders no hero pull-quote. This script closes that
// gap for the existing directory without forcing a republish of each profile.
//
// Matching rule, in descending confidence:
//   1. candidate.publishedTherapistId == therapist._id  (the direct link the
//      publish flow sets at promotion time — unambiguous)
//   2. candidate.providerId == therapist.providerId      (canonical identity
//      key shared across candidates and listings)
//   3. candidate.licenseNumber == therapist.licenseNumber, 1:1 only (license
//      is the highest-confidence external identity key; collisions are skipped
//      rather than guessed, mirroring backfill-candidate-published-therapist-id)
//
// Only therapists with an empty/undefined quote are touched, and only
// candidates that actually have a non-empty quote are considered. When more
// than one candidate maps to the same therapist, the most recently updated
// candidate wins (newest editorial read of the source site).
//
// Idempotent: therapists that already have a quote are skipped, so re-running
// after --apply is a no-op.
//
// Usage:
//   node scripts/backfill-therapist-bipolar-evidence-quote.mjs            # dry run
//   node scripts/backfill-therapist-bipolar-evidence-quote.mjs --apply    # commit
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

function hasQuote(value) {
  return typeof value === "string" && value.trim() !== "";
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

  console.log("Fetching therapists missing a bipolar evidence quote…");
  const therapists = await client.fetch(
    `*[
      _type == "therapist" &&
      (!defined(bipolarEvidenceQuote) || bipolarEvidenceQuote == "")
    ]{ _id, name, providerId, licenseNumber }`,
  );
  console.log(`  Found ${therapists.length} therapists without a quote`);

  console.log("Fetching candidates that have a bipolar evidence quote…");
  const candidates = await client.fetch(
    `*[
      _type == "therapistCandidate" &&
      defined(bipolarEvidenceQuote) && bipolarEvidenceQuote != ""
    ] | order(_updatedAt asc){
      _id, _updatedAt, name, providerId, licenseNumber,
      publishedTherapistId, bipolarEvidenceQuote
    }`,
  );
  console.log(`  Found ${candidates.length} candidates with a quote`);

  // Build lookup maps from candidate quotes. Candidates arrive oldest-first, so
  // a later (newer) candidate naturally overwrites an older one for the same key.
  const quoteByTherapistId = new Map();
  const quoteByProviderId = new Map();
  const candidatesByLicense = new Map();
  for (const c of candidates) {
    const quote = c.bipolarEvidenceQuote.trim();
    if (hasQuote(c.publishedTherapistId)) {
      quoteByTherapistId.set(c.publishedTherapistId, { quote, source: c });
    }
    if (hasQuote(c.providerId)) {
      quoteByProviderId.set(c.providerId, { quote, source: c });
    }
    const lic = lcKey(c.licenseNumber);
    if (lic) {
      if (!candidatesByLicense.has(lic)) candidatesByLicense.set(lic, new Map());
      // Key the inner map by quote text so multiple candidates that carry the
      // *same* quote for one license don't read as an ambiguous collision.
      candidatesByLicense.get(lic).set(quote, c);
    }
  }

  const matched = [];
  const unmatched = [];
  const ambiguousLicense = [];
  for (const t of therapists) {
    const direct = quoteByTherapistId.get(t._id);
    if (direct) {
      matched.push({ t, quote: direct.quote, via: "publishedTherapistId", source: direct.source });
      continue;
    }
    const byProvider = hasQuote(t.providerId) ? quoteByProviderId.get(t.providerId) : null;
    if (byProvider) {
      matched.push({ t, quote: byProvider.quote, via: "providerId", source: byProvider.source });
      continue;
    }
    const lic = lcKey(t.licenseNumber);
    const licHits = lic ? candidatesByLicense.get(lic) : null;
    if (licHits && licHits.size === 1) {
      const [quote, source] = Array.from(licHits.entries())[0];
      matched.push({ t, quote, via: "licenseNumber", source });
      continue;
    }
    if (licHits && licHits.size > 1) {
      ambiguousLicense.push({ t, quotes: Array.from(licHits.keys()) });
      continue;
    }
    unmatched.push(t);
  }

  console.log("\n=== Backfill plan ===");
  console.log(`  Will backfill:                       ${matched.length}`);
  console.log(`  Skip — no candidate quote found:     ${unmatched.length}`);
  console.log(`  Skip — conflicting quotes on license:${ambiguousLicense.length}`);

  if (matched.length) {
    console.log("\nMatches to backfill:");
    for (const { t, via, quote } of matched) {
      const preview = quote.length > 60 ? quote.slice(0, 57) + "…" : quote;
      console.log(`  ${t._id}  (via ${via})  "${preview}"`);
    }
  }

  if (ambiguousLicense.length) {
    console.log("\nConflicting license matches (resolve manually):");
    for (const { t, quotes } of ambiguousLicense) {
      console.log(`  ${t._id} (license ${t.licenseNumber}) has ${quotes.length} distinct quotes`);
    }
  }

  if (matched.length === 0) {
    console.log("\nNothing to do. Migration is idempotent.");
    return;
  }

  if (!APPLY) {
    console.log("\nDRY RUN — pass --apply to commit.");
    return;
  }

  console.log("\nApplying patches…");
  let patched = 0;
  for (const { t, quote } of matched) {
    await client.patch(t._id).set({ bipolarEvidenceQuote: quote }).commit();
    patched += 1;
  }
  console.log(`Applied ${patched} patches. Re-run to verify idempotence.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
