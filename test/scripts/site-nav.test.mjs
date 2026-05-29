import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PATIENT_NAV,
  PATIENT_MOBILE_NAV,
  THERAPIST_NAV,
  THERAPIST_MOBILE_NAV,
  PATIENT_PAGES,
  THERAPIST_PAGES,
} from "../../shared/site-nav.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Compare structurally so the guard survives Prettier reformatting the
// injected markup (it expands long tags onto multiple lines, e.g. </a\n>).
// Collapse whitespace and strip it from around angle brackets; the same
// normalization is applied to both the page and the canonical block, so
// this is a layout-agnostic content/structure comparison.
const norm = (s) =>
  s
    .replace(/\s+/g, " ")
    .replace(/\s*([<>])\s*/g, "$1")
    .trim();

function read(fileName) {
  return norm(fs.readFileSync(path.join(ROOT, fileName), "utf8"));
}

// Drift guard: every page must embed its zone's canonical nav from
// shared/site-nav.mjs. If someone hand-edits one page's nav, this fails
// — keeping the two-zone navigation consistent. After editing the
// canonical markup, run `npm run nav:sync`.
const ZONES = [
  { name: "patient", pages: PATIENT_PAGES, desktop: PATIENT_NAV, mobile: PATIENT_MOBILE_NAV },
  {
    name: "therapist",
    pages: THERAPIST_PAGES,
    desktop: THERAPIST_NAV,
    mobile: THERAPIST_MOBILE_NAV,
  },
];

for (const zone of ZONES) {
  const desktop = norm(zone.desktop);
  const mobile = norm(zone.mobile);
  for (const page of zone.pages) {
    test(`${page} embeds the canonical ${zone.name} desktop nav`, () => {
      assert.ok(
        read(page).includes(desktop),
        `${page} is out of sync with the ${zone.name} desktop nav — run npm run nav:sync`,
      );
    });
    test(`${page} embeds the canonical ${zone.name} mobile nav`, () => {
      assert.ok(
        read(page).includes(mobile),
        `${page} is out of sync with the ${zone.name} mobile nav — run npm run nav:sync`,
      );
    });
  }
}
