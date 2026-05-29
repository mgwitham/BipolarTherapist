import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PATIENT_NAV, PATIENT_MOBILE_NAV, PATIENT_PAGES } from "../../shared/site-nav.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function read(fileName) {
  return fs.readFileSync(path.join(ROOT, fileName), "utf8");
}

// Drift guard: every patient-zone page must embed the canonical nav from
// shared/site-nav.mjs verbatim. If someone hand-edits one page's nav,
// this fails — keeping the two-zone navigation consistent. Run
// `npm run nav:sync` after editing the canonical markup.
for (const page of PATIENT_PAGES) {
  test(`${page} embeds the canonical patient desktop nav`, () => {
    assert.ok(
      read(page).includes(PATIENT_NAV),
      `${page} is out of sync with PATIENT_NAV — run npm run nav:sync`,
    );
  });

  test(`${page} embeds the canonical patient mobile nav`, () => {
    assert.ok(
      read(page).includes(PATIENT_MOBILE_NAV),
      `${page} is out of sync with PATIENT_MOBILE_NAV — run npm run nav:sync`,
    );
  });
}
