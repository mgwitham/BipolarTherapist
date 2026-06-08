import crypto from "node:crypto";
import { Sentry } from "./sentry.mjs";
import { log } from "./logger.mjs";
import { createClient } from "@sanity/client";
import {
  buildApplicationDocument,
  buildRevisionFieldUpdates,
  mergeLicensureVerification,
  normalizeLicensureVerification,
  parseBoolean,
  parseNumber,
  splitList,
  updateApplicationFields,
  validateRevisionInput,
} from "./review-application-support.mjs";
import { handleApplicationRoutes } from "./review-application-routes.mjs";
import { handleAuthAndPortalRoutes } from "./review-auth-portal-routes.mjs";
import { handleCandidateIngestRoutes } from "./review-candidate-ingest-routes.mjs";
import { handleCandidateRoutes } from "./review-candidate-routes.mjs";
import { verifyLicense } from "./dca-license-client.mjs";
import { getReviewApiConfig } from "./review-config.mjs";
import { getRateLimiter } from "./rate-limit-store.mjs";
import { handleAnalyticsRoutes } from "./review-analytics-routes.mjs";
import { handleEngagementRoutes } from "./review-engagement-routes.mjs";
import { handleCronRoutes } from "./review-cron-routes.mjs";
import { handleResendWebhookRoutes } from "./review-resend-webhook-routes.mjs";
import { handlePatientSignalRoutes } from "./review-patient-signal-routes.mjs";
import { handleMatchRoutes } from "./review-match-routes.mjs";
import { handleSavedListRoutes } from "./review-saved-list-routes.mjs";
import { handleStripeRoutes } from "./review-stripe-routes.mjs";
import { handleWaitlistRoutes } from "./review-waitlist-routes.mjs";
import {
  cancelSubscriptionImmediately,
  createBillingPortalSession,
  createFeaturedCheckoutSession,
  retrieveSubscription,
  verifyAndParseWebhook,
} from "./stripe-client.mjs";
import {
  hasEmailConfig,
  sendEmail as sendRawEmail,
  notifyAdminOfRecoveryRequest,
  notifyAdminOfSubmission,
  notifyApplicantOfDecision,
  notifyTherapistOfRecoveryReceived,
  sendFounderAlert,
  sendListingRemovalLink as sendListingRemovalLinkEmail,
  sendPortalClaimLink as sendPortalClaimLinkEmail,
  sendPortalWelcomeEmail,
  sendRecoveryApprovedEmail,
  sendRecoveryConfirmationEmail,
  sendRecoveryConfirmationHeadsUp,
  sendRecoveryRejectedEmail,
  sendTrialEndingReminder,
  sendUnverifiedTrialCanceledNotice,
} from "./review-email.mjs";
import {
  ADMIN_SESSION_COOKIE,
  THERAPIST_SESSION_COOKIE,
  canAttemptIntake,
  recordIntakeAttempt,
  canAttemptLogin,
  canAttemptPortalAuth,
  recordPortalAuthAttempt,
  buildExpiredSessionCookie,
  buildSessionCookie,
  clearFailedLogins,
  createSignedPayload,
  createSignedSession,
  createTherapistSession,
  getAuthorizedActor,
  getAuthorizedTherapist,
  getClientAddress,
  getSecurityWarnings,
  isAuthorized,
  normalizeRoutePath,
  parseBody as parseJsonBody,
  parseRawBody as parseRawRequestBody,
  readAdminSessionFromRequest,
  readSignedPayload,
  recordFailedLogin,
  sessionVerificationSecrets,
  refreshTherapistSessionIfStale,
  sendJson,
} from "./review-http-auth.mjs";
import { handleOpsRoutes } from "./review-ops-routes.mjs";
import { handleReadRoutes } from "./review-read-routes.mjs";
import { handleEmailPreviewRoutes } from "./dev/email-preview-routes.mjs";
import { normalizePortableApplication } from "../shared/application-domain.mjs";
import {
  annotateMatchOutcomeForDisplay,
  annotateMatchRequestForDisplay,
  buildMatchOutcomeDocument,
  buildMatchRequestDocument,
} from "../shared/match-persistence-domain.mjs";
import { annotateProviderFieldObservationForDisplay } from "../shared/provider-field-observation-domain.mjs";
import {
  buildApplicationReviewEvent,
  buildCandidateReviewEvent,
  buildPublishEventId,
  buildTherapistApplicationFieldPatch,
  buildTherapistDocument,
  buildTherapistDocumentFromCandidate,
  buildCandidateMergeFillFields,
  buildTherapistObservationDocuments,
  buildTherapistOpsEvent,
  normalizePortableApplicationDocument,
  normalizePortableCandidate,
} from "../shared/therapist-publishing-domain.mjs";
import {
  buildFieldTrustMeta,
  computeTherapistVerificationMeta,
} from "../shared/therapist-trust-domain.mjs";
import {
  buildDuplicateIdentity,
  buildProviderId,
  compareDuplicateIdentity,
  createTherapistConfirmedFieldReviewStates,
  mapFieldReviewStatesToCamelCase,
  mapFieldReviewStatesToSnakeCase,
  normalizeDisplayRole,
  normalizeFieldReviewStates,
  normalizeLower,
  normalizeText,
  resolveApplicationIntakeType,
  slugify,
} from "../shared/therapist-domain.mjs";

const publishingHelpers = {
  mergeLicensureVerification,
  normalizeFieldReviewStates,
  normalizeLicensureVerification,
  parseBoolean,
  parseNumber,
  splitList,
};

const MAX_REQUEST_BODY_BYTES = 8 * 1024 * 1024;
const MAX_PHOTO_UPLOAD_BYTES = 4 * 1024 * 1024;
const ALLOWED_PHOTO_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
// Per-route limits for abuse-prone public writes. Enforcement runs
// through the shared rate-limit store (Upstash Redis when configured,
// in-process Map otherwise), so counts survive cold starts and are
// shared across concurrent serverless instances. See rate-limit-store.mjs.
const PUBLIC_WRITE_RATE_LIMITS = {
  "POST /applications": { limit: 30, windowMs: 60 * 60 * 1000 },
  "POST /applications/free-path-selected": { limit: 60, windowMs: 60 * 60 * 1000 },
  "POST /applications/intake": { limit: 30, windowMs: 60 * 60 * 1000 },
  "POST /engagement/cta-click": { limit: 300, windowMs: 15 * 60 * 1000 },
  "POST /engagement/view": { limit: 300, windowMs: 15 * 60 * 1000 },
  "POST /match/outcomes": { limit: 120, windowMs: 15 * 60 * 1000 },
  "POST /match/requests": { limit: 60, windowMs: 15 * 60 * 1000 },
  "GET /portal/quick-claim/lookup": { limit: 60, windowMs: 60 * 60 * 1000 },
  "GET /portal/quick-claim/lookup-by-email": { limit: 60, windowMs: 60 * 60 * 1000 },
  "GET /portal/quick-claim/search": { limit: 60, windowMs: 60 * 60 * 1000 },
  "POST /portal/claim-by-slug": { limit: 120, windowMs: 60 * 60 * 1000 },
  "POST /portal/claim-link": { limit: 120, windowMs: 60 * 60 * 1000 },
  "POST /portal/listing-removal/request": { limit: 30, windowMs: 60 * 60 * 1000 },
  "POST /portal/quick-claim": { limit: 120, windowMs: 60 * 60 * 1000 },
  "POST /portal/recovery-request": { limit: 30, windowMs: 60 * 60 * 1000 },
  "POST /portal/requests": { limit: 30, windowMs: 60 * 60 * 1000 },
  "POST /portal/sign-in": { limit: 120, windowMs: 60 * 60 * 1000 },
  "POST /saved-list/email": { limit: 30, windowMs: 60 * 60 * 1000 },
  "POST /waitlist": { limit: 30, windowMs: 60 * 60 * 1000 },
};

function normalizeSlugCandidate(value) {
  return slugify(value || "");
}

function normalizeEmail(value) {
  return normalizeLower(value);
}

// Find an existing therapist or in-progress application that matches the
// intake identity.
//
// options.includeArchived (default false): when true, soft-deleted
// therapists (listingActive=false OR status=archived) are also returned,
// flagged as `archived: true` on the result. The intake route uses this
// to take a restore-on-re-signup path: same person comes back, we
// un-archive their old doc instead of creating a duplicate.
//
// When includeArchived is false (default), archived docs are skipped so
// the legacy /applications endpoint keeps its current strict behavior.
async function findDuplicateTherapistEntity(client, input, options) {
  const includeArchived = Boolean(options && options.includeArchived);
  const identity = buildDuplicateIdentity(input);
  const [therapists, applications] = await Promise.all([
    client.fetch(
      `*[_type == "therapist"]{
        _id,
        name,
        credentials,
        email,
        phone,
        website,
        bookingUrl,
        city,
        state,
        licenseState,
        licenseNumber,
        "slug": slug.current,
        listingActive,
        status
      }`,
    ),
    client.fetch(
      `*[_type == "therapistApplication" && status in ["pending", "reviewing", "requested_changes", "approved"]]{
        _id,
        name,
        credentials,
        email,
        phone,
        website,
        bookingUrl,
        city,
        state,
        licenseState,
        licenseNumber,
        submittedSlug,
        status,
        publishedTherapistId
      }`,
    ),
  ]);

  const therapistMatch = (therapists || []).find(function (candidate) {
    const reasons = compareDuplicateIdentity(identity, candidate);
    if (!reasons.length) return false;
    const isArchived =
      candidate.listingActive === false ||
      String(candidate.status || "active").toLowerCase() === "archived";
    if (isArchived && !includeArchived) return false;
    candidate.__duplicateReasons = reasons;
    candidate.__archived = isArchived;
    return true;
  });

  if (therapistMatch) {
    return {
      kind: "therapist",
      id: therapistMatch._id,
      slug: therapistMatch.slug || "",
      name: therapistMatch.name || "",
      reasons: therapistMatch.__duplicateReasons || [],
      archived: Boolean(therapistMatch.__archived),
    };
  }

  const applicationMatch = (applications || []).find(function (candidate) {
    const shapedCandidate = {
      ...candidate,
      slug: candidate.submittedSlug || "",
    };
    const reasons = compareDuplicateIdentity(identity, shapedCandidate);
    if (reasons.length) {
      candidate.__duplicateReasons = reasons;
      return true;
    }
    return false;
  });

  if (applicationMatch) {
    return {
      kind: "application",
      id: applicationMatch._id,
      slug: applicationMatch.submittedSlug || "",
      name: applicationMatch.name || "",
      status: applicationMatch.status || "pending",
      publishedTherapistId: applicationMatch.publishedTherapistId || "",
      reasons: applicationMatch.__duplicateReasons || [],
    };
  }

  return null;
}

function parseBody(request) {
  return parseJsonBody(request, MAX_REQUEST_BODY_BYTES);
}

function parseRawBody(request) {
  return parseRawRequestBody(request, MAX_REQUEST_BODY_BYTES);
}

function firstHeaderEntry(value) {
  if (!value) return "";
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw).split(",")[0].trim();
}

function getRequestOrigin(request) {
  const headers = (request && request.headers) || {};
  const host = firstHeaderEntry(headers["x-forwarded-host"]) || firstHeaderEntry(headers.host);
  if (!host) return "";
  const proto = firstHeaderEntry(headers["x-forwarded-proto"]) || "https";
  return `${proto}://${host}`;
}

function requestHasCookie(request, cookieName) {
  const header = String((request && request.headers && request.headers.cookie) || "");
  if (!header || !cookieName) return false;
  return header.split(";").some(function (entry) {
    const separatorIndex = entry.indexOf("=");
    const name = separatorIndex === -1 ? entry : entry.slice(0, separatorIndex);
    return name.trim() === cookieName;
  });
}

function isMutatingMethod(method) {
  return method === "POST" || method === "PATCH" || method === "PUT" || method === "DELETE";
}

function isAllowedRequestOrigin(request, origin, config) {
  if (!origin) return true;
  if (Array.isArray(config.allowedOrigins) && config.allowedOrigins.includes(origin)) return true;
  return origin === getRequestOrigin(request);
}

function shouldRejectSessionWriteForOrigin(request, origin, config) {
  if (!isMutatingMethod(request.method)) return false;
  if (!origin) return false;
  const hasSessionCookie =
    requestHasCookie(request, ADMIN_SESSION_COOKIE) ||
    requestHasCookie(request, THERAPIST_SESSION_COOKIE);
  if (!hasSessionCookie) return false;
  return !isAllowedRequestOrigin(request, origin, config);
}

function getRateLimitClientKey(request) {
  // Delegate to the shared trusted-IP resolver so the gateway limiter
  // keys on a header a client cannot spoof (see getClientAddress).
  return getClientAddress(request) || "unknown";
}

async function evaluatePublicWriteRateLimit(request, routePath, config) {
  const routeKey = `${request.method} ${routePath}`;
  const limit = PUBLIC_WRITE_RATE_LIMITS[routeKey];
  if (!limit) {
    return { exceeded: false };
  }

  const limiter = getRateLimiter(`public-write:${routeKey}`, limit.windowMs, limit.limit, config);
  const key = getRateLimitClientKey(request);

  if (!(await limiter.canAttempt(key))) {
    // Both backends use a fixed window; the current window ends at the
    // next windowMs boundary, so that's the soonest a retry can succeed.
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((limit.windowMs - (Date.now() % limit.windowMs)) / 1000),
    );
    return { exceeded: true, retryAfterSeconds };
  }

  await limiter.record(key);
  return { exceeded: false };
}

function addDays(isoString, days) {
  const base = isoString ? new Date(isoString) : new Date();
  if (Number.isNaN(base.getTime())) {
    const fallback = new Date();
    fallback.setUTCDate(fallback.getUTCDate() + days);
    return fallback.toISOString();
  }
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString();
}

function computeCandidateReviewMeta(candidateLike) {
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

function buildLicensureOpsEvent(record, updates) {
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

function buildAppliedFieldReviewStatePatch(selectedFields) {
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

function normalizeApplication(doc) {
  return normalizePortableApplicationDocument(doc, {
    normalizeFieldReviewStates,
    normalizeLicensureVerification,
  });
}

function normalizeCandidate(doc) {
  return normalizePortableCandidate(doc, {
    normalizeLicensureVerification,
  });
}

function resolveSlug(slugField) {
  if (!slugField) return "";
  if (typeof slugField === "string") return slugField;
  return slugField.current || "";
}

function normalizeAdminTherapist(doc) {
  const fieldReviewStates = normalizeFieldReviewStates(doc && doc.fieldReviewStates, {
    keyStyle: "camelCase",
  });
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

function normalizeReviewEvent(doc) {
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

function normalizePortalRequest(doc) {
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

function buildPortalRequestDocument(input) {
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

function buildPortalClaimToken(config, therapist, requesterEmail, options) {
  // Default 24h TTL for quick-claim flows. Callers (e.g. the
  // application-approval email) can pass { ttlMs: N } to extend for
  // cases where the user may not check email immediately.
  const defaultTtl = 1000 * 60 * 60 * 24;
  const ttlMs =
    options && Number.isFinite(options.ttlMs) && options.ttlMs > 0 ? options.ttlMs : defaultTtl;
  return createSignedPayload(
    {
      sub: "therapist-portal",
      slug: resolveSlug(therapist.slug),
      email: requesterEmail,
      exp: Date.now() + ttlMs,
      nonce: crypto.randomBytes(12).toString("hex"),
    },
    config.sessionSecret,
  );
}

function readPortalClaimToken(config, token) {
  const payload = readSignedPayload(token, sessionVerificationSecrets(config));
  if (!payload || payload.sub !== "therapist-portal" || !payload.exp || payload.exp <= Date.now()) {
    return null;
  }
  return payload;
}

async function sendPortalClaimLink(config, therapist, requesterEmail, portalBaseUrl, options) {
  return sendPortalClaimLinkEmail(
    config,
    therapist,
    requesterEmail,
    portalBaseUrl,
    buildPortalClaimToken,
    options,
  );
}

// Build a 24h portal magic-link URL for a therapist + recovery email.
// Used by the recovery-queue approve flow — admin has already verified
// identity out-of-band, so we directly issue a fresh claim token bound
// to the requested email and link it in the approval notification.
function buildRecoveryMagicLink(config, therapist, requestedEmail, portalBaseUrl) {
  const token = buildPortalClaimToken(config, therapist, requestedEmail);
  const base = String(portalBaseUrl || "").replace(/\/+$/, "");
  return `${base}/portal?token=${encodeURIComponent(token)}`;
}

// Listing-removal token — one-time, 24h, bound to therapist slug.
// Stored with sub "listing-removal" so it can't be mistakenly accepted
// as a portal-claim token and vice versa.
// Therapist-self-confirm token — 7-day TTL, bound to a recovery-request
// doc. Admin sends a magic-link email asking "did you request access?".
// Therapist clicks Yes/No on a public page, which auto-approves or
// auto-rejects. The token is single-use via nonce stored on the doc.
function buildRecoveryConfirmToken(config, recoveryId, nonce) {
  return createSignedPayload(
    {
      sub: "recovery-confirm",
      recovery: String(recoveryId),
      nonce: String(nonce),
      exp: Date.now() + 1000 * 60 * 60 * 24 * 7,
    },
    config.sessionSecret,
  );
}

function readRecoveryConfirmToken(config, token) {
  const payload = readSignedPayload(token, sessionVerificationSecrets(config));
  if (!payload || payload.sub !== "recovery-confirm" || !payload.exp || payload.exp <= Date.now()) {
    return null;
  }
  return payload;
}

function buildListingRemovalToken(config, therapist) {
  return createSignedPayload(
    {
      sub: "listing-removal",
      slug: resolveSlug(therapist.slug),
      exp: Date.now() + 1000 * 60 * 60 * 24,
      nonce: crypto.randomBytes(12).toString("hex"),
    },
    config.sessionSecret,
  );
}

function readListingRemovalToken(config, token) {
  const payload = readSignedPayload(token, sessionVerificationSecrets(config));
  if (!payload || payload.sub !== "listing-removal" || !payload.exp || payload.exp <= Date.now()) {
    return null;
  }
  return payload;
}

async function sendListingRemovalLink(config, therapist, portalBaseUrl) {
  return sendListingRemovalLinkEmail(config, therapist, portalBaseUrl, buildListingRemovalToken);
}

async function updatePortalRequestFields(client, requestId, fields) {
  const allowedUpdates = {};

  if (
    typeof fields.status === "string" &&
    ["open", "in_review", "resolved"].includes(fields.status)
  ) {
    allowedUpdates.status = fields.status;
    allowedUpdates.reviewedAt = new Date().toISOString();
  }

  if (!Object.keys(allowedUpdates).length) {
    throw new Error("No valid portal request updates were provided.");
  }

  return client.patch(requestId).set(allowedUpdates).commit({ visibility: "sync" });
}

function createReviewRouteModules() {
  const applicationSupportDeps = {
    buildProviderId,
    createTherapistConfirmedFieldReviewStates,
    mapFieldReviewStatesToCamelCase,
    photoOptions: {
      allowedMimeTypes: ALLOWED_PHOTO_MIME_TYPES,
      maxPhotoUploadBytes: MAX_PHOTO_UPLOAD_BYTES,
    },
    resolveApplicationIntakeType,
    slugify,
  };

  return [
    // Dev-only email preview UI at /dev/emails. Returns 404 in production
    // regardless of routing (the handler itself short-circuits on
    // NODE_ENV=production). Mounted first so it owns its prefix.
    {
      handler: handleEmailPreviewRoutes,
    },
    {
      handler: handleAuthAndPortalRoutes,
      deps: {
        buildPortalRequestDocument,
        buildExpiredSessionCookie,
        buildRecoveryConfirmToken,
        buildRecoveryMagicLink,
        buildSessionCookie,
        canAttemptLogin,
        canAttemptPortalAuth,
        clearFailedLogins,
        createFeaturedCheckoutSession,
        createSignedSession,
        createTherapistSession,
        getAuthorizedActor,
        getAuthorizedTherapist,
        getSecurityWarnings,
        isAuthorized,
        normalizePortalRequest,
        notifyAdminOfRecoveryRequest,
        notifyTherapistOfRecoveryReceived,
        parseBody,
        readListingRemovalToken,
        readPortalClaimToken,
        readRecoveryConfirmToken,
        readAdminSessionFromRequest,
        recordFailedLogin,
        recordPortalAuthAttempt,
        refreshTherapistSessionIfStale,
        sendFounderAlert,
        sendJson,
        sendListingRemovalLink,
        sendPortalClaimLink,
        sendPortalWelcomeEmail,
        sendRecoveryApprovedEmail,
        sendRecoveryConfirmationEmail,
        sendRecoveryConfirmationHeadsUp,
        sendRecoveryRejectedEmail,
        updatePortalRequestFields,
      },
      includeUrl: true,
    },
    {
      handler: handleMatchRoutes,
      deps: {
        buildMatchOutcomeDocument,
        buildMatchRequestDocument,
        parseBody,
        sendJson,
      },
    },
    {
      handler: handleEngagementRoutes,
      deps: {
        parseBody,
        sendJson,
      },
    },
    {
      handler: handleResendWebhookRoutes,
      deps: {
        parseRawBody,
      },
    },
    {
      handler: handleCronRoutes,
      deps: {},
    },
    {
      handler: handlePatientSignalRoutes,
      deps: {
        readAdminSessionFromRequest,
      },
    },
    {
      handler: handleSavedListRoutes,
      deps: {
        parseBody,
        sendJson,
        sendEmail: sendRawEmail,
      },
      includeUrl: true,
    },
    {
      handler: handleAnalyticsRoutes,
      deps: {
        getAuthorizedActor,
        isAuthorized,
        parseBody,
        sendJson,
      },
    },
    {
      handler: handleWaitlistRoutes,
      deps: {
        parseBody,
        sendJson,
        sendEmail: sendRawEmail,
      },
    },
    {
      handler: handleStripeRoutes,
      deps: {
        buildPortalClaimToken,
        cancelSubscriptionImmediately,
        createBillingPortalSession,
        createFeaturedCheckoutSession,
        getAuthorizedTherapist,
        isAuthorized,
        parseBody,
        parseRawBody,
        retrieveSubscription,
        sendFounderAlert,
        sendJson,
        sendTrialEndingReminder,
        sendUnverifiedTrialCanceledNotice,
        verifyAndParseWebhook,
      },
      includeUrl: true,
    },
    {
      handler: handleReadRoutes,
      deps: {
        annotateProviderFieldObservationForDisplay,
        annotateMatchOutcomeForDisplay,
        annotateMatchRequestForDisplay,
        isAuthorized,
        normalizeAdminTherapist,
        normalizeApplication,
        normalizeCandidate,
        normalizeReviewEvent,
        parseBody,
        sendJson,
      },
      includeUrl: true,
    },
    {
      handler: handleApplicationRoutes,
      deps: {
        canAttemptIntake,
        recordIntakeAttempt,
        buildApplicationDocument: function buildApplicationDocumentForRoute(client, input) {
          return buildApplicationDocument(client, input, applicationSupportDeps);
        },
        buildAppliedFieldReviewStatePatch,
        buildApplicationReviewEvent,
        buildPortalClaimToken,
        readPortalClaimToken,
        sendPortalClaimLink,
        buildRevisionFieldUpdates: function buildRevisionFieldUpdatesForRoute(
          client,
          input,
          existingApplication,
        ) {
          return buildRevisionFieldUpdates(
            client,
            input,
            existingApplication,
            applicationSupportDeps,
          );
        },
        buildTherapistApplicationFieldPatch,
        buildTherapistDocument,
        buildTherapistObservationDocuments,
        createFeaturedCheckoutSession,
        findDuplicateTherapistEntity,
        getAuthorizedActor,
        isAuthorized,
        normalizeApplication,
        notifyAdminOfSubmission,
        notifyApplicantOfDecision,
        parseBody,
        publishingHelpers,
        sendJson,
        slugify,
        updateApplicationFields,
        validateRevisionInput,
      },
      // Expose the request URL so the approval email can build a
      // portal magic link pointing at the same host the request
      // came from.
      includeUrl: true,
    },
    {
      handler: handleCandidateIngestRoutes,
      deps: {
        buildDuplicateIdentity,
        buildProviderId,
        compareDuplicateIdentity,
        computeCandidateReviewMeta,
        getAuthorizedActor,
        isAuthorized,
        parseBody,
        sendJson,
        verifyLicense,
      },
    },
    {
      handler: handleCandidateRoutes,
      deps: {
        addDays,
        buildCandidateReviewEvent,
        buildCandidateMergeFillFields,
        buildFieldTrustMeta,
        buildTherapistDocumentFromCandidate,
        buildTherapistObservationDocuments,
        computeCandidateReviewMeta,
        computeTherapistVerificationMeta,
        getAuthorizedActor,
        isAuthorized,
        mergeLicensureVerification,
        normalizeLicensureVerification,
        normalizePortableCandidate,
        parseBody,
        publishingHelpers,
        sendJson,
        verifyLicense,
      },
    },
    {
      handler: handleOpsRoutes,
      deps: {
        addDays,
        buildFieldTrustMeta,
        buildLicensureOpsEvent,
        buildTherapistOpsEvent,
        computeTherapistVerificationMeta,
        getAuthorizedActor,
        isAuthorized,
        parseBody,
        sendJson,
      },
    },
  ];
}

export function createReviewApiHandler(configOverride, clientOverride) {
  const config = configOverride || getReviewApiConfig();
  const client =
    clientOverride ||
    createClient({
      projectId: config.projectId,
      dataset: config.dataset,
      apiVersion: config.apiVersion,
      token: config.token,
      useCdn: false,
      perspective: "raw",
      // Cap any single Sanity request below Vercel's function timeout (30s)
      // so a slow query can't hang a serverless invocation indefinitely and
      // starve concurrent execution slots. @sanity/client still retries
      // transient failures up to its default maxRetries.
      timeout: 25000,
    });
  const routeModules = createReviewRouteModules();

  return async function reviewApiHandler(request, response) {
    const requestId = crypto.randomUUID();
    const requestStart = Date.now();
    const origin = request.headers.origin || "";
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const routePath = normalizeRoutePath(url.pathname);

    // Capture the status code written by any sendJson call so we can log it.
    let capturedStatus = null;
    const origWriteHead = response.writeHead.bind(response);
    response.writeHead = function (statusCode, headers) {
      capturedStatus = statusCode;
      return origWriteHead(statusCode, headers);
    };

    log.info("[http] request", { requestId, method: request.method, path: routePath });

    if (request.method === "OPTIONS") {
      sendJson(response, 200, { ok: true }, origin, config);
      log.info("[http] response", {
        requestId,
        status: capturedStatus,
        durationMs: Date.now() - requestStart,
      });
      return;
    }

    if (shouldRejectSessionWriteForOrigin(request, origin, config)) {
      sendJson(response, 403, { error: "Invalid request origin." }, origin, config);
      log.warn("[security] rejected authenticated write from disallowed origin", {
        requestId,
        method: request.method,
        path: routePath,
        origin,
      });
      log.info("[http] response", {
        requestId,
        status: capturedStatus,
        durationMs: Date.now() - requestStart,
      });
      return;
    }

    // Health check: cheap Sanity probe so uptime monitors get a real signal.
    // Accepts HEAD so UptimeRobot-style monitors (default HEAD) get the same
    // status code without configuration; the Sanity probe still runs so a
    // Sanity outage surfaces as 503 either way.
    if (routePath === "/health" && (request.method === "GET" || request.method === "HEAD")) {
      const probeStart = Date.now();
      try {
        await client.fetch('*[_type == "therapist"][0]{_id}');
        sendJson(response, 200, { ok: true, latencyMs: Date.now() - probeStart }, origin, config);
      } catch (err) {
        log.error("[health] Sanity probe failed", { requestId, err: err?.message || String(err) });
        sendJson(response, 503, { ok: false, error: "Sanity unreachable" }, origin, config);
      }
      log.info("[http] response", {
        requestId,
        status: capturedStatus,
        durationMs: Date.now() - requestStart,
      });
      return;
    }

    const publicWriteRateLimit = await evaluatePublicWriteRateLimit(request, routePath, config);
    if (publicWriteRateLimit.exceeded) {
      response.setHeader("Retry-After", String(publicWriteRateLimit.retryAfterSeconds));
      sendJson(
        response,
        429,
        { error: "Too many requests. Try again in a moment.", reason: "rate_limited" },
        origin,
        config,
      );
      log.info("[http] response", {
        requestId,
        status: capturedStatus,
        durationMs: Date.now() - requestStart,
      });
      return;
    }

    try {
      for (const routeModule of routeModules) {
        if (
          await routeModule.handler({
            client,
            config,
            deps: routeModule.deps,
            origin,
            request,
            requestId,
            response,
            routePath,
            ...(routeModule.includeUrl ? { url } : {}),
          })
        ) {
          log.info("[http] response", {
            requestId,
            status: capturedStatus,
            durationMs: Date.now() - requestStart,
          });
          return;
        }
      }

      if (!response.writableEnded) {
        sendJson(response, 404, { error: "Not found." }, origin, config);
      }
      log.info("[http] response", {
        requestId,
        status: capturedStatus,
        durationMs: Date.now() - requestStart,
      });
    } catch (error) {
      log.error("[review-api] Unhandled route error", {
        requestId,
        err: error?.message || String(error),
      });
      Sentry.captureException(error);
      if (!response.writableEnded) {
        const exposeError = process.env.NODE_ENV !== "production";
        sendJson(
          response,
          500,
          {
            error:
              exposeError && error && error.message ? error.message : "Unexpected server error.",
          },
          origin,
          config,
        );
      }
      log.info("[http] response", {
        requestId,
        status: capturedStatus,
        durationMs: Date.now() - requestStart,
      });
    }
  };
}
