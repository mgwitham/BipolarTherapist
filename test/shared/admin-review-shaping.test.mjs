import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildAppliedFieldReviewStatePatch,
  buildLicensureOpsEvent,
  buildPortalRequestDocument,
  normalizeAdminTherapist,
  normalizePortalRequest,
  normalizeReviewEvent,
  resolveSlug,
} from "../../shared/admin-review-shaping.mjs";

test("resolveSlug handles string, object, and missing", () => {
  assert.equal(resolveSlug("jane-doe"), "jane-doe");
  assert.equal(resolveSlug({ current: "jane-doe" }), "jane-doe");
  assert.equal(resolveSlug({}), "");
  assert.equal(resolveSlug(null), "");
});

test("buildAppliedFieldReviewStatePatch maps only the two whitelisted fields", () => {
  assert.deepEqual(buildAppliedFieldReviewStatePatch(["insurance_accepted", "telehealth_states"]), {
    insuranceAccepted: "editorially_verified",
    telehealthStates: "editorially_verified",
  });
  assert.deepEqual(buildAppliedFieldReviewStatePatch(["bio", "unknown"]), {});
  assert.deepEqual(buildAppliedFieldReviewStatePatch(null), {});
});

test("normalizeAdminTherapist: defaults for an empty doc", () => {
  const t = normalizeAdminTherapist({});
  assert.equal(t.claim_status, "unclaimed");
  assert.equal(t.country, "US");
  assert.deepEqual(t.languages, ["English"]); // fallback
  assert.equal(t.accepting_new_patients, null); // tri-state: unknown
  assert.equal(t.listing_active, true); // only explicit false disables
  assert.equal(t.status, "active");
  assert.equal(t.has_paid_subscription, false);
});

test("normalizeAdminTherapist: tri-state accepting_new_patients and photo fallbacks", () => {
  assert.equal(
    normalizeAdminTherapist({ acceptingNewPatients: true }).accepting_new_patients,
    true,
  );
  assert.equal(
    normalizeAdminTherapist({ acceptingNewPatients: false }).accepting_new_patients,
    false,
  );
  assert.equal(
    normalizeAdminTherapist({ photo: { asset: { url: "https://x/y.jpg" } } }).photo_url,
    "https://x/y.jpg",
  );
  assert.equal(normalizeAdminTherapist({ listingActive: false }).listing_active, false);
  assert.equal(normalizeAdminTherapist({ slug: { current: "s" } }).slug, "s");
});

test("normalizeReviewEvent maps camelCase doc to snake_case", () => {
  const e = normalizeReviewEvent({
    _id: "e1",
    createdAt: "2026-07-15T00:00:00Z",
    eventType: "publish",
    therapistId: "t1",
    changedFields: ["bio"],
  });
  assert.equal(e.id, "e1");
  assert.equal(e.event_type, "publish");
  assert.equal(e.therapist_id, "t1");
  assert.deepEqual(e.changed_fields, ["bio"]);
  assert.equal(e.decision, "");
});

test("normalizePortalRequest: is_priority only when featured AND active/trialing", () => {
  const base = { _id: "r1", therapistSlug: "s" };
  assert.equal(
    normalizePortalRequest({ ...base, subscriptionPlan: "featured", subscriptionStatus: "active" })
      .is_priority,
    true,
  );
  assert.equal(
    normalizePortalRequest({
      ...base,
      subscriptionPlan: "featured",
      subscriptionStatus: "trialing",
    }).is_priority,
    true,
  );
  assert.equal(
    normalizePortalRequest({
      ...base,
      subscriptionPlan: "featured",
      subscriptionStatus: "canceled",
    }).is_priority,
    false,
  );
  assert.equal(
    normalizePortalRequest({ ...base, subscriptionPlan: "", subscriptionStatus: "active" })
      .is_priority,
    false,
  );
});

test("buildPortalRequestDocument: valid input → open request doc", () => {
  const doc = buildPortalRequestDocument({
    request_type: "claim_profile",
    therapist_slug: "jane-doe",
    therapist_name: "Jane Doe",
    requester_name: "Jane",
    requester_email: "jane@practice.com",
  });
  assert.equal(doc._type, "therapistPortalRequest");
  assert.equal(doc.status, "open");
  assert.ok(doc._id.startsWith("therapist-portal-request-jane-doe-"));
});

test("buildPortalRequestDocument: missing fields or bad type throw", () => {
  assert.throws(
    () => buildPortalRequestDocument({ request_type: "claim_profile" }),
    /Missing required/,
  );
  assert.throws(
    () =>
      buildPortalRequestDocument({
        request_type: "hack_the_planet",
        therapist_slug: "s",
        therapist_name: "n",
        requester_name: "r",
        requester_email: "e@x.com",
      }),
    /Invalid therapist portal request type/,
  );
});

test("buildLicensureOpsEvent: therapistId only for therapist-sourced records", () => {
  const fromTherapist = buildLicensureOpsEvent(
    { _id: "rec1", providerId: "p1", sourceDocumentType: "therapist", sourceDocumentId: "t1" },
    { eventType: "licensure_refreshed", actorName: "admin" },
  );
  assert.equal(fromTherapist.therapistId, "t1");
  assert.equal(fromTherapist._type, "therapistPublishEvent");
  assert.equal(fromTherapist.eventType, "licensure_refreshed");

  const fromCandidate = buildLicensureOpsEvent(
    { _id: "rec2", sourceDocumentType: "candidate", sourceDocumentId: "c1" },
    { eventType: "licensure_refreshed", notes: "n" },
  );
  assert.equal(fromCandidate.therapistId, "");
  assert.equal(fromCandidate.rationale, "n"); // rationale falls back to notes
});
