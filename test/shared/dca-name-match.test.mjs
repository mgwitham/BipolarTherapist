import { test } from "node:test";
import assert from "node:assert/strict";

import { applicantNameMatchesDcaLicensee } from "../../shared/dca-name-match.mjs";

const dca = (firstName, lastName) => ({ firstName, lastName });

test("exact match passes", () => {
  assert.equal(applicantNameMatchesDcaLicensee("Jane Doe", dca("Jane", "Doe")), true);
});

test("case, punctuation, and spacing are ignored", () => {
  assert.equal(applicantNameMatchesDcaLicensee("JANE   DOE", dca("jane", "doe")), true);
  assert.equal(applicantNameMatchesDcaLicensee("Jane O'Brien", dca("JANE", "OBRIEN")), true);
  assert.equal(
    applicantNameMatchesDcaLicensee("Ana-Maria Lopez-Garcia", dca("Ana Maria", "LopezGarcia")),
    true,
  );
});

test("nickname variants pass (2-char prefix or containment)", () => {
  assert.equal(applicantNameMatchesDcaLicensee("Mike Smith", dca("Michael", "Smith")), true);
  assert.equal(applicantNameMatchesDcaLicensee("Michael Smith", dca("Mike", "Smith")), true);
  assert.equal(applicantNameMatchesDcaLicensee("Liz Taylor", dca("Elizabeth", "Taylor")), true); // containment
});

test("different last name fails, even with same first", () => {
  assert.equal(applicantNameMatchesDcaLicensee("Jane Doe", dca("Jane", "Smith")), false);
});

test("unrelated first name with matching last fails", () => {
  assert.equal(applicantNameMatchesDcaLicensee("Robert Smith", dca("Michael", "Smith")), false);
});

test("honorifics and credential suffixes are stripped", () => {
  assert.equal(applicantNameMatchesDcaLicensee("Dr. Jane Doe", dca("Jane", "Doe")), true);
  assert.equal(applicantNameMatchesDcaLicensee("Jane Doe, PhD", dca("Jane", "Doe")), true);
  assert.equal(applicantNameMatchesDcaLicensee("Dr. Jane Doe, LMFT", dca("Jane", "Doe")), true);
  assert.equal(
    applicantNameMatchesDcaLicensee("Ms. Jane Doe, PsyD, LMFT", dca("Jane", "Doe")),
    true,
  );
});

test("middle names are tolerated", () => {
  assert.equal(applicantNameMatchesDcaLicensee("Jane Marie Doe", dca("Jane", "Doe")), true);
});

test("single-token names fail (cannot verify)", () => {
  assert.equal(applicantNameMatchesDcaLicensee("Jane", dca("Jane", "Doe")), false);
  assert.equal(applicantNameMatchesDcaLicensee("Dr. Jane, PhD", dca("Jane", "Doe")), false);
});

test("missing inputs fail closed", () => {
  assert.equal(applicantNameMatchesDcaLicensee("", dca("Jane", "Doe")), false);
  assert.equal(applicantNameMatchesDcaLicensee(null, dca("Jane", "Doe")), false);
  assert.equal(applicantNameMatchesDcaLicensee("Jane Doe", null), false);
  assert.equal(applicantNameMatchesDcaLicensee("Jane Doe", dca("", "")), false);
  assert.equal(applicantNameMatchesDcaLicensee("Jane Doe", dca("Jane", "")), false);
});

test("impersonation scenario: colleague's license, own name → rejected", () => {
  // Applicant "Sarah Chen" submits license belonging to "Amanda Rodriguez"
  assert.equal(applicantNameMatchesDcaLicensee("Sarah Chen", dca("Amanda", "Rodriguez")), false);
});

test("1-char first names only match exactly", () => {
  // Prefix rule requires >= 2 chars; "J" vs "Jane" must fail
  assert.equal(applicantNameMatchesDcaLicensee("J Doe", dca("Jane", "Doe")), false);
  assert.equal(applicantNameMatchesDcaLicensee("J Doe", dca("J", "Doe")), true);
});

test("KNOWN LIMITATION: credential-lookalike surnames are falsely rejected", () => {
  // The SUFFIX stripper treats a trailing "Ma"/"Do" as a credential
  // (MA, DO) and eats the real surname, leaving one token → reject.
  // These asserts document CURRENT behavior, not desired behavior —
  // fixing this is a deliberate follow-up, not a refactor side effect.
  assert.equal(applicantNameMatchesDcaLicensee("Wei Ma", dca("Wei", "Ma")), false);
  assert.equal(applicantNameMatchesDcaLicensee("John Do", dca("John", "Do")), false);
});
