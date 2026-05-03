#!/usr/bin/env node
// Deletes all therapist + therapistApplication docs created during local
// dev testing. Matches on email addresses and/or the dev sentinel license.
//
// Usage:
//   node scripts/dev-cleanup-test-docs.mjs
//   node scripts/dev-cleanup-test-docs.mjs --email mgwitham+other@gmail.com
//   node scripts/dev-cleanup-test-docs.mjs --dry-run

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const API_VERSION = "2026-04-02";
const DEV_SENTINEL_LICENSE = "TEST-0000";

function readEnvFile(filePath) {
  try {
    return fs
      .readFileSync(filePath, "utf8")
      .split("\n")
      .reduce(function (acc, line) {
        const eq = line.indexOf("=");
        if (eq < 1 || line.trimStart().startsWith("#")) return acc;
        acc[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
        return acc;
      }, {});
  } catch {
    return {};
  }
}

const env = readEnvFile(path.join(ROOT, ".env"));
const projectId = env.VITE_SANITY_PROJECT_ID;
const dataset = env.VITE_SANITY_DATASET || "production";
const token = env.SANITY_API_TOKEN;

if (!projectId || !token) {
  console.error("Missing VITE_SANITY_PROJECT_ID or SANITY_API_TOKEN in .env");
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const emailFlag = args.indexOf("--email");
const extraEmail = emailFlag >= 0 ? args[emailFlag + 1] : null;

// Default test emails — add more here as needed.
const TEST_EMAILS = [
  "mgwitham@gmail.com",
  "mgwitham+test@gmail.com",
  ...(extraEmail ? [extraEmail] : []),
];

const BASE = `https://${projectId}.api.sanity.io/v${API_VERSION}/data`;
const HEADERS = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};

async function query(groq) {
  const url = `${BASE}/query/${dataset}?query=${encodeURIComponent(groq)}`;
  const res = await fetch(url, { headers: HEADERS });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Query failed");
  return json.result || [];
}

async function deleteIds(ids) {
  if (!ids.length) return;
  const mutations = ids.map((id) => ({ delete: { id } }));
  const res = await fetch(`${BASE}/mutate/${dataset}`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ mutations }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Mutation failed");
  return json;
}

const emailList = TEST_EMAILS.map((e) => `"${e}"`).join(", ");
const therapistQuery = `*[_type == "therapist" && (email in [${emailList}] || claimedByEmail in [${emailList}] || licenseNumber == "${DEV_SENTINEL_LICENSE}")]{_id, name, email, licenseNumber}`;
const applicationQuery = `*[_type == "therapistApplication" && email in [${emailList}]]{_id, name, email}`;

console.log(`Scanning dataset: ${dataset} (project: ${projectId})`);
if (dryRun) console.log("DRY RUN — nothing will be deleted.\n");

const [therapists, applications] = await Promise.all([
  query(therapistQuery),
  query(applicationQuery),
]);

if (!therapists.length && !applications.length) {
  console.log("Nothing to clean up.");
  process.exit(0);
}

if (therapists.length) {
  console.log(`Therapist docs (${therapists.length}):`);
  therapists.forEach((t) =>
    console.log(`  ${t._id}  —  ${t.name}  <${t.email || t.licenseNumber}>`),
  );
}
if (applications.length) {
  console.log(`Application docs (${applications.length}):`);
  applications.forEach((a) => console.log(`  ${a._id}  —  ${a.name}  <${a.email}>`));
}

if (dryRun) {
  console.log("\nRe-run without --dry-run to delete.");
  process.exit(0);
}

const allIds = [...therapists.map((d) => d._id), ...applications.map((d) => d._id)];
await deleteIds(allIds);
console.log(`\nDeleted ${allIds.length} doc(s).`);
