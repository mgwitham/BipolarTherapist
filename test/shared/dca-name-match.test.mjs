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

test("credential-lookalike surnames are kept (Ma, Do)", () => {
  // The SUFFIX stripper used to eat a trailing "Ma"/"Do" as a credential
  // (MA, DO), leaving one token and falsely rejecting the applicant.
  // Stripping now stops when fewer than first + last name would remain.
  assert.equal(applicantNameMatchesDcaLicensee("Wei Ma", dca("Wei", "Ma")), true);
  assert.equal(applicantNameMatchesDcaLicensee("John Do", dca("John", "Do")), true);
});

test("credential-lookalike surname with a real credential after it", () => {
  // ", MA" strips (three tokens remain two), then the surname "Do"
  // survives because stripping it would leave a single token.
  assert.equal(applicantNameMatchesDcaLicensee("Jane Do, MA", dca("Jane", "Do")), true);
});

test("real credentials still strip when a full name remains", () => {
  assert.equal(applicantNameMatchesDcaLicensee("Jane Doe MA", dca("Jane", "Doe")), true);
  assert.equal(applicantNameMatchesDcaLicensee("Jane Doe, PhD, LMFT", dca("Jane", "Doe")), true);
});
