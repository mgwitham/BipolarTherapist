import assert from "node:assert/strict";
import test from "node:test";

import { formatPhoneUS } from "../../shared/phone-format.mjs";

test("formatPhoneUS: handles already-formatted input idempotently", () => {
  assert.equal(formatPhoneUS("(310) 555-1234"), "(310) 555-1234");
});

test("formatPhoneUS: dashed format → canonical", () => {
  assert.equal(formatPhoneUS("310-555-1234"), "(310) 555-1234");
  assert.equal(formatPhoneUS("916-295-1819"), "(916) 295-1819");
});

test("formatPhoneUS: dotted format → canonical", () => {
  assert.equal(formatPhoneUS("310.555.1234"), "(310) 555-1234");
});

test("formatPhoneUS: bare 10-digit → canonical", () => {
  assert.equal(formatPhoneUS("3105551234"), "(310) 555-1234");
  assert.equal(formatPhoneUS("7079744982"), "(707) 974-4982");
});

test("formatPhoneUS: E.164 (+1...) → canonical", () => {
  assert.equal(formatPhoneUS("+13105551234"), "(310) 555-1234");
  assert.equal(formatPhoneUS("+14159368152"), "(415) 936-8152");
});

test("formatPhoneUS: leading 1 without + → canonical", () => {
  assert.equal(formatPhoneUS("13105551234"), "(310) 555-1234");
});

test("formatPhoneUS: spaces are tolerated", () => {
  assert.equal(formatPhoneUS("310 555 1234"), "(310) 555-1234");
  assert.equal(formatPhoneUS(" 310 555 1234 "), "(310) 555-1234");
});

test("formatPhoneUS: empty/null/undefined returns empty string", () => {
  assert.equal(formatPhoneUS(""), "");
  assert.equal(formatPhoneUS(null), "");
  assert.equal(formatPhoneUS(undefined), "");
  assert.equal(formatPhoneUS("   "), "");
});

test("formatPhoneUS: non-10-digit input is passed through (don't corrupt edge data)", () => {
  // International number — pass through; human will fix.
  assert.equal(formatPhoneUS("+44 20 7946 0958"), "+44 20 7946 0958");
  // Too few digits — pass through.
  assert.equal(formatPhoneUS("555-1234"), "555-1234");
  // Extension-style entry — pass through.
  assert.equal(formatPhoneUS("(310) 555-1234 x42"), "(310) 555-1234 x42");
});
