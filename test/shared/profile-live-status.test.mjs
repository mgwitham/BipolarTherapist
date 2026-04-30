import assert from "node:assert/strict";
import test from "node:test";

import { isProfileLive, isLive } from "../../shared/profile-live-status.mjs";

function approvedDoc(overrides = {}) {
  return {
    _id: "therapist-jane-doe-la-ca",
    lifecycle: "approved",
    visibilityIntent: "listed",
    listingActive: true,
    status: "active",
    licenseNumber: "12345",
    insuranceAccepted: ["Aetna"],
    bipolarYearsExperience: 5,
    email: "jane@example.com",
    ...overrides,
  };
}

test("isProfileLive: approved/listed doc with all trust fields is Live", function () {
  const result = isProfileLive(approvedDoc());
  assert.equal(result.isLive, true);
  assert.deepEqual(result.blockers, []);
});

test("isProfileLive: missing lifecycle blocks Live", function () {
  const result = isProfileLive(approvedDoc({ lifecycle: "paused" }));
  assert.equal(result.isLive, false);
  assert.ok(result.blockers.some((b) => b.includes('Lifecycle is "paused"')));
});

test("isProfileLive: visibility hidden blocks Live", function () {
  const result = isProfileLive(approvedDoc({ visibilityIntent: "hidden" }));
  assert.equal(result.isLive, false);
  assert.ok(result.blockers.some((b) => b.includes("Visibility intent")));
});

test("isProfileLive: drafts.* id blocks Live", function () {
  const result = isProfileLive(approvedDoc({ _id: "drafts.therapist-jane-doe-la-ca" }));
  assert.equal(result.isLive, false);
  assert.ok(result.blockers.some((b) => b.includes("Sanity draft")));
});

test("isProfileLive: missing license number is a trust-gate blocker", function () {
  const result = isProfileLive(approvedDoc({ licenseNumber: "" }));
  assert.equal(result.isLive, false);
  assert.ok(result.blockers.some((b) => b.includes("license number")));
});

test("isProfileLive: missing insurance is a trust-gate blocker", function () {
  const result = isProfileLive(approvedDoc({ insuranceAccepted: [] }));
  assert.equal(result.isLive, false);
  assert.ok(result.blockers.some((b) => b.includes("insurance")));
});

test("isProfileLive: missing bipolar years experience is a trust-gate blocker", function () {
  const result = isProfileLive(approvedDoc({ bipolarYearsExperience: null }));
  assert.equal(result.isLive, false);
  assert.ok(result.blockers.some((b) => b.includes("bipolar years")));
});

test("isProfileLive: snake_case shape from fetchPublicTherapists is recognized", function () {
  const result = isProfileLive({
    id: "therapist-1",
    lifecycle: "approved",
    visibility_intent: "listed",
    listing_active: true,
    status: "active",
    license_number: "12345",
    insurance_accepted: ["Aetna"],
    bipolar_years_experience: 5,
  });
  assert.equal(result.isLive, true);
});

test("isProfileLive: duplicate license against another therapist blocks Live", function () {
  const result = isProfileLive(approvedDoc({ licenseNumber: "DUP-1" }), {
    otherTherapists: [{ _id: "therapist-other", licenseNumber: "DUP-1" }],
  });
  assert.equal(result.isLive, false);
  assert.ok(result.blockers.some((b) => b.includes("another therapist")));
});

test("isProfileLive: duplicate license against same id is ignored", function () {
  const doc = approvedDoc({ licenseNumber: "OK-1" });
  const result = isProfileLive(doc, {
    otherTherapists: [{ _id: doc._id, licenseNumber: "OK-1" }],
  });
  assert.equal(result.isLive, true);
});

test("isProfileLive: duplicate against an unconverted candidate blocks Live", function () {
  const result = isProfileLive(approvedDoc({ email: "shared@example.com" }), {
    unconvertedCandidates: [{ _id: "candidate-other", email: "shared@example.com" }],
  });
  assert.equal(result.isLive, false);
  assert.ok(result.blockers.some((b) => b.includes("unconverted candidate")));
});

test("isProfileLive: acceptingNewPatients=false does NOT block Live", function () {
  // The matching model treats this as a hard constraint, but Live status is
  // explicitly decoupled from that until the matching-model behavior is
  // settled as a separate product decision.
  const result = isProfileLive(approvedDoc({ acceptingNewPatients: false }));
  assert.equal(result.isLive, true);
});

test("isLive: convenience helper returns boolean only", function () {
  assert.equal(isLive(approvedDoc()), true);
  assert.equal(isLive(approvedDoc({ status: "draft" })), false);
});

test("isProfileLive: null doc returns clear blocker", function () {
  const result = isProfileLive(null);
  assert.equal(result.isLive, false);
  assert.deepEqual(result.blockers, ["No profile data"]);
});
