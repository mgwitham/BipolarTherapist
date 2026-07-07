import assert from "node:assert/strict";
import test from "node:test";

import { handleAuthAndPortalRoutes } from "../../server/review-auth-portal-routes.mjs";
import { createMemoryClient, createTestApiConfig, deepClone } from "./test-helpers.mjs";

// Manual admin headshot upload: POST /portal/photo-admin-upload publishes
// a pasted/picked image straight onto a listing as a reviewed
// public-source photo.

// Smallest payload that passes the PNG magic-byte check (8-byte
// signature + padding past the 12-byte floor).
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 1),
]);
const PNG_DATA_URL = "data:image/png;base64," + PNG_BYTES.toString("base64");

function buildContext(options) {
  const response = { statusCode: null, payload: null };
  const sendJson = function sendJson(_res, statusCode, payload) {
    response.statusCode = statusCode;
    response.payload = payload;
  };
  const request = {
    method: options.method || "POST",
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
        isAuthorized: () => options.authorized === true,
        getAuthorizedTherapist: () => null,
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
    claimStatus: "unclaimed",
    ...overrides,
  };
}

// The memory client has no assets API; attach a stub like production's
// client.assets.upload that records what was uploaded.
function withAssetStub(client) {
  const uploads = [];
  client.assets = {
    async upload(_type, buffer, opts) {
      uploads.push({ bytes: buffer.length, ...opts });
      return { _id: "image-manual-1", url: "https://cdn.sanity/manual-1.png" };
    },
  };
  return uploads;
}

test("manual upload: requires an admin session", async () => {
  const { client } = createMemoryClient({ "therapist-jamie": seedTherapist() });
  const { response, context } = buildContext({
    client,
    routePath: "/portal/photo-admin-upload",
    authorized: false,
    body: { slug: "jamie-rivera", photo_upload_base64: PNG_DATA_URL },
  });
  assert.equal(await handleAuthAndPortalRoutes(context), true);
  assert.equal(response.statusCode, 401);
});

test("manual upload: publishes as reviewed public-source with provenance", async () => {
  const { client, state } = createMemoryClient({ "therapist-jamie": seedTherapist() });
  const uploads = withAssetStub(client);
  const { response, context } = buildContext({
    client,
    routePath: "/portal/photo-admin-upload",
    authorized: true,
    body: {
      slug: "jamie-rivera",
      photo_upload_base64: PNG_DATA_URL,
      photo_filename: "screenshot.png",
      source_url: "https://www.psychologytoday.com/profile/jamie",
    },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.published, true);
  assert.equal(response.payload.photo_url, "https://cdn.sanity/manual-1.png");
  assert.equal(uploads.length, 1);

  const doc = state.documents.get("therapist-jamie");
  assert.equal(doc.photo.asset._ref, "image-manual-1");
  assert.equal(doc.photoSourceType, "public_source");
  assert.equal(doc.photoUsagePermissionConfirmed, false);
  assert.equal(doc.photoCandidateSourceUrl, "https://www.psychologytoday.com/profile/jamie");
  assert.equal(doc.photoCandidateSourceHost, "psychologytoday.com");
  // Silent by default
  assert.equal(response.payload.noticeSent, false);
});

test("manual upload: refuses when the therapist opted out", async () => {
  const { client } = createMemoryClient({
    "therapist-jamie": seedTherapist({ photoSuppressed: true }),
  });
  withAssetStub(client);
  const { response, context } = buildContext({
    client,
    routePath: "/portal/photo-admin-upload",
    authorized: true,
    body: { slug: "jamie-rivera", photo_upload_base64: PNG_DATA_URL },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 409);
  assert.match(response.payload.error, /opted out/);
});

test("manual upload: never overwrites a therapist-provided photo", async () => {
  const { client } = createMemoryClient({
    "therapist-jamie": seedTherapist({
      photo: { asset: { _ref: "image-own" } },
      photoSourceType: "therapist_uploaded",
      hasPhoto: true,
    }),
  });
  withAssetStub(client);
  const { response, context } = buildContext({
    client,
    routePath: "/portal/photo-admin-upload",
    authorized: true,
    body: { slug: "jamie-rivera", photo_upload_base64: PNG_DATA_URL },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 409);
  assert.match(response.payload.error, /therapist provided/);
});

test("manual upload: rejects bytes that don't match the claimed image type", async () => {
  const { client } = createMemoryClient({ "therapist-jamie": seedTherapist() });
  withAssetStub(client);
  const fake =
    "data:image/png;base64," + Buffer.from("this is not a png at all").toString("base64");
  const { response, context } = buildContext({
    client,
    routePath: "/portal/photo-admin-upload",
    authorized: true,
    body: { slug: "jamie-rivera", photo_upload_base64: fake },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 400);
});

test("upload targets: lists photo-less live listings, admin-gated", async () => {
  const { client } = createMemoryClient({ "therapist-jamie": seedTherapist() });
  const denied = buildContext({
    client,
    method: "GET",
    routePath: "/portal/photo-upload-targets",
    authorized: false,
  });
  await handleAuthAndPortalRoutes(denied.context);
  assert.equal(denied.response.statusCode, 401);

  const ok = buildContext({
    client,
    method: "GET",
    routePath: "/portal/photo-upload-targets",
    authorized: true,
  });
  await handleAuthAndPortalRoutes(ok.context);
  assert.equal(ok.response.statusCode, 200);
  assert.ok(Array.isArray(ok.response.payload.therapists));
});

test("admin remove: takes down a wrong public-source photo without suppressing", async () => {
  const { client, state } = createMemoryClient({
    "therapist-jamie": seedTherapist({
      photo: { asset: { _ref: "image-wrong" } },
      photoSourceType: "public_source",
      photoCandidateStatus: "approved",
      photoReviewedAt: "2026-07-01T00:00:00.000Z",
      hasPhoto: true,
    }),
  });
  const denied = buildContext({
    client,
    routePath: "/portal/photo-admin-remove",
    authorized: false,
    body: { slug: "jamie-rivera" },
  });
  await handleAuthAndPortalRoutes(denied.context);
  assert.equal(denied.response.statusCode, 401);

  const { response, context } = buildContext({
    client,
    routePath: "/portal/photo-admin-remove",
    authorized: true,
    body: { slug: "jamie-rivera" },
  });
  await handleAuthAndPortalRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.removed, true);

  const doc = state.documents.get("therapist-jamie");
  assert.equal(doc.photo, null);
  assert.equal(doc.photoSourceType, null);
  assert.equal(doc.photoCandidateStatus, "rejected");
  // Not an opt-out: the listing must stay open for a corrected upload.
  assert.notEqual(doc.photoSuppressed, true);
});

test("admin remove: refuses therapist-provided photos and photo-less listings", async () => {
  const { client } = createMemoryClient({
    "therapist-jamie": seedTherapist({
      photo: { asset: { _ref: "image-own" } },
      photoSourceType: "therapist_uploaded",
      hasPhoto: true,
    }),
    "therapist-alex": {
      ...seedTherapist(),
      _id: "therapist-alex",
      name: "Alex Kim",
      slug: { current: "alex-kim", _type: "slug" },
    },
  });
  const own = buildContext({
    client,
    routePath: "/portal/photo-admin-remove",
    authorized: true,
    body: { slug: "jamie-rivera" },
  });
  await handleAuthAndPortalRoutes(own.context);
  assert.equal(own.response.statusCode, 409);
  assert.match(own.response.payload.error, /provided by the therapist/);

  const bare = buildContext({
    client,
    routePath: "/portal/photo-admin-remove",
    authorized: true,
    body: { slug: "alex-kim" },
  });
  await handleAuthAndPortalRoutes(bare.context);
  assert.equal(bare.response.statusCode, 409);
  assert.match(bare.response.payload.error, /no photo/);
});

test("admin remove then re-upload: the corrected photo publishes", async () => {
  const { client, state } = createMemoryClient({
    "therapist-jamie": seedTherapist({
      photo: { asset: { _ref: "image-wrong" } },
      photoSourceType: "public_source",
      photoCandidateStatus: "approved",
      hasPhoto: true,
    }),
  });
  withAssetStub(client);
  const removal = buildContext({
    client,
    routePath: "/portal/photo-admin-remove",
    authorized: true,
    body: { slug: "jamie-rivera" },
  });
  await handleAuthAndPortalRoutes(removal.context);
  assert.equal(removal.response.statusCode, 200);

  const upload = buildContext({
    client,
    routePath: "/portal/photo-admin-upload",
    authorized: true,
    body: {
      slug: "jamie-rivera",
      photo_upload_base64: PNG_DATA_URL,
      photo_filename: "corrected.png",
    },
  });
  await handleAuthAndPortalRoutes(upload.context);
  assert.equal(upload.response.statusCode, 200);
  assert.equal(upload.response.payload.published, true);
  const doc = state.documents.get("therapist-jamie");
  assert.equal(doc.photo.asset._ref, "image-manual-1");
  assert.equal(doc.photoSourceType, "public_source");
});
