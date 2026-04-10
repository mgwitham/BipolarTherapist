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
