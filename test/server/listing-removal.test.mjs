import assert from "node:assert/strict";
import test from "node:test";

import { handleAuthAndPortalRoutes } from "../../server/review-auth-portal-routes.mjs";
import { createMemoryClient, createTestApiConfig, deepClone } from "./test-helpers.mjs";

// Shared test context builder for the listing-removal endpoints. Mirrors
// the pattern used in quick-claim.test.mjs so stubs for unrelated deps
// (auth, session helpers) don't have to be set up per test.
function buildContext(options) {
  const bodyPayload = options.body || {};
  const response = {
    statusCode: null,
    payload: null,
    headers: {},
  };
  const sendJson = function sendJson(_res, statusCode, payload) {
    response.statusCode = statusCode;
    response.payload = payload;
  };
  const httpResponse = {
    statusCode: null,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(code) {
      this.statusCode = code;
    },
    end() {
      response.statusCode = this.statusCode;
      response.headers = this.headers;
    },
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
  const sendListingRemovalLink = async (_config, therapist) => {
    emailsSent.push({
      slug: therapist && therapist.slug && therapist.slug.current,
      email: therapist && therapist.email,
    });
  };

  // Shared signed-token helpers the server uses. The simulated
  // implementation matches what review-handler.mjs does in prod.
  const tokens = new Map();
  const readListingRemovalToken = (_config, token) => {
    return tokens.get(token) || null;
  };
  const issueToken = (payload) => {
    const token = `tok_${tokens.size + 1}`;
    tokens.set(token, payload);
    return token;
  };

  const routePath = options.routePath;
  const urlString = options.url || `http://localhost:8787${routePath}`;

  return {
    response,
    httpResponse,
    emailsSent,
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
        parseBody,
        sendJson,
        sendListingRemovalLink,
        sendPortalClaimLink: async () => {},
        readListingRemovalToken,
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
    email: "jamie@example.com",
    licenseNumber: "LMFT12345",
    listingActive: true,
    slug: { current: "jamie-rivera", _type: "slug" },
    ...overrides,
  };
}

test("listing-removal request: missing fields returns 400", async () => {
  const { client } = createMemoryClient();
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/portal/listing-removal/request",
    client,
    body: { full_name: "Jamie Rivera" },
  });
  const handled = await handleAuthAndPortalRoutes(context);
  assert.equal(handled, true);
  assert.equal(response.statusCode, 400);
});

test("listing-removal request: matching listing sends a confirmation email and returns generic success", async () => {
  const { client } = createMemoryClient({
    "therapist-jamie": seedTherapist(),
  });
  const { response, context, emailsSent } = buildContext({
    method: "POST",
    routePath: "/portal/listing-removal/request",
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
  assert.equal(emailsSent.length, 1);
  assert.equal(emailsSent[0].slug, "jamie-rivera");
});

test("listing-removal request: unknown license returns generic success without sending email", async () => {
  const { client } = createMemoryClient();
  const { response, context, emailsSent } = buildContext({
    method: "POST",
    routePath: "/portal/listing-removal/request",
    client,
    body: {
      full_name: "Jamie Rivera",
      email: "jamie@example.com",
      license_number: "LMFT99999",
    },
  });
  await handleAuthAndPortalRoutes(context);
  // Generic success: the endpoint never leaks whether a listing
  // matches, so an attacker can't enumerate the directory.
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.ok, true);
  assert.equal(emailsSent.length, 0);
});

test("listing-removal request: wrong name returns generic success without sending email", async () => {
  const { client } = createMemoryClient({
    "therapist-jamie": seedTherapist(),
  });
  const { response, context, emailsSent } = buildContext({
    method: "POST",
    routePath: "/portal/listing-removal/request",
    client,
    body: {
      full_name: "Someone Else",
      email: "jamie@example.com",
      license_number: "LMFT12345",
    },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(emailsSent.length, 0);
});

test("listing-removal request: wrong email returns generic success without sending email", async () => {
  const { client } = createMemoryClient({
    "therapist-jamie": seedTherapist(),
  });
  const { response, context, emailsSent } = buildContext({
    method: "POST",
    routePath: "/portal/listing-removal/request",
    client,
    body: {
      full_name: "Jamie Rivera",
      email: "attacker@evil.example",
      license_number: "LMFT12345",
    },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(emailsSent.length, 0);
});

test("listing-removal request: already-removed listing silently succeeds without re-emailing", async () => {
  const { client } = createMemoryClient({
    "therapist-jamie": seedTherapist({ listingActive: false }),
  });
  const { response, context, emailsSent } = buildContext({
    method: "POST",
    routePath: "/portal/listing-removal/request",
    client,
    body: {
      full_name: "Jamie Rivera",
      email: "jamie@example.com",
      license_number: "LMFT12345",
    },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(emailsSent.length, 0);
});

test("listing-removal confirm: valid token flips listingActive to false and redirects to /claim?removed=ok", async () => {
  const { client, state } = createMemoryClient({
    "therapist-jamie": seedTherapist(),
  });
  const ctxWrap = buildContext({
    method: "GET",
    routePath: "/portal/listing-removal/confirm",
    url: "http://localhost:8787/portal/listing-removal/confirm?token=tok_1",
    client,
  });
  // Pre-seed a valid token that the stubbed reader will accept.
  ctxWrap.issueToken({
    sub: "listing-removal",
    slug: "jamie-rivera",
    exp: Date.now() + 60_000,
  });

  await handleAuthAndPortalRoutes(ctxWrap.context);

  // Redirect went out
  assert.equal(ctxWrap.httpResponse.statusCode, 302);
  assert.equal(ctxWrap.httpResponse.headers.Location, "http://localhost:8787/claim?removed=ok");

  // Therapist doc was flipped
  const updated = state.documents.get("therapist-jamie");
  assert.equal(updated.listingActive, false);
  assert.ok(updated.listingRemovalRequestedAt);
});

test("listing-removal confirm: invalid token redirects to ?removed=expired", async () => {
  const { client } = createMemoryClient({
    "therapist-jamie": seedTherapist(),
  });
  const ctxWrap = buildContext({
    method: "GET",
    routePath: "/portal/listing-removal/confirm",
    url: "http://localhost:8787/portal/listing-removal/confirm?token=nope",
    client,
  });
  await handleAuthAndPortalRoutes(ctxWrap.context);
  assert.equal(ctxWrap.httpResponse.statusCode, 302);
  assert.equal(
    ctxWrap.httpResponse.headers.Location,
    "http://localhost:8787/claim?removed=expired",
  );
});

test("listing-removal confirm: missing token redirects to ?removed=invalid", async () => {
  const { client } = createMemoryClient();
  const ctxWrap = buildContext({
    method: "GET",
    routePath: "/portal/listing-removal/confirm",
    url: "http://localhost:8787/portal/listing-removal/confirm",
    client,
  });
  await handleAuthAndPortalRoutes(ctxWrap.context);
  assert.equal(ctxWrap.httpResponse.statusCode, 302);
  assert.equal(
    ctxWrap.httpResponse.headers.Location,
    "http://localhost:8787/claim?removed=invalid",
  );
});

test("listing-removal confirm: idempotent — second click on same token still succeeds", async () => {
  const { client, state } = createMemoryClient({
    "therapist-jamie": seedTherapist({
      listingActive: false,
      listingRemovalRequestedAt: "2026-04-18T00:00:00.000Z",
    }),
  });
  const ctxWrap = buildContext({
    method: "GET",
    routePath: "/portal/listing-removal/confirm",
    url: "http://localhost:8787/portal/listing-removal/confirm?token=tok_1",
    client,
  });
  ctxWrap.issueToken({
    sub: "listing-removal",
    slug: "jamie-rivera",
    exp: Date.now() + 60_000,
  });
  await handleAuthAndPortalRoutes(ctxWrap.context);
  assert.equal(ctxWrap.httpResponse.statusCode, 302);
  assert.equal(ctxWrap.httpResponse.headers.Location, "http://localhost:8787/claim?removed=ok");
  // Listing stays removed, original stamp preserved (we don't
  // overwrite the first removal timestamp on idempotent retry).
  const updated = state.documents.get("therapist-jamie");
  assert.equal(updated.listingActive, false);
  assert.equal(updated.listingRemovalRequestedAt, "2026-04-18T00:00:00.000Z");
});
