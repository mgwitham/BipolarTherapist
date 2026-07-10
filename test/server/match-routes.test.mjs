import assert from "node:assert/strict";
import test from "node:test";

import { createReviewApiHandler } from "../../server/review-handler.mjs";
import {
  createMemoryClient,
  createTestApiConfig,
  createTransactionSpy,
  runHandlerRequest,
} from "./test-helpers.mjs";

// createMemoryClient has no transaction(); the match routes commit through one,
// so attach the shared spy (it writes into the same document state).
function createHandler(documents = {}) {
  const { client, state } = createMemoryClient(documents);
  client.transaction = () => createTransactionSpy(state);
  return { state, handler: createReviewApiHandler(createTestApiConfig(), client) };
}

function post(handler, url, body) {
  return runHandlerRequest(handler, {
    body,
    headers: { host: "localhost:8787" },
    method: "POST",
    url,
  });
}

// The exact payload assets/match.js persistMatchRequest() sends. It keys the
// request on `journey_id`, never `request_id`. A validator that required
// `request_id` silently 400'd every real match submission for two months
// (shipped 2026-05-08, found 2026-07-09) — this test is the regression guard.
const CLIENT_PAYLOAD = {
  journey_id: "1778402622456:CA:some-therapist-slug",
  source_surface: "match_flow",
  created_at: "2026-07-09T12:00:00.000Z",
  request_summary: "Adult seeking bipolar therapy in CA",
  care_state: "CA",
  care_format: "telehealth",
  result_count: 5,
};

test("POST /match/requests accepts the client payload keyed on journey_id", async () => {
  const { handler } = createHandler();
  const response = await post(handler, "/match/requests", CLIENT_PAYLOAD);

  assert.equal(response.statusCode, 201, `expected 201, got ${JSON.stringify(response.payload)}`);
  assert.equal(response.payload.ok, true);
  assert.equal(response.payload.type, "matchRequest");
  assert.ok(response.payload.id);
});

test("POST /match/requests persists the journey_id as the document requestId", async () => {
  const { state, handler } = createHandler();
  await post(handler, "/match/requests", CLIENT_PAYLOAD);

  const stored = Array.from(state.documents.values()).find((doc) => doc._type === "matchRequest");
  assert.ok(stored, "matchRequest document was not written");
  assert.equal(stored.requestId, CLIENT_PAYLOAD.journey_id);
  assert.equal(stored.sourceSurface, "match_flow");
  assert.equal(stored.careState, "CA");
});

test("POST /match/requests still accepts a request_id from script/API callers", async () => {
  const { handler } = createHandler();
  const response = await post(handler, "/match/requests", {
    request_id: "smoke-test-1",
    source_surface: "api",
    created_at: "2026-07-09T12:00:00.000Z",
  });

  assert.equal(response.statusCode, 201);
});

test("POST /match/requests rejects a body carrying neither identifier", async () => {
  const { handler } = createHandler();
  const response = await post(handler, "/match/requests", {
    source_surface: "match_flow",
    created_at: "2026-07-09T12:00:00.000Z",
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.payload.error, /request_id or journey_id is required/);
});

test("POST /match/requests still enforces field length limits", async () => {
  const { handler } = createHandler();
  const response = await post(handler, "/match/requests", {
    journey_id: "x".repeat(129),
    source_surface: "match_flow",
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.payload.error, /journey_id/);
});
