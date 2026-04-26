import assert from "node:assert/strict";
import test from "node:test";

import { handleAuthAndPortalRoutes } from "../../server/review-auth-portal-routes.mjs";
import { createMemoryClient, createTestApiConfig } from "./test-helpers.mjs";

// Test context builder mirrors the listing-removal test shape so stubs
// for unrelated deps don't have to be reproduced per case.
function buildContext(options) {
  const httpResponse = {
    statusCode: null,
    headers: {},
    body: "",
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(code) {
      this.statusCode = code;
    },
    end(body) {
      if (this.statusCode == null) this.statusCode = 200;
      this.body = body || "";
    },
  };
  const request = {
    method: options.method,
    headers: { host: "localhost:8787" },
    on() {
      return request;
    },
    destroy() {},
  };

  // Simulated token store. In prod the helper signs and reads via
  // review-handler.mjs; here we just round-trip a payload by reference.
  const tokens = new Map();
  const readEmailUnsubscribeToken = (_config, token) => tokens.get(token) || null;
  const issueToken = (tid) => {
    const token = `tok_${tokens.size + 1}`;
    tokens.set(token, { sub: "email-unsubscribe", tid, exp: Date.now() + 1000 * 60 });
    return token;
  };

  const routePath = "/email/unsubscribe";
  const tokenParam = options.token == null ? "" : options.token;
  const urlString = `http://localhost:8787${routePath}${tokenParam ? `?token=${encodeURIComponent(tokenParam)}` : ""}`;

  return {
    httpResponse,
    issueToken,
    context: {
      client: options.client,
      config: options.config || createTestApiConfig(),
      origin: "",
      request,
      response: httpResponse,
      routePath,
      url: new URL(urlString),
      deps: {
        parseBody: async () => ({}),
        sendJson: () => {},
        sendListingRemovalLink: async () => {},
        sendPortalClaimLink: async () => {},
        readEmailUnsubscribeToken,
        readListingRemovalToken: () => null,
        // Unrelated stubs
        buildPortalRequestDocument: () => null,
        canAttemptLogin: () => true,
        clearFailedLogins: () => {},
        createSignedSession: () => "",
        createTherapistSession: () => "",
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

function seedTherapist(overrides = {}) {
  return {
    _id: "therapist-jamie",
    _type: "therapist",
    name: "Jamie Rivera",
    licenseNumber: "LMFT12345",
    listingActive: true,
    slug: { current: "jamie-rivera", _type: "slug" },
    ...overrides,
  };
}

test("email unsubscribe: missing token returns 400", async () => {
  const { client } = createMemoryClient();
  const ctx = buildContext({ method: "GET", client });
  await handleAuthAndPortalRoutes(ctx.context);
  assert.equal(ctx.httpResponse.statusCode, 400);
});

test("email unsubscribe: invalid token returns 400", async () => {
  const { client } = createMemoryClient();
  const ctx = buildContext({ method: "GET", client, token: "bogus" });
  await handleAuthAndPortalRoutes(ctx.context);
  assert.equal(ctx.httpResponse.statusCode, 400);
});

test("email unsubscribe: valid GET token sets engagementEmailUnsubscribedAt and returns confirmation", async () => {
  const therapist = seedTherapist();
  const { client } = createMemoryClient({ [therapist._id]: therapist });
  const ctx = buildContext({ method: "GET", client });
  const token = ctx.issueToken(therapist._id);
  ctx.context.url = new URL(
    `http://localhost:8787/email/unsubscribe?token=${encodeURIComponent(token)}`,
  );

  await handleAuthAndPortalRoutes(ctx.context);

  assert.equal(ctx.httpResponse.statusCode, 200);
  assert.match(ctx.httpResponse.headers["Content-Type"], /text\/html/);
  assert.match(ctx.httpResponse.body, /You're unsubscribed/);

  const updated = await client.getDocument(therapist._id);
  assert.ok(updated.engagementEmailUnsubscribedAt, "field must be set after unsubscribe");
});

test("email unsubscribe: re-click on already-unsubscribed therapist is idempotent", async () => {
  const firstTimestamp = "2026-04-20T00:00:00.000Z";
  const therapist = seedTherapist({ engagementEmailUnsubscribedAt: firstTimestamp });
  const { client } = createMemoryClient({ [therapist._id]: therapist });
  const ctx = buildContext({ method: "GET", client });
  const token = ctx.issueToken(therapist._id);
  ctx.context.url = new URL(
    `http://localhost:8787/email/unsubscribe?token=${encodeURIComponent(token)}`,
  );

  await handleAuthAndPortalRoutes(ctx.context);

  assert.equal(ctx.httpResponse.statusCode, 200);
  const updated = await client.getDocument(therapist._id);
  assert.equal(
    updated.engagementEmailUnsubscribedAt,
    firstTimestamp,
    "timestamp must not be overwritten on re-click",
  );
});

test("email unsubscribe: POST (RFC 8058 List-Unsubscribe-Post) returns 200 with empty body", async () => {
  const therapist = seedTherapist();
  const { client } = createMemoryClient({ [therapist._id]: therapist });
  const ctx = buildContext({ method: "POST", client });
  const token = ctx.issueToken(therapist._id);
  ctx.context.url = new URL(
    `http://localhost:8787/email/unsubscribe?token=${encodeURIComponent(token)}`,
  );

  await handleAuthAndPortalRoutes(ctx.context);

  assert.equal(ctx.httpResponse.statusCode, 200);
  assert.equal(ctx.httpResponse.body, "");
  const updated = await client.getDocument(therapist._id);
  assert.ok(updated.engagementEmailUnsubscribedAt, "field must be set after POST unsubscribe");
});
