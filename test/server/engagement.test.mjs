import assert from "node:assert/strict";
import test from "node:test";

import { createReviewApiHandler } from "../../server/review-handler.mjs";
import { createMemoryClient, createTestApiConfig, runHandlerRequest } from "./test-helpers.mjs";

function standardHeaders() {
  return { host: "localhost:8787" };
}

test("engagement: view endpoint creates a summary doc and increments counters by source", async function () {
  const { client, state } = createMemoryClient();
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const first = await runHandlerRequest(handler, {
    body: { therapist_slug: "jamie-rivera", source: "directory" },
    headers: standardHeaders(),
    method: "POST",
    url: "/engagement/view",
  });

  assert.equal(first.statusCode, 200);
  assert.equal(first.payload.ok, true);
  assert.equal(first.payload.profileViewsTotal, 1);

  const second = await runHandlerRequest(handler, {
    body: { therapist_slug: "jamie-rivera", source: "match" },
    headers: standardHeaders(),
    method: "POST",
    url: "/engagement/view",
  });

  assert.equal(second.payload.profileViewsTotal, 2);

  const docs = Array.from(state.documents.values()).filter(
    (doc) => doc._type === "therapistEngagementSummary",
  );
  assert.equal(docs.length, 1, "expected one summary doc per therapist per month");
  const summary = docs[0];
  assert.equal(summary.therapistSlug, "jamie-rivera");
  assert.equal(summary.profileViewsTotal, 2);
  assert.equal(summary.profileViewsDirectory, 1);
  assert.equal(summary.profileViewsMatch, 1);
});

test("engagement: cta-click endpoint increments route counters", async function () {
  const { client, state } = createMemoryClient();
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  await runHandlerRequest(handler, {
    body: { therapist_slug: "alex-chen", route: "email" },
    headers: standardHeaders(),
    method: "POST",
    url: "/engagement/cta-click",
  });
  await runHandlerRequest(handler, {
    body: { therapist_slug: "alex-chen", route: "email" },
    headers: standardHeaders(),
    method: "POST",
    url: "/engagement/cta-click",
  });
  const last = await runHandlerRequest(handler, {
    body: { therapist_slug: "alex-chen", route: "booking" },
    headers: standardHeaders(),
    method: "POST",
    url: "/engagement/cta-click",
  });

  assert.equal(last.statusCode, 200);
  assert.equal(last.payload.ctaClicksTotal, 3);

  const summary = Array.from(state.documents.values()).find(
    (doc) => doc._type === "therapistEngagementSummary",
  );
  assert.equal(summary.ctaClicksEmail, 2);
  assert.equal(summary.ctaClicksBooking, 1);
  assert.equal(summary.ctaClicksTotal, 3);
});

test("engagement: missing therapist_slug returns 400", async function () {
  const { client } = createMemoryClient();
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    body: { source: "directory" },
    headers: standardHeaders(),
    method: "POST",
    url: "/engagement/view",
  });

  assert.equal(response.statusCode, 400);
});
