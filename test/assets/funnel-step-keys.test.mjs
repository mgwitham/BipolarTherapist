import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  PATIENT_STEPS,
  SIGNUP_STEPS,
  CLAIM_STEPS,
  PORTAL_STEPS,
  REMOVAL_STEPS,
} from "../../shared/funnel-step-definitions.mjs";

// Build the set of event names the app actually emits, by scanning every
// trackFunnelEvent("…") literal in assets/. This is the guard that keeps
// funnel definitions honest: if an event is renamed or removed, the funnel
// step that points at it will fail here instead of silently reading zero
// (which is exactly the staleness this test was written to catch).
const assetsDir = fileURLToPath(new URL("../../assets/", import.meta.url));
const emitted = new Set();
const CALL_RE = /trackFunnelEvent\(\s*["']([a-z0-9_]+)["']/g;
for (const file of readdirSync(assetsDir)) {
  if (!file.endsWith(".js")) continue;
  const src = readFileSync(assetsDir + file, "utf8");
  let match;
  while ((match = CALL_RE.exec(src)) !== null) {
    emitted.add(match[1]);
  }
}

const funnels = { PATIENT_STEPS, SIGNUP_STEPS, CLAIM_STEPS, PORTAL_STEPS, REMOVAL_STEPS };

for (const [name, steps] of Object.entries(funnels)) {
  test(`every ${name} key is an event the app emits`, () => {
    for (const step of steps) {
      assert.ok(
        emitted.has(step.key),
        `${name} step "${step.key}" is not emitted by any trackFunnelEvent call in assets/ — ` +
          "the event was likely renamed or removed, leaving this funnel step stuck at zero.",
      );
    }
  });
}

test("scan actually found a meaningful number of emitted events", () => {
  // Sanity check the regex didn't silently match nothing (which would make
  // the assertions above vacuously pass).
  assert.ok(emitted.size > 50, `expected >50 emitted events, found ${emitted.size}`);
});
