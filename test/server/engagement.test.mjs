import assert from "node:assert/strict";
import test from "node:test";

import { createReviewApiHandler } from "../../server/review-handler.mjs";
import { createMemoryClient, createTestApiConfig, runHandlerRequest } from "./test-helpers.mjs";

function standardHeaders() {
  return { host: "localhost:8787" };
}

// The engagement endpoints only create summary docs for therapists that exist.
function withTherapists(...slugs) {
  const docs = {};
  for (const slug of slugs) {
    docs["therapist-" + slug] = {
      _id: "therapist-" + slug,
      _type: "therapist",
      slug: { _type: "slug", current: slug },
    };
  }
  return createMemoryClient(docs);
}

test("engagement: view endpoint creates a summary doc and increments counters by source", async function () {
  const { client, state } = withTherapists("jamie-rivera");
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
  const { client, state } = withTherapists("alex-chen");
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

test("engagement: malformed slug is rejected and writes no document", async function () {
  // These public, unauthenticated endpoints interpolate the slug straight
  // into a Sanity _id. An uncapped/unfiltered slug would let anyone create
  // unbounded junk documents in the shared dataset. Reject non-slug input.
  const malformed = [
    "has spaces",
    "café-münchen", // non-ascii
    "trailing-hyphen-",
    "-leading-hyphen",
    "double--hyphen",
    "slug_with_underscores",
    "path/traversal",
    "x".repeat(121), // over the length cap
    "../../etc",
    "drop.table",
  ];

  for (const therapist_slug of malformed) {
    const { client, state } = createMemoryClient();
    const handler = createReviewApiHandler(createTestApiConfig(), client);

    const response = await runHandlerRequest(handler, {
      body: { therapist_slug, source: "directory" },
      headers: standardHeaders(),
      method: "POST",
      url: "/engagement/view",
    });

    assert.equal(response.statusCode, 400, `expected 400 for slug: ${therapist_slug}`);
    const docs = Array.from(state.documents.values()).filter(
      (doc) => doc._type === "therapistEngagementSummary",
    );
    assert.equal(docs.length, 0, `no summary doc should be created for slug: ${therapist_slug}`);
  }
});

test("engagement: a maximum-length valid slug is still accepted", async function () {
  const { client } = withTherapists("a".repeat(120));
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  const response = await runHandlerRequest(handler, {
    body: { therapist_slug: "a".repeat(120), route: "email" },
    headers: standardHeaders(),
    method: "POST",
    url: "/engagement/cta-click",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.ok, true);
});

test("engagement: unknown therapist slug writes no document", async function () {
  // Valid-looking slugs that match no therapist must not mint documents; the
  // dataset has a hard document cap and these endpoints are anonymous.
  const { client, state } = withTherapists("jamie-rivera");
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  for (const url of ["/engagement/view", "/engagement/cta-click"]) {
    for (let i = 0; i < 5; i += 1) {
      const response = await runHandlerRequest(handler, {
        body: { therapist_slug: "made-up-slug-" + i, source: "directory", route: "email" },
        headers: standardHeaders(),
        method: "POST",
        url,
      });
      assert.equal(response.statusCode, 404);
    }
  }
  const docs = Array.from(state.documents.values()).filter(
    (doc) => doc._type === "therapistEngagementSummary",
  );
  assert.equal(docs.length, 0);
});

test("engagement: client-supplied occurred_at cannot pick the week bucket", async function () {
  const { client, state } = withTherapists("jamie-rivera");
  const handler = createReviewApiHandler(createTestApiConfig(), client);

  for (const occurred_at of ["1999-01-01", "2999-12-31T00:00:00Z", "nope"]) {
    const response = await runHandlerRequest(handler, {
      body: { therapist_slug: "jamie-rivera", source: "directory", occurred_at },
      headers: standardHeaders(),
      method: "POST",
      url: "/engagement/view",
    });
    assert.equal(response.statusCode, 200);
  }
  const docs = Array.from(state.documents.values()).filter(
    (doc) => doc._type === "therapistEngagementSummary",
  );
  assert.equal(docs.length, 1, "all events land in the current week's single document");
  assert.equal(docs[0].profileViewsTotal, 3);
  assert.ok(/^20\d\d-W\d\d$/.test(docs[0].periodKey));
  assert.notEqual(docs[0].periodKey, "1998-W53");
});
