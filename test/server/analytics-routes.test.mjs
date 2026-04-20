import assert from "node:assert/strict";
import test from "node:test";

import {
  handleAnalyticsRoutes,
  MAX_EVENTS,
  MAX_BATCH_SIZE,
  sanitizeEvent,
  sanitizePayload,
} from "../../server/review-analytics-routes.mjs";
import { createMemoryClient, createTestApiConfig, deepClone } from "./test-helpers.mjs";

function buildContext(options) {
  const bodyPayload = options.body || {};
  const response = {
    statusCode: null,
    payload: null,
  };
  const sendJson = function (_res, statusCode, payload) {
    response.statusCode = statusCode;
    response.payload = payload;
  };
  const request = {
    method: options.method,
    headers: options.headers || { host: "localhost:8787", "user-agent": "test-ua" },
    on() {
      return request;
    },
    destroy() {},
  };
  const parseBody = async () => deepClone(bodyPayload);
  return {
    response,
    context: {
      client: options.client,
      config: options.config || createTestApiConfig(),
      origin: "",
      request,
      response: { writeHead() {}, end() {} },
      routePath: options.routePath,
      deps: {
        parseBody,
        sendJson,
        getAuthorizedActor: options.authorized ? () => ({ username: "admin" }) : () => null,
        isAuthorized: options.authorized ? () => true : () => false,
      },
    },
  };
}

test("sanitizePayload: serializes object and truncates to 1KB", () => {
  const big = { key: "x".repeat(2000) };
  const result = sanitizePayload(big);
  assert.ok(result.length <= 1024);
});

test("sanitizePayload: returns empty string for non-objects", () => {
  assert.equal(sanitizePayload(null), "");
  assert.equal(sanitizePayload("a string"), "");
  assert.equal(sanitizePayload(42), "");
});

test("sanitizeEvent: drops event with no type", () => {
  const result = sanitizeEvent({ occurredAt: "2026-01-01T00:00:00Z" }, "fallback");
  assert.equal(result, null);
});

test("sanitizeEvent: truncates long type names", () => {
  const longType = "x".repeat(200);
  const result = sanitizeEvent({ type: longType }, "2026-01-01");
  assert.ok(result.type.length <= 80);
});

test("POST /analytics/events: appends new events and creates singleton", async () => {
  const { client, state } = createMemoryClient();
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/analytics/events",
    client,
    body: {
      events: [
        {
          type: "signup_page_viewed",
          occurredAt: "2026-04-20T00:00:00Z",
          sessionId: "s-1",
          payload: { path: "/signup" },
        },
        {
          type: "claim_page_viewed",
          occurredAt: "2026-04-20T00:00:10Z",
          sessionId: "s-1",
          payload: {},
        },
      ],
    },
  });
  await handleAnalyticsRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.ok, true);
  assert.equal(response.payload.appended, 2);

  const doc = state.documents.get("funnelEventLog.singleton");
  assert.ok(doc);
  assert.equal(doc.events.length, 2);
  assert.equal(doc.events[0].type, "signup_page_viewed");
  assert.equal(doc.totalAppended, 2);
});

test("POST /analytics/events: prepends new events (most recent first)", async () => {
  const { client, state } = createMemoryClient({
    "funnelEventLog.singleton": {
      _id: "funnelEventLog.singleton",
      _type: "funnelEventLog",
      events: [{ _key: "old1", type: "claim_page_viewed", occurredAt: "2026-04-18T00:00:00Z" }],
      totalAppended: 1,
    },
  });
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/analytics/events",
    client,
    body: { events: [{ type: "signup_new_listing_submitted", occurredAt: "2026-04-20Z" }] },
  });
  await handleAnalyticsRoutes(context);
  assert.equal(response.statusCode, 200);

  const doc = state.documents.get("funnelEventLog.singleton");
  assert.equal(doc.events.length, 2);
  assert.equal(doc.events[0].type, "signup_new_listing_submitted");
  assert.equal(doc.events[1].type, "claim_page_viewed");
  assert.equal(doc.totalAppended, 2);
});

test("POST /analytics/events: truncates ring buffer at MAX_EVENTS", async () => {
  const seeded = [];
  for (let i = 0; i < MAX_EVENTS; i += 1) {
    seeded.push({ _key: "k" + i, type: "existing", occurredAt: "2026-04-18Z" });
  }
  const { client, state } = createMemoryClient({
    "funnelEventLog.singleton": {
      _id: "funnelEventLog.singleton",
      _type: "funnelEventLog",
      events: seeded,
      totalAppended: MAX_EVENTS,
    },
  });
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/analytics/events",
    client,
    body: { events: [{ type: "new_event_1" }, { type: "new_event_2" }] },
  });
  await handleAnalyticsRoutes(context);
  assert.equal(response.statusCode, 200);

  const doc = state.documents.get("funnelEventLog.singleton");
  assert.equal(doc.events.length, MAX_EVENTS);
  assert.equal(doc.events[0].type, "new_event_1");
  assert.equal(doc.events[1].type, "new_event_2");
  assert.equal(doc.totalAppended, MAX_EVENTS + 2);
});

test("POST /analytics/events: caps batch size", async () => {
  const oversized = [];
  for (let i = 0; i < MAX_BATCH_SIZE + 20; i += 1) {
    oversized.push({ type: "spam_event_" + i });
  }
  const { client } = createMemoryClient();
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/analytics/events",
    client,
    body: { events: oversized },
  });
  await handleAnalyticsRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.appended, MAX_BATCH_SIZE);
});

test("POST /analytics/events: ignores empty events array", async () => {
  const { client } = createMemoryClient();
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/analytics/events",
    client,
    body: { events: [] },
  });
  await handleAnalyticsRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.appended, 0);
});

test("GET /analytics/events: requires admin auth", async () => {
  const { client } = createMemoryClient();
  const { response, context } = buildContext({
    method: "GET",
    routePath: "/analytics/events",
    client,
    authorized: false,
  });
  await handleAnalyticsRoutes(context);
  assert.equal(response.statusCode, 401);
});

test("GET /analytics/events: returns empty log when singleton missing", async () => {
  const { client } = createMemoryClient();
  const { response, context } = buildContext({
    method: "GET",
    routePath: "/analytics/events",
    client,
    authorized: true,
  });
  await handleAnalyticsRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload.events, []);
  assert.equal(response.payload.totalAppended, 0);
});

test("GET /analytics/events: returns stored log for admin", async () => {
  const { client } = createMemoryClient({
    "funnelEventLog.singleton": {
      _id: "funnelEventLog.singleton",
      _type: "funnelEventLog",
      events: [{ _key: "k1", type: "signup_page_viewed", occurredAt: "2026-04-20Z" }],
      updatedAt: "2026-04-20T00:00:00Z",
      totalAppended: 1,
    },
  });
  const { response, context } = buildContext({
    method: "GET",
    routePath: "/analytics/events",
    client,
    authorized: true,
  });
  await handleAnalyticsRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.events.length, 1);
  assert.equal(response.payload.events[0].type, "signup_page_viewed");
  assert.equal(response.payload.totalAppended, 1);
});
