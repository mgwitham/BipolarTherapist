import crypto from "node:crypto";

import { normalizePortableApplication, normalizeReviewFollowUp } from "./application-domain.mjs";
import {
  buildProviderFieldObservationId,
  buildProviderFieldObservationsFromSource,
} from "./provider-field-observation-domain.mjs";
import { buildProviderId, mapFieldReviewStatesToSnakeCase, slugify } from "./therapist-domain.mjs";
import {
  buildFieldTrustMeta,
  computeTherapistVerificationMeta,
} from "./therapist-trust-domain.mjs";

function mergeUniqueUrls(primary, supporting, extra) {
  const urls = []
    .concat(primary ? [primary] : [])
    .concat(Array.isArray(supporting) ? supporting : [])
    .concat(Array.isArray(extra) ? extra : [])
    .map(function (value) {
      return String(value || "").trim();
    })
    .filter(Boolean);

  return Array.from(new Set(urls));
}

export function buildTherapistObservationDocuments(therapistDocument) {
  return buildProviderFieldObservationsFromSource(therapistDocument, {
    sourceType: "therapist",
    sourceDocumentType: "therapist",
    sourceDocumentId: therapistDocument && therapistDocument._id ? therapistDocument._id : "",
    sourceUrl:
      (therapistDocument && (therapistDocument.sourceUrl || therapistDocument.website)) || "",
    observedAt:
      (therapistDocument &&
        (therapistDocument.sourceReviewedAt || therapistDocument.therapistReportedConfirmedAt)) ||
      new Date().toISOString(),
    verifiedAt:
      (therapistDocument &&
        (therapistDocument.therapistReportedConfirmedAt || therapistDocument.sourceReviewedAt)) ||
      "",
    verificationMethod: "editorial_review",
    confidenceScore: 90,
    isCurrent: true,
  }).map(function (observation) {
    return {
      ...observation,
      _id: buildProviderFieldObservationId({
        providerId: observation.providerId,
        fieldName: observation.fieldName,
        sourceType: observation.sourceType,
        sourceDocumentId: observation.sourceDocumentId,
      }),
    };
  });
}

export function buildTherapistDocument(application, existingId, helpers) {
  const slug =
    application.submittedSlug ||
    slugify([application.name, application.city, application.state].filter(Boolean).join(" "));
  const therapistId = existingId || `therapist-${slug}`;
  const draft = {
    sourceUrl: application.sourceUrl || application.website || "",
    supportingSourceUrls: helpers.splitList(application.supportingSourceUrls),
    sourceReviewedAt: application.sourceReviewedAt || "",
    therapistReportedConfirmedAt: application.therapistReportedConfirmedAt || "",
    fieldReviewStates: application.fieldReviewStates || {},
    name: application.name,
    credentials: application.credentials,
    city: application.city,
    state: application.state,
    email: application.email,
    phone: application.phone,
    website: application.website,
    bookingUrl: application.bookingUrl,
    careApproach: application.careApproach,
    bio: application.bio,
    specialties: helpers.splitList(application.specialties),
    insuranceAccepted: helpers.splitList(application.insuranceAccepted),
    languages: helpers.splitList(application.languages),
  };
  const verificationMeta = computeTherapistVerificationMeta(draft);
  const fieldTrustMeta = buildFieldTrustMeta(draft);

  return {
    _id: therapistId,
    _type: "therapist",
    providerId: application.providerId || buildProviderId(application),
    name: application.name,
    slug: {
      _type: "slug",
      current: slug,
    },
    credentials: application.credentials || "",
    title: application.title || "",
    ...(application.photo ? { photo: application.photo } : {}),
    photoSourceType: application.photoSourceType || "",
    photoReviewedAt: application.photoReviewedAt || "",
    photoUsagePermissionConfirmed: Boolean(application.photoUsagePermissionConfirmed),
    bio: application.bio || "",
    bioPreview: application.bio || "",
    practiceName: application.practiceName || "",
    email: application.email || "",
    phone: application.phone || "",
    website: application.website || "",
    preferredContactMethod: application.preferredContactMethod || "",
    preferredContactLabel: application.preferredContactLabel || "",
    contactGuidance: application.contactGuidance || "",
    firstStepExpectation: application.firstStepExpectation || "",
    bookingUrl: application.bookingUrl || "",
    city: application.city || "",
    state: application.state || "",
    zip: application.zip || "",
    country: application.country || "US",
    licenseState: application.licenseState || "",
    licenseNumber: application.licenseNumber || "",
    licensureVerification: helpers.normalizeLicensureVerification(
      application.licensureVerification,
    ),
    specialties: helpers.splitList(application.specialties),
    treatmentModalities: helpers.splitList(application.treatmentModalities),
    clientPopulations: helpers.splitList(application.clientPopulations),
    insuranceAccepted: helpers.splitList(application.insuranceAccepted),
    languages: helpers.splitList(application.languages).length
      ? helpers.splitList(application.languages)
      : ["English"],
    yearsExperience: helpers.parseNumber(application.yearsExperience),
    bipolarYearsExperience: helpers.parseNumber(application.bipolarYearsExperience),
    acceptsTelehealth: helpers.parseBoolean(application.acceptsTelehealth, true),
    acceptsInPerson: helpers.parseBoolean(application.acceptsInPerson, true),
    acceptingNewPatients: helpers.parseBoolean(application.acceptingNewPatients, true),
    telehealthStates: helpers.splitList(application.telehealthStates),
    estimatedWaitTime: application.estimatedWaitTime || "",
    careApproach: application.careApproach || "",
    medicationManagement: helpers.parseBoolean(application.medicationManagement, false),
    verificationStatus: "editorially_verified",
    sourceUrl: application.sourceUrl || application.website || "",
    supportingSourceUrls: helpers.splitList(application.supportingSourceUrls),
    sourceReviewedAt: application.sourceReviewedAt || "",
    therapistReportedFields: Array.isArray(application.therapistReportedFields)
      ? application.therapistReportedFields
      : [],
    therapistReportedConfirmedAt: application.therapistReportedConfirmedAt || "",
    lastOperationalReviewAt: verificationMeta.lastOperationalReviewAt,
    nextReviewDueAt: verificationMeta.nextReviewDueAt,
    verificationPriority: verificationMeta.verificationPriority,
    verificationLane: verificationMeta.verificationLane,
    dataCompletenessScore: verificationMeta.dataCompletenessScore,
    fieldTrustMeta,
    sessionFeeMin: helpers.parseNumber(application.sessionFeeMin),
    sessionFeeMax: helpers.parseNumber(application.sessionFeeMax),
    slidingScale: helpers.parseBoolean(application.slidingScale, false),
    listingActive: true,
    status: "active",
  };
}

export function buildTherapistDocumentFromCandidate(candidate, existingId, helpers) {
  const slug = slugify([candidate.name, candidate.city, candidate.state].filter(Boolean).join(" "));
  const therapistId =
    existingId ||
    candidate.matchedTherapistId ||
    candidate.publishedTherapistId ||
    `therapist-${slug}`;
  const draft = {
    sourceUrl: candidate.sourceUrl || candidate.website || "",
    supportingSourceUrls: helpers.splitList(candidate.supportingSourceUrls),
    sourceReviewedAt: candidate.sourceReviewedAt || "",
    therapistReportedConfirmedAt: "",
    fieldReviewStates: {},
    name: candidate.name,
    credentials: candidate.credentials,
    city: candidate.city,
    state: candidate.state,
    email: candidate.email,
    phone: candidate.phone,
    website: candidate.website,
    bookingUrl: candidate.bookingUrl,
    careApproach: candidate.careApproach,
    bio: candidate.careApproach,
    specialties: helpers.splitList(candidate.specialties),
    insuranceAccepted: helpers.splitList(candidate.insuranceAccepted),
    languages: helpers.splitList(candidate.languages),
  };
  const verificationMeta = computeTherapistVerificationMeta(draft);
  const fieldTrustMeta = buildFieldTrustMeta(draft);

  return {
    _id: therapistId,
    _type: "therapist",
    providerId: candidate.providerId || buildProviderId(candidate),
    name: candidate.name || "",
    slug: {
      _type: "slug",
      current: slug,
    },
    credentials: candidate.credentials || "",
    title: candidate.title || "",
    bio: candidate.careApproach || "",
    bioPreview: candidate.careApproach || "",
    practiceName: candidate.practiceName || "",
    email: candidate.email || "",
    phone: candidate.phone || "",
    website: candidate.website || "",
    preferredContactMethod: "",
    preferredContactLabel: "",
    contactGuidance: "",
    firstStepExpectation: "",
    bookingUrl: candidate.bookingUrl || "",
    city: candidate.city || "",
    state: candidate.state || "",
    zip: candidate.zip || "",
    country: candidate.country || "US",
    licenseState: candidate.licenseState || "",
    licenseNumber: candidate.licenseNumber || "",
    licensureVerification: helpers.normalizeLicensureVerification(candidate.licensureVerification),
    specialties: helpers.splitList(candidate.specialties),
    treatmentModalities: helpers.splitList(candidate.treatmentModalities),
    clientPopulations: helpers.splitList(candidate.clientPopulations),
    insuranceAccepted: helpers.splitList(candidate.insuranceAccepted),
    languages: helpers.splitList(candidate.languages).length
      ? helpers.splitList(candidate.languages)
      : ["English"],
    yearsExperience: undefined,
    bipolarYearsExperience: undefined,
    acceptsTelehealth: helpers.parseBoolean(candidate.acceptsTelehealth, true),
    acceptsInPerson: helpers.parseBoolean(candidate.acceptsInPerson, true),
    acceptingNewPatients: helpers.parseBoolean(candidate.acceptingNewPatients, true),
    telehealthStates: helpers.splitList(candidate.telehealthStates),
    estimatedWaitTime: candidate.estimatedWaitTime || "",
    careApproach: candidate.careApproach || "",
    medicationManagement: helpers.parseBoolean(candidate.medicationManagement, false),
    verificationStatus:
      candidate.sourceReviewedAt || candidate.reviewStatus === "published"
        ? "editorially_verified"
        : "under_review",
    sourceUrl: candidate.sourceUrl || candidate.website || "",
    supportingSourceUrls: helpers.splitList(candidate.supportingSourceUrls),
    sourceReviewedAt: candidate.sourceReviewedAt || "",
    therapistReportedFields: [],
    therapistReportedConfirmedAt: "",
    lastOperationalReviewAt: verificationMeta.lastOperationalReviewAt,
    nextReviewDueAt: verificationMeta.nextReviewDueAt,
    verificationPriority: verificationMeta.verificationPriority,
    verificationLane: verificationMeta.verificationLane,
    dataCompletenessScore: verificationMeta.dataCompletenessScore,
    fieldTrustMeta,
    sessionFeeMin: helpers.parseNumber(candidate.sessionFeeMin),
    sessionFeeMax: helpers.parseNumber(candidate.sessionFeeMax),
    slidingScale: helpers.parseBoolean(candidate.slidingScale, false),
    listingActive: true,
    status: "active",
  };
}

export function normalizePortableCandidate(doc, helpers) {
  return {
    id: doc._id,
    candidate_id: doc.candidateId || "",
    provider_id: doc.providerId || buildProviderId(doc),
    provider_fingerprint: doc.providerFingerprint || "",
    name: doc.name || "",
    credentials: doc.credentials || "",
    title: doc.title || "",
    practice_name: doc.practiceName || "",
    city: doc.city || "",
    state: doc.state || "",
    zip: doc.zip || "",
    country: doc.country || "US",
    license_state: doc.licenseState || "",
    license_number: doc.licenseNumber || "",
    email: doc.email || "",
    phone: doc.phone || "",
    website: doc.website || "",
    booking_url: doc.bookingUrl || "",
    source_type: doc.sourceType || "",
    source_url: doc.sourceUrl || "",
    licensure_verification: helpers.normalizeLicensureVerification(doc.licensureVerification),
    supporting_source_urls: Array.isArray(doc.supportingSourceUrls) ? doc.supportingSourceUrls : [],
    raw_source_snapshot: doc.rawSourceSnapshot || "",
    extracted_at: doc.extractedAt || "",
    source_reviewed_at: doc.sourceReviewedAt || "",
    extraction_version: doc.extractionVersion || "",
    extraction_confidence:
      typeof doc.extractionConfidence === "number" ? doc.extractionConfidence : null,
    care_approach: doc.careApproach || "",
    specialties: Array.isArray(doc.specialties) ? doc.specialties : [],
    treatment_modalities: Array.isArray(doc.treatmentModalities) ? doc.treatmentModalities : [],
    client_populations: Array.isArray(doc.clientPopulations) ? doc.clientPopulations : [],
    insurance_accepted: Array.isArray(doc.insuranceAccepted) ? doc.insuranceAccepted : [],
    languages: Array.isArray(doc.languages) ? doc.languages : [],
    accepts_telehealth: doc.acceptsTelehealth !== false,
    accepts_in_person: doc.acceptsInPerson !== false,
    accepting_new_patients: doc.acceptingNewPatients !== false,
    telehealth_states: Array.isArray(doc.telehealthStates) ? doc.telehealthStates : [],
    estimated_wait_time: doc.estimatedWaitTime || "",
    medication_management: Boolean(doc.medicationManagement),
    session_fee_min: typeof doc.sessionFeeMin === "number" ? doc.sessionFeeMin : null,
    session_fee_max: typeof doc.sessionFeeMax === "number" ? doc.sessionFeeMax : null,
    sliding_scale: Boolean(doc.slidingScale),
    dedupe_status: doc.dedupeStatus || "unreviewed",
    dedupe_confidence: typeof doc.dedupeConfidence === "number" ? doc.dedupeConfidence : null,
    matched_therapist_slug: doc.matchedTherapistSlug || "",
    matched_therapist_id: doc.matchedTherapistId || "",
    matched_application_id: doc.matchedApplicationId || "",
    published_therapist_id: doc.publishedTherapistId || "",
    published_at: doc.publishedAt || "",
    review_follow_up: normalizeReviewFollowUp(doc.reviewFollowUp),
    review_status: doc.reviewStatus || "queued",
    review_lane: doc.reviewLane || "editorial_review",
    review_priority: typeof doc.reviewPriority === "number" ? doc.reviewPriority : null,
    next_review_due_at: doc.nextReviewDueAt || "",
    last_reviewed_at: doc.lastReviewedAt || "",
    readiness_score: typeof doc.readinessScore === "number" ? doc.readinessScore : null,
    publish_recommendation: doc.publishRecommendation || "",
    notes: doc.notes || "",
    review_history: Array.isArray(doc.reviewHistory) ? doc.reviewHistory : [],
  };
}

export function buildCandidateReviewEvent(candidate, updates) {
  const now = new Date().toISOString();
  return {
    _id: `therapist-publish-event-${candidate.candidateId || candidate._id}-${crypto.randomUUID()}`,
    _type: "therapistPublishEvent",
    eventType: updates.eventType,
    providerId: candidate.providerId || buildProviderId(candidate),
    candidateId: candidate.candidateId || "",
    candidateDocumentId: candidate._id,
    applicationId: updates.applicationId || candidate.matchedApplicationId || "",
    therapistId: updates.therapistId || candidate.matchedTherapistId || "",
    decision: updates.decision || "",
    reviewStatus: updates.reviewStatus || "",
    publishRecommendation: updates.publishRecommendation || "",
    actorName: updates.actorName || "",
    rationale: updates.rationale || updates.notes || "",
    notes: updates.notes || "",
    changedFields: Array.isArray(updates.changedFields) ? updates.changedFields : [],
    createdAt: now,
  };
}

export function buildApplicationReviewEvent(application, updates) {
  const now = new Date().toISOString();
  return {
    _id: `therapist-publish-event-${application._id}-${crypto.randomUUID()}`,
    _type: "therapistPublishEvent",
    eventType: updates.eventType,
    providerId: application.providerId || buildProviderId(application),
    candidateId: "",
    candidateDocumentId: "",
    applicationId: application._id,
    therapistId:
      updates.therapistId ||
      application.publishedTherapistId ||
      application.targetTherapistId ||
      "",
    decision: updates.decision || "",
    reviewStatus: updates.reviewStatus || "",
    publishRecommendation: updates.publishRecommendation || "",
    actorName: updates.actorName || "",
    rationale: updates.rationale || updates.notes || "",
    notes: updates.notes || "",
    changedFields: Array.isArray(updates.changedFields) ? updates.changedFields : [],
    createdAt: now,
  };
}

export function buildTherapistOpsEvent(therapist, updates) {
  const now = new Date().toISOString();
  return {
    _id: `therapist-publish-event-${therapist._id}-${crypto.randomUUID()}`,
    _type: "therapistPublishEvent",
    eventType: updates.eventType,
    providerId: therapist.providerId || buildProviderId(therapist),
    candidateId: "",
    candidateDocumentId: "",
    applicationId: "",
    therapistId: therapist._id,
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

export function buildTherapistApplicationFieldPatch(
  application,
  therapist,
  selectedFields,
  nowIso,
  helpers,
) {
  const allowed = new Set([
    "credentials",
    "title",
    "location",
    "website",
    "email",
    "phone",
    "preferred_contact_method",
    "preferred_contact_label",
    "insurance_accepted",
    "telehealth_states",
    "accepting_new_patients",
    "medication_management",
  ]);
  const fields = Array.isArray(selectedFields)
    ? selectedFields
        .map((field) => String(field || "").trim())
        .filter((field) => allowed.has(field))
    : [];

  const patch = {};
  fields.forEach(function (field) {
    if (field === "credentials") patch.credentials = application.credentials || "";
    else if (field === "title") patch.title = application.title || "";
    else if (field === "location") {
      patch.city = application.city || "";
      patch.state = application.state || "";
      patch.zip = application.zip || "";
    } else if (field === "website") patch.website = application.website || "";
    else if (field === "email") patch.email = application.email || "";
    else if (field === "phone") patch.phone = application.phone || "";
    else if (field === "preferred_contact_method")
      patch.preferredContactMethod = application.preferredContactMethod || "";
    else if (field === "preferred_contact_label")
      patch.preferredContactLabel = application.preferredContactLabel || "";
    else if (field === "insurance_accepted")
      patch.insuranceAccepted = helpers.splitList(application.insuranceAccepted);
    else if (field === "telehealth_states")
      patch.telehealthStates = helpers.splitList(application.telehealthStates);
    else if (field === "accepting_new_patients")
      patch.acceptingNewPatients = helpers.parseBoolean(application.acceptingNewPatients, true);
    else if (field === "medication_management")
      patch.medicationManagement = helpers.parseBoolean(application.medicationManagement, false);
  });

  const mergedDraft = {
    ...therapist,
    ...patch,
    licensureVerification: helpers.mergeLicensureVerification(
      therapist.licensureVerification,
      application.licensureVerification,
    ),
    sourceUrl: therapist.sourceUrl || application.sourceUrl || application.website || "",
    supportingSourceUrls: mergeUniqueUrls(
      therapist.sourceUrl,
      therapist.supportingSourceUrls,
      mergeUniqueUrls(
        application.sourceUrl,
        application.supportingSourceUrls,
        application.website ? [application.website] : [],
      ),
    ),
    sourceReviewedAt: application.sourceReviewedAt || therapist.sourceReviewedAt || nowIso,
    therapistReportedConfirmedAt:
      application.therapistReportedConfirmedAt || therapist.therapistReportedConfirmedAt || "",
    fieldReviewStates: therapist.fieldReviewStates || {},
    therapistReportedFields: Array.from(
      new Set(
        []
          .concat(therapist.therapistReportedFields || [])
          .concat(application.therapistReportedFields || []),
      ),
    ),
  };
  const verificationMeta = computeTherapistVerificationMeta(mergedDraft);

  return {
    patch: {
      ...patch,
      licensureVerification: mergedDraft.licensureVerification,
      supportingSourceUrls: mergedDraft.supportingSourceUrls,
      sourceReviewedAt: mergedDraft.sourceReviewedAt,
      therapistReportedConfirmedAt: mergedDraft.therapistReportedConfirmedAt,
      therapistReportedFields: mergedDraft.therapistReportedFields,
      fieldTrustMeta: buildFieldTrustMeta(mergedDraft),
      lastOperationalReviewAt: verificationMeta.lastOperationalReviewAt,
      nextReviewDueAt: verificationMeta.nextReviewDueAt,
      verificationPriority: verificationMeta.verificationPriority,
      verificationLane: verificationMeta.verificationLane,
      dataCompletenessScore: verificationMeta.dataCompletenessScore,
    },
    appliedFields: fields,
  };
}

export function normalizePortableApplicationDocument(doc, helpers) {
  const fieldReviewStates = helpers.normalizeFieldReviewStates(doc.fieldReviewStates, {
    keyStyle: "camelCase",
  });

  return normalizePortableApplication({
    id: doc._id,
    created_at: doc.submittedAt || doc._createdAt,
    updated_at: doc.updatedAt || doc._updatedAt || doc.submittedAt || doc._createdAt,
    status: doc.status || "pending",
    intake_type: doc.intakeType || "new_listing",
    provider_id: doc.providerId || buildProviderId(doc),
    target_therapist_slug: doc.targetTherapistSlug || "",
    target_therapist_id: doc.targetTherapistId || "",
    slug: doc.submittedSlug || "",
    name: doc.name || "",
    credentials: doc.credentials || "",
    title: doc.title || "",
    photo_url: doc.photo && doc.photo.asset ? doc.photo.asset.url || "" : "",
    photo_source_type: doc.photoSourceType || "",
    photo_reviewed_at: doc.photoReviewedAt || "",
    photo_usage_permission_confirmed: Boolean(doc.photoUsagePermissionConfirmed),
    bio: doc.bio || "",
    email: doc.email || "",
    phone: doc.phone || "",
    website: doc.website || "",
    preferred_contact_method: doc.preferredContactMethod || "",
    preferred_contact_label: doc.preferredContactLabel || "",
    contact_guidance: doc.contactGuidance || "",
    first_step_expectation: doc.firstStepExpectation || "",
    booking_url: doc.bookingUrl || "",
    practice_name: doc.practiceName || "",
    city: doc.city || "",
    state: doc.state || "",
    zip: doc.zip || "",
    license_state: doc.licenseState || "",
    license_number: doc.licenseNumber || "",
    specialties: Array.isArray(doc.specialties) ? doc.specialties : [],
    treatment_modalities: Array.isArray(doc.treatmentModalities) ? doc.treatmentModalities : [],
    client_populations: Array.isArray(doc.clientPopulations) ? doc.clientPopulations : [],
    insurance_accepted: Array.isArray(doc.insuranceAccepted) ? doc.insuranceAccepted : [],
    accepts_telehealth: doc.acceptsTelehealth !== false,
    accepts_in_person: doc.acceptsInPerson !== false,
    accepting_new_patients: doc.acceptingNewPatients !== false,
    years_experience: doc.yearsExperience || null,
    bipolar_years_experience: doc.bipolarYearsExperience || null,
    languages: Array.isArray(doc.languages) && doc.languages.length ? doc.languages : ["English"],
    telehealth_states: Array.isArray(doc.telehealthStates) ? doc.telehealthStates : [],
    estimated_wait_time: doc.estimatedWaitTime || "",
    care_approach: doc.careApproach || "",
    medication_management: Boolean(doc.medicationManagement),
    verification_status: doc.verificationStatus || "",
    source_url: doc.sourceUrl || "",
    licensure_verification: helpers.normalizeLicensureVerification(doc.licensureVerification),
    supporting_source_urls: Array.isArray(doc.supportingSourceUrls) ? doc.supportingSourceUrls : [],
    source_reviewed_at: doc.sourceReviewedAt || "",
    source_health_status: doc.sourceHealthStatus || "",
    source_health_checked_at: doc.sourceHealthCheckedAt || "",
    source_health_status_code:
      typeof doc.sourceHealthStatusCode === "number" ? doc.sourceHealthStatusCode : null,
    source_health_final_url: doc.sourceHealthFinalUrl || "",
    source_health_error: doc.sourceHealthError || "",
    source_drift_signals: Array.isArray(doc.sourceDriftSignals) ? doc.sourceDriftSignals : [],
    therapist_reported_fields: Array.isArray(doc.therapistReportedFields)
      ? doc.therapistReportedFields
      : [],
    therapist_reported_confirmed_at: doc.therapistReportedConfirmedAt || "",
    field_review_states: mapFieldReviewStatesToSnakeCase(fieldReviewStates),
    session_fee_min: doc.sessionFeeMin || null,
    session_fee_max: doc.sessionFeeMax || null,
    sliding_scale: Boolean(doc.slidingScale),
    notes: doc.notes || "",
    review_follow_up: normalizeReviewFollowUp(doc.reviewFollowUp),
    review_request_message: doc.reviewRequestMessage || "",
    revision_history: Array.isArray(doc.revisionHistory) ? doc.revisionHistory : [],
    revision_count: doc.revisionCount || 0,
    published_therapist_id: doc.publishedTherapistId || "",
  });
}
