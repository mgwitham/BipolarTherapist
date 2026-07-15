import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildResultsMatchRequestPayload,
  getOrCreateResultsJourneyId,
} from "../../assets/results-match-request.js";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
}

test("journey id: minted once, stable within a session", () => {
  const storage = memoryStorage();
  const first = getOrCreateResultsJourneyId(storage);
  assert.ok(first.startsWith("results:"));
  assert.equal(getOrCreateResultsJourneyId(storage), first);
});

test("journey id: unavailable storage → empty string (skip persistence)", () => {
  const broken = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {},
  };
  assert.equal(getOrCreateResultsJourneyId(broken), "");
});

test("payload: carries journey id, surface, and referral code", () => {
  const payload = buildResultsMatchRequestPayload({ care_state: "CA" }, [], {
    journeyId: "results:abc",
    referralCode: "nkennedy-3f2a",
    now: "2026-07-15T12:00:00.000Z",
  });
  assert.equal(payload.journey_id, "results:abc");
  assert.equal(payload.source_surface, "results_page");
  assert.equal(payload.referral_code, "nkennedy-3f2a");
  assert.equal(payload.created_at, "2026-07-15T12:00:00.000Z");
  assert.equal(payload.result_count, 0);
  assert.equal(payload.top_slug, "");
});

test("payload: maps profile fields and tolerates missing ones", () => {
  const profile = {
    care_state: "CA",
    care_format: "Telehealth",
    insurance: "Aetna",
    bipolar_focus: ["bipolar ii"],
  };
  const entries = [{ therapist: { slug: "jane-doe" } }, { therapist: { slug: "sam-lee" } }];
  const payload = buildResultsMatchRequestPayload(profile, entries, { journeyId: "results:x" });
  assert.equal(payload.care_state, "CA");
  assert.equal(payload.care_format, "Telehealth");
  assert.equal(payload.insurance, "Aetna");
  assert.deepEqual(payload.bipolar_focus, ["bipolar ii"]);
  assert.deepEqual(payload.preferred_modalities, []);
  assert.equal(payload.budget_max, null);
  assert.equal(payload.top_slug, "jane-doe");
  assert.equal(payload.result_count, 2);
  assert.equal(typeof payload.request_summary, "string");
  assert.ok(payload.request_summary.length > 0);
});

test("payload: null profile still produces a valid identity + summary", () => {
  const payload = buildResultsMatchRequestPayload(null, null, { journeyId: "results:y" });
  assert.equal(payload.journey_id, "results:y");
  assert.equal(payload.request_summary, "Results page search");
  assert.equal(payload.referral_code, "");
});
