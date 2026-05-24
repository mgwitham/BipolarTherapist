import test from "node:test";
import assert from "node:assert/strict";

import {
  getCompareCostLabel,
  getCompareFreshness,
  getCompareRole,
  getCompareTimingLabel,
  getCompareTrustLabel,
  renderCompareValue,
  shortlistRowDiffers,
} from "../../assets/match-compare.js";

test("renderCompareValue handles order chips, formats, booleans, and lists", function () {
  assert.match(renderCompareValue("#1 Best match", "order"), /compare-chip-positive/);
  assert.match(renderCompareValue("#2 match", "order"), /compare-chip-neutral/);
  assert.match(renderCompareValue(["Telehealth", "In-person"], "format"), /compare-format-item/);
  assert.match(renderCompareValue([], "format"), /Not listed/);
  assert.equal(renderCompareValue(true, "boolean"), "Available");
  assert.match(renderCompareValue(false, "boolean"), /Not listed/);
  assert.equal(renderCompareValue(true), "Yes");
  assert.equal(renderCompareValue(false), "No");
  assert.match(renderCompareValue("", null), /Not listed/);
});

test("renderCompareValue escapes untrusted strings", function () {
  assert.equal(renderCompareValue("<script>x</script>"), "&lt;script&gt;x&lt;/script&gt;");
});

test("getCompareCostLabel formats ranges, single values, and sliding scale", function () {
  assert.equal(getCompareCostLabel({ session_fee_min: 150, session_fee_max: 200 }), "$150–$200");
  assert.equal(getCompareCostLabel({ session_fee_min: 150, session_fee_max: 150 }), "$150");
  assert.equal(getCompareCostLabel({ session_fee_min: 150 }), "$150");
  assert.equal(getCompareCostLabel({ session_fee_max: 200 }), "Up to $200");
  assert.equal(getCompareCostLabel({ sliding_scale: true }), "Sliding scale available");
  assert.equal(getCompareCostLabel({}), "");
  assert.equal(getCompareCostLabel(null), "");
});

test("getCompareTimingLabel prefers explicit wait time then accepting status", function () {
  assert.equal(getCompareTimingLabel({ estimated_wait_time: "1-2 weeks" }), "1-2 weeks");
  assert.equal(
    getCompareTimingLabel({ accepting_new_patients: true }),
    "Appears to be accepting new patients",
  );
  assert.equal(getCompareTimingLabel({}), "");
  assert.equal(getCompareTimingLabel(null), "");
});

test("getCompareTrustLabel surfaces experience, verification, then a partial fallback", function () {
  assert.equal(
    getCompareTrustLabel({ therapist: { bipolar_years_experience: 8 } }),
    "8 years with bipolar-related care",
  );
  assert.equal(
    getCompareTrustLabel({ therapist: { verification_status: "editorially_verified" } }),
    "Editorially verified profile",
  );
  assert.equal(getCompareTrustLabel({ therapist: {} }), "Trust details still partial");
  assert.equal(getCompareTrustLabel(null), "");
});

test("getCompareRole labels the top entry distinctly", function () {
  assert.equal(getCompareRole({}, 0), "#1 Best match");
  assert.equal(getCompareRole({}, 2), "#3 match");
});

test("getCompareFreshness returns null when there is no therapist", function () {
  assert.equal(getCompareFreshness(null), null);
  assert.equal(getCompareFreshness({}), null);
});

test("shortlistRowDiffers normalizes arrays/booleans before comparing", function () {
  const entries = [
    { therapist: { insurance: ["Aetna", "BCBS"], med: true } },
    { therapist: { insurance: ["BCBS", "Aetna"], med: false } },
  ];
  const insuranceRow = { getValue: (t) => t.insurance };
  const medRow = { getValue: (t) => t.med };

  assert.equal(shortlistRowDiffers(insuranceRow, entries), false);
  assert.equal(shortlistRowDiffers(medRow, entries), true);
});
