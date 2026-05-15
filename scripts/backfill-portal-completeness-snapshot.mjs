#!/usr/bin/env node
// One-shot backfill of portalCompletenessScore + portalCompletionFields for
// every therapist doc. The cached snapshot is normally refreshed on every
// therapist portal save and (since PR #784) on every admin God-mode drawer
// save. But neither path retroactively touches docs whose last edit happened
// BEFORE #784 shipped — so a therapist whose admin manually filled in (e.g.)
// a missing gender field still shows the stale low score until something
// else triggers a recompute.
//
// This script reads every therapist, computes the snapshot off the current
// doc shape, and writes a fresh score + missingFields list when they differ.
//
// Usage:
//   node scripts/backfill-portal-completeness-snapshot.mjs           # dry run
//   node scripts/backfill-portal-completeness-snapshot.mjs --apply   # commit

import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@sanity/client";
import { computePortalCompletenessSnapshot } from "../server/portal-completeness-snapshot.mjs";

const APPLY = process.argv.includes("--apply");

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

async function main() {
  const root = process.cwd();
  const env = readEnvFile(path.join(root, ".env"));

  const client = createClient({
    projectId: process.env.VITE_SANITY_PROJECT_ID || env.VITE_SANITY_PROJECT_ID,
    dataset: process.env.VITE_SANITY_DATASET || env.VITE_SANITY_DATASET || "production",
    apiVersion: process.env.VITE_SANITY_API_VERSION || env.VITE_SANITY_API_VERSION || "2026-04-02",
    token: process.env.SANITY_API_TOKEN || env.SANITY_API_TOKEN,
    useCdn: false,
  });

  // Pull every field the snapshot predicate touches. hasPhoto is derived
  // from the photo asset reference, matching the same logic the admin
  // PATCH handler uses post-save.
  const docs = await client.fetch(
    `*[_type == "therapist"] | order(name asc){
      _id, name,
      portalCompletenessScore, portalCompletionFields,
      bio, careApproach, credentials, title,
      city, state, email, phone, website, bookingUrl,
      preferredContactMethod, contactGuidance, firstStepExpectation,
      estimatedWaitTime, practiceName, gender,
      specialties, treatmentModalities, clientPopulations, insuranceAccepted,
      languages, telehealthStates,
      yearsExperience, bipolarYearsExperience,
      sessionFeeMin, sessionFeeMax, slidingScale,
      acceptsTelehealth, acceptsInPerson, medicationManagement,
      "hasPhoto": defined(photo.asset)
    }`,
  );

  console.log(`Found ${docs.length} therapist(s).`);

  const stale = [];
  for (const d of docs) {
    const fresh = computePortalCompletenessSnapshot(d);
    const cachedScore =
      typeof d.portalCompletenessScore === "number" ? d.portalCompletenessScore : null;
    const cachedFields = Array.isArray(d.portalCompletionFields)
      ? d.portalCompletionFields.slice().sort()
      : [];
    const freshFields = fresh.missingFields.slice().sort();
    const scoreChanged = cachedScore !== fresh.score;
    const fieldsChanged = JSON.stringify(cachedFields) !== JSON.stringify(freshFields);
    if (scoreChanged || fieldsChanged) {
      stale.push({
        _id: d._id,
        name: d.name,
        cachedScore,
        freshScore: fresh.score,
        cachedFields,
        freshFields,
        fresh,
      });
    }
  }

  console.log(`  ${docs.length - stale.length} already in sync`);
  console.log(`  ${stale.length} need a refresh`);

  if (stale.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  console.log("\nProfiles to refresh:");
  for (const s of stale) {
    const droppedFields = s.cachedFields.filter((f) => !s.freshFields.includes(f));
    const newFields = s.freshFields.filter((f) => !s.cachedFields.includes(f));
    const delta = [];
    if (s.cachedScore !== s.freshScore) {
      delta.push(`${s.cachedScore} → ${s.freshScore}`);
    }
    if (droppedFields.length) delta.push(`-[${droppedFields.join(",")}]`);
    if (newFields.length) delta.push(`+[${newFields.join(",")}]`);
    console.log(`  ${s.name} (${s._id}): ${delta.join("  ")}`);
  }

  if (!APPLY) {
    console.log("\nDRY RUN — pass --apply to commit.");
    return;
  }

  console.log("\nApplying patches…");
  const nowIso = new Date().toISOString();
  let tx = client.transaction();
  for (const s of stale) {
    tx = tx.patch(s._id, (p) =>
      p.set({
        portalCompletenessScore: s.fresh.score,
        portalCompletionFields: s.fresh.missingFields,
        portalCompletenessUpdatedAt: nowIso,
      }),
    );
  }
  const result = await tx.commit();
  console.log(`Committed ${result.results.length} patch(es).`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
