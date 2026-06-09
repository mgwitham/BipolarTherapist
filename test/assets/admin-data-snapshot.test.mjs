import assert from "node:assert/strict";
import test from "node:test";

import { loadRemoteAdminSnapshot } from "../../assets/admin-data.js";

// Regression for the admin operational-blindness bug: snapshot fetch
// failures used to be silently converted to null, so a down Review API
// rendered as an empty (looks-done) dashboard. The loader must keep the
// per-section null degradation but report which sections failed.

function workingDependencies() {
  return {
    fetchTherapistApplications: async () => [{ _id: "application-1" }],
    fetchTherapistCandidates: async () => [{ _id: "candidate-1" }],
    fetchTherapistPortalRequests: async () => [{ _id: "portal-request-1" }],
    fetchReviewEvents: async () => ({ items: [{ _id: "event-1" }] }),
    fetchTherapistReviewers: async () => [{ _id: "reviewer-1" }],
    fetchAdminSession: async () => ({ username: "architect" }),
    fetchPublicTherapists: async () => [{ slug: "dr-a" }],
  };
}

test("a fully successful snapshot reports no fetch failures", async () => {
  const snapshot = await loadRemoteAdminSnapshot(workingDependencies());
  assert.deepEqual(snapshot.fetchFailures, []);
  assert.equal(snapshot.applications.length, 1);
  assert.equal(snapshot.reviewEvents.length, 1);
  assert.equal(snapshot.reviewers.length, 1);
});

test("a failed section degrades to null AND is reported by name with its message", async () => {
  const dependencies = workingDependencies();
  dependencies.fetchTherapistApplications = async () => {
    throw new Error("HTTP 503 from review API");
  };
  dependencies.fetchPublicTherapists = async () => {
    throw new Error("network down");
  };

  const snapshot = await loadRemoteAdminSnapshot(dependencies);

  assert.equal(snapshot.applications, null);
  assert.equal(snapshot.therapists, null);
  // Unaffected sections still load.
  assert.equal(snapshot.candidates.length, 1);

  assert.deepEqual(snapshot.fetchFailures.map((failure) => failure.name).sort(), [
    "applications",
    "therapists",
  ]);
  const applicationFailure = snapshot.fetchFailures.find((f) => f.name === "applications");
  assert.equal(applicationFailure.message, "HTTP 503 from review API");
});

test("a rejection without an Error message still produces a readable failure entry", async () => {
  const dependencies = workingDependencies();
  dependencies.fetchTherapistReviewers = () => Promise.reject("boom");

  const snapshot = await loadRemoteAdminSnapshot(dependencies);
  assert.deepEqual(snapshot.reviewers, []);
  assert.deepEqual(snapshot.fetchFailures, [{ name: "reviewers", message: "Request failed." }]);
});

test("all seven sections failing reports all seven names (the API-down case)", async () => {
  const fail = async () => {
    throw new Error("ECONNREFUSED");
  };
  const snapshot = await loadRemoteAdminSnapshot({
    fetchTherapistApplications: fail,
    fetchTherapistCandidates: fail,
    fetchTherapistPortalRequests: fail,
    fetchReviewEvents: fail,
    fetchTherapistReviewers: fail,
    fetchAdminSession: fail,
    fetchPublicTherapists: fail,
  });
  assert.equal(snapshot.fetchFailures.length, 7);
  assert.deepEqual(snapshot.fetchFailures.map((failure) => failure.name).sort(), [
    "applications",
    "candidates",
    "portal requests",
    "review events",
    "reviewers",
    "session",
    "therapists",
  ]);
});
