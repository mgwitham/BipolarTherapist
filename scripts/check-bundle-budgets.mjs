#!/usr/bin/env node
// Fail the build if any tracked bundle in dist/ exceeds its gzipped
// size budget. Caps growth on the patient-facing surfaces (match,
// therapist, home) so they don't silently double over a year of
// feature work. Admin and portal get looser budgets — they're
// internal-tool surfaces where bundle size matters less.
//
// Usage: run after `npm run build`. Wired into `npm run check` and
// CI. Update BUDGETS deliberately when a real feature requires more
// headroom — don't bump it to make the build green.

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

const DIST_DIR = path.resolve(process.cwd(), "dist");

// Budgets are in KILOBYTES of gzipped output. Each rule matches by
// regex against the file's path relative to dist/. First matching
// rule wins. Files matched by no rule are reported but don't fail.
const BUDGETS = [
  // Patient-facing JS — strict caps. These are what a bipolar patient
  // in a depressive episode actually downloads on a low-end phone.
  // The {8,12} char tail matches Vite's content hash on entry chunks
  // and excludes code-split chunks (which have additional dashes).
  {
    pattern: /^assets\/match-[A-Za-z0-9_]{8,12}\.js$/,
    maxKb: 45,
    label: "match.js (patient match flow)",
  },
  {
    pattern: /^assets\/therapist-[A-Za-z0-9_]{8,12}\.js$/,
    maxKb: 28,
    label: "therapist.js (profile page)",
  },
  { pattern: /^assets\/home-[A-Za-z0-9_]{8,12}\.js$/, maxKb: 25, label: "home.js" },
  { pattern: /^assets\/directory-[A-Za-z0-9_]{8,12}\.js$/, maxKb: 35, label: "directory.js" },
  { pattern: /^index\.html$/, maxKb: 18, label: "index.html (homepage)" },
  { pattern: /^match\.html$/, maxKb: 8, label: "match.html" },
  { pattern: /^therapist\.html$/, maxKb: 4, label: "therapist.html" },

  // Therapist-facing — looser. Subscribers tolerate a heavier portal.
  { pattern: /^assets\/portal-[A-Za-z0-9_]{8,12}\.js$/, maxKb: 38, label: "portal.js" },
  { pattern: /^assets\/signup-[A-Za-z0-9_]{8,12}\.js$/, maxKb: 35, label: "signup.js" },
  { pattern: /^assets\/claim-[A-Za-z0-9_]{8,12}\.js$/, maxKb: 35, label: "claim.js" },

  // Admin — internal only. Only the main admin entry chunk; per-feature
  // code-split chunks (admin-foo-bar-HASH.js) aren't tracked because
  // they're already small and naturally lazy-loaded.
  {
    pattern: /^assets\/admin-[A-Za-z0-9_]{8,12}\.js$/,
    maxKb: 100,
    label: "admin.js (main bundle)",
  },
  { pattern: /^admin\.html$/, maxKb: 35, label: "admin.html" },

  // Shared CSS — patient-facing.
  { pattern: /^assets\/match-[A-Za-z0-9_]{8,12}\.css$/, maxKb: 22, label: "match.css" },
  { pattern: /^assets\/styles-[A-Za-z0-9_]{8,12}\.css$/, maxKb: 14, label: "styles.css" },
];

async function walk(dir, base = "") {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.posix.join(base, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(full, rel)));
    } else if (entry.isFile()) {
      files.push({ full, rel });
    }
  }
  return files;
}

async function gzippedKb(filePath) {
  const buf = await readFile(filePath);
  const gz = gzipSync(buf);
  return gz.length / 1024;
}

function matchBudget(rel) {
  for (const rule of BUDGETS) {
    if (rule.pattern.test(rel)) return rule;
  }
  return null;
}

async function main() {
  try {
    await stat(DIST_DIR);
  } catch (_error) {
    console.error("dist/ not found. Run `npm run build` first.");
    process.exit(2);
  }

  const files = await walk(DIST_DIR);
  const results = [];
  for (const file of files) {
    const rule = matchBudget(file.rel);
    if (!rule) continue;
    const kb = await gzippedKb(file.full);
    results.push({ rel: file.rel, kb, rule });
  }

  results.sort(function (a, b) {
    return b.kb - a.kb;
  });

  let failed = 0;
  console.log("Bundle budget check (gzipped):");
  console.log("");
  for (const row of results) {
    const headroom = row.rule.maxKb - row.kb;
    const status = headroom < 0 ? "FAIL" : "ok  ";
    if (headroom < 0) failed += 1;
    const pctUsed = Math.round((row.kb / row.rule.maxKb) * 100);
    console.log(
      "  " +
        status +
        "  " +
        row.kb.toFixed(2).padStart(6) +
        " kB / " +
        String(row.rule.maxKb).padStart(3) +
        " kB  (" +
        String(pctUsed).padStart(3) +
        "%)  " +
        row.rule.label,
    );
  }
  console.log("");

  if (failed > 0) {
    console.error(
      failed +
        " bundle" +
        (failed === 1 ? "" : "s") +
        " exceeded budget. Investigate the regression before raising the cap.",
    );
    process.exit(1);
  }
  console.log("All " + results.length + " tracked bundles within budget.");
}

main().catch(function (error) {
  console.error("check-bundle-budgets failed:", error);
  process.exit(2);
});
