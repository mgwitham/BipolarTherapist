#!/usr/bin/env node
/* eslint-disable no-console */
import process from "node:process";
import { createClient } from "@sanity/client";

const NPI_API = "https://npiregistry.cms.hhs.gov/api/?version=2.1";
const DRY_RUN = process.argv.includes("--dry-run");

const CA_TAXONOMY_PREFIXES = {
  PSY: ["Psychologist", "103T", "103TC", "103TM", "103TP"],
  LMFT: ["Marriage", "106H"],
  MFC: ["Marriage", "106H"],
  LCSW: ["Social Worker", "1041C"],
  LPCC: ["Counselor", "101Y"],
  MD: ["Psychiatry", "2084P"],
  DO: ["Psychiatry", "2084P"],
  PMHNP: ["Psychiatric", "364SP08"],
};

function parsePersonName(rawName) {
  if (!rawName) return null;
  const stripped = rawName
    .replace(/,?\s*(PhD|PsyD|MD|DO|LMFT|LCSW|LPCC|MFT|MA|MS|MSW|DNP|PMHNP|APRN|MFCC|LCP|LP|EdD|JD|RN|MFC).*$/i, "")
    .replace(/^Dr\.\s+/i, "")
    .trim();
  const parts = stripped.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return { first: parts[0], last: parts[parts.length - 1] };
}

async function npiSearch(first, last) {
  const url = `${NPI_API}&first_name=${encodeURIComponent(first)}&last_name=${encodeURIComponent(last)}&state=CA&limit=10`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return data.results || [];
}

function pickLicense(npiResults, credentials) {
  for (const result of npiResults) {
    const taxonomies = result.taxonomies || [];
    for (const tax of taxonomies) {
      if (!tax.license || tax.state !== "CA") continue;
      if (credentials) {
        const credUpper = credentials.toUpperCase();
        const knownPrefix = Object.keys(CA_TAXONOMY_PREFIXES).find((p) => credUpper.includes(p));
        if (knownPrefix) {
          const expected = CA_TAXONOMY_PREFIXES[knownPrefix];
          const matches = expected.some((needle) => tax.desc?.includes(needle) || tax.code?.startsWith(needle));
          if (!matches) continue;
        }
      }
      return {
        npi: result.number,
        licenseNumber: tax.license,
        taxonomyDesc: tax.desc,
        taxonomyCode: tax.code,
      };
    }
  }
  return null;
}

async function main() {
  const projectId = process.env.VITE_SANITY_PROJECT_ID;
  const dataset = process.env.VITE_SANITY_DATASET;
  const apiVersion = process.env.VITE_SANITY_API_VERSION || "2026-04-02";
  const token = process.env.SANITY_API_TOKEN;
  if (!projectId || !dataset || !token) throw new Error("Missing Sanity env vars");

  const client = createClient({ projectId, dataset, apiVersion, token, useCdn: false });

  const docs = await client.fetch(
    `*[_type == "therapistCandidate" && (!defined(licenseNumber) || licenseNumber == "") && defined(credentials) && credentials != ""]{_id, name, credentials, sourceUrl}`,
  );

  console.log(`Found ${docs.length} candidate(s) missing licenseNumber but with credentials.\n`);

  let patched = 0;
  let failed = 0;
  for (const doc of docs) {
    const parsed = parsePersonName(doc.name);
    if (!parsed) {
      console.log(`SKIP  ${doc.name} — could not parse first/last`);
      failed += 1;
      continue;
    }
    const results = await npiSearch(parsed.first, parsed.last);
    const found = pickLicense(results, doc.credentials);
    if (!found) {
      console.log(`MISS  ${doc.name} (${doc.credentials}) — no NPI/CA license match`);
      failed += 1;
      continue;
    }
    console.log(
      `HIT   ${doc.name} (${doc.credentials}) → license ${found.licenseNumber} (NPI ${found.npi}, ${found.taxonomyDesc})`,
    );
    if (!DRY_RUN) {
      await client
        .patch(doc._id)
        .set({
          licenseNumber: found.licenseNumber,
          licenseState: "CA",
          providerNpi: found.npi,
        })
        .commit();
      patched += 1;
    }
    await new Promise((r) => setTimeout(r, 600));
  }

  console.log(`\n${DRY_RUN ? "Dry-run" : "Done"}: ${patched} patched, ${failed} failed/no-match.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
