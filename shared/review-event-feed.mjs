// Review-event feed lane classification + cursor pagination. Extracted
// from server/review-read-routes.mjs so the lane rules and the compound
// cursor round-trip are unit-testable. The windowed fetch loop that uses
// these (fetchLaneEvents) stays server-side with the Sanity client.
//
// Pure — no I/O.

// Buckets a therapistPublishEvent into an admin feed lane. Precedence:
// licensure/ops event types first, then whichever entity id is present.
export function getEventLane(doc) {
  const eventType = String((doc && doc.eventType) || "");
  if (
    eventType.startsWith("licensure_") ||
    eventType === "therapist_review_completed" ||
    eventType === "therapist_review_deferred"
  ) {
    return "ops";
  }
  if (doc && doc.applicationId) {
    return "application";
  }
  if (doc && (doc.candidateId || doc.candidateDocumentId)) {
    return "candidate";
  }
  if (doc && doc.therapistId) {
    return "therapist";
  }
  return "ops";
}

export function reviewEventSortStamp(doc) {
  return (doc && (doc.createdAt || doc._createdAt)) || "";
}

// Compound cursor "<timestamp>|<_id>" gives a total order even when many
// events share an identical createdAt (build*ReviewEvent stamps them in the
// same millisecond), so page boundaries neither skip nor duplicate siblings.
export function encodeReviewEventCursor(doc) {
  return `${reviewEventSortStamp(doc)}|${(doc && doc._id) || ""}`;
}

export function decodeReviewEventCursor(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;
  const idx = value.lastIndexOf("|");
  // Back-compat: a legacy timestamp-only cursor decodes with an empty id.
  if (idx === -1) return { ts: value, id: "" };
  return { ts: value.slice(0, idx), id: value.slice(idx + 1) };
}
