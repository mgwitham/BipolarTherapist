import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { GA_CONVERSION_EVENTS, isGaConversionEvent } from "../../shared/ga-conversion-events.mjs";
import { PATIENT_STEPS } from "../../shared/funnel-step-definitions.mjs";

// Same scan as funnel-step-keys.test.mjs: collect every trackFunnelEvent("…")
// literal in assets/. A GA conversion pointing at an event nobody emits would
// read zero in GA4 forever (match_submitted did, after the guided intake was
// retired), so fail loudly instead.
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

test("every GA conversion event is an event the app emits", () => {
  for (const name of GA_CONVERSION_EVENTS) {
    assert.ok(emitted.has(name), `GA conversion "${name}" is not emitted by any trackFunnelEvent`);
  }
});

test("the live patient funnel reaches GA4", () => {
  assert.ok(isGaConversionEvent("match_results_page_viewed"));
  assert.ok(isGaConversionEvent("match_results_card_clicked"));
  assert.ok(isGaConversionEvent("profile_contact_route_clicked"));
  assert.ok(isGaConversionEvent("directory_card_contact_action"));
  const patientKeys = PATIENT_STEPS.map((step) => step.key);
  for (const key of patientKeys) {
    assert.ok(isGaConversionEvent(key), `patient funnel step ${key} is not forwarded to GA4`);
  }
  assert.equal(isGaConversionEvent("directory_viewed"), false);
  assert.equal(isGaConversionEvent(undefined), false);
});
