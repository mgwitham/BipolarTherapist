import { log } from "./logger.mjs";
import { normalizeLicenseForMatch } from "../shared/therapist-domain.mjs";
import { readLicenseStateParam } from "./license-states.mjs";
import { getClientAddress, sessionIsStaleForListing } from "./review-http-auth.mjs";
import { verifyTurnstileToken } from "./turnstile-verify.mjs";
import { shapePortalTherapist } from "../shared/therapist-publishing-domain.mjs";
import { buildEngagementPeriodKey } from "../shared/therapist-engagement-domain.mjs";
import { appendFunnelEvent } from "./review-analytics-routes.mjs";
import { imageBytesMatchMime } from "./review-application-support.mjs";
import {
  renderPortalCompletenessNudge,
  renderTherapistPhotoRequest,
  sendPortalCompletenessNudge,
  sendTherapistPhotoRequest,
} from "./review-email.mjs";
import {
  computePortalCompletenessSnapshot,
  persistCompletenessSnapshot,
} from "./portal-completeness-snapshot.mjs";
import {
  normalizeUrl,
  validateBookingUrl,
  validateEmail,
  validatePhone,
  validatePublicContactPresence,
  validateWebsite,
} from "../shared/contact-validation.mjs";
import { formatPhoneUS } from "../shared/phone-format.mjs";
import {
  buildApprovalPatch,
  buildRejectionPatch,
  buildSuppressionPatch,
  canPublishCandidate,
} from "../shared/photo-sourcing-domain.mjs";
import { sendSourcedPhotoNotice } from "./review-email.mjs";

// Snapshot scoring + persistence helpers live in ./portal-completeness-snapshot.mjs
// so the admin God-mode drawer (review-ops-routes.mjs) can recompute the score
// after every save too — keeping the Completeness Tracker in lockstep with
// admin edits, not just therapist edits. That module owns the PTS import.

// Validates and normalizes a PATCH /portal/therapist body. Strict
// whitelist — any field not in this map is silently ignored so a
// caller can send a bigger payload than they intend without breaking.
// Returns { setFields, unsetFields, touchedBodyKeys, hasChanges,
// error?, field? }. touchedBodyKeys is the set of snake_case body
// keys that had any effect — used to promote those fields into the
// therapist-reported set (provenance: "I reviewed this").
function validatePortalTherapistUpdates(body) {
  if (!body || typeof body !== "object") {
    return { setFields: {}, unsetFields: [], touchedBodyKeys: [], hasChanges: false };
  }

  const setFields = {};
  const unsetFields = [];
  const touchedBodyKeys = new Set();

  // Strings: trim; empty string → unset. Enforces max length.
  const stringFields = {
    credentials: { max: 200 },
    title: { max: 120 },
    email: { max: 254, validator: validateEmail },
    phone: { max: 40, normalize: formatPhoneUS, validator: validatePhone },
    website: { max: 500, normalize: normalizeUrl, validator: validateWebsite },
    bookingUrl: {
      max: 500,
      bodyKey: "booking_url",
      normalize: normalizeUrl,
      validator: validateBookingUrl,
    },
    contactGuidance: { max: 600, bodyKey: "contact_guidance" },
    firstStepExpectation: { max: 600, bodyKey: "first_step_expectation" },
    estimatedWaitTime: { max: 120, bodyKey: "estimated_wait_time" },
    careApproach: { max: 1500, bodyKey: "care_approach" },
    practiceName: { max: 200, bodyKey: "practice_name" },
    city: { max: 120 },
    zip: { max: 15 },
  };
  for (const field of Object.keys(stringFields)) {
    const spec = stringFields[field];
    const bodyKey = spec.bodyKey || field;
    if (!(bodyKey in body)) continue;
    const raw = body[bodyKey];
    if (raw === null || raw === undefined || String(raw).trim() === "") {
      unsetFields.push(field);
      touchedBodyKeys.add(bodyKey);
      continue;
    }
    let value = String(raw).trim();
    if (spec.normalize) {
      value = spec.normalize(value);
    }
    if (value.length > spec.max) {
      return { error: `${bodyKey} is too long.`, field: bodyKey };
    }
    if (spec.validator) {
      const result = spec.validator(value);
      if (!result.valid) {
        return { error: result.error, field: bodyKey };
      }
    }
    setFields[field] = value;
    touchedBodyKeys.add(bodyKey);
  }

  // Bio is required + schema-min of 50 chars. Reject clearing it.
  if ("bio" in body) {
    const bio = String(body.bio || "").trim();
    if (!bio) {
      return { error: "Bio is required.", field: "bio" };
    }
    if (bio.length < 50) {
      return { error: "Bio must be at least 50 characters.", field: "bio" };
    }
    if (bio.length > 4000) {
      return { error: "Bio is too long.", field: "bio" };
    }
    setFields.bio = bio;
    touchedBodyKeys.add("bio");
  }

  // Enum: gender.
  if ("gender" in body) {
    const raw = String(body.gender || "").trim();
    if (!raw) {
      unsetFields.push("gender");
      touchedBodyKeys.add("gender");
    } else if (!["male", "female", "non_binary"].includes(raw)) {
      return { error: "gender must be male, female, or non_binary.", field: "gender" };
    } else {
      setFields.gender = raw;
      touchedBodyKeys.add("gender");
    }
  }

  // Enum: preferredContactMethod.
  if ("preferred_contact_method" in body) {
    const raw = String(body.preferred_contact_method || "").trim();
    if (!raw) {
      unsetFields.push("preferredContactMethod");
      touchedBodyKeys.add("preferred_contact_method");
    } else if (!["email", "phone", "website", "booking"].includes(raw)) {
      return {
        error: "preferred_contact_method must be one of email, phone, website, booking.",
        field: "preferred_contact_method",
      };
    } else {
      setFields.preferredContactMethod = raw;
      touchedBodyKeys.add("preferred_contact_method");
    }
  }

  // Booleans. Accept true/false (and "true"/"false" strings).
  const booleanFields = {
    acceptingNewPatients: "accepting_new_patients",
    acceptsTelehealth: "accepts_telehealth",
    acceptsInPerson: "accepts_in_person",
    slidingScale: "sliding_scale",
    medicationManagement: "medication_management",
  };
  for (const field of Object.keys(booleanFields)) {
    const bodyKey = booleanFields[field];
    if (!(bodyKey in body)) continue;
    const raw = body[bodyKey];
    if (raw === true || raw === "true") {
      setFields[field] = true;
      touchedBodyKeys.add(bodyKey);
    } else if (raw === false || raw === "false") {
      setFields[field] = false;
      touchedBodyKeys.add(bodyKey);
    } else {
      return { error: `${bodyKey} must be true or false.`, field: bodyKey };
    }
  }

  // Numbers: session fees + experience.
  const numberFields = {
    sessionFeeMin: { bodyKey: "session_fee_min", min: 0, max: 10000 },
    sessionFeeMax: { bodyKey: "session_fee_max", min: 0, max: 10000 },
    yearsExperience: { bodyKey: "years_experience", min: 0, max: 80 },
    bipolarYearsExperience: { bodyKey: "bipolar_years_experience", min: 0, max: 80 },
  };
  for (const field of Object.keys(numberFields)) {
    const spec = numberFields[field];
    if (!(spec.bodyKey in body)) continue;
    const raw = body[spec.bodyKey];
    if (raw === null || raw === "" || raw === undefined) {
      unsetFields.push(field);
      touchedBodyKeys.add(spec.bodyKey);
      continue;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < spec.min || value > spec.max) {
      return {
        error: `${spec.bodyKey} must be a number between ${spec.min} and ${spec.max}.`,
        field: spec.bodyKey,
      };
    }
    setFields[field] = value;
    touchedBodyKeys.add(spec.bodyKey);
  }

  // Cross-field: sessionFeeMin <= sessionFeeMax when both present.
  const nextMin =
    "sessionFeeMin" in setFields
      ? setFields.sessionFeeMin
      : unsetFields.includes("sessionFeeMin")
        ? null
        : undefined;
  const nextMax =
    "sessionFeeMax" in setFields
      ? setFields.sessionFeeMax
      : unsetFields.includes("sessionFeeMax")
        ? null
        : undefined;
  if (typeof nextMin === "number" && typeof nextMax === "number" && nextMin > nextMax) {
    return {
      error: "Minimum session fee cannot exceed maximum session fee.",
      field: "session_fee_min",
    };
  }

  // Arrays of strings. Accept array or comma-separated string. Empty → unset.
  const arrayFields = {
    specialties: { bodyKey: "specialties", maxItems: 40, maxLen: 80 },
    insuranceAccepted: { bodyKey: "insurance_accepted", maxItems: 40, maxLen: 120 },
    telehealthStates: { bodyKey: "telehealth_states", maxItems: 60, maxLen: 60 },
    treatmentModalities: { bodyKey: "treatment_modalities", maxItems: 40, maxLen: 120 },
    languages: { bodyKey: "languages", maxItems: 20, maxLen: 60 },
    clientPopulations: { bodyKey: "client_populations", maxItems: 40, maxLen: 80 },
  };
  for (const field of Object.keys(arrayFields)) {
    const spec = arrayFields[field];
    if (!(spec.bodyKey in body)) continue;
    const raw = body[spec.bodyKey];
    let items;
    if (Array.isArray(raw)) {
      items = raw;
    } else if (typeof raw === "string") {
      items = raw.split(",");
    } else if (raw === null || raw === undefined) {
      unsetFields.push(field);
      touchedBodyKeys.add(spec.bodyKey);
      continue;
    } else {
      return {
        error: `${spec.bodyKey} must be an array or comma-separated string.`,
        field: spec.bodyKey,
      };
    }
    const cleaned = items
      .map((item) => String(item || "").trim())
      .filter((item) => item.length > 0);
    if (!cleaned.length) {
      unsetFields.push(field);
      touchedBodyKeys.add(spec.bodyKey);
      continue;
    }
    if (cleaned.length > spec.maxItems) {
      return { error: `${spec.bodyKey} has too many entries.`, field: spec.bodyKey };
    }
    if (cleaned.some((item) => item.length > spec.maxLen)) {
      return { error: `${spec.bodyKey} contains an entry that is too long.`, field: spec.bodyKey };
    }
    setFields[field] = cleaned;
    touchedBodyKeys.add(spec.bodyKey);
  }

  const hasChanges = Object.keys(setFields).length > 0 || unsetFields.length > 0;
  return {
    setFields,
    unsetFields,
    touchedBodyKeys: Array.from(touchedBodyKeys),
    hasChanges,
  };
}

export async function handlePortalProfileRoutes(context) {
  const { config, deps, request, response } = context;
  const { refreshTherapistSessionIfStale } = deps;

  // Silently rotate an aging session cookie on every portal request so the
  // effective window stays sliding rather than expiring at a fixed issuance time.
  if (refreshTherapistSessionIfStale) {
    refreshTherapistSessionIfStale(request, response, config);
  }

  const route = PORTAL_PROFILE_ROUTES.find(
    (r) => r.methods.includes(request.method) && r.path === context.routePath,
  );
  return route ? route.handler(context) : false;
}

const PORTAL_PROFILE_ROUTES = [
  { methods: ["GET"], path: "/portal/me", handler: portalGetMe },
  { methods: ["POST"], path: "/portal/photo", handler: portalPostPhoto },
  { methods: ["PATCH", "POST"], path: "/portal/therapist", handler: portalUpdateTherapist },
  { methods: ["GET"], path: "/portal/analytics", handler: portalGetAnalytics },
  {
    methods: ["POST"],
    path: "/portal/listing-removal/request",
    handler: portalPostListingRemovalRequest,
  },
  {
    methods: ["GET"],
    path: "/portal/listing-removal/confirm",
    handler: portalGetListingRemovalConfirm,
  },
  {
    methods: ["GET"],
    path: "/portal/completeness-summary",
    handler: portalGetCompletenessSummary,
  },
  {
    methods: ["GET"],
    path: "/portal/completeness-nudge/preview",
    handler: portalGetCompletenessNudgePreview,
  },
  { methods: ["POST"], path: "/portal/completeness-nudge", handler: portalPostCompletenessNudge },
  { methods: ["GET"], path: "/portal/photo-missing", handler: portalGetPhotoMissing },
  {
    methods: ["GET"],
    path: "/portal/photo-request/preview",
    handler: portalGetPhotoRequestPreview,
  },
  { methods: ["POST"], path: "/portal/photo-request", handler: portalPostPhotoRequest },
  { methods: ["GET"], path: "/portal/photo-review-queue", handler: adminGetPhotoReviewQueue },
  { methods: ["POST"], path: "/portal/photo-review/approve", handler: adminPostPhotoApprove },
  { methods: ["POST"], path: "/portal/photo-review/reject", handler: adminPostPhotoReject },
  { methods: ["GET"], path: "/portal/photo-optout/confirm", handler: publicGetPhotoOptOut },
];

// GET /portal/photo-optout/confirm?token=... — the one-click opt-out link
// in the sourced-photo notice email. No login: the signed token stands in
// for authentication. Clears the public-source photo and suppresses
// re-sourcing, then redirects to a friendly confirmation page.
async function publicGetPhotoOptOut(context) {
  const { client, config, response, url } = context;
  const { readPhotoOptOutToken } = context.deps;
  const token = String((url.searchParams && url.searchParams.get("token")) || "").trim();
  const returnBase = String(config.portalBaseUrl || "http://localhost:5173").replace(/\/+$/, "");

  function redirect(status) {
    response.statusCode = 302;
    response.setHeader("Location", `${returnBase}/remove?photo=${status}`);
    response.end();
    return true;
  }

  if (!token) return redirect("invalid");
  const payload = readPhotoOptOutToken(config, token);
  if (!payload || !payload.slug) return redirect("expired");

  const therapist = await client.fetch(
    `*[_type == "therapist" && slug.current == $slug][0]{ _id, "slug": slug.current, photoSourceType, photoSuppressed }`,
    { slug: payload.slug },
  );
  if (!therapist) return redirect("invalid");

  // Idempotent: an already-suppressed photo still redirects to success.
  if (therapist.photoSuppressed) return redirect("removed");

  await client
    .patch(therapist._id)
    .set(buildSuppressionPatch(therapist))
    .commit({ visibility: "sync" });

  appendFunnelEvent(client, "sourced_photo_opted_out", { therapist_slug: payload.slug });
  return redirect("removed");
}

// GET /portal/photo-review-queue — admin-only. Sourced headshots awaiting
// review before they publish (photoCandidate present, status=pending).
async function adminGetPhotoReviewQueue(context) {
  const { client, config, deps, origin, request, response } = context;
  const { sendJson } = context.deps;
  if (!deps.isAuthorized || !deps.isAuthorized(request, config)) {
    sendJson(response, 401, { error: "Admin session required." }, origin, config);
    return true;
  }
  const rows = await client.fetch(
    `*[_type == "therapist" && photoCandidateStatus == "pending" && photoSuppressed != true && defined(photoCandidate.asset)] | order(photoCandidateSourcedAt desc) {
        "slug": slug.current,
        name,
        city,
        state,
        website,
        claimStatus,
        photoCandidateSourceUrl,
        photoCandidateSourceHost,
        photoCandidateSourcedAt,
        "candidateUrl": photoCandidate.asset->url,
        "hasEmail": defined(email) && email != ""
      }`,
  );
  sendJson(response, 200, { ok: true, therapists: rows || [] }, origin, config);
  return true;
}

// Shared lookup for the approve/reject handlers: admin gate + fetch the
// therapist by slug with the fields the domain module needs.
async function loadPhotoReviewTarget(context) {
  const { client, config, deps, origin, request, response } = context;
  const { parseBody, sendJson } = context.deps;
  if (!deps.isAuthorized || !deps.isAuthorized(request, config)) {
    sendJson(response, 401, { error: "Admin session required." }, origin, config);
    return null;
  }
  const body = await parseBody(request);
  const slug = String((body && body.slug) || "").trim();
  if (!slug) {
    sendJson(response, 400, { error: "slug is required." }, origin, config);
    return null;
  }
  const doc = await client.fetch(
    `*[_type == "therapist" && slug.current == $slug][0]{
      _id, name, email, "slug": slug.current,
      photoCandidateStatus, photoSuppressed,
      "candidateAssetRef": photoCandidate.asset._ref,
      "candidateUrl": photoCandidate.asset->url
    }`,
    { slug },
  );
  if (!doc) {
    sendJson(response, 404, { error: "Therapist not found." }, origin, config);
    return null;
  }
  return doc;
}

// POST /portal/photo-review/approve — publish the sourced candidate. Copies
// photoCandidate into the live photo field and emails the therapist a
// notice with one-click opt-out + claim links.
async function adminPostPhotoApprove(context) {
  const { client, config, origin, response } = context;
  const { buildPhotoOptOutToken, sendJson } = context.deps;
  const doc = await loadPhotoReviewTarget(context);
  if (!doc) return true;

  if (!canPublishCandidate(doc) || !doc.candidateAssetRef) {
    sendJson(
      response,
      409,
      { error: "No pending photo to approve for this listing." },
      origin,
      config,
    );
    return true;
  }

  const nowIso = new Date().toISOString();
  await client
    .patch(doc._id)
    .set(buildApprovalPatch({ candidateAssetRef: doc.candidateAssetRef, nowIso }))
    .commit({ visibility: "sync" });

  appendFunnelEvent(client, "sourced_photo_published", { therapist_slug: doc.slug });

  // Notice + opt-out. Best-effort — a mail failure shouldn't unpublish.
  let noticeSent = false;
  if (doc.email) {
    try {
      const result = await sendSourcedPhotoNotice(
        config,
        doc,
        config.portalBaseUrl,
        buildPhotoOptOutToken,
        { photoUrl: doc.candidateUrl },
      );
      noticeSent = Boolean(result && result.sent);
    } catch (error) {
      log.warn("Sourced-photo notice email failed", {
        slug: doc.slug,
        err: error?.message || String(error),
      });
    }
  }
  sendJson(response, 200, { ok: true, published: true, noticeSent }, origin, config);
  return true;
}

// POST /portal/photo-review/reject — discard the candidate and suppress
// re-sourcing. Does not publish anything.
async function adminPostPhotoReject(context) {
  const { client, config, origin, response } = context;
  const { sendJson } = context.deps;
  const doc = await loadPhotoReviewTarget(context);
  if (!doc) return true;

  await client.patch(doc._id).set(buildRejectionPatch()).commit({ visibility: "sync" });
  sendJson(response, 200, { ok: true, rejected: true }, origin, config);
  return true;
}

async function portalGetMe(context) {
  const { client, config, origin, request, response } = context;
  const { getAuthorizedTherapist, sendJson } = context.deps;
  const session = getAuthorizedTherapist(request, config);
  if (!session) {
    sendJson(response, 401, { error: "Not signed in." }, origin, config);
    return true;
  }

  const therapist = await client.fetch(
    `*[_type == "therapist" && slug.current == $slug][0]{
        _id, name, email, city, state, zip, practiceName, status, listingActive,
        claimStatus, claimedByEmail, claimedAt, ownershipChangedAt,
        portalLastSeenAt, listingPauseRequestedAt, listingRemovalRequestedAt,
        "slug": slug.current,
        bio, credentials, title, phone, website, bookingUrl, gender,
        preferredContactMethod, preferredContactLabel, contactGuidance, firstStepExpectation,
        acceptingNewPatients, acceptsTelehealth, acceptsInPerson,
        sessionFeeMin, sessionFeeMax, slidingScale,
        specialties, insuranceAccepted, telehealthStates, treatmentModalities, languages, clientPopulations,
        careApproach, estimatedWaitTime, yearsExperience, bipolarYearsExperience,
        medicationManagement, therapistReportedFields, portalFirstSaveAt, portalLastSaveAt, portalSaveCount
      }`,
    { slug: session.slug },
  );

  if (!therapist) {
    sendJson(response, 404, { error: "Therapist profile not found." }, origin, config);
    return true;
  }
  if (sessionIsStaleForListing(session, therapist)) {
    sendJson(
      response,
      401,
      { error: "Your session is no longer valid for this listing." },
      origin,
      config,
    );
    return true;
  }

  sendJson(
    response,
    200,
    {
      ok: true,
      session: {
        slug: session.slug,
        email: session.email,
        expires_at: session.expiresAt,
      },
      therapist: shapePortalTherapist(therapist),
    },
    origin,
    config,
  );
  return true;
}

// POST /portal/photo — therapist-uploaded headshot. Accepts a base64
// data URL (same encoding the application intake uses), uploads to
// Sanity, attaches the asset reference to the authenticated
// therapist, and stamps photoSourceType=therapist_uploaded.
async function portalPostPhoto(context) {
  const { client, config, origin, request, requestId, response } = context;
  const { getAuthorizedTherapist, parseBody, sendJson } = context.deps;
  const session = getAuthorizedTherapist(request, config);
  if (!session) {
    sendJson(response, 401, { error: "Not signed in." }, origin, config);
    return true;
  }

  const body = await parseBody(request);
  const dataUrl = String((body && body.photo_upload_base64) || "").trim();
  const filenameRaw = String((body && body.photo_filename) || "therapist-headshot").trim();
  const filename = filenameRaw || "therapist-headshot";

  if (!dataUrl) {
    sendJson(response, 400, { error: "Headshot upload was empty." }, origin, config);
    return true;
  }

  const ALLOWED_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
  const MAX_BYTES = 4 * 1024 * 1024;
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    sendJson(
      response,
      400,
      { error: "Headshot must be a base64-encoded data URL." },
      origin,
      config,
    );
    return true;
  }
  const mimeType = String(match[1] || "")
    .trim()
    .toLowerCase();
  if (!ALLOWED_MIMES.has(mimeType)) {
    sendJson(
      response,
      400,
      { error: "Headshot must be a JPG, PNG, or WebP image." },
      origin,
      config,
    );
    return true;
  }
  const buffer = Buffer.from(String(match[2] || "").trim(), "base64");
  if (!buffer.length) {
    sendJson(response, 400, { error: "Headshot upload was empty." }, origin, config);
    return true;
  }
  if (buffer.length > MAX_BYTES) {
    sendJson(
      response,
      400,
      { error: "Headshot image is too large. Keep it under 4 MB." },
      origin,
      config,
    );
    return true;
  }
  // The data-URL MIME prefix is client-controlled; confirm the actual
  // bytes match the claimed image type so a caller can't store arbitrary
  // content labeled as an image.
  if (!imageBytesMatchMime(buffer, mimeType)) {
    sendJson(
      response,
      400,
      { error: "Headshot file contents don't match a JPG, PNG, or WebP image." },
      origin,
      config,
    );
    return true;
  }

  const therapist = await client.fetch(
    `*[_type == "therapist" && slug.current == $slug][0]{
        _id, claimStatus, claimedByEmail, ownershipChangedAt, name, email, city, state,
        "existingPhotoAssetRef": photo.asset._ref,
        preferredContactMethod, phone, bookingUrl,
        careApproach, bio, practiceName, website, languages,
        sessionFeeMin, sessionFeeMax, slidingScale,
        treatmentModalities, acceptsInPerson, acceptsTelehealth, insuranceAccepted,
        estimatedWaitTime, firstStepExpectation, specialties, clientPopulations,
        yearsExperience, bipolarYearsExperience
      }`,
    { slug: session.slug },
  );
  if (!therapist) {
    sendJson(response, 404, { error: "Therapist profile not found." }, origin, config);
    return true;
  }
  if (sessionIsStaleForListing(session, therapist)) {
    sendJson(
      response,
      401,
      { error: "Your session is no longer valid for this listing." },
      origin,
      config,
    );
    return true;
  }
  if (therapist.claimStatus !== "claimed") {
    sendJson(
      response,
      403,
      { error: "Claim this profile before uploading a headshot." },
      origin,
      config,
    );
    return true;
  }

  let asset;
  try {
    asset = await client.assets.upload("image", buffer, {
      filename: filename,
      contentType: mimeType,
    });
  } catch (error) {
    log.error("Sanity asset upload failed for portal photo", {
      requestId,
      err: error?.message || String(error),
    });
    sendJson(
      response,
      502,
      { error: "Couldn't upload the headshot. Try again in a moment." },
      origin,
      config,
    );
    return true;
  }

  const nowIso = new Date().toISOString();
  await client
    .patch(therapist._id)
    .set({
      photo: { _type: "image", asset: { _type: "reference", _ref: asset._id } },
      photoSourceType: "therapist_uploaded",
      photoReviewedAt: nowIso,
      photoUsagePermissionConfirmed: true,
    })
    .commit({ visibility: "sync" });

  // Delete the previous headshot asset now that nothing references it,
  // so repeated re-uploads don't accumulate orphaned assets in the
  // dataset. Best-effort: a failure (e.g. the asset is still referenced
  // elsewhere) is logged, not surfaced — the upload already succeeded.
  if (therapist.existingPhotoAssetRef && therapist.existingPhotoAssetRef !== asset._id) {
    client.delete(therapist.existingPhotoAssetRef).catch((delErr) => {
      log.warn("Failed to delete replaced portal photo asset", {
        requestId,
        assetId: therapist.existingPhotoAssetRef,
        err: delErr?.message || String(delErr),
      });
    });
  }

  // Completeness snapshot — hasPhoto is now true since we just uploaded.
  const snapshotAfterPhoto = computePortalCompletenessSnapshot(
    Object.assign({}, therapist, { hasPhoto: true }),
  );
  persistCompletenessSnapshot(client, therapist._id, snapshotAfterPhoto, nowIso);

  sendJson(
    response,
    200,
    {
      photo_url: asset.url,
      photo_source_type: "therapist_uploaded",
      photo_reviewed_at: nowIso,
    },
    origin,
    config,
  );
  return true;
}

// PATCH /portal/therapist — self-service profile edits for an
// authenticated claimed therapist. Writes are direct (no admin
// review) for the whitelisted field set below. Identity/trust fields
// (name, licenseNumber, licenseState, public email, slug) are NOT
// editable here on purpose — those require re-verification.
async function portalUpdateTherapist(context) {
  const { client, config, origin, request, response } = context;
  const { getAuthorizedTherapist, parseBody, sendJson } = context.deps;
  const session = getAuthorizedTherapist(request, config);
  if (!session) {
    sendJson(response, 401, { error: "Not signed in." }, origin, config);
    return true;
  }

  const body = await parseBody(request);
  const validation = validatePortalTherapistUpdates(body);
  if (validation.error) {
    sendJson(response, 400, { error: validation.error, field: validation.field }, origin, config);
    return true;
  }
  if (!validation.hasChanges) {
    sendJson(response, 400, { error: "No editable fields supplied." }, origin, config);
    return true;
  }

  const existing = await client.fetch(
    `*[_type == "therapist" && slug.current == $slug][0]{
        _id, claimStatus, claimedByEmail, ownershipChangedAt, therapistReportedFields,
        portalFirstSaveAt, portalSaveCount,
        listingActive, status, bio, listingRemovalRequestedAt,
        email, phone, website, bookingUrl
      }`,
    { slug: session.slug },
  );
  if (!existing) {
    sendJson(response, 404, { error: "Therapist profile not found." }, origin, config);
    return true;
  }
  if (sessionIsStaleForListing(session, existing)) {
    sendJson(
      response,
      401,
      { error: "Your session is no longer valid for this listing." },
      origin,
      config,
    );
    return true;
  }
  if (existing.claimStatus !== "claimed") {
    sendJson(response, 403, { error: "Claim this profile before editing it." }, origin, config);
    return true;
  }

  // Presence check against the after-state: the patch must not leave
  // the therapist with zero public contact methods. Compute effective
  // values by layering validation.setFields and unsetFields on top of
  // the existing doc, then run the presence validator.
  const contactAfter = {
    email: existing.email || "",
    phone: existing.phone || "",
    website: existing.website || "",
    bookingUrl: existing.bookingUrl || "",
  };
  ["email", "phone", "website", "bookingUrl"].forEach(function (key) {
    if (key in validation.setFields) {
      contactAfter[key] = validation.setFields[key];
    } else if (validation.unsetFields.includes(key)) {
      contactAfter[key] = "";
    }
  });
  const presence = validatePublicContactPresence(contactAfter);
  if (!presence.valid) {
    sendJson(response, 400, { error: presence.error, field: "email" }, origin, config);
    return true;
  }

  // Merge touched snake_case keys into therapistReportedFields. Any
  // field the therapist submitted — set or unset — is considered
  // reviewed. This is the provenance signal the portal uses to hide
  // the "unreviewed" dot and dismiss the "review scraped data"
  // banner on the next render.
  const priorReported = Array.isArray(existing.therapistReportedFields)
    ? existing.therapistReportedFields
    : [];
  const nextReportedSet = new Set(priorReported);
  (validation.touchedBodyKeys || []).forEach(function (key) {
    nextReportedSet.add(key);
  });
  const nextReported = Array.from(nextReportedSet);

  // Save bookkeeping for portal funnel analytics. Aggregate-friendly
  // counters + timestamps on the therapist doc — no new doc types.
  // portalFirstSaveAt sticks (never overwritten). portalLastSaveAt
  // and portalSaveCount update every save.
  const nowIso = new Date().toISOString();
  const saveBookkeeping = {
    portalLastSaveAt: nowIso,
    portalSaveCount: Number(existing.portalSaveCount || 0) + 1,
  };
  if (!existing.portalFirstSaveAt) {
    saveBookkeeping.portalFirstSaveAt = nowIso;
  }

  // Auto-publish: a therapist who signed up via signup-instant-checkout
  // lands with listingActive=false + status=pending_profile so their
  // stub bio doesn't leak into the public directory before they fill
  // it in. The first portal save that results in a bio of 50+ chars
  // (matches the Sanity schema's min validation) flips them live
  // automatically. No admin gate, no extra click.
  //
  // Gate strictly on the pending_profile signup stub: listingActive can
  // be false for other reasons (confirmed listing removal, admin
  // pause/archive, DCA freshness inactivation), and a portal save must
  // never resurrect those listings.
  const setFields = { ...validation.setFields };
  const shouldAutoPublish =
    existing.status === "pending_profile" &&
    !existing.listingRemovalRequestedAt &&
    ((typeof setFields.bio === "string" && setFields.bio.trim().length >= 50) ||
      (setFields.bio === undefined &&
        typeof existing.bio === "string" &&
        existing.bio.trim().length >= 50 &&
        !/^Pending/i.test(existing.bio.trim())));
  if (shouldAutoPublish) {
    setFields.listingActive = true;
    setFields.status = "active";
  }

  let patch = client.patch(existing._id);
  if (Object.keys(setFields).length) {
    patch = patch.set(setFields);
  }
  if (validation.unsetFields.length) {
    patch = patch.unset(validation.unsetFields);
  }
  if (nextReported.length > priorReported.length) {
    patch = patch.set({ therapistReportedFields: nextReported });
  }
  patch = patch.set(saveBookkeeping);
  await patch.commit({ visibility: "sync" });

  const updated = await client.fetch(
    `*[_type == "therapist" && slug.current == $slug][0]{
        _id, name, email, city, state, zip, practiceName, status, listingActive,
        claimStatus, claimedByEmail, claimedAt, ownershipChangedAt,
        portalLastSeenAt, listingPauseRequestedAt, listingRemovalRequestedAt,
        "slug": slug.current,
        bio, credentials, title, phone, website, bookingUrl, gender,
        preferredContactMethod, preferredContactLabel, contactGuidance, firstStepExpectation,
        acceptingNewPatients, acceptsTelehealth, acceptsInPerson,
        sessionFeeMin, sessionFeeMax, slidingScale,
        specialties, insuranceAccepted, telehealthStates, treatmentModalities, languages, clientPopulations,
        careApproach, estimatedWaitTime, yearsExperience, bipolarYearsExperience,
        medicationManagement, therapistReportedFields, portalFirstSaveAt, portalLastSaveAt, portalSaveCount,
        portalCompletenessScore, portalCompletionFields,
        "hasPhoto": defined(photo.asset)
      }`,
    { slug: session.slug },
  );

  // Update completeness snapshot async — does not block the response.
  const snapshot = computePortalCompletenessSnapshot(updated);
  persistCompletenessSnapshot(client, existing._id, snapshot, nowIso);

  sendJson(response, 200, { ok: true, therapist: shapePortalTherapist(updated) }, origin, config);
  return true;
}

// GET /portal/analytics — V0 portal analytics dashboard. Returns
// the authenticated therapist's engagement summary for the current
// calendar month (and the prior month for context, not yet rendered
// in the UI but useful for an eventual 30-day rolling window).
//
// Data source: therapistEngagementSummary Sanity documents, which
// are written by the /engagement/view and /engagement/cta-click
// endpoints when patients view or interact with profiles. This
// endpoint is read-only.
//
// Gating: any authenticated claimed therapist can hit this. When
// paid-tier subscriptions go live, free vs paid response payloads
// can diverge (free = total-only, paid = full breakdown). V0
// returns the full breakdown to every caller; the client chooses
// what to render.
async function portalGetAnalytics(context) {
  const { client, config, origin, request, response } = context;
  const { getAuthorizedTherapist, sendJson } = context.deps;
  const session = getAuthorizedTherapist(request, config);
  if (!session) {
    sendJson(response, 401, { error: "Not signed in." }, origin, config);
    return true;
  }

  const owner = await client.fetch(
    `*[_type == "therapist" && slug.current == $slug][0]{ claimedByEmail, ownershipChangedAt }`,
    { slug: session.slug },
  );
  if (sessionIsStaleForListing(session, owner)) {
    sendJson(
      response,
      401,
      { error: "Your session is no longer valid for this listing." },
      origin,
      config,
    );
    return true;
  }

  const summaries = await client.fetch(
    `*[_type == "therapistEngagementSummary" && therapistSlug == $slug] | order(periodKey desc) [0...12]{
        _id,
        periodKey,
        periodYear,
        periodWeek,
        periodStart,
        profileViewsTotal,
        profileViewsDirect,
        profileViewsDirectory,
        profileViewsMatch,
        profileViewsEmail,
        profileViewsSearch,
        profileViewsOther,
        ctaClicksTotal,
        ctaClicksEmail,
        ctaClicksPhone,
        ctaClicksBooking,
        ctaClicksWebsite,
        ctaClicksOther,
        firstEventAt,
        lastEventAt
      }`,
    { slug: session.slug },
  );

  const currentPeriodKey = buildEngagementPeriodKey(new Date().toISOString());
  const list = Array.isArray(summaries) ? summaries : [];
  const current = list.find((s) => s.periodKey === currentPeriodKey) || null;
  const previous = list.find((s) => s.periodKey !== currentPeriodKey) || null;

  sendJson(
    response,
    200,
    {
      ok: true,
      slug: session.slug,
      current_period_key: currentPeriodKey,
      current: current,
      previous: previous,
      summaries: list,
    },
    origin,
    config,
  );
  return true;
}

// POST /portal/listing-removal/request — start the listing-removal
// flow. We added California therapists to the directory without
// explicit consent; this endpoint is their email-verified off-ramp.
//
// Verification mirrors the quick-claim endpoint: full name, CA
// license number, and email must all match the listing on file.
// Security nuance: the confirmation email is always sent to the
// email ON FILE, not to whatever address the submitter typed, so an
// attacker who knows a therapist's license number cannot take over
// the removal flow by typing a different email. If the on-file
// email is stale, the therapist has to contact support directly.
//
// Response policy: we deliberately return a generic "check your
// inbox" message whether or not the listing exists, so the endpoint
// can't be used to enumerate directory membership. Specific errors
// (missing fields, bad request body) still return 400 so the form
// can show useful hints to legitimate users.
async function portalPostListingRemovalRequest(context) {
  const { client, config, deps, origin, request, requestId, response } = context;
  const { parseBody, sendJson } = context.deps;
  const body = await parseBody(request);

  const turnstile = await verifyTurnstileToken({
    token: body && body.turnstile_token,
    remoteIp: getClientAddress(request),
    config,
  });
  if (!turnstile.ok) {
    log.warn("Turnstile rejected /portal/listing-removal/request", {
      requestId,
      code: turnstile.code,
      errorCodes: turnstile.errorCodes,
    });
    sendJson(
      response,
      403,
      { error: "Verification failed. Please refresh the page and try again." },
      origin,
      config,
    );
    return true;
  }

  const rawFullName = String(body.full_name || "").trim();
  const rawEmail = String(body.email || "").trim();
  const rawLicense = String(body.license_number || "").trim();

  if (!rawFullName || !rawEmail || !rawLicense) {
    sendJson(
      response,
      400,
      { error: "Full name, email, and CA license number are all required." },
      origin,
      config,
    );
    return true;
  }

  const fullName = normalizeNameForMatch(rawFullName);
  const requesterEmail = rawEmail.toLowerCase();
  const licenseNumber = normalizeLicenseForMatch(rawLicense);

  // Look up the listing. If any check fails (not found, name
  // mismatch, email mismatch) we return the same generic 200
  // response as on success — no info leak. Real failures that the
  // form couldn't have caused (e.g. missing email on file) log
  // server-side and fall through to the generic success response.
  const genericSuccess = () => {
    sendJson(
      response,
      200,
      { ok: true, message: "If a listing matches, a confirmation email is on its way." },
      origin,
      config,
    );
    return true;
  };

  // Scoped to one state's license namespace (two states can issue the
  // same number); the !defined() escape keeps legacy docs visible until
  // a licenseState backfill.
  const removalLicenseState = readLicenseStateParam(body.license_state);
  const therapist = await client.fetch(
    `*[_type == "therapist" && (licenseState == $licenseState || !defined(licenseState)) && licenseNumber match $license][0]{
        _id, name, email, website, listingActive, "slug": slug
      }`,
    { license: `*${licenseNumber}*`, licenseState: removalLicenseState },
  );
  if (!therapist || !therapist.slug || !therapist.slug.current) {
    return genericSuccess();
  }
  // Already-removed listings: silently succeed so we don't leak
  // state. Nothing more to do — the listing is gone.
  if (therapist.listingActive === false) {
    return genericSuccess();
  }

  const profileName = normalizeNameForMatch(therapist.name);
  if (!profileName || profileName !== fullName) {
    return genericSuccess();
  }

  const profileEmail = String(therapist.email || "")
    .trim()
    .toLowerCase();
  const emailMatches = profileEmail && profileEmail === requesterEmail;
  const domainVerified =
    !emailMatches && emailDomainMatchesWebsite(requesterEmail, therapist.website);
  if (!emailMatches && !domainVerified) {
    return genericSuccess();
  }

  // No on-file email means we cannot deliver a verification link.
  // Fall through to generic response — an internal ops task will
  // need to follow up manually. The incidence should be near-zero
  // since we require email on ingest.
  if (!profileEmail) {
    return genericSuccess();
  }

  const { sendListingRemovalLink } = deps;
  try {
    await sendListingRemovalLink(config, therapist, config.portalBaseUrl);
  } catch (error) {
    // Log and still return generic success; an email-delivery
    // failure should not reveal that the listing exists.
    log.error("Failed to send listing removal link", {
      requestId,
      err: error?.message || String(error),
    });
  }

  return genericSuccess();
}

// GET /portal/listing-removal/confirm?token=... — the link the
// therapist clicks from the confirmation email. Validates the
// signed token, flips listingActive to false + stamps
// listingRemovalRequestedAt, and redirects back to /remove with a
// query param that drives the toast banner. No auth header needed —
// the signed token is the auth.
async function portalGetListingRemovalConfirm(context) {
  const { client, config, response, url } = context;
  const { readListingRemovalToken } = context.deps;
  const token = String((url.searchParams && url.searchParams.get("token")) || "").trim();
  const returnBase = config.portalBaseUrl;

  function redirect(status) {
    response.statusCode = 302;
    response.setHeader("Location", `${returnBase}/remove?removed=${status}`);
    response.end();
    return true;
  }

  if (!token) {
    return redirect("invalid");
  }

  const payload = readListingRemovalToken(config, token);
  if (!payload || !payload.slug) {
    return redirect("expired");
  }

  const therapist = await client.fetch(
    `*[_type == "therapist" && slug.current == $slug][0]{ _id, listingActive, listingRemovalRequestedAt }`,
    { slug: payload.slug },
  );
  if (!therapist) {
    return redirect("invalid");
  }

  // Idempotent: if already removed, still treat as success.
  if (therapist.listingActive === false) {
    return redirect("ok");
  }

  await client
    .patch(therapist._id)
    .set({
      listingActive: false,
      listingRemovalRequestedAt: new Date().toISOString(),
    })
    .commit({ visibility: "sync" });

  // Headline removal metric. Fire only on the true→false transition,
  // not on the idempotent re-click path above.
  appendFunnelEvent(client, "listing_removal_confirmed", {
    therapist_slug: payload.slug,
  });

  return redirect("ok");
}

// GET /portal/completeness-summary — admin-only.
// Returns all claimed therapists that have been scored, sorted by
// completeness ascending (lowest first = most actionable for email targeting).
async function portalGetCompletenessSummary(context) {
  const { client, config, deps, origin, request, response } = context;
  const { sendJson } = context.deps;
  if (!deps.isAuthorized || !deps.isAuthorized(request, config)) {
    sendJson(response, 401, { error: "Admin session required." }, origin, config);
    return true;
  }
  // Sort: least-recently-nudged first so the daily admin flow naturally
  // picks up therapists you haven't touched in the longest. Never-nudged
  // therapists (null portalNudgeLastSentAt) come before any with a date,
  // ordered by completeness ascending within that group.
  const rows = await client.fetch(
    `*[_type == "therapist" && claimStatus == "claimed"] | order(
        coalesce(portalNudgeLastSentAt, "1970-01-01T00:00:00Z") asc,
        portalCompletenessScore asc
      ) {
        "slug": slug.current,
        name,
        email,
        city,
        state,
        portalCompletenessScore,
        portalCompletionFields,
        portalLastSaveAt,
        portalCompletenessUpdatedAt,
        portalNudgeSentCount,
        portalNudgeLastSentAt,
        "hasEmail": defined(email) && email != ""
      }`,
  );
  sendJson(response, 200, { ok: true, therapists: rows || [] }, origin, config);
  return true;
}

// GET /portal/completeness-nudge/preview?slug=<slug> — admin-only.
// Returns the rendered email so the admin can see exactly what would
// be sent before clicking Send. Does NOT send anything.
async function portalGetCompletenessNudgePreview(context) {
  const { client, config, deps, origin, request, response, url } = context;
  const { sendJson } = context.deps;
  if (!deps.isAuthorized || !deps.isAuthorized(request, config)) {
    sendJson(response, 401, { error: "Admin session required." }, origin, config);
    return true;
  }
  const slugParam = String((url && url.searchParams.get("slug")) || "").trim();
  if (!slugParam) {
    sendJson(response, 400, { error: "slug query param is required." }, origin, config);
    return true;
  }
  // Mirror the send endpoint's filter exactly so admin can't preview an
  // email for a record that would be silently rejected at send time.
  // Includes claim_status because nudges only target claimed therapists.
  const t = await client.fetch(
    `*[_type == "therapist" && claimStatus == "claimed" && slug.current == $slug][0]{
        _id,
        "slug": slug.current,
        name,
        email,
        portalCompletenessScore,
        portalCompletionFields
      }`,
    { slug: slugParam },
  );
  if (!t) {
    sendJson(response, 404, { error: "Therapist not found or not claimed." }, origin, config);
    return true;
  }
  const rendered = renderPortalCompletenessNudge(config, t, config.portalBaseUrl);
  sendJson(
    response,
    200,
    {
      ok: true,
      preview: {
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        to_email: rendered.toEmail,
        portal_url: rendered.portalUrl,
        name: t.name || "",
        slug: t.slug,
        score: rendered.score,
        missing_shown: rendered.missingShown,
        missing_total: rendered.missingTotal,
      },
    },
    origin,
    config,
  );
  return true;
}

// POST /portal/completeness-nudge — admin-only.
// Body: { slugs: ["slug1", "slug2", ...] }
// Sends a personalized profile-completion email to each slug.
// Returns { sent, failed, results }.
async function portalPostCompletenessNudge(context) {
  const { client, config, deps, origin, request, response } = context;
  const { sendJson } = context.deps;
  if (!deps.isAuthorized || !deps.isAuthorized(request, config)) {
    sendJson(response, 401, { error: "Admin session required." }, origin, config);
    return true;
  }
  const body = await deps.parseBody(request);
  const slugs = Array.isArray(body && body.slugs)
    ? body.slugs
        .map((s) => String(s || "").trim())
        .filter(Boolean)
        .slice(0, 100)
    : [];
  if (!slugs.length) {
    sendJson(response, 400, { error: "Provide at least one slug." }, origin, config);
    return true;
  }

  const therapists = await client.fetch(
    `*[_type == "therapist" && claimStatus == "claimed" && slug.current in $slugs]{
        _id,
        "slug": slug.current,
        name,
        email,
        portalCompletenessScore,
        portalCompletionFields
      }`,
    { slugs },
  );

  // Process therapists in bounded-concurrency chunks. Each Resend request
  // is mostly network-bound (~200-500ms), and a 50-row batch in series
  // would block the response for 10-25 seconds. 4 in flight keeps us
  // well under Resend's rate limits (10 req/sec on paid) while cutting
  // wall time by ~4x. Each task is fully isolated — one failure does
  // not affect the rest.
  const NUDGE_CONCURRENCY = 4;

  async function nudgeOne(t) {
    const toEmail = String(t.email || "")
      .trim()
      .toLowerCase();
    if (!toEmail) {
      return { slug: t.slug, status: "skipped", reason: "no email on file" };
    }
    try {
      await sendPortalCompletenessNudge(config, t, config.portalBaseUrl);
      // Durable tracking — increment lifetime count + stamp last-sent so the
      // admin Completeness tracker can surface "Sent 3× · 4d ago" and sort
      // by least-recently-nudged. Log on failure rather than swallowing so
      // we notice if the count drifts.
      client
        .patch(t._id)
        .setIfMissing({ portalNudgeSentCount: 0 })
        .inc({ portalNudgeSentCount: 1 })
        .set({ portalNudgeLastSentAt: new Date().toISOString() })
        .commit({ visibility: "async" })
        .catch((patchErr) => {
          log.warn("[nudge] failed to persist nudge count", {
            slug: t.slug,
            err: patchErr?.message || String(patchErr),
          });
        });
      // Aggregate trend — feeds the existing admin Funnel tab.
      appendFunnelEvent(client, "portal_nudge_sent", {
        therapist_slug: t.slug,
        score: typeof t.portalCompletenessScore === "number" ? t.portalCompletenessScore : null,
      });
      return { slug: t.slug, status: "sent", to: toEmail };
    } catch (err) {
      return { slug: t.slug, status: "failed", reason: (err && err.message) || "unknown" };
    }
  }

  const results = [];
  for (let i = 0; i < therapists.length; i += NUDGE_CONCURRENCY) {
    const chunk = therapists.slice(i, i + NUDGE_CONCURRENCY);
    const settled = await Promise.all(chunk.map(nudgeOne));
    results.push(...settled);
  }
  const sent = results.filter((r) => r.status === "sent").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;

  sendJson(response, 200, { ok: true, sent, failed, skipped, results }, origin, config);
  return true;
}

// GET /portal/photo-missing — admin-only.
// Claimed therapists with a live listing but no headshot on file — the
// target list for the "add your photo" campaign. Sorted least-recently-
// requested first (never-requested before any with a date) so the daily
// admin pass naturally works through the backlog without re-hitting the
// same people. Photos only ever arrive via consent-based portal upload,
// so this campaign is how the directory fills in faces.
async function portalGetPhotoMissing(context) {
  const { client, config, deps, origin, request, response } = context;
  const { sendJson } = context.deps;
  if (!deps.isAuthorized || !deps.isAuthorized(request, config)) {
    sendJson(response, 401, { error: "Admin session required." }, origin, config);
    return true;
  }
  const rows = await client.fetch(
    `*[_type == "therapist" && claimStatus == "claimed" && listingActive != false && !defined(photo.asset)] | order(
        coalesce(photoRequestLastSentAt, "1970-01-01T00:00:00Z") asc,
        name asc
      ) {
        "slug": slug.current,
        name,
        email,
        city,
        state,
        photoRequestSentCount,
        photoRequestLastSentAt,
        "hasEmail": defined(email) && email != ""
      }`,
  );
  sendJson(response, 200, { ok: true, therapists: rows || [] }, origin, config);
  return true;
}

// GET /portal/photo-request/preview?slug=<slug> — admin-only.
// Renders the email so admin can see exactly what would be sent. Does
// NOT send anything.
async function portalGetPhotoRequestPreview(context) {
  const { client, config, deps, origin, request, response, url } = context;
  const { sendJson } = context.deps;
  if (!deps.isAuthorized || !deps.isAuthorized(request, config)) {
    sendJson(response, 401, { error: "Admin session required." }, origin, config);
    return true;
  }
  const slugParam = String((url && url.searchParams.get("slug")) || "").trim();
  if (!slugParam) {
    sendJson(response, 400, { error: "slug query param is required." }, origin, config);
    return true;
  }
  // Mirror the send endpoint's filter so admin can't preview an email for
  // a record the send step would silently reject.
  const t = await client.fetch(
    `*[_type == "therapist" && claimStatus == "claimed" && slug.current == $slug][0]{
        "slug": slug.current,
        name,
        email
      }`,
    { slug: slugParam },
  );
  if (!t) {
    sendJson(response, 404, { error: "Therapist not found or not claimed." }, origin, config);
    return true;
  }
  const rendered = renderTherapistPhotoRequest(config, t, config.portalBaseUrl);
  sendJson(
    response,
    200,
    {
      ok: true,
      preview: {
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        to_email: rendered.toEmail,
        portal_url: rendered.portalUrl,
        name: t.name || "",
        slug: t.slug,
      },
    },
    origin,
    config,
  );
  return true;
}

// POST /portal/photo-request — admin-only.
// Body: { slugs: ["slug1", ...] }
// Sends the "add your photo" email to each claimed slug, tracks the
// send, and returns { sent, failed, skipped, results }. Mirrors the
// completeness-nudge send endpoint's concurrency + tracking model.
async function portalPostPhotoRequest(context) {
  const { client, config, deps, origin, request, response } = context;
  const { sendJson } = context.deps;
  if (!deps.isAuthorized || !deps.isAuthorized(request, config)) {
    sendJson(response, 401, { error: "Admin session required." }, origin, config);
    return true;
  }
  const body = await deps.parseBody(request);
  const slugs = Array.isArray(body && body.slugs)
    ? body.slugs
        .map((s) => String(s || "").trim())
        .filter(Boolean)
        .slice(0, 100)
    : [];
  if (!slugs.length) {
    sendJson(response, 400, { error: "Provide at least one slug." }, origin, config);
    return true;
  }

  const therapists = await client.fetch(
    `*[_type == "therapist" && claimStatus == "claimed" && slug.current in $slugs]{
        _id,
        "slug": slug.current,
        name,
        email
      }`,
    { slugs },
  );

  // Bounded concurrency, same as the completeness nudge: each Resend
  // call is network-bound, so 4 in flight keeps wall time low while
  // staying well under rate limits. One failure never affects the rest.
  const PHOTO_REQUEST_CONCURRENCY = 4;

  async function requestOne(t) {
    const toEmail = String(t.email || "")
      .trim()
      .toLowerCase();
    if (!toEmail) {
      return { slug: t.slug, status: "skipped", reason: "no email on file" };
    }
    try {
      await sendTherapistPhotoRequest(config, t, config.portalBaseUrl);
      client
        .patch(t._id)
        .setIfMissing({ photoRequestSentCount: 0 })
        .inc({ photoRequestSentCount: 1 })
        .set({ photoRequestLastSentAt: new Date().toISOString() })
        .commit({ visibility: "async" })
        .catch((patchErr) => {
          log.warn("[photo-request] failed to persist send count", {
            slug: t.slug,
            err: patchErr?.message || String(patchErr),
          });
        });
      appendFunnelEvent(client, "photo_request_sent", { therapist_slug: t.slug });
      return { slug: t.slug, status: "sent", to: toEmail };
    } catch (err) {
      return { slug: t.slug, status: "failed", reason: (err && err.message) || "unknown" };
    }
  }

  const results = [];
  for (let i = 0; i < therapists.length; i += PHOTO_REQUEST_CONCURRENCY) {
    const chunk = therapists.slice(i, i + PHOTO_REQUEST_CONCURRENCY);
    const settled = await Promise.all(chunk.map(requestOne));
    results.push(...settled);
  }
  const sent = results.filter((r) => r.status === "sent").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;

  sendJson(response, 200, { ok: true, sent, failed, skipped, results }, origin, config);
  return true;
}

// Helper functions also used by portal-profile routes (listing-removal)
function normalizeNameForMatch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^(dr|mr|mrs|ms|mx|prof)\.?\s+/i, "")
    .split(",")[0]
    .replace(/[^a-z\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const AGGREGATOR_DOMAINS = new Set([
  "psychologytoday.com",
  "goodtherapy.org",
  "therapyden.com",
  "rula.com",
  "headway.co",
  "growtherapy.com",
  "zencare.co",
  "alma.com",
  "helloalma.com",
  "betterhelp.com",
  "talkspace.com",
  "lifestance.com",
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "yelp.com",
  "healthgrades.com",
  "wellsheet.com",
  "mentalhealthmatch.com",
]);

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "comcast.net",
  "sbcglobal.net",
  "att.net",
  "verizon.net",
  "cox.net",
]);

function extractRegistrableDomain(value) {
  let host = String(value || "")
    .trim()
    .toLowerCase();
  if (!host) {
    return "";
  }
  host = host.replace(/^https?:\/\//, "").replace(/^www\./, "");
  host = host.split("/")[0].split("?")[0].split("#")[0].split(":")[0];
  host = host.replace(/\.+$/, "");
  if (!host || !host.includes(".")) {
    return "";
  }
  const parts = host.split(".");
  if (
    parts.length >= 3 &&
    parts[parts.length - 2].length <= 3 &&
    parts[parts.length - 1].length <= 3
  ) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

function emailDomainMatchesWebsite(email, website) {
  const emailDomain = extractRegistrableDomain(String(email || "").split("@")[1] || "");
  const siteDomain = extractRegistrableDomain(website);
  if (!emailDomain || !siteDomain) {
    return false;
  }
  if (AGGREGATOR_DOMAINS.has(emailDomain) || AGGREGATOR_DOMAINS.has(siteDomain)) {
    return false;
  }
  if (FREE_EMAIL_DOMAINS.has(emailDomain)) {
    return false;
  }
  return emailDomain === siteDomain;
}
