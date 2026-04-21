import assert from "node:assert/strict";
import test from "node:test";

import { handleAuthAndPortalRoutes } from "../../server/review-auth-portal-routes.mjs";
import { createMemoryClient, createTestApiConfig, deepClone } from "./test-helpers.mjs";

function buildContext(options) {
  const bodyPayload = options.body || {};
  const response = {
    statusCode: null,
    payload: null,
  };
  const sendJson = function sendJson(_res, statusCode, payload) {
    response.statusCode = statusCode;
    response.payload = payload;
  };
  const request = {
    method: options.method,
    headers: options.headers || { host: "localhost:8787" },
    on() {
      return request;
    },
    destroy() {},
  };
  const parseBody = async () => deepClone(bodyPayload);

  const emailsSent = [];
  const sendPortalClaimLink = async (_config, therapist, email) => {
    emailsSent.push({ slug: therapist && therapist.slug && therapist.slug.current, email });
  };

  const checkoutCalls = [];
  const createFeaturedCheckoutSession =
    options.createFeaturedCheckoutSession ||
    (async (_config, args) => {
      checkoutCalls.push(args);
      return {
        id: "cs_test_123",
        url: "https://stripe.test/checkout/cs_test_123",
        tier: "paid",
        interval: "month",
      };
    });

  return {
    response,
    emailsSent,
    checkoutCalls,
    context: {
      client: options.client,
      config: options.config || createTestApiConfig(),
      origin: "",
      request,
      response: { writeHead() {}, end() {} },
      routePath: options.routePath,
      url: new URL(`http://localhost:8787${options.routePath}`),
      deps: {
        parseBody,
        sendJson,
        sendPortalClaimLink,
        createFeaturedCheckoutSession,
        // Stubs for deps we don't exercise in these tests
        buildPortalRequestDocument: () => null,
        canAttemptLogin: () => true,
        clearFailedLogins: () => {},
        createSignedSession: () => "",
        createTherapistSession: () => "test-session-token",
        getAuthorizedTherapist: () => null,
        getSecurityWarnings: () => [],
        isAuthorized: () => false,
        normalizePortalRequest: (doc) => doc,
        notifyAdminOfRecoveryRequest: async () => {},
        notifyTherapistOfRecoveryReceived: async () => {},
        parseAuthorizationHeader: () => "",
        readPortalClaimToken: options.readPortalClaimToken || (() => null),
        readSignedSession: () => null,
        recordFailedLogin: () => {},
        updatePortalRequestFields: async () => null,
      },
    },
  };
}

function seedTherapist(licenseNumber, overrides = {}) {
  return {
    _id: `therapist-${licenseNumber}`,
    _type: "therapist",
    name: "Jamie Rivera",
    email: "jamie@example.com",
    licenseNumber,
    slug: { current: "jamie-rivera", _type: "slug" },
    claimStatus: "unclaimed",
    ...overrides,
  };
}

test("claim-accept: accepts fresh token and records nonce as used", async () => {
  const { client, state } = createMemoryClient({
    "therapist-LMFT12345": seedTherapist("LMFT12345"),
  });
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/portal/claim-accept",
    client,
    body: { token: "valid-token" },
    readPortalClaimToken: () => ({
      sub: "therapist-portal",
      slug: "jamie-rivera",
      email: "jamie@example.com",
      exp: Date.now() + 60 * 60 * 1000,
      nonce: "nonce-fresh-abc123",
    }),
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.ok, true);
  const updated = state.documents.get("therapist-LMFT12345");
  assert.equal(updated.claimStatus, "claimed");
  assert.ok(Array.isArray(updated.usedClaimTokenNonces));
  assert.ok(updated.usedClaimTokenNonces.includes("nonce-fresh-abc123"));
});

test("claim-accept: rejects token whose nonce was already used", async () => {
  const { client } = createMemoryClient({
    "therapist-LMFT12345": seedTherapist("LMFT12345", {
      usedClaimTokenNonces: ["nonce-already-spent"],
    }),
  });
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/portal/claim-accept",
    client,
    body: { token: "replay-token" },
    readPortalClaimToken: () => ({
      sub: "therapist-portal",
      slug: "jamie-rivera",
      email: "jamie@example.com",
      exp: Date.now() + 60 * 60 * 1000,
      nonce: "nonce-already-spent",
    }),
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 401);
  assert.equal(response.payload.reason, "token_already_used");
});

test("claim-by-slug: rate-limits to 3 requests per slug per hour", async () => {
  const now = new Date();
  const recent = [
    new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
    new Date(now.getTime() - 5 * 60 * 1000).toISOString(),
    new Date(now.getTime() - 1 * 60 * 1000).toISOString(),
  ];
  const { client } = createMemoryClient({
    "therapist-LMFT12345": seedTherapist("LMFT12345", { claimLinkRequests: recent }),
  });
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/portal/claim-by-slug",
    client,
    body: { slug: "jamie-rivera" },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 429);
  assert.equal(response.payload.reason, "rate_limited");
});

test("claim-by-slug: requests older than 1 hour don't count toward rate limit", async () => {
  const now = new Date();
  const old = [
    new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
    new Date(now.getTime() - 90 * 60 * 1000).toISOString(),
    new Date(now.getTime() - 75 * 60 * 1000).toISOString(),
  ];
  const { client, state } = createMemoryClient({
    "therapist-LMFT12345": seedTherapist("LMFT12345", { claimLinkRequests: old }),
  });
  const { response, emailsSent, context } = buildContext({
    method: "POST",
    routePath: "/portal/claim-by-slug",
    client,
    body: { slug: "jamie-rivera" },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(emailsSent.length, 1);
  const updated = state.documents.get("therapist-LMFT12345");
  // Old entries filtered out, only the new entry remains
  assert.equal(updated.claimLinkRequests.length, 1);
});

test("claim-trial: shares rate-limit counter with claim-by-slug", async () => {
  const now = new Date();
  const recent = [
    new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
    new Date(now.getTime() - 20 * 60 * 1000).toISOString(),
    new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
  ];
  const { client } = createMemoryClient({
    "therapist-LMFT12345": seedTherapist("LMFT12345", { claimLinkRequests: recent }),
  });
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/portal/claim-trial",
    client,
    body: { slug: "jamie-rivera" },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 429);
  assert.equal(response.payload.reason, "rate_limited");
});

test("quick-claim: missing fields returns 400", async () => {
  const { client } = createMemoryClient();
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/portal/quick-claim",
    client,
    body: { email: "jamie@example.com" },
  });
  const handled = await handleAuthAndPortalRoutes(context);
  assert.equal(handled, true);
  assert.equal(response.statusCode, 400);
});

test("quick-claim: unknown license returns 404 with reason 'not_found'", async () => {
  const { client } = createMemoryClient();
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/portal/quick-claim",
    client,
    body: {
      full_name: "Alex Chen",
      email: "alex@example.com",
      license_number: "LMFT99999",
    },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 404);
  assert.equal(response.payload.reason, "not_found");
});

test("quick-claim: name mismatch returns 403 with reason 'name_mismatch'", async () => {
  const { client } = createMemoryClient({
    "therapist-LMFT12345": seedTherapist("LMFT12345"),
  });
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/portal/quick-claim",
    client,
    body: {
      full_name: "Someone Else",
      email: "jamie@example.com",
      license_number: "LMFT12345",
    },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 403);
  assert.equal(response.payload.reason, "name_mismatch");
});

test("quick-claim: email mismatch returns 403 with reason 'email_mismatch'", async () => {
  const { client } = createMemoryClient({
    "therapist-LMFT12345": seedTherapist("LMFT12345"),
  });
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/portal/quick-claim",
    client,
    body: {
      full_name: "Jamie Rivera",
      email: "impostor@example.com",
      license_number: "LMFT12345",
    },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 403);
  assert.equal(response.payload.reason, "email_mismatch");
});

test("quick-claim: matching fields sends the claim link and updates status", async () => {
  const { client, state } = createMemoryClient({
    "therapist-LMFT12345": seedTherapist("LMFT12345"),
  });
  const { response, emailsSent, context } = buildContext({
    method: "POST",
    routePath: "/portal/quick-claim",
    client,
    body: {
      full_name: "Jamie Rivera",
      email: "jamie@example.com",
      license_number: "LMFT12345",
    },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.ok, true);
  assert.equal(response.payload.therapist_slug, "jamie-rivera");
  assert.equal(emailsSent.length, 1);
  assert.equal(emailsSent[0].email, "jamie@example.com");

  const updated = state.documents.get("therapist-LMFT12345");
  assert.equal(updated.claimStatus, "claim_requested");
});

test("quick-claim: already-claimed profile keeps its claimed status", async () => {
  const { client, state } = createMemoryClient({
    "therapist-LMFT12345": seedTherapist("LMFT12345", { claimStatus: "claimed" }),
  });
  const { context } = buildContext({
    method: "POST",
    routePath: "/portal/quick-claim",
    client,
    body: {
      full_name: "Jamie Rivera",
      email: "jamie@example.com",
      license_number: "LMFT12345",
    },
  });
  await handleAuthAndPortalRoutes(context);
  const updated = state.documents.get("therapist-LMFT12345");
  assert.equal(updated.claimStatus, "claimed");
});

test("quick-claim: accepts email at the same domain as the practice website", async () => {
  const { client, state } = createMemoryClient({
    "therapist-LMFT12345": seedTherapist("LMFT12345", {
      website: "https://rivercounselingla.com",
    }),
  });
  const { response, emailsSent, context } = buildContext({
    method: "POST",
    routePath: "/portal/quick-claim",
    client,
    body: {
      full_name: "Jamie Rivera",
      email: "jamie@rivercounselingla.com",
      license_number: "LMFT12345",
    },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.verification_method, "email_domain_match");
  assert.equal(emailsSent.length, 1);
  assert.equal(emailsSent[0].email, "jamie@rivercounselingla.com");
  const updated = state.documents.get("therapist-LMFT12345");
  assert.equal(updated.lastClaimVerificationMethod, "email_domain_match");
});

test("quick-claim: rejects free-email domains even when website shares the name", async () => {
  const { client } = createMemoryClient({
    "therapist-LMFT12345": seedTherapist("LMFT12345", {
      website: "https://gmail.com",
    }),
  });
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/portal/quick-claim",
    client,
    body: {
      full_name: "Jamie Rivera",
      email: "impostor@gmail.com",
      license_number: "LMFT12345",
    },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 403);
  assert.equal(response.payload.reason, "email_mismatch");
});

test("quick-claim: rejects aggregator-domain websites for auto-verify", async () => {
  const { client } = createMemoryClient({
    "therapist-LMFT12345": seedTherapist("LMFT12345", {
      website: "https://www.psychologytoday.com/us/therapists/jamie-rivera",
    }),
  });
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/portal/quick-claim",
    client,
    body: {
      full_name: "Jamie Rivera",
      email: "jamie@psychologytoday.com",
      license_number: "LMFT12345",
    },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 403);
  assert.equal(response.payload.reason, "email_mismatch");
});

test("quick-claim: no email on file + no domain match routes to manual review", async () => {
  const { client, state } = createMemoryClient({
    "therapist-LMFT12345": seedTherapist("LMFT12345", { email: "", website: "" }),
  });
  const { response, emailsSent, context } = buildContext({
    method: "POST",
    routePath: "/portal/quick-claim",
    client,
    body: {
      full_name: "Jamie Rivera",
      email: "jamie@example.com",
      license_number: "LMFT12345",
    },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 202);
  assert.equal(response.payload.verification_method, "manual_review");
  assert.equal(emailsSent.length, 0, "no claim link is sent until admin approves");

  const recoveryDocs = Array.from(state.documents.values()).filter(
    (doc) => doc._type === "therapistRecoveryRequest",
  );
  assert.equal(recoveryDocs.length, 1);
  assert.equal(recoveryDocs[0].status, "pending");
  assert.equal(recoveryDocs[0].reason, "no_email_on_file");
  assert.equal(recoveryDocs[0].requestedEmail, "jamie@example.com");
  assert.equal(recoveryDocs[0].therapistDocId, "therapist-LMFT12345");

  const updated = state.documents.get("therapist-LMFT12345");
  assert.equal(updated.claimStatus, "claim_requested");
});

test("quick-claim: no email on file but domain matches website still auto-verifies", async () => {
  const { client, state } = createMemoryClient({
    "therapist-LMFT12345": seedTherapist("LMFT12345", {
      email: "",
      website: "https://jamie-therapy.com",
    }),
  });
  const { response, emailsSent, context } = buildContext({
    method: "POST",
    routePath: "/portal/quick-claim",
    client,
    body: {
      full_name: "Jamie Rivera",
      email: "hello@jamie-therapy.com",
      license_number: "LMFT12345",
    },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.verification_method, "email_domain_match");
  assert.equal(emailsSent.length, 1);
  const recoveryDocs = Array.from(state.documents.values()).filter(
    (doc) => doc._type === "therapistRecoveryRequest",
  );
  assert.equal(recoveryDocs.length, 0, "domain match should NOT create a recovery request");
});

test("quick-claim: email on file but mismatch still returns 403 (imposter protection)", async () => {
  const { client } = createMemoryClient({
    "therapist-LMFT12345": seedTherapist("LMFT12345"),
  });
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/portal/quick-claim",
    client,
    body: {
      full_name: "Jamie Rivera",
      email: "imposter@evil.com",
      license_number: "LMFT12345",
    },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 403);
  assert.equal(response.payload.reason, "email_mismatch");
});

test("quick-claim: no-email manual review rate-limits at 3 pending per license", async () => {
  const { client, state } = createMemoryClient({
    "therapist-LMFT12345": seedTherapist("LMFT12345", { email: "", website: "" }),
  });
  for (let i = 0; i < 3; i += 1) {
    await client.create({
      _id: `recovery-${i}`,
      _type: "therapistRecoveryRequest",
      status: "pending",
      licenseNumber: "LMFT12345",
      requestedEmail: `pending${i}@example.com`,
      fullName: "Jamie Rivera",
      createdAt: new Date().toISOString(),
    });
  }
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/portal/quick-claim",
    client,
    body: {
      full_name: "Jamie Rivera",
      email: "jamie@example.com",
      license_number: "LMFT12345",
    },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 429);
  assert.equal(response.payload.reason, "rate_limited");

  const recoveryDocs = Array.from(state.documents.values()).filter(
    (doc) => doc._type === "therapistRecoveryRequest",
  );
  assert.equal(recoveryDocs.length, 3, "no 4th doc is created while rate-limited");
});

test("claim-by-slug: sends link to on-file email when slug matches", async () => {
  const { client, state } = createMemoryClient({
    "therapist-LMFT12345": seedTherapist("LMFT12345"),
  });
  const { response, emailsSent, context } = buildContext({
    method: "POST",
    routePath: "/portal/claim-by-slug",
    client,
    body: { slug: "jamie-rivera" },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.verification_method, "email_on_file");
  assert.equal(response.payload.therapist_slug, "jamie-rivera");
  assert.equal(emailsSent.length, 1);
  assert.equal(emailsSent[0].email, "jamie@example.com");
  const updated = state.documents.get("therapist-LMFT12345");
  assert.equal(updated.claimStatus, "claim_requested");
});

test("claim-by-slug: returns 409 no_email_on_file when profile has no email", async () => {
  const { client } = createMemoryClient({
    "therapist-LMFT12345": seedTherapist("LMFT12345", { email: "" }),
  });
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/portal/claim-by-slug",
    client,
    body: { slug: "jamie-rivera" },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 409);
  assert.equal(response.payload.reason, "no_email_on_file");
});

test("quick-claim/lookup: returns single therapist by slug", async () => {
  const { client } = createMemoryClient({
    "therapist-LMFT12345": seedTherapist("LMFT12345"),
  });
  const { response, context } = buildContext({
    method: "GET",
    routePath: "/portal/quick-claim/lookup",
    client,
  });
  // Override URL to include the slug query param.
  context.url = new URL("http://localhost:8787/portal/quick-claim/lookup?slug=jamie-rivera");
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.ok(response.payload.result);
  assert.equal(response.payload.result.slug, "jamie-rivera");
  assert.equal(response.payload.result.name, "Jamie Rivera");
  assert.equal(response.payload.result.has_email, true);
  // Email is returned as masked hint, not raw
  assert.ok(/\*/.test(response.payload.result.email_hint));
  // Trust signals fields present, defaults to false when not verified
  assert.equal(response.payload.result.license_verified_current, false);
  assert.equal(response.payload.result.license_verified_at, "");
});

test("quick-claim/lookup: surfaces license_verified_current when current standing", async () => {
  const { client } = createMemoryClient({
    "therapist-LMFT12345": seedTherapist("LMFT12345", {
      licensureVerification: {
        statusStanding: "current",
        verifiedAt: "2026-04-01T00:00:00Z",
      },
    }),
  });
  const { response, context } = buildContext({
    method: "GET",
    routePath: "/portal/quick-claim/lookup",
    client,
  });
  context.url = new URL("http://localhost:8787/portal/quick-claim/lookup?slug=jamie-rivera");
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.result.license_verified_current, true);
  assert.equal(response.payload.result.license_verified_at, "2026-04-01T00:00:00Z");
});

test("quick-claim/lookup: expired license does NOT mark verified_current", async () => {
  const { client } = createMemoryClient({
    "therapist-LMFT12345": seedTherapist("LMFT12345", {
      licensureVerification: {
        statusStanding: "expired",
        verifiedAt: "2026-04-01T00:00:00Z",
      },
    }),
  });
  const { response, context } = buildContext({
    method: "GET",
    routePath: "/portal/quick-claim/lookup",
    client,
  });
  context.url = new URL("http://localhost:8787/portal/quick-claim/lookup?slug=jamie-rivera");
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.result.license_verified_current, false);
});

test("quick-claim/lookup: returns 404 for unknown slug", async () => {
  const { client } = createMemoryClient({
    "therapist-LMFT12345": seedTherapist("LMFT12345"),
  });
  const { response, context } = buildContext({
    method: "GET",
    routePath: "/portal/quick-claim/lookup",
    client,
  });
  context.url = new URL("http://localhost:8787/portal/quick-claim/lookup?slug=nobody-here");
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 404);
  assert.equal(response.payload.reason, "not_found");
});

test("quick-claim/lookup: returns 400 when slug missing", async () => {
  const { client } = createMemoryClient();
  const { response, context } = buildContext({
    method: "GET",
    routePath: "/portal/quick-claim/lookup",
    client,
  });
  context.url = new URL("http://localhost:8787/portal/quick-claim/lookup");
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 400);
});

test("claim-trial: sends activation link AND creates Stripe session", async () => {
  const { client, state } = createMemoryClient({
    "therapist-LMFT12345": seedTherapist("LMFT12345"),
  });
  const { response, emailsSent, checkoutCalls, context } = buildContext({
    method: "POST",
    routePath: "/portal/claim-trial",
    client,
    body: { slug: "jamie-rivera" },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.ok, true);
  assert.equal(response.payload.therapist_slug, "jamie-rivera");
  assert.equal(response.payload.stripe_url, "https://stripe.test/checkout/cs_test_123");
  // Verification email fired to on-file address
  assert.equal(emailsSent.length, 1);
  assert.equal(emailsSent[0].email, "jamie@example.com");
  // Stripe session created with slug + customer_email
  assert.equal(checkoutCalls.length, 1);
  assert.equal(checkoutCalls[0].therapistSlug, "jamie-rivera");
  assert.equal(checkoutCalls[0].customerEmail, "jamie@example.com");
  assert.equal(checkoutCalls[0].plan, "paid_monthly");
  // Claim marked as requested so admin sees trial intent
  const updated = state.documents.get("therapist-LMFT12345");
  assert.equal(updated.claimStatus, "claim_requested");
});

test("claim-trial: returns 409 when profile has no email and no override provided", async () => {
  const { client } = createMemoryClient({
    "therapist-LMFT12345": seedTherapist("LMFT12345", { email: "" }),
  });
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/portal/claim-trial",
    client,
    body: { slug: "jamie-rivera" },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 409);
  assert.equal(response.payload.reason, "no_email_on_file");
});

test("claim-trial: accepts override_email only when no on-file email exists", async () => {
  const { client } = createMemoryClient({
    "therapist-LMFT12345": seedTherapist("LMFT12345", { email: "" }),
  });
  const { response, emailsSent, checkoutCalls, context } = buildContext({
    method: "POST",
    routePath: "/portal/claim-trial",
    client,
    body: { slug: "jamie-rivera", override_email: "new@example.com" },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(emailsSent[0].email, "new@example.com");
  assert.equal(checkoutCalls[0].customerEmail, "new@example.com");
});

test("claim-trial: ignores override_email when on-file email exists (prevents imposter verification)", async () => {
  const { client } = createMemoryClient({
    "therapist-LMFT12345": seedTherapist("LMFT12345"),
  });
  const { response, emailsSent, context } = buildContext({
    method: "POST",
    routePath: "/portal/claim-trial",
    client,
    body: { slug: "jamie-rivera", override_email: "imposter@evil.com" },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 200);
  // Verification email went to on-file, NOT the override
  assert.equal(emailsSent[0].email, "jamie@example.com");
});

test("claim-trial: returns 404 when slug is unknown", async () => {
  const { client } = createMemoryClient();
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/portal/claim-trial",
    client,
    body: { slug: "nobody-here" },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 404);
  assert.equal(response.payload.reason, "not_found");
});

test("claim-trial: returns 400 when slug is missing", async () => {
  const { client } = createMemoryClient();
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/portal/claim-trial",
    client,
    body: {},
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 400);
});

test("claim-by-slug: returns 404 when slug is unknown", async () => {
  const { client } = createMemoryClient();
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/portal/claim-by-slug",
    client,
    body: { slug: "nobody-here" },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 404);
  assert.equal(response.payload.reason, "not_found");
});

test("quick-claim: normalizes name and email to case-insensitive compare", async () => {
  const { client } = createMemoryClient({
    "therapist-LMFT12345": seedTherapist("LMFT12345"),
  });
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/portal/quick-claim",
    client,
    body: {
      full_name: "JAMIE RIVERA",
      email: "Jamie@Example.com",
      license_number: "LMFT12345",
    },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 200);
});
