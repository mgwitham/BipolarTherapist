import { test } from "node:test";
import assert from "node:assert/strict";

import {
  findSuppressionEntry,
  normalizeSuppressionEmail,
} from "../../shared/outreach-suppression-domain.mjs";

test("normalizeSuppressionEmail lowercases and trims", () => {
  assert.equal(
    normalizeSuppressionEmail("  Eli.Reding@GroundedTherapy.org \n"),
    "eli.reding@groundedtherapy.org",
  );
});

test("normalizeSuppressionEmail handles null/undefined/non-strings", () => {
  assert.equal(normalizeSuppressionEmail(null), "");
  assert.equal(normalizeSuppressionEmail(undefined), "");
  assert.equal(normalizeSuppressionEmail(0), "0");
});

const ENTRIES = [
  {
    email: "eli.reding@groundedtherapy.org",
    reason: "replied STOP to outreach",
    date: "2026-06-12",
  },
];

test("findSuppressionEntry matches exact address", () => {
  const entry = findSuppressionEntry(ENTRIES, "eli.reding@groundedtherapy.org");
  assert.ok(entry);
  assert.equal(entry.reason, "replied STOP to outreach");
});

test("findSuppressionEntry matches despite casing and whitespace", () => {
  assert.ok(findSuppressionEntry(ENTRIES, "  ELI.REDING@GroundedTherapy.ORG  "));
});

test("findSuppressionEntry matches when the list entry itself has casing drift", () => {
  const drifted = [{ email: " Eli.Reding@GroundedTherapy.org " }];
  assert.ok(findSuppressionEntry(drifted, "eli.reding@groundedtherapy.org"));
});

test("findSuppressionEntry returns null for non-suppressed addresses", () => {
  assert.equal(findSuppressionEntry(ENTRIES, "someone.else@example.com"), null);
});

test("findSuppressionEntry returns null for empty input and malformed lists", () => {
  assert.equal(findSuppressionEntry(ENTRIES, ""), null);
  assert.equal(findSuppressionEntry(ENTRIES, null), null);
  assert.equal(findSuppressionEntry(null, "eli.reding@groundedtherapy.org"), null);
  assert.equal(findSuppressionEntry([null, {}], "eli.reding@groundedtherapy.org"), null);
});
