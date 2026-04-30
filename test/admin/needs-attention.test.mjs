import assert from "node:assert/strict";
import test from "node:test";

import { buildNeedsAttentionEntries } from "../../assets/admin-needs-attention.js";

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

test("buildNeedsAttentionEntries: approved+listed but missing trust field is in the queue", function () {
  // Trust-gate blocker: missing insurance_accepted. (bipolar_years_experience
  // was demoted from required to soft on 2026-04-29 and no longer triggers.)
  const entries = buildNeedsAttentionEntries(
    [
      liveTherapist({
        id: "therapist-broken-1",
        name: "Dr. Broken",
        insurance_accepted: [],
      }),
    ],
    [],
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, "therapist-broken-1");
  assert.ok(entries[0].blockers.some((b) => b.includes("insurance")));
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
