import test from "node:test";
import assert from "node:assert/strict";

import {
  buildApplicationReviewEvent,
  buildCandidateReviewEvent,
  buildPublishEventId,
  buildTherapistOpsEvent,
} from "../../shared/therapist-publishing-domain.mjs";

// Sanity's document ID ceiling. Any builder that composes an _id from an
// entity slug risks blowing past this for long-slug records.
const SANITY_MAX_DOCUMENT_ID_LENGTH = 128;
const LONG_CANDIDATE_ID =
  "therapist-candidate-psychiatrist-mental-health-treatment-in-westwood-los-angeles-los-angeles-ca";

test("buildPublishEventId keeps the result under Sanity's 128-char ceiling", function () {
  const id = buildPublishEventId(LONG_CANDIDATE_ID);
  assert.ok(
    id.length <= SANITY_MAX_DOCUMENT_ID_LENGTH,
    `expected id length <= ${SANITY_MAX_DOCUMENT_ID_LENGTH}, got ${id.length}`,
  );
  assert.ok(id.startsWith("therapist-publish-event-"));
});

test("buildPublishEventId still embeds a fragment of the entity id when short enough", function () {
  const id = buildPublishEventId("therapist-candidate-short-id");
  assert.ok(id.includes("therapist-candidate-short-id"));
});

test("buildPublishEventId produces unique ids on repeated calls", function () {
  const a = buildPublishEventId(LONG_CANDIDATE_ID);
  const b = buildPublishEventId(LONG_CANDIDATE_ID);
  assert.notEqual(a, b);
});

test("buildPublishEventId handles missing entity id without throwing", function () {
  const id = buildPublishEventId("");
  assert.ok(id.startsWith("therapist-publish-event-"));
  assert.ok(id.length <= SANITY_MAX_DOCUMENT_ID_LENGTH);
});

test("buildCandidateReviewEvent yields a legal Sanity document id for long-slug candidates", function () {
  const event = buildCandidateReviewEvent(
    { _id: LONG_CANDIDATE_ID, candidateId: LONG_CANDIDATE_ID },
    { eventType: "candidate_reviewed", decision: "needs_review" },
  );
  assert.ok(event._id.length <= SANITY_MAX_DOCUMENT_ID_LENGTH);
  assert.equal(event._type, "therapistPublishEvent");
  assert.equal(event.eventType, "candidate_reviewed");
});

test("buildApplicationReviewEvent yields a legal Sanity document id for long ids", function () {
  const event = buildApplicationReviewEvent(
    { _id: LONG_CANDIDATE_ID.replace("candidate", "application") },
    { eventType: "candidate_reviewed", decision: "approve" },
  );
  assert.ok(event._id.length <= SANITY_MAX_DOCUMENT_ID_LENGTH);
});

test("buildTherapistOpsEvent yields a legal Sanity document id for long ids", function () {
  const event = buildTherapistOpsEvent(
    { _id: LONG_CANDIDATE_ID.replace("candidate", "therapist") },
    { eventType: "therapist_review_completed" },
  );
  assert.ok(event._id.length <= SANITY_MAX_DOCUMENT_ID_LENGTH);
});
