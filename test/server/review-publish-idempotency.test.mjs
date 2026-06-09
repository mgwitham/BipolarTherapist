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
