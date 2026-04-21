import crypto from "node:crypto";
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
import { handleAnalyticsRoutes } from "./review-analytics-routes.mjs";
import { handleEngagementRoutes } from "./review-engagement-routes.mjs";
import { handleMatchRoutes } from "./review-match-routes.mjs";
import { handleStripeRoutes } from "./review-stripe-routes.mjs";
import {
  cancelSubscriptionImmediately,
  createBillingPortalSession,
  createFeaturedCheckoutSession,
  retrieveSubscription,
  verifyAndParseWebhook,
} from "./stripe-client.mjs";
import {
  hasEmailConfig,
  notifyAdminOfRecoveryRequest,
  notifyAdminOfSubmission,
  notifyApplicantOfDecision,
  notifyTherapistOfRecoveryReceived,
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
  canAttemptLogin,
  clearFailedLogins,
  createSignedPayload,
  createSignedSession,
  createTherapistSession,
  getAuthorizedActor,
  getAuthorizedTherapist,
  getSecurityWarnings,
  isAuthorized,
  normalizeRoutePath,
  parseAuthorizationHeader,
  parseBody as parseJsonBody,
  parseRawBody as parseRawRequestBody,
  readSignedPayload,
  readSignedSession,
  recordFailedLogin,
  sendJson,
} from "./review-http-auth.mjs";
import { handleOpsRoutes } from "./review-ops-routes.mjs";
import { handleReadRoutes } from "./review-read-routes.mjs";
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

function normalizeSlugCandidate(value) {
  return slugify(value || "");
}

function normalizeEmail(value) {
  return normalizeLower(value);
}

async function findDuplicateTherapistEntity(client, input) {
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
    if (
      reasons.length &&
      candidate.listingActive !== false &&
      String(candidate.status || "active").toLowerCase() !== "archived"
    ) {
      candidate.__duplicateReasons = reasons;
      return true;
    }
    return false;
  });

  if (therapistMatch) {
    return {
      kind: "therapist",
      id: therapistMatch._id,
      slug: therapistMatch.slug || "",
      name: therapistMatch.name || "",
      reasons: therapistMatch.__duplicateReasons || [],
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
      slug: therapist.slug.current,
      email: requesterEmail,
      exp: Date.now() + ttlMs,
      nonce: crypto.randomBytes(12).toString("hex"),
    },
    config.sessionSecret,
  );
}

function readPortalClaimToken(config, token) {
  const payload = readSignedPayload(token, config.sessionSecret);
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
  return `${base}/portal.html?token=${encodeURIComponent(token)}`;
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
  const payload = readSignedPayload(token, config.sessionSecret);
  if (!payload || payload.sub !== "recovery-confirm" || !payload.exp || payload.exp <= Date.now()) {
    return null;
  }
  return payload;
}

function buildListingRemovalToken(config, therapist) {
  return createSignedPayload(
    {
      sub: "listing-removal",
      slug: therapist.slug.current,
      exp: Date.now() + 1000 * 60 * 60 * 24,
      nonce: crypto.randomBytes(12).toString("hex"),
    },
    config.sessionSecret,
  );
}

function readListingRemovalToken(config, token) {
  const payload = readSignedPayload(token, config.sessionSecret);
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
    {
      handler: handleAuthAndPortalRoutes,
      deps: {
        buildPortalRequestDocument,
        buildRecoveryConfirmToken,
        buildRecoveryMagicLink,
        canAttemptLogin,
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
        parseAuthorizationHeader,
        parseBody,
        readListingRemovalToken,
        readPortalClaimToken,
        readRecoveryConfirmToken,
        readSignedSession,
        recordFailedLogin,
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
      handler: handleAnalyticsRoutes,
      deps: {
        getAuthorizedActor,
        isAuthorized,
        parseBody,
        sendJson,
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
        parseBody,
        parseRawBody,
        retrieveSubscription,
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
    });
  const routeModules = createReviewRouteModules();

  return async function reviewApiHandler(request, response) {
    const origin = request.headers.origin || "";
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const routePath = normalizeRoutePath(url.pathname);

    if (request.method === "OPTIONS") {
      sendJson(response, 200, { ok: true }, origin, config);
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
            response,
            routePath,
            ...(routeModule.includeUrl ? { url } : {}),
          })
        ) {
          return;
        }
      }

      sendJson(response, 404, { error: "Not found." }, origin, config);
    } catch (error) {
      sendJson(
        response,
        500,
        { error: error && error.message ? error.message : "Unexpected server error." },
        origin,
        config,
      );
    }
  };
}
