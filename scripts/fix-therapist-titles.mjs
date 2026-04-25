#!/usr/bin/env node
// One-shot cleanup for the credential/title mismatch we surfaced in the
// 2026-04-25 license audit. A bulk-ingestion script in an earlier
// session set every therapist's `title` to "Psychiatrist" regardless
// of credentials. The public profile renders `title` so a customer
// sees "Jane Doe, LMFT, Psychiatrist" — confusing and wrong.
//
// Maps the credentials field to a coherent title. Run with --apply to
// commit; default is dry-run.
//
// Usage:
//   node scripts/fix-therapist-titles.mjs            # dry run
//   node scripts/fix-therapist-titles.mjs --apply    # commit changes
import process from "node:process";
import { createClient } from "@sanity/client";

const APPLY = process.argv.includes("--apply");

// Map of DCA-verified licenseType labels to the public-facing title we
// want. Some DCA labels ("Physician and Surgeon") are board-language
// the directory shouldn't surface; map to friendlier wording.
const DCA_TO_TITLE = {
  "Licensed Marriage and Family Therapist": "Licensed Marriage and Family Therapist",
  "Licensed Clinical Social Worker": "Licensed Clinical Social Worker",
  "Licensed Professional Clinical Counselor": "Licensed Professional Clinical Counselor",
  "Licensed Educational Psychologist": "Licensed Educational Psychologist",
  Psychologist: "Psychologist",
  "Physician and Surgeon": "Psychiatrist",
  "Osteopathic Physician and Surgeon": "Psychiatrist",
  "Nurse Practitioner": "Psychiatric Mental Health Nurse Practitioner",
};

function inferTitle(credentials, currentTitle, licensureLicenseType) {
  // Prefer the DCA-verified license type when present — it's authoritative
  // (the practicing license CA confirmed) and avoids guessing between
  // dual-credential strings like "PhD, LPCC".
  if (licensureLicenseType && DCA_TO_TITLE[licensureLicenseType]) {
    return DCA_TO_TITLE[licensureLicenseType];
  }
  // Fallback: infer from credentials. Order matters — practicing
  // licenses (LMFT/LCSW/LPCC) come before academic degrees (PhD/PsyD)
  // because someone with "PhD, LPCC" practices as an LPCC.
  const c = (credentials || "").toUpperCase();
  if (/\bPMHNP\b|\bAPRN\b|\bDNP\b|\bNP\b/.test(c) || /nurse practitioner/i.test(currentTitle))
    return "Psychiatric Mental Health Nurse Practitioner";
  if (/\bMD\b/.test(c)) return "Psychiatrist";
  if (/\bLMFT\b|\bMFCC\b|\bMFT\b/.test(c)) return "Licensed Marriage and Family Therapist";
  if (/\bLCSW\b/.test(c)) return "Licensed Clinical Social Worker";
  if (/\bLPCC\b/.test(c)) return "Licensed Professional Clinical Counselor";
  if (/\bLEP\b/.test(c)) return "Licensed Educational Psychologist";
  if (/\bDO\b/.test(c) && !/\bPSYD\b/.test(c)) return "Psychiatrist";
  if (/\bPSYD\b|\bPHD\b/.test(c)) return "Psychologist";
  if (/\bMSW\b/.test(c)) return "Licensed Clinical Social Worker";
  return null;
}

async function main() {
  const client = createClient({
    projectId: process.env.VITE_SANITY_PROJECT_ID,
    dataset: process.env.VITE_SANITY_DATASET,
    apiVersion: process.env.VITE_SANITY_API_VERSION || "2026-04-02",
    token: process.env.SANITY_API_TOKEN,
    useCdn: false,
  });

  const docs = await client.fetch(
    `*[_type == "therapist" && defined(credentials) && credentials != ""]{_id, name, credentials, title, "dcaType": licensureVerification.licenseType}`,
  );

  let toFix = 0;
  let alreadyOk = 0;
  let cantInfer = 0;
  for (const doc of docs) {
    const proper = inferTitle(doc.credentials, doc.title, doc.dcaType);
    if (!proper) {
      cantInfer += 1;
      continue;
    }
    if (doc.title === proper) {
      alreadyOk += 1;
      continue;
    }
    toFix += 1;
    console.log(
      `${APPLY ? "FIX " : "WOULD FIX"}  ${doc.name} (${doc.credentials}): "${doc.title}" → "${proper}"`,
    );
    if (APPLY) {
      await client.patch(doc._id).set({ title: proper }).commit();
    }
  }

  console.log(
    `\n${APPLY ? "Applied" : "Dry run"}: ${toFix} ${APPLY ? "fixed" : "would fix"}, ${alreadyOk} already correct, ${cantInfer} couldn't infer (left alone).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
