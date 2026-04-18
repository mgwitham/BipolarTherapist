#!/usr/bin/env node
// Recompute dedupe state for active therapistCandidate docs:
//   * Strip invalid email sentinels (e.g. literal "unknown") that produced
//     false-positive email matches.
//   * Re-run identity comparison against the current candidate corpus.
//   * Patch dedupeStatus, dedupeReasons, matchedCandidateId.
//
// Usage:
//   node scripts/backfill-candidate-duplicate-pointers.mjs [--dry-run]

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";
import {
  buildDuplicateIdentity,
  compareDuplicateIdentity,
  normalizeEmail,
} from "../shared/therapist-domain.mjs";

const ROOT = process.cwd();
const API_VERSION = "2026-04-02";

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
      let value = trimmed.slice(sep + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      acc[trimmed.slice(0, sep).trim()] = value;
      return acc;
    }, {});
}

function getConfig() {
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
    apiVersion: process.env.SANITY_API_VERSION || rootEnv.VITE_SANITY_API_VERSION || API_VERSION,
    token:
      process.env.SANITY_API_TOKEN || rootEnv.SANITY_API_TOKEN || studioEnv.SANITY_API_TOKEN || "",
  };
}

function parseArgs(argv) {
  const options = { dryRun: false };
  argv.forEach((arg) => {
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
  });
  return options;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      "Recompute dedupe state for active candidates.\n\n  --dry-run   Report changes without writing.",
    );
    return;
  }

  const config = getConfig();
  if (!config.projectId || !config.dataset || !config.token) {
    console.error("Missing Sanity config. Set SANITY_API_TOKEN + project/dataset in .env.");
    process.exit(1);
  }

  const client = createClient({
    projectId: config.projectId,
    dataset: config.dataset,
    apiVersion: config.apiVersion,
    token: config.token,
    useCdn: false,
  });

  const docs = await client.fetch(
    `*[_type == "therapistCandidate" && reviewStatus != "archived"]{
      _id, candidateId, name, credentials, slug,
      city, state, licenseState, licenseNumber,
      email, phone, website, bookingUrl,
      dedupeStatus, dedupeReasons, matchedCandidateId,
      matchedTherapistSlug, matchedTherapistId, matchedApplicationId,
      reviewStatus
    }`,
  );

  console.log(`Loaded ${docs.length} active candidates.`);

  // First pass: clean invalid email sentinels so compareDuplicateIdentity
  // operates on the post-fix normalization.
  const cleanedDocs = docs.map((doc) => {
    const cleanedEmail = normalizeEmail(doc.email) ? doc.email : "";
    return { ...doc, email: cleanedEmail };
  });

  const emailsToClear = docs
    .filter((doc) => doc.email && !normalizeEmail(doc.email))
    .map((doc) => doc._id);

  // Second pass: recompute dedupe vs other candidates only. Therapist and
  // application matches cause ingest to skip the candidate entirely, so any
  // current candidate is by definition not a match against those corpora.
  const plans = [];
  for (const target of cleanedDocs) {
    const identity = buildDuplicateIdentity(target);
    let bestMatch = null;
    for (const other of cleanedDocs) {
      if (other._id === target._id) continue;
      const reasons = compareDuplicateIdentity(identity, other);
      if (reasons.length && (!bestMatch || reasons.length > bestMatch.reasons.length)) {
        bestMatch = { id: other._id, name: other.name, reasons };
      }
    }

    // Already pointing at a therapist/application? Leave those alone.
    const hasExternalPointer =
      target.matchedTherapistSlug || target.matchedTherapistId || target.matchedApplicationId;
    if (hasExternalPointer) continue;

    // Only recompute candidates currently flagged possible_duplicate. States
    // like "unique", "merged", "rejected_duplicate" reflect reviewer decisions
    // and must not be clobbered.
    if ((target.dedupeStatus || "unreviewed") !== "possible_duplicate") continue;

    const nextStatus = bestMatch ? "possible_duplicate" : "unreviewed";
    const nextReasons = bestMatch ? bestMatch.reasons : [];
    const nextMatchedCandidateId = bestMatch ? bestMatch.id : "";

    const prevStatus = target.dedupeStatus || "unreviewed";
    const prevReasons = Array.isArray(target.dedupeReasons) ? target.dedupeReasons : [];
    const prevMatchedCandidateId = target.matchedCandidateId || "";

    const changed =
      prevStatus !== nextStatus ||
      prevReasons.join(",") !== nextReasons.join(",") ||
      prevMatchedCandidateId !== nextMatchedCandidateId;

    if (!changed) continue;

    plans.push({
      id: target._id,
      name: target.name,
      prevStatus,
      nextStatus,
      nextReasons,
      matchName: bestMatch ? bestMatch.name : "",
      nextMatchedCandidateId,
    });
  }

  console.log(`\nInvalid emails to clear: ${emailsToClear.length}`);
  console.log(`Candidate dedupe patches: ${plans.length}`);
  plans.forEach((p) => {
    const arrow = p.nextStatus === "possible_duplicate" ? `-> ${p.matchName}` : "(cleared)";
    console.log(
      `  ${p.name}: ${p.prevStatus} -> ${p.nextStatus} ${arrow} [${p.nextReasons.join(", ")}]`,
    );
  });

  if (args.dryRun) {
    console.log("\nDry run — no writes performed.");
    return;
  }

  const tx = client.transaction();
  for (const id of emailsToClear) {
    tx.patch(id, { set: { email: "" } });
  }
  for (const plan of plans) {
    tx.patch(plan.id, {
      set: {
        dedupeStatus: plan.nextStatus,
        dedupeReasons: plan.nextReasons,
        matchedCandidateId: plan.nextMatchedCandidateId,
      },
    });
  }
  const result = await tx.commit();
  console.log(`\nCommitted ${result.results.length} patches.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
