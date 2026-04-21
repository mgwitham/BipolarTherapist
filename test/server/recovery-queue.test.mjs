import assert from "node:assert/strict";
import test from "node:test";

import { handleAuthAndPortalRoutes } from "../../server/review-auth-portal-routes.mjs";
import { createReviewApiHandler } from "../../server/review-handler.mjs";
import {
  createMemoryClient,
  createTestApiConfig,
  deepClone,
  runHandlerRequest,
} from "./test-helpers.mjs";

function buildAdminApproveContext(options) {
  const response = { statusCode: null, payload: null };
  return {
    response,
    context: {
      client: options.client,
      config: options.config || createTestApiConfig(),
      origin: "",
      request: {
        method: "POST",
        headers: { host: "localhost:8787" },
        on() {
          return this;
        },
        destroy() {},
      },
      response: { writeHead() {}, end() {} },
      routePath: options.routePath,
      url: new URL(`http://localhost:8787${options.routePath}`),
      deps: {
        parseBody: async () => deepClone(options.body || {}),
        sendJson(_res, statusCode, payload) {
          response.statusCode = statusCode;
          response.payload = payload;
        },
        buildRecoveryMagicLink: () => "https://test.example/portal.html?token=stub",
        sendRecoveryApprovedEmail: async () => {},
        sendRecoveryRejectedEmail: async () => {},
        isAuthorized: () => true,
        getAuthorizedActor: () => "admin",
        notifyAdminOfRecoveryRequest: async () => {},
        notifyTherapistOfRecoveryReceived: async () => {},
        // Stubs for unused deps
        buildPortalRequestDocument: () => null,
        canAttemptLogin: () => true,
        clearFailedLogins: () => {},
        createSignedSession: () => "",
        createTherapistSession: () => "",
        getAuthorizedTherapist: () => null,
        getSecurityWarnings: () => [],
        normalizePortalRequest: (doc) => doc,
        parseAuthorizationHeader: () => "",
        readPortalClaimToken: () => null,
        readSignedSession: () => null,
        recordFailedLogin: () => {},
        sendPortalClaimLink: async () => {},
        updatePortalRequestFields: async () => null,
      },
    },
  };
}

function standardHeaders(extra) {
  return { host: "localhost:8787", ...(extra || {}) };
}

function buildTherapistFixture(overrides) {
  return {
    _id: "therapist-jamie",
    _type: "therapist",
    name: "Jamie Rivera",
    email: "contact@jamie-therapy.com",
    claimedByEmail: "jamie@lostaccess.com",
    slug: { current: "jamie-rivera" },
    claimStatus: "claimed",
    licenseNumber: "CA-12345",
    ...overrides,
  };
}

test("POST /portal/recovery-request creates a pending doc + snapshots profile context", async () => {
  const { client, state } = createMemoryClient({ "therapist-jamie": buildTherapistFixture() });
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    body: {
      full_name: "Jamie Rivera",
      license_number: "CA-12345",
      requested_email: "jamie.new@practice.example",
      prior_email: "jamie@lostaccess.com",
      reason: "Lost access to my old clinic email after changing practices.",
    },
    headers: standardHeaders(),
    method: "POST",
    url: "/portal/recovery-request",
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.payload.ok, true);
  assert.equal(response.payload.status, "pending");

  // Doc was created with the profile context snapshotted.
  const docs = Array.from(state.documents.values()).filter(
    (d) => d._type === "therapistRecoveryRequest",
  );
  assert.equal(docs.length, 1);
  const recovery = docs[0];
  assert.equal(recovery.fullName, "Jamie Rivera");
  assert.equal(recovery.requestedEmail, "jamie.new@practice.example");
  assert.equal(recovery.status, "pending");
  assert.equal(recovery.therapistSlug, "jamie-rivera");
  assert.equal(recovery.therapistDocId, "therapist-jamie");
  assert.equal(recovery.profileName, "Jamie Rivera");
  assert.equal(recovery.profileClaimedEmail, "jamie@lostaccess.com");
  assert.ok(recovery.profileEmailHint.includes("*"), "email hint should be masked");
});

test("POST /portal/recovery-request rejects missing fields", async () => {
  const { client } = createMemoryClient();
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    body: { full_name: "", license_number: "CA-12345", requested_email: "x@y.com" },
    headers: standardHeaders(),
    method: "POST",
    url: "/portal/recovery-request",
  });

  assert.equal(response.statusCode, 400);
});

test("POST /portal/recovery-request rejects malformed email", async () => {
  const { client } = createMemoryClient();
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    body: {
      full_name: "Jamie Rivera",
      license_number: "CA-12345",
      requested_email: "not-an-email",
      reason: "test",
    },
    headers: standardHeaders(),
    method: "POST",
    url: "/portal/recovery-request",
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.payload.field, "requested_email");
});

test("POST /portal/recovery-request rate-limits at 3 pending per license", async () => {
  const initial = {};
  for (let i = 1; i <= 3; i += 1) {
    initial[`therapistRecoveryRequest-${i}`] = {
      _id: `therapistRecoveryRequest-${i}`,
      _type: "therapistRecoveryRequest",
      status: "pending",
      licenseNumber: "CA-99999",
      fullName: `Repeated ${i}`,
      requestedEmail: `repeat${i}@example.com`,
      createdAt: new Date().toISOString(),
    };
  }
  const { client } = createMemoryClient(initial);
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    body: {
      full_name: "Jamie Rivera",
      license_number: "CA-99999",
      requested_email: "another@example.com",
      reason: "test",
    },
    headers: standardHeaders(),
    method: "POST",
    url: "/portal/recovery-request",
  });

  assert.equal(response.statusCode, 429);
  assert.equal(response.payload.reason, "rate_limited");
});

test("GET /recovery-requests requires admin auth", async () => {
  const { client } = createMemoryClient();
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    headers: standardHeaders(),
    method: "GET",
    url: "/recovery-requests",
  });

  assert.equal(response.statusCode, 401);
});

function seedColdTakeoverFixtures(overrides = {}) {
  return {
    "recovery-1": {
      _id: "recovery-1",
      _type: "therapistRecoveryRequest",
      status: "pending",
      reason: "no_email_on_file",
      fullName: "Jamie Rivera",
      licenseNumber: "LMFT12345",
      requestedEmail: "jamie@newpractice.com",
      therapistSlug: "jamie-rivera",
      therapistDocId: "therapist-jamie",
      createdAt: new Date().toISOString(),
      ...overrides,
    },
    "therapist-jamie": {
      _id: "therapist-jamie",
      _type: "therapist",
      name: "Jamie Rivera",
      slug: { current: "jamie-rivera" },
      claimStatus: "unclaimed",
    },
  };
}

test("POST /recovery-requests/:id/approve rejects cold takeover without identity verification", async () => {
  const { client } = createMemoryClient(
    seedColdTakeoverFixtures({ requestedEmail: "attacker@example.com" }),
  );
  const { response, context } = buildAdminApproveContext({
    client,
    body: { outcome_message: "approved" },
    routePath: "/recovery-requests/recovery-1/approve",
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 400);
  assert.equal(response.payload.reason, "identity_verification_required");
});

test("POST /recovery-requests/:id/approve rejects short identity verification (<20 chars)", async () => {
  const { client } = createMemoryClient(seedColdTakeoverFixtures());
  const { response, context } = buildAdminApproveContext({
    client,
    body: { outcome_message: "ok", identity_verification: "looks fine" },
    routePath: "/recovery-requests/recovery-1/approve",
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 400);
  assert.equal(response.payload.reason, "identity_verification_required");
});

test("POST /recovery-requests/:id/approve accepts cold takeover with identity verification", async () => {
  const { client, state } = createMemoryClient(seedColdTakeoverFixtures());
  const { response, context } = buildAdminApproveContext({
    client,
    body: {
      outcome_message: "approved",
      identity_verification:
        "Called 415-555-0100 from DCA record. Confirmed license and new email with Jamie.",
    },
    routePath: "/recovery-requests/recovery-1/approve",
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 200);
  const updated = state.documents.get("recovery-1");
  assert.equal(updated.status, "approved");
  assert.ok(
    updated.identityVerification.includes("415-555-0100"),
    "identity verification note is persisted on the recovery doc",
  );
});

test("POST /recovery-requests/:id/approve does NOT require identity verification for stale-email case", async () => {
  const { client, state } = createMemoryClient(
    seedColdTakeoverFixtures({ reason: "stale_email_on_file" }),
  );
  const { response, context } = buildAdminApproveContext({
    client,
    body: { outcome_message: "approved" },
    routePath: "/recovery-requests/recovery-1/approve",
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 200);
  const updated = state.documents.get("recovery-1");
  assert.equal(updated.status, "approved");
});

test("POST /recovery-requests/:id/reject requires admin auth", async () => {
  const { client } = createMemoryClient();
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    body: { outcome_message: "Could not verify." },
    headers: standardHeaders(),
    method: "POST",
    url: "/recovery-requests/some-id/reject",
  });

  assert.equal(response.statusCode, 401);
});
