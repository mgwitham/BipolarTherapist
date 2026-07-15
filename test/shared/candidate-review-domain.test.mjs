import { test } from "node:test";
import assert from "node:assert/strict";

import { addDays, computeCandidateReviewMeta } from "../../shared/candidate-review-domain.mjs";

const daysBetween = (fromIso, toIso) =>
  Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86400000);

test("addDays adds UTC days to a valid ISO timestamp", () => {
  assert.equal(addDays("2026-07-15T12:00:00.000Z", 2), "2026-07-17T12:00:00.000Z");
  assert.equal(addDays("2026-01-31T00:00:00.000Z", 1), "2026-02-01T00:00:00.000Z"); // month rollover
  assert.equal(addDays("2026-07-15T12:00:00.000Z", 0), "2026-07-15T12:00:00.000Z");
});

test("addDays falls back to now for missing/garbage input", () => {
  for (const input of ["", null, "not-a-date"]) {
    const result = addDays(input, 3);
    const delta = new Date(result).getTime() - (Date.now() + 3 * 86400000);
    assert.ok(Math.abs(delta) < 5000, `${JSON.stringify(input)} → within 5s of now+3d`);
  }
});

test("published/archived candidates → archived lane, 30d revisit", () => {
  for (const reviewStatus of ["published", "archived", "  PUBLISHED  "]) {
    const meta = computeCandidateReviewMeta({ reviewStatus });
    assert.equal(meta.reviewLane, "archived");
    assert.equal(meta.reviewPriority, 10);
    assert.equal(daysBetween(new Date().toISOString(), meta.nextReviewDueAt), 30);
  }
});

test("possible duplicate outranks everything except archived", () => {
  const meta = computeCandidateReviewMeta({
    reviewStatus: "ready_to_publish",
    dedupeStatus: "possible_duplicate",
    readinessScore: 95,
  });
  assert.equal(meta.reviewLane, "resolve_duplicates");
  assert.equal(meta.reviewPriority, 96);
  assert.equal(daysBetween(new Date().toISOString(), meta.nextReviewDueAt), 0); // due now
});

test("needs_confirmation lane: priority clamped to 72–88, due in 2d", () => {
  assert.equal(
    computeCandidateReviewMeta({ reviewStatus: "needs_confirmation" }).reviewPriority,
    72,
  ); // no readiness → floor
  assert.equal(
    computeCandidateReviewMeta({ reviewStatus: "needs_confirmation", readinessScore: 95 })
      .reviewPriority,
    88, // ceiling
  );
  const meta = computeCandidateReviewMeta({
    publishRecommendation: "needs_confirmation", // recommendation alone triggers the lane
    readinessScore: 80,
  });
  assert.equal(meta.reviewLane, "needs_confirmation");
  assert.equal(meta.reviewPriority, 80);
  assert.equal(daysBetween(new Date().toISOString(), meta.nextReviewDueAt), 2);
});

test("ready to publish → publish_now, priority clamped to 85–98, due now", () => {
  assert.equal(computeCandidateReviewMeta({ reviewStatus: "ready_to_publish" }).reviewPriority, 85);
  assert.equal(
    computeCandidateReviewMeta({ publishRecommendation: "ready", readinessScore: 99 })
      .reviewPriority,
    98,
  );
  const meta = computeCandidateReviewMeta({ reviewStatus: "ready_to_publish", readinessScore: 90 });
  assert.equal(meta.reviewLane, "publish_now");
  assert.equal(meta.reviewPriority, 90);
});

test("default lane: editorial_review with blended priority", () => {
  // readiness 70, confidence 0.8 → 70*0.7 + 0.8*20 + 10 = 75
  const meta = computeCandidateReviewMeta({ readinessScore: 70, extractionConfidence: 0.8 });
  assert.equal(meta.reviewLane, "editorial_review");
  assert.equal(meta.reviewPriority, 75);
  // readiness >= 70 → short 1d due date
  assert.equal(daysBetween(new Date().toISOString(), meta.nextReviewDueAt), 1);
});

test("editorial_review: low readiness → 4d due date and floor/ceiling clamps", () => {
  const low = computeCandidateReviewMeta({ readinessScore: 10, extractionConfidence: 0 });
  assert.equal(low.reviewPriority, 52); // floor (10*0.7+10 = 17 → clamped)
  assert.equal(daysBetween(new Date().toISOString(), low.nextReviewDueAt), 4);

  const high = computeCandidateReviewMeta({ readinessScore: 100, extractionConfidence: 1 });
  assert.equal(high.reviewPriority, 84); // ceiling (100*0.7+20+10 = 100 → clamped)
});

test("empty candidate defaults to editorial_review at floor priority", () => {
  const meta = computeCandidateReviewMeta({});
  assert.equal(meta.reviewLane, "editorial_review");
  assert.equal(meta.reviewPriority, 52);
});
