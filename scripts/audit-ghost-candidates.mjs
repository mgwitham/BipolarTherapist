#!/usr/bin/env node
// Audit script: find therapistCandidate documents that have a corresponding
// published therapist document. These "ghost" candidates were promoted to
// therapists (via import scripts or the admin publish flow) but the candidate
// record was never archived, leaving a confusing duplicate row in the admin
// search UI.
//
// Matching strategy (in priority order):
//   1. licenseNumber — most reliable when present; uniquely identifies
//      a CA practitioner within the dataset
//   2. email — reliable for direct-submitted candidates; can collide for
//      shared practice addresses, so flagged as ambiguous when both sides
//      have a license that doesn't match
//
// Output: JSON report saved to scripts/reports/ghost-candidates-<timestamp>.json
//
// Usage:
//   node scripts/audit-ghost-candidates.mjs
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";

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

function normalizeKey(val) {
  return String(val || "")
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

  console.log("Fetching all therapistCandidate documents…");
  const candidates = await client.fetch(
    `*[_type == "therapistCandidate"]{
      _id, _createdAt, _updatedAt,
      name, email, licenseNumber,
      reviewStatus, publishedTherapistId,
      matchedTherapistId
    }`,
  );
  console.log(`  Found ${candidates.length} candidates`);

  console.log("Fetching all therapist documents…");
  const therapists = await client.fetch(
    `*[_type == "therapist"]{
      _id, _createdAt,
      name, email, licenseNumber,
      status, listingActive
    }`,
  );
  console.log(`  Found ${therapists.length} therapists`);

  // Build lookup maps
  const therapistByLicense = new Map();
  const therapistByEmail = new Map();
  for (const t of therapists) {
    const lic = normalizeKey(t.licenseNumber);
    const em = normalizeKey(t.email);
    if (lic) {
      if (!therapistByLicense.has(lic)) therapistByLicense.set(lic, []);
      therapistByLicense.get(lic).push(t);
    }
    if (em) {
      if (!therapistByEmail.has(em)) therapistByEmail.set(em, []);
      therapistByEmail.get(em).push(t);
    }
  }

  const ghosts = [];
  const ambiguous = [];
  const noMatch = [];

  for (const c of candidates) {
    const lic = normalizeKey(c.licenseNumber);
    const em = normalizeKey(c.email);

    let matchedTherapists = [];
    let matchBasis = null;

    // Priority 1: license match
    if (lic) {
      const byLic = therapistByLicense.get(lic) || [];
      if (byLic.length > 0) {
        matchedTherapists = byLic;
        matchBasis = "license";
      }
    }

    // Priority 2: email match (only if no license match)
    if (!matchedTherapists.length && em) {
      const byEm = therapistByEmail.get(em) || [];
      if (byEm.length > 0) {
        matchedTherapists = byEm;
        matchBasis = "email";
      }
    }

    if (!matchedTherapists.length) {
      noMatch.push(c._id);
      continue;
    }

    // Check for ambiguity: email match but licenses differ between candidate
    // and therapist (and both have a license number)
    const isAmbiguous =
      matchBasis === "email" &&
      lic &&
      matchedTherapists.some(
        (t) => normalizeKey(t.licenseNumber) && normalizeKey(t.licenseNumber) !== lic,
      );

    // Collect field comparison for data-loss check
    // Compare key fields the candidate has that the matched therapist might lack
    const matched = matchedTherapists[0];
    const candidateOnlyFields = [];
    const fieldsToCheck = [
      "email",
      "phone",
      "website",
      "bookingUrl",
      "sourceUrl",
      "specialties",
      "treatmentModalities",
      "clientPopulations",
      "insuranceAccepted",
      "careApproach",
      "bipolarEvidenceQuote",
      "rawSourceSnapshot",
    ];
    for (const field of fieldsToCheck) {
      const cv = c[field];
      const tv = matched[field];
      const hasCandidate = Array.isArray(cv) ? cv.length > 0 : Boolean(cv);
      const hasTherapist = Array.isArray(tv) ? tv.length > 0 : Boolean(tv);
      if (hasCandidate && !hasTherapist) {
        candidateOnlyFields.push(field);
      }
    }

    const entry = {
      candidate_id: c._id,
      candidate_created_at: c._createdAt,
      candidate_updated_at: c._updatedAt,
      candidate_review_status: c.reviewStatus || "queued",
      candidate_published_therapist_id: c.publishedTherapistId || null,
      license_number: c.licenseNumber || null,
      email: c.email || null,
      name: c.name || null,
      match_basis: matchBasis,
      matched_therapist_ids: matchedTherapists.map((t) => t._id),
      matched_therapist_count: matchedTherapists.length,
      candidate_only_fields: candidateOnlyFields,
      already_marked_published:
        c.reviewStatus === "published" ||
        c.reviewStatus === "archived" ||
        Boolean(c.publishedTherapistId),
    };

    if (isAmbiguous || matchedTherapists.length > 1) {
      ambiguous.push(entry);
    } else {
      ghosts.push(entry);
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    summary: {
      total_candidates: candidates.length,
      total_therapists: therapists.length,
      ghost_candidates: ghosts.length,
      ambiguous_matches: ambiguous.length,
      no_match: noMatch.length,
      already_marked: ghosts.filter((g) => g.already_marked_published).length,
      needs_archiving: ghosts.filter((g) => !g.already_marked_published).length,
      ghosts_with_candidate_only_data: ghosts.filter((g) => g.candidate_only_fields.length > 0)
        .length,
    },
    ghost_candidates: ghosts,
    ambiguous_matches: ambiguous,
  };

  console.log("\n=== Ghost Candidate Audit ===");
  console.log(`  Total candidates:        ${report.summary.total_candidates}`);
  console.log(`  Ghost candidates:        ${report.summary.ghost_candidates}`);
  console.log(`  Already marked:          ${report.summary.already_marked}`);
  console.log(`  Needs archiving:         ${report.summary.needs_archiving}`);
  console.log(`  Ambiguous matches:       ${report.summary.ambiguous_matches}`);
  console.log(`  No match:                ${report.summary.no_match}`);
  console.log(`  Ghosts w/ candidate-only data: ${report.summary.ghosts_with_candidate_only_data}`);

  if (ghosts.length) {
    console.log("\nGhost candidates (have a matching therapist doc):");
    for (const g of ghosts) {
      const marker = g.already_marked_published ? "[already archived]" : "[NEEDS ARCHIVE]";
      const dataNote =
        g.candidate_only_fields.length > 0
          ? ` ⚠ candidate-only fields: ${g.candidate_only_fields.join(", ")}`
          : "";
      console.log(
        `  ${marker} ${g.candidate_id}  →  ${g.matched_therapist_ids[0]}  (${g.match_basis})${dataNote}`,
      );
    }
  }

  if (ambiguous.length) {
    console.log("\nAmbiguous matches (review manually):");
    for (const a of ambiguous) {
      console.log(
        `  ${a.candidate_id}  →  ${a.matched_therapist_ids.join(", ")}  (${a.match_basis}, ${a.matched_therapist_count} matches)`,
      );
    }
  }

  // Save report
  const reportsDir = path.join(ROOT, "scripts", "reports");
  fs.mkdirSync(reportsDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outPath = path.join(reportsDir, `ghost-candidates-${ts}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nReport saved to: ${outPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
