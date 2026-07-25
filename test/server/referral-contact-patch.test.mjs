import assert from "node:assert/strict";
import test from "node:test";

import { handleReferralRoutes } from "../../server/review-referral-routes.mjs";
import { createMemoryClient, createTestApiConfig, deepClone } from "./test-helpers.mjs";

// PATCH /api/review/admin/referral-contact/<id>
//
// client.patch(id) targets ANY document. `status` is a live field on therapist
// docs, where anything other than "active" drops the listing out of every
// public query (see PUBLIC_THERAPIST_LIST_QUERY), so a mistargeted id would
// silently take a real listing offline with no publish event recording it.

function buildContext(options) {
  const captured = { statusCode: null, payload: null };
  const response = {
    writeHead(statusCode) {
      captured.statusCode = statusCode;
    },
    end(raw) {
      captured.payload = raw ? JSON.parse(raw) : null;
    },
  };
  const request = {
    method: options.method || "PATCH",
    headers: { host: "localhost:8787" },
  };
  return {
    captured,
    context: {
      client: options.client,
      config: createTestApiConfig(),
      request,
      response,
      routePath: options.routePath,
      deps: {
        parseBody: async () => deepClone(options.body || {}),
        readAdminSessionFromRequest: () =>
          options.session === undefined ? { sub: "admin" } : options.session,
      },
    },
  };
}

function seedContact(overrides = {}) {
  return {
    _id: "referralContact-1",
    _type: "referralContact",
    name: "Dr. Prescriber",
    email: "prescriber@example.com",
    status: "queued",
    ...overrides,
  };
}

function seedTherapist(overrides = {}) {
  return {
    _id: "therapist-jamie",
    _type: "therapist",
    name: "Jamie Rivera",
    slug: { current: "jamie-rivera", _type: "slug" },
    status: "active",
    listingActive: true,
    ...overrides,
  };
}

test("referral PATCH: updates a genuine referralContact", async () => {
  const { client, state } = createMemoryClient({
    "referralContact-1": seedContact(),
  });
  const { captured, context } = buildContext({
    client,
    routePath: "/admin/referral-contact/referralContact-1",
    body: { status: "contacted", notes: "Left a voicemail" },
  });
  await handleReferralRoutes(context);
  assert.equal(captured.statusCode, 200);
  const doc = state.documents.get("referralContact-1");
  assert.equal(doc.status, "contacted");
  assert.equal(doc.notes, "Left a voicemail");
});

test("referral PATCH: refuses a therapist id instead of delisting the profile", async () => {
  const { client, state } = createMemoryClient({
    "therapist-jamie": seedTherapist(),
  });
  const { captured, context } = buildContext({
    client,
    routePath: "/admin/referral-contact/therapist-jamie",
    // "opted_out" is a valid referralContact status, and would have been
    // written straight onto the therapist's live `status` field.
    body: { status: "opted_out" },
  });
  await handleReferralRoutes(context);
  assert.equal(captured.statusCode, 404);
  const doc = state.documents.get("therapist-jamie");
  assert.equal(doc.status, "active", "the listing must stay published");
  assert.equal(doc.optedOut, undefined, "no CRM fields may leak onto a therapist");
});

test("referral PATCH: refuses an unknown id", async () => {
  const { client } = createMemoryClient();
  const { captured, context } = buildContext({
    client,
    routePath: "/admin/referral-contact/does-not-exist",
    body: { status: "contacted" },
  });
  await handleReferralRoutes(context);
  assert.equal(captured.statusCode, 404);
});

test("referral PATCH: still requires an admin session", async () => {
  const { client, state } = createMemoryClient({
    "referralContact-1": seedContact(),
  });
  const { captured, context } = buildContext({
    client,
    routePath: "/admin/referral-contact/referralContact-1",
    body: { status: "contacted" },
    session: null,
  });
  await handleReferralRoutes(context);
  assert.equal(captured.statusCode, 401);
  assert.equal(state.documents.get("referralContact-1").status, "queued");
});

test("referral PATCH: validation still rejects an unknown status before any write", async () => {
  const { client, state } = createMemoryClient({
    "referralContact-1": seedContact(),
  });
  const { captured, context } = buildContext({
    client,
    routePath: "/admin/referral-contact/referralContact-1",
    body: { status: "not-a-real-status" },
  });
  await handleReferralRoutes(context);
  assert.equal(captured.statusCode, 400);
  assert.equal(state.documents.get("referralContact-1").status, "queued");
});
