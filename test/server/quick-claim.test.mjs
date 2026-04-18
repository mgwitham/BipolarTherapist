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
        // Stubs for deps we don't exercise in these tests
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
