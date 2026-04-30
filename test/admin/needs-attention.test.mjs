import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNeedsAttentionEntries,
  parseDuplicateCounterpart,
} from "../../assets/admin-needs-attention.js";

function liveTherapist(overrides = {}) {
  return {
    id: "therapist-live-1",
    name: "Dr. Live",
    email: "live@example.com",
    license_number: "LIC-1",
    lifecycle: "approved",
    visibility_intent: "listed",
    listing_active: true,
    status: "active",
    insurance_accepted: ["Aetna"],
    bipolar_years_experience: 5,
    _updatedAt: "2026-04-29T00:00:00Z",
    ...overrides,
  };
}

test("buildNeedsAttentionEntries: a fully Live therapist is not in the queue", function () {
  const entries = buildNeedsAttentionEntries([liveTherapist()], []);
  assert.deepEqual(entries, []);
});

test("buildNeedsAttentionEntries: approved+listed but missing license is in the queue", function () {
  // Only license_number remains a hard trust-gate blocker. Both
  // insurance_accepted (demoted 2026-04-30) and bipolar_years_experience
  // (demoted 2026-04-29) are no longer required for Live status.
  const entries = buildNeedsAttentionEntries(
    [
      liveTherapist({
        id: "therapist-broken-1",
        name: "Dr. Broken",
        license_number: "",
      }),
    ],
    [],
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, "therapist-broken-1");
  assert.ok(entries[0].blockers.some((b) => b.includes("license number")));
});

test("buildNeedsAttentionEntries: missing insurance_accepted does NOT trigger queue (soft signal)", function () {
  const entries = buildNeedsAttentionEntries(
    [liveTherapist({ id: "therapist-no-ins", insurance_accepted: [] })],
    [],
  );
  assert.deepEqual(entries, []);
});

test("buildNeedsAttentionEntries: paused profile is NOT in the queue (admin intent is hidden)", function () {
  // Pause is an explicit takedown — admin intent matches reality, so it's
  // not a silent failure.
  const entries = buildNeedsAttentionEntries([liveTherapist({ lifecycle: "paused" })], []);
  assert.deepEqual(entries, []);
});

test("buildNeedsAttentionEntries: hidden visibility profile is NOT in the queue", function () {
  const entries = buildNeedsAttentionEntries([liveTherapist({ visibility_intent: "hidden" })], []);
  assert.deepEqual(entries, []);
});

test("buildNeedsAttentionEntries: oldest _updatedAt sorts first", function () {
  const newer = liveTherapist({
    id: "newer",
    licenseNumber: undefined,
    license_number: "",
    _updatedAt: "2026-04-29T00:00:00Z",
  });
  const older = liveTherapist({
    id: "older",
    license_number: "",
    _updatedAt: "2026-01-01T00:00:00Z",
  });
  const entries = buildNeedsAttentionEntries([newer, older], []);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].id, "older");
  assert.equal(entries[1].id, "newer");
});

test("buildNeedsAttentionEntries: duplicate against unconverted candidate surfaces", function () {
  const entries = buildNeedsAttentionEntries(
    [liveTherapist({ id: "therapist-x", license_number: "DUP" })],
    [{ _id: "candidate-y", license_number: "DUP", published_therapist_id: "" }],
  );
  assert.equal(entries.length, 1);
  assert.ok(entries[0].blockers.some((b) => b.includes("unconverted candidate")));
});

test("buildNeedsAttentionEntries: candidate that is already converted is not flagged as duplicate", function () {
  const entries = buildNeedsAttentionEntries(
    [liveTherapist({ id: "therapist-x", license_number: "DUP" })],
    [
      {
        _id: "candidate-converted",
        license_number: "DUP",
        published_therapist_id: "therapist-x",
      },
    ],
  );
  assert.deepEqual(entries, []);
});

test("buildNeedsAttentionEntries: candidate marked rejected_duplicate is not flagged", function () {
  const entries = buildNeedsAttentionEntries(
    [liveTherapist({ id: "therapist-x", license_number: "DUP", email: "shared@example.com" })],
    [
      {
        _id: "candidate-not-actually-dup",
        license_number: "DUP",
        email: "shared@example.com",
        dedupe_status: "rejected_duplicate",
      },
    ],
  );
  assert.deepEqual(entries, []);
});

test("parseDuplicateCounterpart: extracts candidate id and kind", function () {
  const result = parseDuplicateCounterpart([
    "Missing insurance accepted",
    "Duplicate detected: an unconverted candidate (therapist-candidate-foo) shares this license number",
  ]);
  assert.deepEqual(result, { id: "therapist-candidate-foo", kind: "candidate" });
});

test("parseDuplicateCounterpart: extracts therapist id and kind", function () {
  const result = parseDuplicateCounterpart([
    "Duplicate detected: another therapist (therapist-bar) shares this email address",
  ]);
  assert.deepEqual(result, { id: "therapist-bar", kind: "therapist" });
});

test("parseDuplicateCounterpart: returns null when no duplicate blocker", function () {
  assert.equal(parseDuplicateCounterpart(["Missing insurance accepted"]), null);
  assert.equal(parseDuplicateCounterpart([]), null);
  assert.equal(parseDuplicateCounterpart(null), null);
});
