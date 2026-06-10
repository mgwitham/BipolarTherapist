import assert from "node:assert/strict";
import test from "node:test";

import { createReviewApiHandler } from "../../server/review-handler.mjs";
import { ADMIN_SESSION_COOKIE } from "../../server/review-http-auth.mjs";
import {
  createMemoryClient,
  createTestApiConfig,
  readSetCookieHeader,
  runHandlerRequest,
} from "./test-helpers.mjs";

// Regression tests for the double-approve / double-publish data-loss race:
// both endpoints rebuild the therapist doc via createOrReplace, so a second
// invocation (stale admin tab, double-click, concurrent reviewers) used to
// silently overwrite any edits made to the live profile since the first.
// They must now refuse with 409 instead.

async function loginAsAdmin(handler) {
  const response = await runHandlerRequest(handler, {
    body: {
      username: "architect",
      password: "secret-pass",
    },
    headers: {
      host: "localhost:8787",
    },
    method: "POST",
    url: "/auth/login",
  });

  assert.equal(response.statusCode, 200);
  const cookie = readSetCookieHeader(response, ADMIN_SESSION_COOKIE);
  assert.ok(cookie);
  return cookie;
}

function pendingApplication(id) {
  return {
    _id: id,
    _type: "therapistApplication",
    name: "Dr. Robin Vale",
    credentials: "LMFT",
    email: "robin@example.com",
    city: "Sacramento",
    state: "CA",
    licenseState: "CA",
    licenseNumber: "LMFT55555",
    bio: "Bipolar-focused therapy.",
    specialties: ["Bipolar disorder"],
    status: "pending",
  };
}

function queuedCandidate(id) {
  return {
    _id: id,
    _type: "therapistCandidate",
    name: "Dr. Casey North",
    credentials: "LCSW",
    city: "Seattle",
    state: "WA",
    licenseState: "WA",
    licenseNumber: "LCSW98765",
    sourceUrl: "https://example.com/casey",
    specialties: ["Bipolar disorder"],
    reviewStatus: "queued",
    publishRecommendation: "",
    dedupeStatus: "unreviewed",
    licensureVerification: {
      verifiedAt: "2026-04-08T00:00:00.000Z",
      statusStanding: "clear",
    },
  };
}

test("approving an already-approved application returns 409 and preserves live-profile edits", async function () {
  const { client, state } = createMemoryClient({
    "application-double-approve": pendingApplication("application-double-approve"),
  });
  const handler = createReviewApiHandler(createTestApiConfig(), client);
  const sessionToken = await loginAsAdmin(handler);
  const adminHeaders = { cookie: sessionToken, host: "localhost:8787" };

  const firstApprove = await runHandlerRequest(handler, {
    body: {},
    headers: adminHeaders,
    method: "POST",
    url: "/applications/application-double-approve/approve",
  });
  assert.equal(firstApprove.statusCode, 200);
  const therapistId = firstApprove.payload.therapistId;
  assert.ok(therapistId);

  // Simulate a portal edit landing after approval — exactly the data a
  // second approve used to wipe by rebuilding the doc from the application.
  const therapist = state.documents.get(therapistId);
  therapist.bio = "Updated by the therapist via the portal.";

  const secondApprove = await runHandlerRequest(handler, {
    body: {},
    headers: adminHeaders,
    method: "POST",
    url: "/applications/application-double-approve/approve",
  });
  assert.equal(secondApprove.statusCode, 409);
  assert.match(secondApprove.payload.error, /already approved/i);
  assert.equal(secondApprove.payload.therapistId, therapistId);

  assert.equal(
    state.documents.get(therapistId).bio,
    "Updated by the therapist via the portal.",
    "second approve must not rebuild the therapist doc",
  );
});

test("a rejected application can still be approved (the guard only blocks approved status)", async function () {
  const { client, state } = createMemoryClient({
    "application-reapprove": pendingApplication("application-reapprove"),
  });
  const handler = createReviewApiHandler(createTestApiConfig(), client);
  const sessionToken = await loginAsAdmin(handler);
  const adminHeaders = { cookie: sessionToken, host: "localhost:8787" };

  const rejectResponse = await runHandlerRequest(handler, {
    body: {},
    headers: adminHeaders,
    method: "POST",
    url: "/applications/application-reapprove/reject",
  });
  assert.equal(rejectResponse.statusCode, 200);
  assert.equal(state.documents.get("application-reapprove").status, "rejected");

  const approveResponse = await runHandlerRequest(handler, {
    body: {},
    headers: adminHeaders,
    method: "POST",
    url: "/applications/application-reapprove/approve",
  });
  assert.equal(approveResponse.statusCode, 200);
  assert.equal(state.documents.get("application-reapprove").status, "approved");
});

test("publishing an already-published candidate returns 409 and preserves live-profile edits", async function () {
  const { client, state } = createMemoryClient({
    "candidate-double-publish": queuedCandidate("candidate-double-publish"),
  });
  const handler = createReviewApiHandler(createTestApiConfig(), client);
  const sessionToken = await loginAsAdmin(handler);
  const adminHeaders = { cookie: sessionToken, host: "localhost:8787" };

  const firstPublish = await runHandlerRequest(handler, {
    body: { decision: "publish" },
    headers: adminHeaders,
    method: "POST",
    url: "/candidates/candidate-double-publish/decision",
  });
  assert.equal(firstPublish.statusCode, 200);
  const therapistId = firstPublish.payload.therapistId;
  assert.ok(therapistId);
  assert.equal(state.documents.get("candidate-double-publish").publishedTherapistId, therapistId);

  const therapist = state.documents.get(therapistId);
  therapist.careApproach = "Updated by the therapist via the portal.";

  const secondPublish = await runHandlerRequest(handler, {
    body: { decision: "publish" },
    headers: adminHeaders,
    method: "POST",
    url: "/candidates/candidate-double-publish/decision",
  });
  assert.equal(secondPublish.statusCode, 409);
  assert.match(secondPublish.payload.error, /already published/i);
  assert.equal(secondPublish.payload.therapistId, therapistId);

  assert.equal(
    state.documents.get(therapistId).careApproach,
    "Updated by the therapist via the portal.",
    "second publish must not rebuild the therapist doc",
  );
});

test("a merged candidate cannot be re-published over the merge target", async function () {
  const { client } = createMemoryClient({
    "candidate-merged": {
      ...queuedCandidate("candidate-merged"),
      reviewStatus: "archived",
      dedupeStatus: "merged",
      publishedTherapistId: "therapist-existing",
    },
  });
  const handler = createReviewApiHandler(createTestApiConfig(), client);
  const sessionToken = await loginAsAdmin(handler);

  const response = await runHandlerRequest(handler, {
    body: { decision: "publish" },
    headers: { cookie: sessionToken, host: "localhost:8787" },
    method: "POST",
    url: "/candidates/candidate-merged/decision",
  });
  assert.equal(response.statusCode, 409);
  assert.equal(response.payload.therapistId, "therapist-existing");
});

// --- Slug-collision guards ---
// The therapist _id is derived from slugify(name+city+state). Two different
// providers with the same name in the same city collapse to the same id, and
// publish/approve use createOrReplace — so without a guard, approving the
// second silently replaces the first's live profile.

test("approving an application whose derived id collides with a different live profile returns 409", async function () {
  // "Dr. Robin Vale, Sacramento CA" → therapist-dr-robin-vale-sacramento-ca,
  // which is already occupied by a different provider's live doc.
  const { client, state } = createMemoryClient({
    "therapist-dr-robin-vale-sacramento-ca": {
      _id: "therapist-dr-robin-vale-sacramento-ca",
      _type: "therapist",
      name: "Dr. Robin Vale",
      city: "Sacramento",
      state: "CA",
      licenseNumber: "LCSW11111", // different provider, same name/city/state
      bio: "The original Robin Vale's live profile.",
    },
    "application-collider": pendingApplication("application-collider"),
  });
  const handler = createReviewApiHandler(createTestApiConfig(), client);
  const sessionToken = await loginAsAdmin(handler);

  const response = await runHandlerRequest(handler, {
    body: {},
    headers: { cookie: sessionToken, host: "localhost:8787" },
    method: "POST",
    url: "/applications/application-collider/approve",
  });

  assert.equal(response.statusCode, 409);
  assert.match(response.payload.error, /already exists/i);
  assert.equal(response.payload.therapistId, "therapist-dr-robin-vale-sacramento-ca");
  assert.equal(
    state.documents.get("therapist-dr-robin-vale-sacramento-ca").bio,
    "The original Robin Vale's live profile.",
    "the occupant's live profile must not be overwritten",
  );
  assert.equal(state.documents.get("application-collider").status, "pending");
});

test("publishing a candidate whose derived id collides with a different live profile returns 409", async function () {
  // "Dr. Casey North, Seattle WA" → therapist-dr-casey-north-seattle-wa,
  // already occupied; the candidate was NOT matched to it via dedupe.
  const { client, state } = createMemoryClient({
    "therapist-dr-casey-north-seattle-wa": {
      _id: "therapist-dr-casey-north-seattle-wa",
      _type: "therapist",
      name: "Dr. Casey North",
      city: "Seattle",
      state: "WA",
      licenseNumber: "LMHC22222",
      bio: "The original Casey North's live profile.",
    },
    "candidate-collider": queuedCandidate("candidate-collider"),
  });
  const handler = createReviewApiHandler(createTestApiConfig(), client);
  const sessionToken = await loginAsAdmin(handler);

  const response = await runHandlerRequest(handler, {
    body: { decision: "publish" },
    headers: { cookie: sessionToken, host: "localhost:8787" },
    method: "POST",
    url: "/candidates/candidate-collider/decision",
  });

  assert.equal(response.statusCode, 409);
  assert.match(response.payload.error, /already exists/i);
  assert.equal(
    state.documents.get("therapist-dr-casey-north-seattle-wa").bio,
    "The original Casey North's live profile.",
    "the occupant's live profile must not be overwritten",
  );
});

test("a candidate deliberately matched to an existing therapist still publishes over it", async function () {
  // matchedTherapistId is the dedupe flow's explicit decision — the guard
  // must not block the intentional update path.
  const { client, state } = createMemoryClient({
    "therapist-matched": {
      _id: "therapist-matched",
      _type: "therapist",
      name: "Dr. Casey North",
      city: "Seattle",
      state: "WA",
    },
    "candidate-matched": {
      ...queuedCandidate("candidate-matched"),
      matchedTherapistId: "therapist-matched",
    },
  });
  const handler = createReviewApiHandler(createTestApiConfig(), client);
  const sessionToken = await loginAsAdmin(handler);

  const response = await runHandlerRequest(handler, {
    body: { decision: "publish" },
    headers: { cookie: sessionToken, host: "localhost:8787" },
    method: "POST",
    url: "/candidates/candidate-matched/decision",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.therapistId, "therapist-matched");
  assert.equal(state.documents.get("candidate-matched").publishedTherapistId, "therapist-matched");
});
