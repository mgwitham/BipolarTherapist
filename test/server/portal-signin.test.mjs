import assert from "node:assert/strict";
import test from "node:test";

import { handleAuthAndPortalRoutes } from "../../server/review-auth-portal-routes.mjs";
import { createMemoryClient, createTestApiConfig, deepClone } from "./test-helpers.mjs";

function buildContext(options) {
  const bodyPayload = options.body || {};
  const response = { statusCode: null, payload: null };
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

  return {
    response,
    emailsSent,
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
        buildPortalRequestDocument: () => null,
        canAttemptLogin: () => true,
        clearFailedLogins: () => {},
        createSignedSession: () => "",
        createTherapistSession: () => "test-session-token",
        getAuthorizedTherapist: () => null,
        getSecurityWarnings: () => [],
        isAuthorized: () => false,
        normalizePortalRequest: (doc) => doc,
        parseAuthorizationHeader: () => "",
        readPortalClaimToken: () => null,
        readSignedSession: () => null,
        recordFailedLogin: () => {},
        updatePortalRequestFields: async () => null,
      },
    },
  };
}

function seedClaimed(overrides = {}) {
  return {
    _id: "therapist-claimed",
    _type: "therapist",
    name: "Jamie Rivera",
    email: "jamie-public@practice.com",
    claimedByEmail: "jamie@work.com",
    claimStatus: "claimed",
    slug: { current: "jamie-rivera", _type: "slug" },
    licenseNumber: "LMFT12345",
    ...overrides,
  };
}

test("sign-in: sends link to claimedByEmail match (case-insensitive)", async () => {
  const { client } = createMemoryClient({ "therapist-claimed": seedClaimed() });
  const { response, emailsSent, context } = buildContext({
    method: "POST",
    routePath: "/portal/sign-in",
    client,
    body: { email: "Jamie@Work.com" },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.ok, true);
  assert.equal(emailsSent.length, 1);
  assert.equal(emailsSent[0].email, "jamie@work.com");
  assert.equal(emailsSent[0].slug, "jamie-rivera");
});

test("sign-in: unknown email returns generic success (no email sent)", async () => {
  const { client } = createMemoryClient({ "therapist-claimed": seedClaimed() });
  const { response, emailsSent, context } = buildContext({
    method: "POST",
    routePath: "/portal/sign-in",
    client,
    body: { email: "stranger@nowhere.com" },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.ok, true);
  assert.match(response.payload.message, /If that email matches a claimed profile/);
  assert.equal(emailsSent.length, 0);
});

test("sign-in: does not match unclaimed profile with same email", async () => {
  const { client } = createMemoryClient({
    "therapist-unclaimed": seedClaimed({
      _id: "therapist-unclaimed",
      claimStatus: "unclaimed",
    }),
  });
  const { response, emailsSent, context } = buildContext({
    method: "POST",
    routePath: "/portal/sign-in",
    client,
    body: { email: "jamie@work.com" },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(emailsSent.length, 0, "unclaimed profiles should not receive sign-in links");
});

test("sign-in: rejects malformed email with 400", async () => {
  const { client } = createMemoryClient();
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/portal/sign-in",
    client,
    body: { email: "not-an-email" },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 400);
});

test("sign-in: rejects missing email with 400", async () => {
  const { client } = createMemoryClient();
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/portal/sign-in",
    client,
    body: {},
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 400);
});

test("sign-in: rate limit silently drops without leaking enumeration signal", async () => {
  const now = Date.now();
  const recentStamps = [
    new Date(now - 60 * 1000).toISOString(),
    new Date(now - 120 * 1000).toISOString(),
    new Date(now - 180 * 1000).toISOString(),
  ];
  const { client } = createMemoryClient({
    "therapist-claimed": seedClaimed({ claimLinkRequests: recentStamps }),
  });
  const { response, emailsSent, context } = buildContext({
    method: "POST",
    routePath: "/portal/sign-in",
    client,
    body: { email: "jamie@work.com" },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 200, "rate-limited request should still return 200");
  assert.equal(response.payload.ok, true);
  assert.equal(emailsSent.length, 0, "no email should be sent when rate-limited");
});
