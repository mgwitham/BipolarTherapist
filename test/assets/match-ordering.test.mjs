import { test } from "node:test";
import assert from "node:assert/strict";

import { orderMatchEntries, applyZipAwareOrdering } from "../../assets/match-ordering.js";

// Preload the CA zipcodes dataset so getZipDistanceMiles can resolve 94901 /
// 94941 / 91105 during the tests. assets/zip-lookup.js fetches this at runtime;
// in node we replicate that by reading the JSON directly and seeding the
// module's cache via its public loader.
import { preloadZipcodes } from "../../assets/zip-lookup.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const zipUrl = new URL("../../assets/ca-zipcodes.json", import.meta.url);
const zipData = JSON.parse(readFileSync(fileURLToPath(zipUrl), "utf8"));
// Monkey-patch global fetch so preloadZipcodes resolves without network.
globalThis.fetch = async () => ({ ok: true, json: async () => zipData });
await preloadZipcodes();

function makeEntry(overrides) {
  return {
    therapist: { slug: overrides.slug, name: overrides.slug, zip: overrides.zip },
    evaluation: {
      score: overrides.score,
      confidence_score: overrides.confidence || 70,
    },
  };
}

test("orderMatchEntries — in-person 94941 search ranks local therapist above higher-scoring LA therapist", () => {
  var entries = [
    makeEntry({ slug: "valone-pasadena", zip: "91105", score: 140 }),
    makeEntry({ slug: "kokoska-mill-valley", zip: "94941", score: 90 }),
  ];

  var ordered = orderMatchEntries(entries, {
    locationQuery: "94941",
    careFormat: "In-Person",
  });

  assert.equal(
    ordered[0].therapist.slug,
    "kokoska-mill-valley",
    "nearby Mill Valley therapist should outrank Pasadena on a 94941 in-person search",
  );
  assert.equal(ordered[1].therapist.slug, "valone-pasadena");
});

test("applyZipAwareOrdering — stamps ordering_score used by prominence pass", () => {
  var entries = [
    makeEntry({ slug: "far", zip: "91105", score: 100 }),
    makeEntry({ slug: "near", zip: "94941", score: 100 }),
  ];

  applyZipAwareOrdering(entries, { locationQuery: "94941", careFormat: "In-Person" });

  assert.ok(typeof entries[0].ordering_score === "number");
  assert.ok(typeof entries[1].ordering_score === "number");
  assert.ok(
    entries[1].ordering_score > entries[0].ordering_score,
    "near (Mill Valley) should have a higher ordering_score than far (Pasadena)",
  );
});

test("orderMatchEntries — telehealth search preserves evaluation.score ordering", () => {
  // Distance should not dominate when the user picked telehealth.
  var entries = [
    makeEntry({ slug: "far-high-score", zip: "91105", score: 120 }),
    makeEntry({ slug: "near-low-score", zip: "94941", score: 80 }),
  ];

  var ordered = orderMatchEntries(entries, {
    locationQuery: "94941",
    careFormat: "Telehealth",
  });

  assert.equal(
    ordered[0].therapist.slug,
    "far-high-score",
    "telehealth should still rank by base score when gap exceeds the tiebreaker",
  );
});
