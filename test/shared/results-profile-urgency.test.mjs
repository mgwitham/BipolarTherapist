import test from "node:test";
import assert from "node:assert/strict";

import { restoreProfileFromUrl } from "../../assets/match-intake.js";
import { buildUserMatchProfile } from "../../shared/matching-model.mjs";

// restoreProfileFromUrl reads window.location.search. Provide a minimal window.
function withSearch(search, fn) {
  const prev = globalThis.window;
  globalThis.window = { location: { search } };
  try {
    return fn();
  } finally {
    globalThis.window = prev;
  }
}

const deps = {
  buildUserMatchProfile,
  // The async zipcodes data isn't loaded in this context; deriveStateFromLocation
  // returns "" and the URL's care_state anchors the profile (mirrors results.js).
  deriveStateFromLocation: () => "",
  splitCommaSeparated: (value) =>
    String(value || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
};

// Regression: a location search that doesn't specify urgency must NOT impose
// "ASAP". "ASAP" triggers the engine's availability-urgency scoring, which
// rewards the tiny fraction of therapists with a confirmed fast
// estimated_wait_time and buries everyone else (including newly-claimed
// profiles with no wait-time data) — even though the user never asked for
// urgent care. The neutral value is "Flexible".
test("restoreProfileFromUrl defaults urgency to neutral 'Flexible' when unspecified", () => {
  const profile = withSearch("?location_query=90210&care_intent=Therapy&care_state=CA", () =>
    restoreProfileFromUrl(deps),
  );
  assert.equal(profile.urgency, "Flexible");
});

test("restoreProfileFromUrl still honors an explicit urgency param", () => {
  const profile = withSearch("?location_query=90210&care_intent=Therapy&urgency=ASAP", () =>
    restoreProfileFromUrl(deps),
  );
  assert.equal(profile.urgency, "ASAP");
});

// Guard the neutral value against the engine: buildUserMatchProfile must treat
// "Flexible" as its own default too, so the restore default and the engine
// default agree (both neutral, no urgency-based reranking).
test("buildUserMatchProfile default urgency is also the neutral 'Flexible'", () => {
  assert.equal(buildUserMatchProfile({ care_state: "CA" }).urgency, "Flexible");
});
