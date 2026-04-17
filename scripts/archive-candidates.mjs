#!/usr/bin/env node
// Archive therapistCandidate docs by posting an "archive" decision.
//
// Usage:
//   node scripts/archive-candidates.mjs --ids id1,id2,... --reason "why" [--prod]
//   node scripts/archive-candidates.mjs --file ids.txt --reason "why" [--prod]

import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const LOCAL_BASE_URL = "http://localhost:8787";
const PROD_BASE_URL = "https://www.bipolartherapyhub.com/api/review";

function parseArgs(argv) {
  const args = { ids: "", file: "", reason: "", prod: false, baseUrl: "" };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--ids") args.ids = argv[++i];
    else if (token === "--file") args.file = argv[++i];
    else if (token === "--reason") args.reason = argv[++i];
    else if (token === "--prod") args.prod = true;
    else if (token === "--base-url") args.baseUrl = argv[++i];
    else if (token === "--help" || token === "-h") args.help = true;
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
  console.log(`Archive therapist candidates.

Options:
  --ids <a,b,c>      Comma-separated candidate document IDs.
  --file <path>      File with one candidate ID per line (# comments ok).
  --reason <text>    Required. Goes into the decision notes / event.
  --prod             Target the production Vercel endpoint.
  --base-url <url>   Override base URL.
  -h, --help         Show this help.

Env:
  REVIEW_API_ADMIN_USERNAME, REVIEW_API_ADMIN_PASSWORD (required).
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

async function readIds(args) {
  const ids = [];
  if (args.ids) {
    for (const piece of args.ids.split(",")) {
      const id = piece.trim();
      if (id) ids.push(id);
    }
  }
  if (args.file) {
    const text = await readFile(path.resolve(process.cwd(), args.file), "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      ids.push(trimmed);
    }
  }
  return Array.from(new Set(ids));
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || (!args.ids && !args.file) || !args.reason) {
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
  const ids = await readIds(args);
  if (!ids.length) {
    console.error("No candidate IDs provided.");
    process.exit(1);
  }

  console.log(`→ Target: ${baseUrl}`);
  console.log(`→ Archiving ${ids.length} candidate${ids.length === 1 ? "" : "s"}`);
  console.log(`→ Reason: ${args.reason}`);

  const login = await postJson(`${baseUrl}/auth/login`, { username, password });
  if (login.status !== 200 || !login.payload?.sessionToken) {
    console.error(`✗ Login failed (${login.status}):`, login.payload);
    process.exit(1);
  }
  console.log(`✓ Authenticated as ${login.payload.actorName || username}`);

  const auth = { Authorization: `Bearer ${login.payload.sessionToken}` };
  let archived = 0;
  let failed = 0;
  for (const id of ids) {
    const url = `${baseUrl}/candidates/${encodeURIComponent(id)}/decision`;
    const result = await postJson(url, { decision: "archive", notes: args.reason }, auth);
    if (result.status === 200 && result.payload?.ok) {
      const status = result.payload?.candidate?.review_status || "archived";
      console.log(`  ✓ ${id}  → ${status}`);
      archived += 1;
    } else {
      console.error(`  ✗ ${id}  (${result.status})`, result.payload);
      failed += 1;
    }
  }

  console.log("");
  console.log(`Done. archived=${archived} failed=${failed}`);
  process.exit(failed ? 1 : 0);
}

main().catch(function (error) {
  console.error("✗ Unexpected error:", error);
  process.exit(1);
});
