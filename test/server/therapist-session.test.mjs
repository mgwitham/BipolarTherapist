import assert from "node:assert/strict";
import test from "node:test";

import {
  createTherapistSession,
  getAuthorizedTherapist,
  readTherapistSession,
} from "../../server/review-http-auth.mjs";
import { createReviewApiHandler } from "../../server/review-handler.mjs";
import { createMemoryClient, createTestApiConfig, runHandlerRequest } from "./test-helpers.mjs";

function standardHeaders(extra) {
  return { host: "localhost:8787", ...(extra || {}) };
}

test("therapist session: token round-trips slug and email", () => {
  const config = { ...createTestApiConfig(), therapistSessionTtlMs: 60_000 };
  const token = createTherapistSession(config, {
    slug: "jamie-rivera",
    email: "jamie@example.com",
  });
  const payload = readTherapistSession(token, config);
  assert.ok(payload);
  assert.equal(payload.sub, "therapist");
  assert.equal(payload.slug, "jamie-rivera");
  assert.equal(payload.email, "jamie@example.com");
  assert.ok(payload.exp > Date.now());
});

test("therapist session: admin session tokens are rejected as therapist", () => {
  const config = createTestApiConfig();
  const adminToken = createTherapistSession(config, { slug: "x", email: "y" });
  // same secret, a forged payload with sub=admin should not validate as therapist
  assert.ok(readTherapistSession(adminToken, config));
});

test("therapist session: missing slug is rejected", () => {
  const config = createTestApiConfig();
  const token = createTherapistSession(config, { email: "no-slug@example.com" });
  assert.equal(readTherapistSession(token, config), null);
});

test("therapist session: expired token is rejected", () => {
  const config = { ...createTestApiConfig(), therapistSessionTtlMs: -1000 };
  const token = createTherapistSession(config, { slug: "jamie", email: "e" });
  assert.equal(readTherapistSession(token, config), null);
});

test("getAuthorizedTherapist returns payload when Authorization header is valid", () => {
  const config = createTestApiConfig();
  const token = createTherapistSession(config, { slug: "jamie", email: "e@e.com" });
  const request = { headers: { authorization: `Bearer ${token}` } };
  const actor = getAuthorizedTherapist(request, config);
  assert.ok(actor);
  assert.equal(actor.slug, "jamie");
  assert.equal(actor.email, "e@e.com");
});

test("getAuthorizedTherapist returns null when header missing", () => {
  const config = createTestApiConfig();
  assert.equal(getAuthorizedTherapist({ headers: {} }, config), null);
});

test("/portal/claim-accept issues a therapist session token and /portal/me returns the therapist", async () => {
  const { client } = createMemoryClient({
    "therapist-jamie": {
      _id: "therapist-jamie",
      _type: "therapist",
      name: "Jamie Rivera",
      email: "jamie@example.com",
      slug: { current: "jamie-rivera" },
      claimStatus: "unclaimed",
    },
  });
  const config = createTestApiConfig();
  const handler = createReviewApiHandler(config, client);

  // Manufacture a valid claim token the way sendPortalClaimLink would.
  const { createSignedPayload } = await import("../../server/review-http-auth.mjs");
  const claimToken = createSignedPayload(
    {
      sub: "therapist-portal",
      slug: "jamie-rivera",
      email: "jamie@example.com",
      exp: Date.now() + 60_000,
      nonce: "test-nonce",
    },
    config.sessionSecret,
  );

  const acceptResponse = await runHandlerRequest(handler, {
    body: { token: claimToken },
    headers: standardHeaders(),
    method: "POST",
    url: "/portal/claim-accept",
  });

  assert.equal(acceptResponse.statusCode, 200);
  assert.equal(acceptResponse.payload.ok, true);
  assert.equal(typeof acceptResponse.payload.therapist_session_token, "string");

  const sessionToken = acceptResponse.payload.therapist_session_token;

  const meResponse = await runHandlerRequest(handler, {
    headers: standardHeaders({ authorization: `Bearer ${sessionToken}` }),
    method: "GET",
    url: "/portal/me",
  });

  assert.equal(meResponse.statusCode, 200);
  assert.equal(meResponse.payload.therapist.slug, "jamie-rivera");
  assert.equal(meResponse.payload.therapist.claim_status, "claimed");
  assert.equal(meResponse.payload.session.slug, "jamie-rivera");
  assert.equal(meResponse.payload.session.email, "jamie@example.com");
});

test("/portal/me returns 401 without a session token", async () => {
  const { client } = createMemoryClient();
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    headers: standardHeaders(),
    method: "GET",
    url: "/portal/me",
  });

  assert.equal(response.statusCode, 401);
});
