// Candidate review-queue triage: which lane an ingested candidate lands
// in, its review priority, and when it's due for another look. Extracted
// from server/review-handler.mjs so the triage rules are unit-testable.
// Used by candidate review, bulk ingest, and admin ops (via the handler's
// deps wiring).
//
// Pure — no I/O.

// Adds `days` to an ISO timestamp (UTC-safe). Invalid or missing input
// falls back to now.
export function addDays(isoString, days) {
  const base = isoString ? new Date(isoString) : new Date();
  if (Number.isNaN(base.getTime())) {
    const fallback = new Date();
    fallback.setUTCDate(fallback.getUTCDate() + days);
    return fallback.toISOString();
  }
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString();
}

// Lane rules, in precedence order:
//   published/archived        → archived lane, low priority, revisit in 30d
//   possible duplicate        → resolve_duplicates, near-top priority, due now
//   needs confirmation        → needs_confirmation, priority 72–88, due in 2d
//   ready to publish          → publish_now, priority 85–98, due now
//   everything else           → editorial_review, priority 52–84 blended from
//                               readiness + extraction confidence; higher
//                               readiness gets a shorter due date (1d vs 4d)
export function computeCandidateReviewMeta(candidateLike) {
  const readiness = Number(candidateLike.readinessScore || 0) || 0;
  const extractionConfidence = Number(candidateLike.extractionConfidence || 0) || 0;
  const reviewStatus = String(candidateLike.reviewStatus || "queued")
    .trim()
    .toLowerCase();
  const dedupeStatus = String(candidateLike.dedupeStatus || "unreviewed")
    .trim()
    .toLowerCase();
  const recommendation = String(candidateLike.publishRecommendation || "")
    .trim()
    .toLowerCase();
  const now = new Date().toISOString();

  if (reviewStatus === "published" || reviewStatus === "archived") {
    return {
      reviewLane: "archived",
      reviewPriority: 10,
      nextReviewDueAt: addDays(now, 30),
    };
  }

  if (dedupeStatus === "possible_duplicate") {
    return {
      reviewLane: "resolve_duplicates",
      reviewPriority: 96,
      nextReviewDueAt: now,
    };
  }

  if (reviewStatus === "needs_confirmation" || recommendation === "needs_confirmation") {
    return {
      reviewLane: "needs_confirmation",
      reviewPriority: Math.max(72, Math.min(88, readiness || 72)),
      nextReviewDueAt: addDays(now, 2),
    };
  }

  if (reviewStatus === "ready_to_publish" || recommendation === "ready") {
    return {
      reviewLane: "publish_now",
      reviewPriority: Math.max(85, Math.min(98, readiness || 85)),
      nextReviewDueAt: now,
    };
  }

  return {
    reviewLane: "editorial_review",
    reviewPriority: Math.max(
      52,
      Math.min(84, Math.round(readiness * 0.7 + extractionConfidence * 20 + 10)),
    ),
    nextReviewDueAt: addDays(now, readiness >= 70 ? 1 : 4),
  };
}
