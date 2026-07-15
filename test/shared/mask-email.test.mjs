import { test } from "node:test";
import assert from "node:assert/strict";

import { maskEmail } from "../../shared/mask-email.mjs";

test("masks local part and domain, keeps TLD", () => {
  assert.equal(maskEmail("jane.doe@gmail.com"), "j***@g***.com");
  assert.equal(maskEmail("a@practice.co.uk"), "a***@p***.uk");
});

test("empty or missing input → empty string", () => {
  assert.equal(maskEmail(""), "");
  assert.equal(maskEmail("   "), "");
  assert.equal(maskEmail(null), "");
  assert.equal(maskEmail(undefined), "");
});

test("no @ or @ at position 0 → first char + stars", () => {
  assert.equal(maskEmail("not-an-email"), "n***");
  assert.equal(maskEmail("@nodomain.com"), "@***");
});

test("domain without dot still masks", () => {
  assert.equal(maskEmail("x@localhost"), "x***@l***");
});

test("trims surrounding whitespace before masking", () => {
  assert.equal(maskEmail("  jane@site.org  "), "j***@s***.org");
});
