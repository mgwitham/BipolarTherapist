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
        method: options.method || "POST",
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
        buildRecoveryConfirmToken: (_config, recoveryId, nonce) =>
          "tok|" + recoveryId + "|" + nonce,
        readRecoveryConfirmToken:
          options.readRecoveryConfirmToken ||
          ((_config, token) => {
            const parts = String(token || "").split("|");
            if (parts.length !== 3 || parts[0] !== "tok") return null;
            return {
              sub: "recovery-confirm",
              recovery: parts[1],
              nonce: parts[2],
              exp: Date.now() + 1000,
            };
          }),
        sendRecoveryApprovedEmail: async () => {},
        sendRecoveryRejectedEmail: async () => {},
        sendRecoveryConfirmationEmail: options.sendRecoveryConfirmationEmail || (async () => {}),
        sendRecoveryConfirmationHeadsUp:
          options.sendRecoveryConfirmationHeadsUp || (async () => {}),
        isAuthorized: options.isAuthorized || (() => true),
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

test("POST /recovery-requests/:id/send-confirmation stamps channel and nonce on the doc", async () => {
  const { client, state } = createMemoryClient(seedColdTakeoverFixtures());
  const emailsSent = [];
  const { response, context } = buildAdminApproveContext({
    client,
    body: {
      channel_email: "info@drsmiththerapy.com",
      channel_context: "Practice website footer",
    },
    routePath: "/recovery-requests/recovery-1/send-confirmation",
    sendRecoveryConfirmationEmail: async (_cfg, _rec, confirmUrl, denyUrl, channelEmail, ctx) => {
      emailsSent.push({ confirmUrl, denyUrl, channelEmail, ctx });
    },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(emailsSent.length, 1);
  assert.equal(emailsSent[0].channelEmail, "info@drsmiththerapy.com");
  assert.ok(emailsSent[0].confirmUrl.includes("response=yes"));
  assert.ok(emailsSent[0].denyUrl.includes("response=no"));

  const updated = state.documents.get("recovery-1");
  assert.equal(updated.confirmationChannel, "info@drsmiththerapy.com");
  assert.equal(updated.confirmationChannelContext, "Practice website footer");
  assert.equal(updated.confirmationResponse, "pending");
  assert.ok(updated.confirmationTokenNonce, "nonce must be stored for single-use invalidation");
  assert.ok(updated.confirmationSentAt);
});

test("POST /recovery-requests/:id/send-confirmation also pings the requester with a masked heads-up", async () => {
  const { client } = createMemoryClient(seedColdTakeoverFixtures());
  const headsUpCalls = [];
  const { response, context } = buildAdminApproveContext({
    client,
    body: {
      channel_email: "office@drsmiththerapy.com",
      channel_context: "Practice website footer",
    },
    routePath: "/recovery-requests/recovery-1/send-confirmation",
    sendRecoveryConfirmationHeadsUp: async (_cfg, rec, maskedHint) => {
      headsUpCalls.push({ rec, maskedHint });
    },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(headsUpCalls.length, 1, "heads-up email was sent to the requester");
  assert.ok(
    headsUpCalls[0].maskedHint.includes("*"),
    "the channel hint is masked (e.g., o***@d***.com), not the full address",
  );
  assert.ok(
    !headsUpCalls[0].maskedHint.includes("office@drsmiththerapy.com"),
    "full channel address must NOT leak to the requester",
  );
});

test("POST /recovery-requests/:id/send-confirmation rejects channel matching requester email", async () => {
  const { client } = createMemoryClient(
    seedColdTakeoverFixtures({ requestedEmail: "attacker@example.com" }),
  );
  const { response, context } = buildAdminApproveContext({
    client,
    body: {
      channel_email: "Attacker@Example.com",
      channel_context: "Psychology Today",
    },
    routePath: "/recovery-requests/recovery-1/send-confirmation",
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 400);
  assert.equal(response.payload.reason, "channel_matches_requester");
});

test("POST /recovery-requests/:id/send-confirmation requires channel context note", async () => {
  const { client } = createMemoryClient(seedColdTakeoverFixtures());
  const { response, context } = buildAdminApproveContext({
    client,
    body: { channel_email: "info@drsmiththerapy.com", channel_context: "" },
    routePath: "/recovery-requests/recovery-1/send-confirmation",
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 400);
});

test("GET /recovery-confirm returns context for valid token", async () => {
  const { client } = createMemoryClient(
    seedColdTakeoverFixtures({
      confirmationTokenNonce: "abc123",
      confirmationSentAt: new Date().toISOString(),
      confirmationResponse: "pending",
    }),
  );
  const { response, context } = buildAdminApproveContext({
    client,
    method: "GET",
    body: {},
    routePath: "/recovery-confirm",
  });
  context.url = new URL("http://localhost:8787/recovery-confirm?token=tok|recovery-1|abc123");
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.therapist_name, "Jamie Rivera");
  assert.equal(response.payload.requested_email, "jamie@newpractice.com");
});

test("GET /recovery-confirm returns 410 when nonce no longer matches (used)", async () => {
  const { client } = createMemoryClient(
    seedColdTakeoverFixtures({ confirmationTokenNonce: "new-nonce-after-use" }),
  );
  const { response, context } = buildAdminApproveContext({
    client,
    method: "GET",
    body: {},
    routePath: "/recovery-confirm",
  });
  context.url = new URL("http://localhost:8787/recovery-confirm?token=tok|recovery-1|old-nonce");
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 410);
  assert.equal(response.payload.reason, "used_or_replaced");
});

test("POST /recovery-confirm with 'yes' auto-approves and invalidates token", async () => {
  const { client, state } = createMemoryClient(
    seedColdTakeoverFixtures({
      confirmationTokenNonce: "abc123",
      confirmationChannel: "info@drsmiththerapy.com",
      confirmationChannelContext: "Practice website footer",
      confirmationSentAt: new Date().toISOString(),
      confirmationResponse: "pending",
    }),
  );
  const emailsSent = [];
  const { response, context } = buildAdminApproveContext({
    client,
    body: { token: "tok|recovery-1|abc123", response: "yes" },
    routePath: "/recovery-confirm",
  });
  context.deps.sendRecoveryApprovedEmail = async (_cfg, rec, link) => {
    emailsSent.push({ rec, link });
  };
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.outcome, "confirmed");
  assert.equal(emailsSent.length, 1, "sign-in link was emailed to the requested email");

  const updated = state.documents.get("recovery-1");
  assert.equal(updated.status, "approved");
  assert.equal(updated.confirmationResponse, "yes");
  assert.ok(updated.identityVerification.includes("Confirmed by therapist"));
  assert.notEqual(updated.confirmationTokenNonce, "abc123", "nonce rotates to invalidate the link");

  const therapist = state.documents.get("therapist-jamie");
  assert.equal(therapist.claimStatus, "claimed");
  assert.equal(therapist.claimedByEmail, "jamie@newpractice.com");
});

test("POST /recovery-confirm with 'no' auto-rejects and alerts admin", async () => {
  const { client, state } = createMemoryClient(
    seedColdTakeoverFixtures({
      confirmationTokenNonce: "abc123",
      confirmationSentAt: new Date().toISOString(),
      confirmationResponse: "pending",
    }),
  );
  const adminAlerts = [];
  const { response, context } = buildAdminApproveContext({
    client,
    body: { token: "tok|recovery-1|abc123", response: "no" },
    routePath: "/recovery-confirm",
  });
  context.deps.notifyAdminOfRecoveryRequest = async (_cfg, rec) => {
    adminAlerts.push(rec);
  };
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.outcome, "denied");
  assert.equal(adminAlerts.length, 1);
  assert.equal(adminAlerts[0].adminAlert, "therapist_denied_confirmation");

  const updated = state.documents.get("recovery-1");
  assert.equal(updated.status, "rejected");
  assert.equal(updated.confirmationResponse, "no");
  assert.notEqual(updated.confirmationTokenNonce, "abc123");

  const therapist = state.documents.get("therapist-jamie");
  assert.equal(therapist.claimStatus, "unclaimed", "therapist profile must not be claimed on deny");
});

test("POST /recovery-confirm returns 410 when Sanity rejects the nonce-rotation patch (concurrent click)", async () => {
  // Simulate the race: two users click the same link at once. The
  // first request gets through and rotates the nonce; the second
  // arrives with the same _rev and Sanity rejects with a revision-
  // mismatch error. We stub the patch to throw on ifRevisionId-guarded
  // commit to exercise that branch.
  const { client } = createMemoryClient(
    seedColdTakeoverFixtures({
      confirmationTokenNonce: "abc123",
      confirmationSentAt: new Date().toISOString(),
      confirmationResponse: "pending",
    }),
  );

  const originalPatch = client.patch.bind(client);
  let shouldConflict = true;
  client.patch = function patchWithConflict(id) {
    const builder = originalPatch(id);
    const originalIfRev = builder.ifRevisionId;
    builder.ifRevisionId = function () {
      originalIfRev.call(builder);
      if (shouldConflict) {
        shouldConflict = false;
        return {
          set: () => ({
            commit: async () => {
              throw new Error("mutation conflict: revision mismatch");
            },
          }),
        };
      }
      return builder;
    };
    return builder;
  };

  const { response, context } = buildAdminApproveContext({
    client,
    body: { token: "tok|recovery-1|abc123", response: "yes" },
    routePath: "/recovery-confirm",
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 410);
  assert.equal(response.payload.reason, "used_or_replaced");
});

test("POST /recovery-confirm with reused token returns 410", async () => {
  const { client } = createMemoryClient(
    seedColdTakeoverFixtures({
      confirmationTokenNonce: "rotated-already",
      confirmationResponse: "yes",
    }),
  );
  const { response, context } = buildAdminApproveContext({
    client,
    body: { token: "tok|recovery-1|old-nonce", response: "yes" },
    routePath: "/recovery-confirm",
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 410);
  assert.equal(response.payload.reason, "used_or_replaced");
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
