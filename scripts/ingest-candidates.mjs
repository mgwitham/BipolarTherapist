#!/usr/bin/env node
// Ingest a batch of therapistCandidate docs via POST /candidates/ingest.
//
// Usage:
//   node scripts/ingest-candidates.mjs --file scripts/marin-ingest-batch-1.json
//   node scripts/ingest-candidates.mjs --file ./batch.json --prod
//   node scripts/ingest-candidates.mjs --file ./batch.json --base-url https://staging.example.com/api/review
//
// Reads credentials from env: REVIEW_API_ADMIN_USERNAME, REVIEW_API_ADMIN_PASSWORD.
// Loads .env if present (no dotenv dependency — simple manual parse).

import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const LOCAL_BASE_URL = "http://localhost:8787";
const PROD_BASE_URL = "https://www.bipolartherapyhub.com/api/review";

function parseArgs(argv) {
  const args = { file: "", prod: false, baseUrl: "" };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--file") {
      args.file = argv[++i];
    } else if (token === "--prod") {
      args.prod = true;
    } else if (token === "--base-url") {
      args.baseUrl = argv[++i];
    } else if (token === "--help" || token === "-h") {
      args.help = true;
    }
  }
  return args;
}

function loadDotEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
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
  console.log(`Ingest therapist candidates.

Options:
  --file <path>         Required. JSON file with a "candidates" array.
  --prod                Target the production Vercel endpoint.
  --base-url <url>      Override base URL (e.g. a staging preview).
  -h, --help            Show this help.

Env:
  REVIEW_API_ADMIN_USERNAME   Admin username (required).
  REVIEW_API_ADMIN_PASSWORD   Admin password (required).
`);
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { status: response.status, payload };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.file) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  loadDotEnv();
  const username = process.env.REVIEW_API_ADMIN_USERNAME;
  const password = process.env.REVIEW_API_ADMIN_PASSWORD;
  if (!username || !password) {
    console.error("Missing REVIEW_API_ADMIN_USERNAME or REVIEW_API_ADMIN_PASSWORD in env / .env");
    process.exit(1);
  }

  const baseUrl = args.baseUrl || (args.prod ? PROD_BASE_URL : LOCAL_BASE_URL);

  const fileContents = await readFile(path.resolve(process.cwd(), args.file), "utf8");
  const batch = JSON.parse(fileContents);
  const count = Array.isArray(batch.candidates) ? batch.candidates.length : 0;
  if (!count) {
    console.error(`No candidates found in ${args.file}`);
    process.exit(1);
  }

  console.log(`→ Target: ${baseUrl}`);
  console.log(`→ Batch:  ${args.file} (${count} candidate${count === 1 ? "" : "s"})`);

  // Step 1: log in
  const login = await postJson(`${baseUrl}/auth/login`, { username, password });
  if (login.status !== 200 || !login.payload?.sessionToken) {
    console.error(`✗ Login failed (${login.status}):`, login.payload);
    process.exit(1);
  }
  console.log(`✓ Authenticated as ${login.payload.actorName || username}`);

  // Step 2: POST ingest
  const ingest = await postJson(`${baseUrl}/candidates/ingest`, batch, {
    Authorization: `Bearer ${login.payload.sessionToken}`,
  });

  if (ingest.status !== 200) {
    console.error(`✗ Ingest failed (${ingest.status}):`, ingest.payload);
    process.exit(1);
  }

  const summary = ingest.payload?.summary || {};
  console.log("");
  console.log("─── Ingest result ───");
  console.log(`  received:         ${summary.received ?? "?"}`);
  console.log(`  created:          ${summary.created ?? 0}`);
  console.log(`  updated:          ${summary.updated ?? 0}`);
  console.log(`  skippedDuplicate: ${summary.skippedDuplicate ?? 0}`);
  console.log(`  errors:           ${summary.errors ?? 0}`);

  function formatVerification(v) {
    if (!v || !v.attempted) {
      if (v?.reason === "dca_not_configured")
        return "  [license check skipped: DCA not configured]";
      if (v?.reason === "license_type_unknown")
        return "  [license check skipped: unknown license type]";
      return "";
    }
    if (v.ok && v.status === "active" && v.nameMatch === "match") return "  [license ✓ active]";
    if (v.ok && v.nameMatch === "match") return `  [license ✓ ${v.status}]`;
    if (v.ok && v.nameMatch === "indeterminate") return "  [license ✓ (name unverified)]";
    if (!v.ok && v.status === "name_mismatch") return `  [⚠ name mismatch → DCA: ${v.dcaName}]`;
    if (!v.ok && v.status === "lookup_failed") return `  [⚠ ${v.error}]`;
    return "";
  }

  const created = ingest.payload?.created || [];
  if (created.length) {
    console.log("\nCreated:");
    for (const row of created) {
      const dup = row.possibleDuplicate
        ? ` (possible dup of ${row.possibleDuplicate.kind} ${row.possibleDuplicate.id})`
        : "";
      console.log(
        `  • ${row.name}  —  ${row.candidateId}${dup}${formatVerification(row.verification)}`,
      );
    }
  }

  const updated = ingest.payload?.updated || [];
  if (updated.length) {
    console.log("\nUpdated:");
    for (const row of updated) {
      console.log(`  • ${row.name}  —  ${row.candidateId}${formatVerification(row.verification)}`);
    }
  }

  const skipped = ingest.payload?.skippedDuplicate || [];
  if (skipped.length) {
    console.log("\nSkipped (already exists as therapist or application):");
    for (const row of skipped) {
      console.log(`  • ${row.name}  —  duplicate of ${row.match.kind} ${row.match.id}`);
    }
  }

  const errors = ingest.payload?.errors || [];
  if (errors.length) {
    console.log("\nErrors:");
    for (const row of errors) {
      console.log(`  • [${row.index}] ${row.error}`);
    }
  }

  console.log("");
}

main().catch(function (error) {
  console.error("✗ Unexpected error:", error);
  process.exit(1);
});
