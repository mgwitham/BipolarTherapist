import assert from "node:assert/strict";
import test from "node:test";

import { handleAuthAndPortalRoutes } from "../../server/review-auth-portal-routes.mjs";
import { createMemoryClient, createTestApiConfig, deepClone } from "./test-helpers.mjs";

// Context builder for the photo-review endpoints (admin approve/reject +
// the public opt-out confirm). Mirrors listing-removal.test.mjs.
function buildContext(options) {
  const bodyPayload = options.body || {};
  const response = { statusCode: null, payload: null, headers: {} };
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

  const tokens = new Map();
  const readPhotoOptOutToken = (_config, token) => tokens.get(token) || null;
  const issueOptOutToken = (payload) => {
    const token = `optout_${tokens.size + 1}`;
    tokens.set(token, payload);
    return token;
  };

  const routePath = options.routePath;
  const urlString = options.url || `http://localhost:8787${routePath}`;

  return {
    response,
    httpResponse,
    issueOptOutToken,
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
        isAuthorized: () => options.authorized === true,
        readPhotoOptOutToken,
        buildPhotoOptOutToken: () => "optout_stub",
        refreshTherapistSessionIfStale: () => {},
      },
    },
  };
}

function seedTherapist(overrides = {}) {
  return {
    _id: "therapist-jamie",
    _type: "therapist",
    name: "Dr. Jamie Rivera",
    email: "jamie@example.com",
    slug: { current: "jamie-rivera", _type: "slug" },
    photoCandidateStatus: "pending",
    // The production query projects these off photoCandidate.asset; the
    // in-memory client returns the raw doc, so seed them directly.
    candidateAssetRef: "image-abc",
    candidateUrl: "https://cdn.sanity/image-abc.jpg",
    ...overrides,
  };
}

test("photo approve: requires an admin session", async () => {
  const { client } = createMemoryClient({ "therapist-jamie": seedTherapist() });
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/portal/photo-review/approve",
    client,
    authorized: false,
    body: { slug: "jamie-rivera" },
  });
  assert.equal(await handleAuthAndPortalRoutes(context), true);
  assert.equal(response.statusCode, 401);
});

test("photo approve: publishes the candidate into the live photo field", async () => {
  const { client, state } = createMemoryClient({ "therapist-jamie": seedTherapist() });
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/portal/photo-review/approve",
    client,
    authorized: true,
    body: { slug: "jamie-rivera" },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.published, true);

  const doc = state.documents.get("therapist-jamie");
  assert.equal(doc.photoSourceType, "public_source");
  assert.equal(doc.photoCandidateStatus, "approved");
  assert.equal(doc.photoUsagePermissionConfirmed, false);
  assert.equal(doc.photo.asset._ref, "image-abc");
});

test("photo approve: 409 when there is no pending candidate", async () => {
  const { client } = createMemoryClient({
    "therapist-jamie": seedTherapist({ photoCandidateStatus: "approved" }),
  });
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/portal/photo-review/approve",
    client,
    authorized: true,
    body: { slug: "jamie-rivera" },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 409);
});

test("photo reject: suppresses without publishing", async () => {
  const { client, state } = createMemoryClient({ "therapist-jamie": seedTherapist() });
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/portal/photo-review/reject",
    client,
    authorized: true,
    body: { slug: "jamie-rivera" },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 200);
  const doc = state.documents.get("therapist-jamie");
  assert.equal(doc.photoSuppressed, true);
  assert.equal(doc.photoCandidateStatus, "rejected");
  assert.equal(doc.photo, undefined);
});

test("photo opt-out: valid token clears a published public-source photo", async () => {
  const { client, state } = createMemoryClient({
    "therapist-jamie": seedTherapist({
      photoSourceType: "public_source",
      photoCandidateStatus: "approved",
      photo: { _type: "image", asset: { _type: "reference", _ref: "image-abc" } },
    }),
  });
  const built = buildContext({
    method: "GET",
    routePath: "/portal/photo-optout/confirm",
    client,
  });
  const token = built.issueOptOutToken({ sub: "photo-optout", slug: "jamie-rivera" });
  built.context.url = new URL(`http://localhost:8787/portal/photo-optout/confirm?token=${token}`);
  await handleAuthAndPortalRoutes(built.context);
  assert.equal(built.httpResponse.statusCode, 302);
  assert.match(built.httpResponse.headers.Location, /remove\?photo=removed/);

  const doc = state.documents.get("therapist-jamie");
  assert.equal(doc.photoSuppressed, true);
  assert.equal(doc.photo, null);
  assert.equal(doc.photoSourceType, null);
});

test("photo opt-out: invalid token redirects without changing anything", async () => {
  const { client, state } = createMemoryClient({
    "therapist-jamie": seedTherapist({ photoSourceType: "public_source" }),
  });
  const built = buildContext({
    method: "GET",
    routePath: "/portal/photo-optout/confirm",
    client,
    url: "http://localhost:8787/portal/photo-optout/confirm?token=bogus",
  });
  await handleAuthAndPortalRoutes(built.context);
  assert.equal(built.httpResponse.statusCode, 302);
  assert.match(built.httpResponse.headers.Location, /remove\?photo=expired/);
  assert.equal(state.documents.get("therapist-jamie").photoSuppressed, undefined);
});
