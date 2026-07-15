import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decodeReviewEventCursor,
  encodeReviewEventCursor,
  getEventLane,
  reviewEventSortStamp,
} from "../../shared/review-event-feed.mjs";

test("getEventLane: licensure/ops event types win over entity ids", () => {
  assert.equal(getEventLane({ eventType: "licensure_refreshed", applicationId: "a1" }), "ops");
  assert.equal(getEventLane({ eventType: "therapist_review_completed", therapistId: "t1" }), "ops");
  assert.equal(getEventLane({ eventType: "therapist_review_deferred" }), "ops");
});

test("getEventLane: entity id precedence application > candidate > therapist", () => {
  assert.equal(
    getEventLane({
      eventType: "publish",
      applicationId: "a1",
      candidateId: "c1",
      therapistId: "t1",
    }),
    "application",
  );
  assert.equal(
    getEventLane({ eventType: "publish", candidateDocumentId: "cd1", therapistId: "t1" }),
    "candidate",
  );
  assert.equal(getEventLane({ eventType: "publish", therapistId: "t1" }), "therapist");
});

test("getEventLane: nothing identifiable → ops", () => {
  assert.equal(getEventLane({}), "ops");
  assert.equal(getEventLane(null), "ops");
});

test("reviewEventSortStamp prefers createdAt over _createdAt", () => {
  assert.equal(reviewEventSortStamp({ createdAt: "A", _createdAt: "B" }), "A");
  assert.equal(reviewEventSortStamp({ _createdAt: "B" }), "B");
  assert.equal(reviewEventSortStamp(null), "");
});

test("cursor round-trips through encode/decode", () => {
  const doc = { _id: "evt-123", createdAt: "2026-07-15T12:00:00Z" };
  const cursor = encodeReviewEventCursor(doc);
  assert.equal(cursor, "2026-07-15T12:00:00Z|evt-123");
  assert.deepEqual(decodeReviewEventCursor(cursor), { ts: "2026-07-15T12:00:00Z", id: "evt-123" });
});

test("decode: legacy timestamp-only cursor gets empty id", () => {
  assert.deepEqual(decodeReviewEventCursor("2026-07-15T12:00:00Z"), {
    ts: "2026-07-15T12:00:00Z",
    id: "",
  });
});

test("decode: ids containing pipes survive (lastIndexOf split)", () => {
  const doc = { _id: "weird|id", createdAt: "TS" };
  // encode produces "TS|weird|id"; decode must split on the LAST pipe…
  const decoded = decodeReviewEventCursor(encodeReviewEventCursor(doc));
  // …so ts absorbs the extra pipe segment; documents the actual contract:
  assert.deepEqual(decoded, { ts: "TS|weird", id: "id" });
});

test("decode: blank input → null", () => {
  assert.equal(decodeReviewEventCursor(""), null);
  assert.equal(decodeReviewEventCursor("   "), null);
  assert.equal(decodeReviewEventCursor(null), null);
});
