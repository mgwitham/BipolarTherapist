import test from "node:test";
import assert from "node:assert/strict";

import { stripNameHonorifics } from "../../scripts/discover-therapist-candidates.mjs";

test("stripNameHonorifics removes Dr./Doctor/Prof./Mr./Mrs./Ms./Mx./Miss at start", () => {
  assert.equal(stripNameHonorifics("Dr. John Connor Barnhart"), "John Connor Barnhart");
  assert.equal(stripNameHonorifics("Doctor Jane Doe"), "Jane Doe");
  assert.equal(stripNameHonorifics("Prof. Alex Rivera"), "Alex Rivera");
  assert.equal(stripNameHonorifics("Mr. James Smith"), "James Smith");
  assert.equal(stripNameHonorifics("Mrs. Emily Brown"), "Emily Brown");
  assert.equal(stripNameHonorifics("Ms. Patricia Lee"), "Patricia Lee");
  assert.equal(stripNameHonorifics("Mx. Sam Taylor"), "Sam Taylor");
});

test("stripNameHonorifics handles missing period and extra whitespace", () => {
  assert.equal(stripNameHonorifics("Dr  John  Doe"), "John Doe");
  assert.equal(stripNameHonorifics("  Dr. Jane  "), "Jane");
});

test("stripNameHonorifics collapses stacked honorifics at the start", () => {
  assert.equal(stripNameHonorifics("Dr. Prof. Jane Doe"), "Jane Doe");
});

test("stripNameHonorifics leaves mid-name tokens alone", () => {
  // "Dr" inside the name stays put — only leading honorifics are stripped.
  assert.equal(stripNameHonorifics("Jane Dr. Doe"), "Jane Dr. Doe");
});

test("stripNameHonorifics is a no-op on clean names", () => {
  assert.equal(stripNameHonorifics("Peter Forster"), "Peter Forster");
  assert.equal(stripNameHonorifics("J Connor Barnhart"), "J Connor Barnhart");
});

test("stripNameHonorifics returns empty on empty-ish input", () => {
  assert.equal(stripNameHonorifics(""), "");
  assert.equal(stripNameHonorifics(null), "");
  assert.equal(stripNameHonorifics(undefined), "");
});
