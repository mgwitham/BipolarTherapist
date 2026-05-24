import test from "node:test";
import assert from "node:assert/strict";

import {
  formatFeeRange,
  formatNameList,
  summarizeProviders,
} from "../../shared/seo-provider-stats.mjs";

const PROVIDERS = [
  {
    city: "Los Angeles",
    sessionFeeMin: 150,
    sessionFeeMax: 250,
    acceptingNewPatients: true,
    acceptsTelehealth: true,
    acceptsInPerson: true,
    treatmentModalities: ["CBT", "IPSRT"],
    specialties: ["Bipolar Disorder", "Anxiety"],
  },
  {
    city: "Los Angeles",
    sessionFeeMin: 200,
    sessionFeeMax: 300,
    acceptingNewPatients: false,
    acceptsTelehealth: true,
    treatmentModalities: ["CBT", "DBT"],
    specialties: ["Anxiety", "Trauma"],
  },
  {
    city: "San Diego",
    sessionFeeMin: 120,
    acceptingNewPatients: true,
    acceptsInPerson: true,
    treatmentModalities: ["IPSRT"],
    specialties: ["Mood Disorders"],
  },
];

test("summarizeProviders aggregates fees, availability, and geography from real records", function () {
  const s = summarizeProviders(PROVIDERS);
  assert.equal(s.count, 3);
  assert.equal(s.feeMin, 120);
  assert.equal(s.feeMax, 300);
  assert.equal(s.acceptingCount, 2);
  assert.equal(s.telehealthCount, 2);
  assert.equal(s.inPersonCount, 2);
  assert.equal(s.cityCount, 2);
  assert.deepEqual(s.topCities, ["Los Angeles", "San Diego"]); // LA has 2, sorts first
});

test("summarizeProviders ranks modalities by frequency and drops generic specialties", function () {
  const s = summarizeProviders(PROVIDERS);
  assert.equal(s.topModalities[0], "CBT"); // appears twice
  // "Bipolar Disorder" / "Mood Disorders" filtered out as generic.
  assert.deepEqual(s.topSpecialties.sort(), ["Anxiety", "Trauma"]);
});

test("summarizeProviders is safe on empty / missing data", function () {
  const s = summarizeProviders([]);
  assert.equal(s.count, 0);
  assert.equal(s.feeMin, null);
  assert.equal(s.acceptingCount, 0);
  assert.deepEqual(s.topCities, []);
  assert.equal(summarizeProviders(null).count, 0);
});

test("formatFeeRange renders a range, a single value, or empty", function () {
  assert.equal(formatFeeRange({ feeMin: 150, feeMax: 300 }), "$150–$300");
  assert.equal(formatFeeRange({ feeMin: 150, feeMax: 150 }), "$150");
  assert.equal(formatFeeRange({ feeMin: 150 }), "$150");
  assert.equal(formatFeeRange({ feeMin: null }), "");
  assert.equal(formatFeeRange(null), "");
});

test("formatNameList builds a grammatical, capped list", function () {
  assert.equal(formatNameList(["LA"]), "LA");
  assert.equal(formatNameList(["LA", "SD"]), "LA and SD");
  assert.equal(formatNameList(["LA", "SD", "SF"]), "LA, SD, and SF");
  assert.equal(formatNameList(["LA", "SD", "SF", "Oakland"], 3), "LA, SD, and SF");
  assert.equal(formatNameList([]), "");
});
