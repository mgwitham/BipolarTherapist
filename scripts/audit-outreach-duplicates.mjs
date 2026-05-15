#!/usr/bin/env node
// Audit outreach.emailLog for same-day duplicate sends to the same therapist.
// Flags any therapist whose emailLog contains two or more entries with sentAt
// timestamps within DUP_WINDOW_MINUTES of each other. Also prints a summary
// of all sends from the last 24 hours so you can eyeball recent activity.
//
// Usage:
//   node scripts/audit-outreach-duplicates.mjs
//   node scripts/audit-outreach-duplicates.mjs --window=10   # minutes, default 60
//   node scripts/audit-outreach-duplicates.mjs --since=24h   # default 24h
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@sanity/client";

const ROOT = process.cwd();

function readEnvFile(p) {
  if (!fs.existsSync(p)) return {};
  return fs
    .readFileSync(p, "utf8")
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

function parseArgs(argv) {
  const out = { windowMinutes: 60, sinceHours: 24 };
  for (const a of argv) {
    if (a.startsWith("--window=")) out.windowMinutes = Number(a.slice(9));
    else if (a.startsWith("--since=")) {
      const v = a.slice(8);
      const m = v.match(/^(\d+)(h|d)?$/);
      if (m) out.sinceHours = Number(m[1]) * (m[2] === "d" ? 24 : 1);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = readEnvFile(path.join(ROOT, ".env"));
  const client = createClient({
    projectId: process.env.VITE_SANITY_PROJECT_ID || env.VITE_SANITY_PROJECT_ID,
    dataset: process.env.VITE_SANITY_DATASET || env.VITE_SANITY_DATASET || "production",
    apiVersion: process.env.VITE_SANITY_API_VERSION || env.VITE_SANITY_API_VERSION || "2026-04-02",
    token: process.env.SANITY_API_TOKEN || env.SANITY_API_TOKEN,
    useCdn: false,
  });

  const sinceIso = new Date(Date.now() - args.sinceHours * 3600_000).toISOString();
  console.log(`Window for duplicate detection: ${args.windowMinutes} minutes`);
  console.log(`Recent-activity window: last ${args.sinceHours}h (since ${sinceIso})\n`);

  const rows = await client.fetch(
    `*[_type == "therapist" && defined(outreach.emailLog) && count(outreach.emailLog) > 0]{
      _id, name, email, "slug": slug.current,
      "log": outreach.emailLog[]{ sentAt, subject, template, campaign, resendId }
    }`,
  );

  const dupes = [];
  const recent = [];

  for (const t of rows) {
    const log = (t.log || [])
      .filter((e) => e && e.sentAt)
      .slice()
      .sort((a, b) => a.sentAt.localeCompare(b.sentAt));

    for (const e of log) if (e.sentAt >= sinceIso) recent.push({ t, e });

    for (let i = 1; i < log.length; i++) {
      const a = log[i - 1];
      const b = log[i];
      const gapMs = new Date(b.sentAt) - new Date(a.sentAt);
      if (gapMs <= args.windowMinutes * 60_000) {
        dupes.push({ t, a, b, gapSeconds: Math.round(gapMs / 1000) });
      }
    }
  }

  console.log(`=== Same-therapist sends within ${args.windowMinutes}min ===`);
  if (dupes.length === 0) {
    console.log("  (none — no back-to-back duplicates found)\n");
  } else {
    for (const d of dupes) {
      console.log(
        `  • ${d.t.name || d.t.slug || d.t._id} <${d.t.email || "?"}>  gap=${d.gapSeconds}s`,
      );
      console.log(
        `      A  ${d.a.sentAt}  [${d.a.template || "?"}] ${d.a.subject || ""}  resendId=${d.a.resendId || "(none)"}`,
      );
      console.log(
        `      B  ${d.b.sentAt}  [${d.b.template || "?"}] ${d.b.subject || ""}  resendId=${d.b.resendId || "(none)"}`,
      );
    }
    console.log("");
  }

  console.log(`=== All sends in last ${args.sinceHours}h (${recent.length} total) ===`);
  recent
    .sort((a, b) => b.e.sentAt.localeCompare(a.e.sentAt))
    .forEach(({ t, e }) => {
      console.log(
        `  ${e.sentAt}  ${(t.name || t.slug || t._id).padEnd(28)} [${e.template || "?"}]  ${e.campaign ? `tag=${e.campaign}  ` : ""}resendId=${e.resendId || "(none)"}`,
      );
    });
  console.log("");

  if (dupes.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
