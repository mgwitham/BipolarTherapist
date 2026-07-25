import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFieldTrustMeta,
  computeTherapistCompletenessScore,
  computeTherapistVerificationMeta,
} from "../../shared/therapist-trust-domain.mjs";

test("trust meta recognizes editorial review with degraded source health", function () {
  const record = {
    sourceReviewedAt: "2026-03-01T00:00:00.000Z",
    therapistReportedConfirmedAt: "2026-03-15T00:00:00.000Z",
    therapistReportedFields: ["insuranceAccepted"],
    sourceHealthStatus: "error",
    fieldReviewStates: {
      estimatedWaitTime: "editorially_verified",
      insuranceAccepted: "needs_reconfirmation",
      telehealthStates: "unknown",
      bipolarYearsExperience: "unknown",
    },
  };

  const meta = buildFieldTrustMeta(record);

  assert.equal(meta.estimatedWaitTime.sourceKind, "editorial_source_review");
  assert.equal(meta.insuranceAccepted.sourceKind, "degraded_source");
  assert.equal(meta.insuranceAccepted.reviewState, "needs_reconfirmation");
  assert.equal(meta.estimatedWaitTime.staleAfterDays, 21);
});

test("verification meta escalates missing operational review and reconfirmation work", function () {
  const missingReview = computeTherapistVerificationMeta({
    fieldReviewStates: {},
  });
  assert.equal(missingReview.verificationLane, "needs_verification");
  assert.equal(missingReview.verificationPriority, 95);

  const reconfirmation = computeTherapistVerificationMeta({
    sourceReviewedAt: "2026-04-01T00:00:00.000Z",
    therapistReportedConfirmedAt: "2026-04-02T00:00:00.000Z",
    fieldReviewStates: {
      estimatedWaitTime: "needs_reconfirmation",
      insuranceAccepted: "editorially_verified",
    },
    name: "Dr. Jamie Rivera",
    credentials: "LMFT",
    city: "Los Angeles",
    state: "CA",
  });
  assert.equal(reconfirmation.verificationLane, "needs_reconfirmation");
  assert.ok(reconfirmation.verificationPriority >= 86);
});

test("completeness score rewards populated trust-critical fields", function () {
  const score = computeTherapistCompletenessScore({
    name: "Dr. Jamie Rivera",
    credentials: "LMFT",
    city: "Los Angeles",
    state: "CA",
    email: "hello@example.com",
    careApproach: "Structured bipolar care",
    specialties: ["Bipolar II"],
    insuranceAccepted: ["Aetna"],
    languages: ["English"],
    sourceUrl: "https://example.com",
    sourceReviewedAt: "2026-04-01T00:00:00.000Z",
  });

  assert.equal(score, 100);
});

// ── Time-dependent behaviour, pinned ─────────────────────────────────
// The freshness lanes and the confidence age-decay steps are the core of the
// trust system, and until nowIso existed none of their thresholds could be
// asserted: the tests above deliberately avoid exact priorities and never touch
// refresh_now / refresh_soon / fresh at all. A typo in a boundary (>= 12 for
// >= 120) would have shipped green.

const NOW = "2026-07-01T00:00:00.000Z";
const at = { nowIso: NOW };

function daysBefore(days) {
  return new Date(Date.parse(NOW) - days * 86400000).toISOString();
}

function verificationAt(days, extra = {}) {
  return computeTherapistVerificationMeta(
    { sourceReviewedAt: daysBefore(days), fieldReviewStates: {}, ...extra },
    at,
  );
}

test("verification lanes: refresh_now at and beyond 120 days", () => {
  for (const days of [120, 121, 400]) {
    const meta = verificationAt(days);
    assert.equal(meta.verificationLane, "refresh_now", `${days}d should be refresh_now`);
    assert.equal(meta.verificationPriority, 84);
  }
});

test("verification lanes: refresh_soon from 75 up to 119 days", () => {
  for (const days of [75, 76, 119]) {
    const meta = verificationAt(days);
    assert.equal(meta.verificationLane, "refresh_soon", `${days}d should be refresh_soon`);
    assert.equal(meta.verificationPriority, 61);
  }
});

test("verification lanes: fresh below 75 days", () => {
  for (const days of [0, 1, 74]) {
    const meta = verificationAt(days);
    assert.equal(meta.verificationLane, "fresh", `${days}d should be fresh`);
    assert.equal(meta.verificationPriority, 28);
  }
});

test("verification lanes: the 75 and 120 day boundaries are exact", () => {
  // The off-by-one guards. 74 must NOT be refresh_soon and 119 must NOT be
  // refresh_now, or the lanes silently shift by a day.
  assert.equal(verificationAt(74).verificationLane, "fresh");
  assert.equal(verificationAt(75).verificationLane, "refresh_soon");
  assert.equal(verificationAt(119).verificationLane, "refresh_soon");
  assert.equal(verificationAt(120).verificationLane, "refresh_now");
});

test("verification: nextReviewDueAt is derived from the last review, per lane", () => {
  const stale = verificationAt(200);
  assert.equal(
    stale.nextReviewDueAt,
    new Date(Date.parse(daysBefore(200)) + 120 * 86400000).toISOString(),
  );

  const soon = verificationAt(80);
  assert.equal(
    soon.nextReviewDueAt,
    new Date(Date.parse(daysBefore(80)) + 105 * 86400000).toISOString(),
  );

  const fresh = verificationAt(10);
  assert.equal(
    fresh.nextReviewDueAt,
    new Date(Date.parse(daysBefore(10)) + 120 * 86400000).toISOString(),
  );
});

test("verification: with no review history at all, review is due now", () => {
  const meta = computeTherapistVerificationMeta({ fieldReviewStates: {} }, at);
  assert.equal(meta.verificationLane, "needs_verification");
  assert.equal(meta.verificationPriority, 95);
  // Only assertable with an injected clock — this used to be Date.now().
  assert.equal(meta.nextReviewDueAt, NOW);
  assert.equal(meta.lastOperationalReviewAt, "");
});

test("verification: reconfirmation priority is 82 + 4 per field, capped at 98", () => {
  const lanes = (count) =>
    verificationAt(10, {
      fieldReviewStates: Object.fromEntries(
        ["estimatedWaitTime", "insuranceAccepted", "telehealthStates", "bipolarYearsExperience"]
          .slice(0, count)
          .map((f) => [f, "needs_reconfirmation"]),
      ),
    });
  assert.equal(lanes(1).verificationPriority, 86);
  assert.equal(lanes(2).verificationPriority, 90);
  assert.equal(lanes(4).verificationPriority, 98);
  assert.equal(lanes(1).verificationLane, "needs_reconfirmation");
  assert.equal(
    lanes(1).nextReviewDueAt,
    new Date(Date.parse(daysBefore(10)) + 7 * 86400000).toISOString(),
  );
});

test("verification: reconfirmation outranks staleness, however old the source", () => {
  const meta = verificationAt(500, {
    fieldReviewStates: { estimatedWaitTime: "needs_reconfirmation" },
  });
  assert.equal(meta.verificationLane, "needs_reconfirmation");
});

test("verification: lastOperationalReviewAt takes the LATER of the two dates", () => {
  const meta = computeTherapistVerificationMeta(
    {
      sourceReviewedAt: daysBefore(200),
      therapistReportedConfirmedAt: daysBefore(10),
      fieldReviewStates: {},
    },
    at,
  );
  assert.equal(meta.lastOperationalReviewAt, daysBefore(10));
  // ...but the LANE still keys off source age, which is 200 days stale.
  assert.equal(meta.verificationLane, "refresh_now");
});

test("confidence: source age decays -6 at 75 days and -12 at 120", () => {
  const scoreAt = (days) =>
    buildFieldTrustMeta(
      {
        sourceReviewedAt: daysBefore(days),
        fieldReviewStates: { estimatedWaitTime: "editorially_verified" },
      },
      at,
    ).estimatedWaitTime.confidenceScore;

  assert.equal(scoreAt(0), 92, "editorially_verified with a fresh source review");
  assert.equal(scoreAt(74), 92, "no decay just below the first threshold");
  assert.equal(scoreAt(75), 86, "-6");
  assert.equal(scoreAt(119), 86, "still -6 just below the second threshold");
  assert.equal(scoreAt(120), 80, "-12, and the -6 step does not also apply");
});

test("confidence: confirmation age decays -8 at 60 days and -16 at 120", () => {
  const scoreAt = (days) =>
    buildFieldTrustMeta(
      {
        therapistReportedConfirmedAt: daysBefore(days),
        therapistReportedFields: ["estimatedWaitTime"],
        fieldReviewStates: {},
      },
      at,
    ).estimatedWaitTime.confidenceScore;

  assert.equal(scoreAt(0), 76, "therapist_confirmed, no decay");
  assert.equal(scoreAt(59), 76);
  assert.equal(scoreAt(60), 68, "-8");
  assert.equal(scoreAt(119), 68);
  assert.equal(scoreAt(120), 60, "-16");
});

test("confidence: floors at 5 when every penalty stacks", () => {
  const meta = buildFieldTrustMeta(
    {
      sourceReviewedAt: daysBefore(400),
      therapistReportedConfirmedAt: daysBefore(400),
      therapistReportedFields: ["estimatedWaitTime"],
      sourceHealthStatus: "error",
      fieldReviewStates: { estimatedWaitTime: "needs_reconfirmation" },
    },
    at,
  );
  // 44 base - 16 degraded_source - 12 source age - 16 confirmation age = 0 → 5
  assert.equal(meta.estimatedWaitTime.confidenceScore, 5);
});

test("staleAfterAt is verifiedAt plus the per-field window", () => {
  const meta = buildFieldTrustMeta(
    {
      sourceReviewedAt: daysBefore(10),
      fieldReviewStates: {
        estimatedWaitTime: "editorially_verified",
        insuranceAccepted: "editorially_verified",
        bipolarYearsExperience: "editorially_verified",
      },
    },
    at,
  );
  const verified = Date.parse(daysBefore(10));
  assert.equal(
    meta.estimatedWaitTime.staleAfterAt,
    new Date(verified + 21 * 86400000).toISOString(),
  );
  assert.equal(
    meta.insuranceAccepted.staleAfterAt,
    new Date(verified + 45 * 86400000).toISOString(),
  );
  assert.equal(
    meta.bipolarYearsExperience.staleAfterAt,
    new Date(verified + 180 * 86400000).toISOString(),
  );
});

test("staleAfterAt is empty when nothing has been verified", () => {
  const meta = buildFieldTrustMeta({ fieldReviewStates: {} }, at);
  assert.equal(meta.estimatedWaitTime.verifiedAt, "");
  assert.equal(meta.estimatedWaitTime.staleAfterAt, "");
});

test("a pinned clock is deterministic, and a garbage one falls back rather than throwing", () => {
  const record = { sourceReviewedAt: daysBefore(130), fieldReviewStates: {} };
  assert.deepEqual(
    computeTherapistVerificationMeta(record, at),
    computeTherapistVerificationMeta(record, at),
  );
  // An unparseable nowIso must not produce Invalid Date output.
  const bad = computeTherapistVerificationMeta(record, { nowIso: "not-a-date" });
  assert.ok(["fresh", "refresh_soon", "refresh_now"].includes(bad.verificationLane));
  assert.ok(!String(bad.nextReviewDueAt).includes("Invalid"));
});
