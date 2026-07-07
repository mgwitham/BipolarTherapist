import assert from "node:assert/strict";
import test from "node:test";

import { handleAuthAndPortalRoutes } from "../../server/review-auth-portal-routes.mjs";
import { createMemoryClient, createTestApiConfig, deepClone } from "./test-helpers.mjs";

// Therapist-session routes for resolving a sourced photo from the portal:
// POST /portal/photo/keep and /portal/photo/remove.
function buildContext(options) {
  const response = { statusCode: null, payload: null };
  const sendJson = function sendJson(_res, statusCode, payload) {
    response.statusCode = statusCode;
    response.payload = payload;
  };
  const request = {
    method: "POST",
    headers: { host: "localhost:8787" },
    on() {
      return request;
    },
    destroy() {},
  };
  return {
    response,
    context: {
      client: options.client,
      config: createTestApiConfig(),
      origin: "",
      request,
      response: { setHeader() {}, end() {} },
      routePath: options.routePath,
      url: new URL(`http://localhost:8787${options.routePath}`),
      deps: {
        parseBody: async () => deepClone(options.body || {}),
        sendJson,
        getAuthorizedTherapist: () => options.session || null,
        refreshTherapistSessionIfStale: () => {},
        isAuthorized: () => false,
      },
    },
  };
}

function seedTherapist(overrides = {}) {
  return {
    _id: "therapist-jamie",
    _type: "therapist",
    name: "Dr. Jamie Rivera",
    slug: { current: "jamie-rivera", _type: "slug" },
    claimStatus: "claimed",
    ...overrides,
  };
}

const SESSION = { slug: "jamie-rivera", email: "jamie@example.com" };

test("photo keep: requires a therapist session", async () => {
  const { client } = createMemoryClient({ "therapist-jamie": seedTherapist() });
  const { response, context } = buildContext({
    client,
    routePath: "/portal/photo/keep",
    session: null,
  });
  assert.equal(await handleAuthAndPortalRoutes(context), true);
  assert.equal(response.statusCode, 401);
});

test("photo keep: confirms consent on a published public-source photo", async () => {
  const { client, state } = createMemoryClient({
    "therapist-jamie": seedTherapist({
      photo: { _type: "image", asset: { _type: "reference", _ref: "image-live" } },
      photoSourceType: "public_source",
      photoUsagePermissionConfirmed: false,
      photoCandidateStatus: "approved",
      hasPhoto: true,
      photoUrl: "https://cdn/x.jpg",
    }),
  });
  const { response, context } = buildContext({
    client,
    routePath: "/portal/photo/keep",
    session: SESSION,
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.kept, true);

  const doc = state.documents.get("therapist-jamie");
  assert.equal(doc.photoUsagePermissionConfirmed, true);
  assert.equal(doc.photoSourceType, "practice_uploaded");
  assert.equal(doc.photoSuppressed, false);
  // Live photo untouched
  assert.equal(doc.photo.asset._ref, "image-live");
});

test("photo keep: publishes a pending candidate directly", async () => {
  const { client, state } = createMemoryClient({
    "therapist-jamie": seedTherapist({
      photoCandidateStatus: "pending",
      candidateAssetRef: "image-cand",
      candidateUrl: "https://cdn/cand.jpg",
    }),
  });
  const { response, context } = buildContext({
    client,
    routePath: "/portal/photo/keep",
    session: SESSION,
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.photo_url, "https://cdn/cand.jpg");

  const doc = state.documents.get("therapist-jamie");
  assert.equal(doc.photo.asset._ref, "image-cand");
  assert.equal(doc.photoUsagePermissionConfirmed, true);
});

test("photo keep: 409 when there is nothing sourced to confirm", async () => {
  const { client } = createMemoryClient({
    "therapist-jamie": seedTherapist({
      photo: { asset: { _ref: "image-own" } },
      photoSourceType: "therapist_uploaded",
      hasPhoto: true,
    }),
  });
  const { response, context } = buildContext({
    client,
    routePath: "/portal/photo/keep",
    session: SESSION,
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 409);
});

test("photo remove: clears a published public-source photo and suppresses", async () => {
  const { client, state } = createMemoryClient({
    "therapist-jamie": seedTherapist({
      photo: { asset: { _ref: "image-live" } },
      photoSourceType: "public_source",
      photoCandidateStatus: "approved",
      hasPhoto: true,
    }),
  });
  const { response, context } = buildContext({
    client,
    routePath: "/portal/photo/remove",
    session: SESSION,
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.removed, true);

  const doc = state.documents.get("therapist-jamie");
  assert.equal(doc.photo, null);
  assert.equal(doc.photoSuppressed, true);
  assert.equal(doc.photoSourceType, null);
});

test("photo remove: never touches a therapist-uploaded photo", async () => {
  const { client } = createMemoryClient({
    "therapist-jamie": seedTherapist({
      photo: { asset: { _ref: "image-own" } },
      photoSourceType: "therapist_uploaded",
      hasPhoto: true,
    }),
  });
  const { response, context } = buildContext({
    client,
    routePath: "/portal/photo/remove",
    session: SESSION,
  });
  await handleAuthAndPortalRoutes(context);
  // No sourced state → 409, own upload untouched by this path.
  assert.equal(response.statusCode, 409);
});
