import test from "node:test";
import assert from "node:assert/strict";

import { summarizeUnmetDemand } from "../../shared/unmet-demand-domain.mjs";

test("summarizeUnmetDemand ranks zero-result criteria by frequency with percentages", function () {
  const rows = [
    {
      careIntent: "psychiatry",
      careFormat: "telehealth",
      insurancePreference: "Aetna",
      bipolarFocus: ["bipolar_i"],
    },
    {
      careIntent: "psychiatry",
      careFormat: "in_person",
      insurancePreference: "Aetna",
      bipolarFocus: ["bipolar_i", "psychosis"],
    },
    {
      careIntent: "therapy",
      careFormat: "telehealth",
      insurancePreference: "Kaiser",
      bipolarFocus: [],
    },
  ];

  const out = summarizeUnmetDemand(rows);

  assert.equal(out.total, 3);
  // Psychiatry is the dominant unmet intent (2 of 3 = 67%).
  assert.deepEqual(out.byIntent[0], { value: "psychiatry", count: 2, pct: 67 });
  // Aetna is the top unmet insurance.
  assert.deepEqual(out.byInsurance[0], { value: "Aetna", count: 2, pct: 67 });
  // Array fields (focus) tally each member; bipolar_i appears twice.
  assert.equal(out.byFocus[0].value, "bipolar_i");
  assert.equal(out.byFocus[0].count, 2);
});

test("summarizeUnmetDemand ignores blank/missing values and tolerates non-arrays", function () {
  const out = summarizeUnmetDemand([
    { careIntent: "", insurancePreference: "  ", bipolarFocus: null },
    { careIntent: "therapy" },
  ]);

  assert.equal(out.total, 2);
  assert.deepEqual(out.byIntent, [{ value: "therapy", count: 1, pct: 50 }]);
  assert.deepEqual(out.byInsurance, []);
  assert.deepEqual(out.byFocus, []);
});

test("summarizeUnmetDemand returns empty shape for no input", function () {
  const out = summarizeUnmetDemand(undefined);
  assert.deepEqual(out, {
    total: 0,
    byIntent: [],
    byFormat: [],
    byInsurance: [],
    byUrgency: [],
    byFocus: [],
  });
});
