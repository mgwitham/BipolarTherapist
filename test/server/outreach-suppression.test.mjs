// Regression guard for the committed suppression list: these tests read
// the real data/suppression.json, so removing or renaming an entry that
// must stay suppressed (a STOP reply is a permanent legal opt-out) fails
// the suite.

import { test } from "node:test";
import assert from "node:assert/strict";

import { getSuppressionEntry, loadSuppressionEntries } from "../../server/outreach-suppression.mjs";

test("data/suppression.json loads and has the expected shape", () => {
  const entries = loadSuppressionEntries();
  assert.ok(Array.isArray(entries));
  for (const entry of entries) {
    assert.equal(typeof entry.email, "string");
    assert.ok(entry.email.includes("@"));
  }
});

test("eli.reding@groundedtherapy.org is permanently suppressed", () => {
  const entry = getSuppressionEntry("eli.reding@groundedtherapy.org");
  assert.ok(entry, "Eli Reding replied STOP — this entry must never be removed");
  assert.equal(entry.reason, "replied STOP to outreach");
  assert.equal(entry.date, "2026-06-12");
});

test("suppression matching survives casing and whitespace drift", () => {
  assert.ok(getSuppressionEntry("  Eli.Reding@GroundedTherapy.ORG  "));
  assert.ok(getSuppressionEntry("ELI.REDING@GROUNDEDTHERAPY.ORG\n"));
});

test("non-suppressed addresses are not blocked", () => {
  assert.equal(getSuppressionEntry("not.suppressed@example.com"), null);
});
