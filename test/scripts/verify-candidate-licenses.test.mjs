import test from "node:test";
import assert from "node:assert/strict";

import { normalizeLicense } from "../../scripts/verify-candidate-licenses.mjs";

test("normalizeLicense strips professional prefixes and non-alphanumeric", () => {
  assert.equal(normalizeLicense("PSY 28456"), "28456");
  assert.equal(normalizeLicense("LMFT 121234"), "121234");
  assert.equal(normalizeLicense("MD A180630"), "A180630");
  // "PSY" is the registered license prefix (from the DCA taxonomy list);
  // "PsyD" in "PsyD 9327" is a credential string not a license prefix, so
  // it's preserved as the letter part after non-alphanumeric stripping.
  assert.equal(normalizeLicense("PSY 9327"), "9327");
  assert.equal(normalizeLicense("  PsyD   9327  "), "PSYD9327");
});

test("normalizeLicense strips leading zeros on the numeric tail", () => {
  // Physician license form that bit us in the SF run: seed said G58999,
  // DCA returned G058999 — both should normalize to the same value.
  assert.equal(normalizeLicense("G58999"), normalizeLicense("G058999"));
  assert.equal(normalizeLicense("G58999"), "G58999");
  assert.equal(normalizeLicense("A0180630"), normalizeLicense("A180630"));
});

test("normalizeLicense tolerates whitespace, case, and punctuation", () => {
  assert.equal(normalizeLicense(" g 0 58999 "), normalizeLicense("G58999"));
  assert.equal(normalizeLicense("psy 9,327"), normalizeLicense("PSY 9327"));
});

test("normalizeLicense returns empty for empty-ish input", () => {
  assert.equal(normalizeLicense(""), "");
  assert.equal(normalizeLicense(null), "");
  assert.equal(normalizeLicense(undefined), "");
});

test("normalizeLicense preserves all-numeric licenses unchanged apart from leading zeros", () => {
  assert.equal(normalizeLicense("0012345"), "12345");
  assert.equal(normalizeLicense("12345"), "12345");
});
