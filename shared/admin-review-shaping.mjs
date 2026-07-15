// Admin API response shaping + admin ops document builders. Extracted
// from server/review-handler.mjs: these normalize Sanity docs into the
// snake_case shapes the admin panels consume, and build the ops/audit
// documents admin actions persist. Route modules receive them through
// the handler's deps wiring.
//
// Pure — no I/O.

import { buildPublishEventId } from "./therapist-publishing-domain.mjs";
import { normalizeDisplayRole, normalizeFieldReviewStates } from "./therapist-domain.mjs";

export function buildLicensureOpsEvent(record, updates) {
  const now = new Date().toISOString();
  return {
    _id: buildPublishEventId(record._id),
    _type: "therapistPublishEvent",
    eventType: updates.eventType,
    providerId: record.providerId || "",
    candidateId: "",
    candidateDocumentId: "",
    applicationId: "",
    therapistId: record.sourceDocumentType === "therapist" ? record.sourceDocumentId || "" : "",
    decision: updates.decision || "",
    reviewStatus: "",
    publishRecommendation: "",
    actorName: updates.actorName || "",
    rationale: updates.rationale || updates.notes || "",
    notes: updates.notes || "",
    changedFields: Array.isArray(updates.changedFields) ? updates.changedFields : [],
    createdAt: now,
  };
}

export function buildAppliedFieldReviewStatePatch(selectedFields) {
  const nextStates = {};
  (Array.isArray(selectedFields) ? selectedFields : []).forEach(function (field) {
    if (field === "insurance_accepted") {
      nextStates.insuranceAccepted = "editorially_verified";
    }
    if (field === "telehealth_states") {
      nextStates.telehealthStates = "editorially_verified";
    }
  });
  return nextStates;
}

export function resolveSlug(slugField) {
  if (!slugField) return "";
  if (typeof slugField === "string") return slugField;
  return slugField.current || "";
}

export function normalizeAdminTherapist(doc) {
  const fieldReviewStates = /** @type {Record<string, string>} */ (
    normalizeFieldReviewStates(doc && doc.fieldReviewStates, {
      keyStyle: "camelCase",
    })
  );
  return {
    id: doc._id || doc.id || "",
    name: doc.name || "",
    credentials: doc.credentials || "",
    title: normalizeDisplayRole(doc.title || ""),
    bio: normalizeDisplayRole(doc.bio || ""),
    bio_preview: normalizeDisplayRole(doc.bioPreview || doc.bio || ""),
    photo_url:
      doc.photo_url ||
      (doc.photo && doc.photo.asset && doc.photo.asset.url) ||
      (doc.photo && doc.photo.url) ||
      null,
    photo_source_type: doc.photoSourceType || "",
    photo_reviewed_at: doc.photoReviewedAt || "",
    photo_usage_permission_confirmed: Boolean(doc.photoUsagePermissionConfirmed),
    email: doc.email || "",
    phone: doc.phone || "",
    website: doc.website || null,
    preferred_contact_method: doc.preferredContactMethod || "",
    preferred_contact_label: doc.preferredContactLabel || "",
    contact_guidance: doc.contactGuidance || "",
    first_step_expectation: doc.firstStepExpectation || "",
    booking_url: doc.bookingUrl || null,
    claim_status: doc.claimStatus || "unclaimed",
    claimed_by_email: doc.claimedByEmail || "",
    claimed_at: doc.claimedAt || "",
    portal_last_seen_at: doc.portalLastSeenAt || "",
    listing_pause_requested_at: doc.listingPauseRequestedAt || "",
    listing_removal_requested_at: doc.listingRemovalRequestedAt || "",
    practice_name: doc.practiceName || "",
    gender: doc.gender || "",
    city: doc.city || "",
    state: doc.state || "",
    zip: doc.zip || "",
    country: doc.country || "US",
    license_state: doc.licenseState || "",
    license_number: doc.licenseNumber || "",
    specialties: Array.isArray(doc.specialties) ? doc.specialties : [],
    treatment_modalities: Array.isArray(doc.treatmentModalities) ? doc.treatmentModalities : [],
    client_populations: Array.isArray(doc.clientPopulations) ? doc.clientPopulations : [],
    insurance_accepted: Array.isArray(doc.insuranceAccepted) ? doc.insuranceAccepted : [],
    accepts_telehealth: Boolean(doc.acceptsTelehealth),
    accepts_in_person: Boolean(doc.acceptsInPerson),
    accepting_new_patients:
      doc.acceptingNewPatients === true ? true : doc.acceptingNewPatients === false ? false : null,
    years_experience: doc.yearsExperience || null,
    bipolar_years_experience: doc.bipolarYearsExperience || null,
    languages: Array.isArray(doc.languages) && doc.languages.length ? doc.languages : ["English"],
    telehealth_states: Array.isArray(doc.telehealthStates) ? doc.telehealthStates : [],
    estimated_wait_time: doc.estimatedWaitTime || "",
    care_approach: doc.careApproach || "",
    medication_management: Boolean(doc.medicationManagement),
    verification_status: doc.verificationStatus || "",
    source_url: doc.sourceUrl || "",
    supporting_source_urls: Array.isArray(doc.supportingSourceUrls) ? doc.supportingSourceUrls : [],
    source_reviewed_at: doc.sourceReviewedAt || "",
    therapist_reported_fields: Array.isArray(doc.therapistReportedFields)
      ? doc.therapistReportedFields
      : [],
    therapist_reported_confirmed_at: doc.therapistReportedConfirmedAt || "",
    field_review_states: {
      estimated_wait_time: fieldReviewStates.estimatedWaitTime,
      insurance_accepted: fieldReviewStates.insuranceAccepted,
      telehealth_states: fieldReviewStates.telehealthStates,
      bipolar_years_experience: fieldReviewStates.bipolarYearsExperience,
    },
    session_fee_min: doc.sessionFeeMin || null,
    session_fee_max: doc.sessionFeeMax || null,
    sliding_scale: Boolean(doc.slidingScale),
    listing_active: doc.listingActive !== false,
    status: doc.status || "active",
    lifecycle: doc.lifecycle || "",
    visibility_intent: doc.visibilityIntent || "",
    notes: doc.notes || "",
    audit_log: Array.isArray(doc.auditLog) ? doc.auditLog : [],
    slug: resolveSlug(doc.slug),
    has_paid_subscription: false,
  };
}

export function normalizeReviewEvent(doc) {
  return {
    id: doc._id,
    created_at: doc.createdAt || doc._createdAt || "",
    event_type: doc.eventType || "",
    provider_id: doc.providerId || "",
    candidate_id: doc.candidateId || "",
    candidate_document_id: doc.candidateDocumentId || "",
    application_id: doc.applicationId || "",
    therapist_id: doc.therapistId || "",
    decision: doc.decision || "",
    review_status: doc.reviewStatus || "",
    publish_recommendation: doc.publishRecommendation || "",
    actor_name: doc.actorName || "",
    rationale: doc.rationale || "",
    notes: doc.notes || "",
    changed_fields: Array.isArray(doc.changedFields) ? doc.changedFields : [],
  };
}

export function normalizePortalRequest(doc) {
  const paidPlan = String(doc.subscriptionPlan || "") === "featured";
  const paidStatus = doc.subscriptionStatus === "active" || doc.subscriptionStatus === "trialing";
  return {
    id: doc._id,
    therapist_slug: doc.therapistSlug || "",
    therapist_name: doc.therapistName || "",
    request_type: doc.requestType || "",
    requester_name: doc.requesterName || "",
    requester_email: doc.requesterEmail || "",
    license_number: doc.licenseNumber || "",
    message: doc.message || "",
    status: doc.status || "open",
    requested_at: doc.requestedAt || doc._createdAt || "",
    reviewed_at: doc.reviewedAt || "",
    is_priority: Boolean(paidPlan && paidStatus),
  };
}

export function buildPortalRequestDocument(input) {
  const requestType = String(input.request_type || "").trim();
  const therapistSlug = String(input.therapist_slug || "").trim();
  const therapistName = String(input.therapist_name || "").trim();
  const requesterName = String(input.requester_name || "").trim();
  const requesterEmail = String(input.requester_email || "").trim();

  if (!therapistSlug || !therapistName || !requestType || !requesterName || !requesterEmail) {
    throw new Error("Missing required therapist portal request fields.");
  }

  const allowedRequestTypes = new Set([
    "claim_profile",
    "pause_listing",
    "remove_listing",
    "profile_update",
  ]);
  if (!allowedRequestTypes.has(requestType)) {
    throw new Error("Invalid therapist portal request type.");
  }

  const now = new Date().toISOString();
  return {
    _id: `therapist-portal-request-${therapistSlug}-${Date.now()}`,
    _type: "therapistPortalRequest",
    therapistSlug: therapistSlug,
    therapistName: therapistName,
    requestType: requestType,
    requesterName: requesterName,
    requesterEmail: requesterEmail,
    licenseNumber: String(input.license_number || "").trim(),
    message: String(input.message || "").trim(),
    status: "open",
    requestedAt: now,
  };
}
