// Rewrites the nav blocks in each public page from the canonical markup
// in shared/site-nav.mjs, so the two-zone navigation can't drift page to
// page. Edit shared/site-nav.mjs, then run `npm run nav:sync`.
//
// Operates on source HTML in the repo root (so dev and prod stay in
// sync). test/scripts/site-nav.test.mjs guards that every page still
// embeds its zone's canonical block.
//
// Phase 1 scope: patient-zone pages (they share the .nav-dark /
// .public-mobile-nav system). Therapist-zone pages are migrated onto the
// same system separately.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { ZONE_NAV, PATIENT_PAGES } from "../shared/site-nav.mjs";

const ROOT = process.cwd();

const DESKTOP_RE = /<nav\b[^>]*class="nav-dark"[^>]*>[\s\S]*?<\/nav>/;
const MOBILE_RE = /<div\b[^>]*class="public-mobile-nav"[^>]*>[\s\S]*?<\/div>/;

function syncFile(fileName, zone) {
  const filePath = path.join(ROOT, fileName);
  if (!fs.existsSync(filePath)) {
    return { fileName, status: "missing" };
  }
  const original = fs.readFileSync(filePath, "utf8");
  const nav = ZONE_NAV[zone];
  let updated = original;
  const problems = [];

  if (DESKTOP_RE.test(updated)) {
    updated = updated.replace(DESKTOP_RE, () => nav.desktop);
  } else {
    problems.push("no .nav-dark block");
  }
  if (MOBILE_RE.test(updated)) {
    updated = updated.replace(MOBILE_RE, () => nav.mobile);
  } else {
    problems.push("no .public-mobile-nav block");
  }

  if (problems.length) return { fileName, status: "skipped", problems };
  if (updated === original) return { fileName, status: "unchanged" };
  fs.writeFileSync(filePath, updated, "utf8");
  return { fileName, status: "updated" };
}

let changed = 0;
let skipped = 0;
for (const fileName of PATIENT_PAGES) {
  const result = syncFile(fileName, "patient");
  if (result.status === "updated") {
    changed += 1;
    console.log(`  ✓ ${fileName}`);
  } else if (result.status === "unchanged") {
    console.log(`  · ${fileName} (already in sync)`);
  } else {
    skipped += 1;
    console.warn(
      `  ⚠ ${fileName}: ${result.problems ? result.problems.join(", ") : result.status}`,
    );
  }
}
console.log(`[nav:sync] patient zone — ${changed} updated, ${skipped} skipped`);
if (skipped > 0) process.exit(1);
