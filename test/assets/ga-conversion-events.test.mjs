import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  GA_CONVERSION_EVENTS,
  isGaConversionEvent,
  sanitizeGaParams,
  toGaDirectEvent,
  toGaEvent,
} from "../../shared/ga-conversion-events.mjs";
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

test("contact actions become GA4 generate_lead with their source and route", () => {
  assert.deepEqual(
    toGaEvent("profile_contact_route_clicked", {
      route: "email",
      therapist_slug: "jamie-rivera",
      experiments: { a: "b" },
    }),
    {
      name: "generate_lead",
      params: { lead_source: "profile", contact_method: "email", therapist_slug: "jamie-rivera" },
    },
  );
  assert.deepEqual(
    toGaEvent("directory_card_contact_action", { therapist_slug: "x", sort_by: "y" }),
    {
      name: "generate_lead",
      params: { lead_source: "directory", therapist_slug: "x" },
    },
  );
});

test("checkout intent becomes begin_checkout and funnel-only events send nothing", () => {
  assert.equal(toGaEvent("pricing_checkout_clicked", {}).name, "begin_checkout");
  assert.equal(toGaEvent("pricing_checkout_clicked", {}).params.checkout_source, "pricing_page");
  assert.equal(toGaEvent("directory_viewed", {}), null);
  assert.equal(toGaEvent("toString", {}), null);
});

test("signup and claim direct events: outcomes only", () => {
  assert.deepEqual(toGaDirectEvent("signup_verification_succeeded", { duration_ms: 1200, x: 1 }), {
    name: "sign_up",
    params: { method: "license_verified", duration_ms: 1200 },
  });
  assert.equal(toGaDirectEvent("claim_link_sent", { therapist_slug: "a" }).name, "claim_link_sent");
  for (const noisy of [
    "signup_field_focused",
    "signup_field_completed",
    "signup_field_abandoned",
    "signup_page_viewed",
    "claim_search_submitted",
    "claim_page_viewed",
    "constructor",
  ]) {
    assert.equal(toGaDirectEvent(noisy, {}), null, noisy);
  }
});

test("GA params keep primitives only, trimmed and capped", () => {
  const clean = sanitizeGaParams({
    a: "x".repeat(300),
    b: 3,
    c: true,
    d: { nested: 1 },
    e: NaN,
    f: "",
  });
  assert.deepEqual(Object.keys(clean), ["a", "b", "c"]);
  assert.equal(clean.a.length, 100);
  const many = {};
  for (let i = 0; i < 20; i += 1) many["k" + i] = i;
  assert.equal(Object.keys(sanitizeGaParams(many)).length, 10);
});

test("no GA param can be read as a traffic-source override or be overloaded", () => {
  const forbidden = new Set(["source", "medium", "campaign", "term", "content"]);
  const samples = [
    ["home_match_started", { source: "hero", interest_type: "x" }],
    ["pricing_checkout_clicked", { source: "pricing_page", branch: "b" }],
    ["profile_contact_route_clicked", { source: "directory", route: "email" }],
    ["directory_card_contact_action", { source: "x" }],
    ["match_contact_completed", { source: "x" }],
    ["claim_accepted", { source: "x" }],
  ];
  for (const [type, payload] of samples) {
    const event = toGaEvent(type, payload);
    for (const key of Object.keys(event.params)) {
      assert.equal(forbidden.has(key), false, `${type} sends reserved param ${key}`);
    }
  }
  // `method` belongs to Google's sign_up event only.
  assert.equal(
    "method" in toGaEvent("profile_contact_route_clicked", { route: "email" }).params,
    false,
  );
  assert.equal(
    "method" in
      toGaDirectEvent("claim_link_sent", { method: "slug_picked", therapist_slug: "a" }).params,
    false,
  );
  assert.equal(
    toGaDirectEvent("claim_link_sent", { method: "slug_picked" }).params.claim_method,
    "slug_picked",
  );
});
