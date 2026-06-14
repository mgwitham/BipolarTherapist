#!/usr/bin/env node
// Ingest a batch of demand-side referral contacts into Sanity as
// `referralContact` documents.
//
// Provenance is enforced: every row must carry a verifiable `sourceUrl` (and a
// known `segment`), so a fabricated or unsourced contact can never enter the
// system. Validation, shaping, fit-scoring, and dedup all come from the shared
// domain layer (shared/referral-contact-domain.mjs) — this script is just I/O.
//
// Usage:
//   node scripts/ingest-referral-contacts.mjs --file data/import/referral-contacts-ca-1.json
//       → DRY RUN: validates, dedups, prints the plan. No network, no creds needed.
//   node scripts/ingest-referral-contacts.mjs --file <path> --write
//       → Writes to Sanity. Requires SANITY_API_TOKEN + VITE_SANITY_PROJECT_ID.
//
// Input shape:  { "contacts": [ { orgName, segment, sourceUrl, email?, ... }, ... ] }
// Writes are idempotent: the _id is derived from the contact's identity key, so
// re-running the same batch updates-in-place rather than duplicating.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  dedupeByIdentity,
  referralContactDocId,
  shapeReferralContact,
  validateIngestRecord,
} from "../shared/referral-contact-domain.mjs";

function parseArgs(argv) {
  const args = { file: "", write: false, help: false };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--file") args.file = argv[++i];
    else if (token === "--write") args.write = true;
    else if (token === "--dry-run") args.write = false;
    else if (token === "--help" || token === "-h") args.help = true;
  }
  return args;
}

function loadDotEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key]) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function printHelp() {
  console.log(`Ingest demand-side referral contacts into Sanity.

Options:
  --file <path>   Required. JSON file with a "contacts" array.
  --write         Actually write to Sanity (default is a dry run).
  -h, --help      Show this help.

Env (only needed with --write):
  SANITY_API_TOKEN, VITE_SANITY_PROJECT_ID, VITE_SANITY_DATASET
`);
}

function readContacts(file) {
  const resolved = path.resolve(process.cwd(), file);
  if (!existsSync(resolved)) {
    throw new Error(`Input file not found: ${resolved}`);
  }
  const parsed = JSON.parse(readFileSync(resolved, "utf8"));
  const contacts = Array.isArray(parsed) ? parsed : parsed && parsed.contacts;
  if (!Array.isArray(contacts)) {
    throw new Error('Input must be a JSON array or an object with a "contacts" array.');
  }
  return contacts;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.file) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const rawContacts = readContacts(args.file);
  const nowIso = new Date().toISOString();

  /** @type {Array<{ index: number, errors: string[] }>} */
  const rejected = [];
  const shaped = [];
  rawContacts.forEach((raw, index) => {
    const errors = validateIngestRecord(raw);
    if (errors.length) {
      rejected.push({ index, errors });
      return;
    }
    shaped.push(shapeReferralContact(raw, { nowIso }));
  });

  const { unique, duplicates } = dedupeByIdentity(shaped);

  console.log(`\nReferral contact ingestion — ${args.write ? "WRITE" : "DRY RUN"}`);
  console.log(`  input rows:     ${rawContacts.length}`);
  console.log(`  valid:          ${shaped.length}`);
  console.log(`  rejected:       ${rejected.length}`);
  console.log(`  in-batch dupes: ${duplicates.length}`);
  console.log(`  to ingest:      ${unique.length}\n`);

  if (rejected.length) {
    console.log("Rejected rows (fix the source data — nothing fabricated gets in):");
    for (const { index, errors } of rejected) {
      console.log(`  [row ${index}] ${errors.join("; ")}`);
    }
    console.log("");
  }

  if (unique.length) {
    console.log("Contacts to ingest (org · segment · fit · email):");
    for (const doc of unique) {
      console.log(
        `  ${doc.fitScore.toString().padStart(3)}  ${doc.orgName} · ${doc.segment} · ${doc.email || "(no email)"}`,
      );
    }
    console.log("");
  }

  if (!args.write) {
    console.log("Dry run only. Re-run with --write to persist to Sanity.\n");
    return;
  }

  loadDotEnv();
  const projectId = process.env.VITE_SANITY_PROJECT_ID;
  const token = process.env.SANITY_API_TOKEN;
  if (!projectId || !token) {
    console.error("Cannot --write: VITE_SANITY_PROJECT_ID and SANITY_API_TOKEN are required.");
    process.exit(1);
  }

  const { createClient } = await import("@sanity/client");
  const client = createClient({
    projectId,
    dataset: process.env.VITE_SANITY_DATASET || "production",
    apiVersion: process.env.VITE_SANITY_API_VERSION || "2026-04-02",
    token,
    useCdn: false,
  });

  let created = 0;
  for (const doc of unique) {
    const _id = referralContactDocId(doc);
    // createIfNotExists keeps re-runs idempotent and never clobbers pipeline
    // state (status/emailLog) that later phases write onto an existing contact.
    await client.createIfNotExists({ _id, ...doc });
    created += 1;
  }
  console.log(`Wrote ${created} referral contact(s) to Sanity.\n`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
