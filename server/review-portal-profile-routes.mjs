import { THERAPIST_PORTAL_BY_SLUG, THERAPIST_PORTAL_SAVE_BY_SLUG } from "./queries.mjs";
import { scrubIntakeStub } from "../shared/therapist-publishing-domain.mjs";
import { buildEngagementPeriodKey } from "../shared/therapist-engagement-domain.mjs";
import { appendFunnelEvent } from "./review-analytics-routes.mjs";
import { sendPortalCompletenessNudge } from "./review-email.mjs";
import {
  normalizeUrl,
  validateBookingUrl,
  validateEmail,
  validatePhone,
  validatePublicContactPresence,
  validateWebsite,
} from "../shared/contact-validation.mjs";

// Shapes a therapist document into the portal /me + PATCH response
// payload. Kept in one place so /portal/me and /portal/therapist
// never drift.
function shapePortalTherapist(therapist) {
  return {
    slug: therapist.slug,
    name: therapist.name,
    email: therapist.email || "",
    city: therapist.city || "",
    state: therapist.state || "",
    zip: therapist.zip || "",
    practice_name: therapist.practiceName || "",
    status: therapist.status || "",
    listing_active: therapist.listingActive !== false,
    claim_status: therapist.claimStatus || "unclaimed",
    claimed_by_email: therapist.claimedByEmail || "",
    claimed_at: therapist.claimedAt || "",
    portal_last_seen_at: therapist.portalLastSeenAt || "",
    listing_pause_requested_at: therapist.listingPauseRequestedAt || "",
    listing_removal_requested_at: therapist.listingRemovalRequestedAt || "",
    bio: scrubIntakeStub(therapist.bio),
    credentials: scrubIntakeStub(therapist.credentials),
    title: therapist.title || "",
    phone: therapist.phone || "",
    website: therapist.website || "",
    booking_url: therapist.bookingUrl || "",
    preferred_contact_method: therapist.preferredContactMethod || "",
    preferred_contact_label: therapist.preferredContactLabel || "",
    contact_guidance: therapist.contactGuidance || "",
    first_step_expectation: therapist.firstStepExpectation || "",
    accepting_new_patients: therapist.acceptingNewPatients !== false,
    accepts_telehealth: therapist.acceptsTelehealth !== false,
    accepts_in_person: therapist.acceptsInPerson !== false,
    session_fee_min: typeof therapist.sessionFeeMin === "number" ? therapist.sessionFeeMin : null,
    session_fee_max: typeof therapist.sessionFeeMax === "number" ? therapist.sessionFeeMax : null,
    sliding_scale: therapist.slidingScale === true,
    client_populations: Array.isArray(therapist.clientPopulations)
      ? therapist.clientPopulations
      : [],
    specialties: Array.isArray(therapist.specialties) ? therapist.specialties : [],
    insurance_accepted: Array.isArray(therapist.insuranceAccepted)
      ? therapist.insuranceAccepted
      : [],
    telehealth_states: Array.isArray(therapist.telehealthStates) ? therapist.telehealthStates : [],
    treatment_modalities: Array.isArray(therapist.treatmentModalities)
      ? therapist.treatmentModalities
      : [],
    languages: Array.isArray(therapist.languages) ? therapist.languages : [],
    gender: therapist.gender || "",
    care_approach: scrubIntakeStub(therapist.careApproach),
    estimated_wait_time: therapist.estimatedWaitTime || "",
    years_experience:
      typeof therapist.yearsExperience === "number" ? therapist.yearsExperience : null,
    bipolar_years_experience:
      typeof therapist.bipolarYearsExperience === "number"
        ? therapist.bipolarYearsExperience
        : null,
    medication_management: therapist.medicationManagement === true,
    therapist_reported_fields: Array.isArray(therapist.therapistReportedFields)
      ? therapist.therapistReportedFields
      : [],
    portal_first_save_at: therapist.portalFirstSaveAt || "",
    portal_last_save_at: therapist.portalLastSaveAt || "",
    portal_save_count:
      typeof therapist.portalSaveCount === "number" ? therapist.portalSaveCount : 0,
    portal_completeness_score:
      typeof therapist.portalCompletenessScore === "number"
        ? therapist.portalCompletenessScore
        : null,
    portal_completion_fields: Array.isArray(therapist.portalCompletionFields)
      ? therapist.portalCompletionFields
      : [],
  };
}

// Mirrors the browser-side FIELD_REGISTRY in portal-td-completeness.js.
// Must stay in sync when field weights change. Returns { score, missingFields }.
function computePortalCompletenessSnapshot(t) {
  if (!t) return { score: 0, missingFields: [] };
  const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
  const str = (v) => String(v || "").trim();
  const num = (v) => Number(v) || 0;
  const method = str(t.preferredContactMethod).toLowerCase();
  const fields = [
    { key: "card_bio", pts: 9, done: str(t.careApproach).length >= 50 },
    {
      key: "contact",
      pts: 7,
      done:
        method === "email"
          ? Boolean(str(t.email))
          : method === "phone"
            ? Boolean(str(t.phone))
            : method === "booking"
              ? Boolean(str(t.bookingUrl))
              : false,
    },
    { key: "headshot", pts: 10, done: Boolean(t.hasPhoto) },
    { key: "name", pts: 4, done: Boolean(str(t.name)) },
    { key: "location", pts: 4, done: Boolean(str(t.city) && str(t.state)) },
    { key: "years", pts: 4, done: num(t.bipolarYearsExperience) > 0 },
    { key: "full_bio", pts: 6, done: Boolean(str(t.bio)) },
    { key: "practice_name", pts: 2, done: Boolean(str(t.practiceName)) },
    { key: "website", pts: 3, done: Boolean(str(t.website)) },
    { key: "languages", pts: 2, done: arr(t.languages).length > 0 },
    {
      key: "fee",
      pts: 7,
      done: num(t.sessionFeeMin) > 0 || num(t.sessionFeeMax) > 0 || t.slidingScale === true,
    },
    { key: "modalities", pts: 8, done: arr(t.treatmentModalities).length > 0 },
    { key: "format", pts: 4, done: Boolean(t.acceptsInPerson || t.acceptsTelehealth) },
    { key: "insurance", pts: 6, done: arr(t.insuranceAccepted).length > 0 },
    { key: "wait_time", pts: 3, done: Boolean(str(t.estimatedWaitTime)) },
    { key: "first_step", pts: 4, done: Boolean(str(t.firstStepExpectation)) },
    { key: "specialties", pts: 5, done: arr(t.specialties).length > 0 },
    { key: "populations", pts: 7, done: arr(t.clientPopulations).length > 0 },
    { key: "total_years", pts: 2, done: num(t.yearsExperience) > 0 },
    {
      key: "gender",
      pts: 3,
      done: str(t.gender) === "male" || str(t.gender) === "female",
    },
  ];
  let score = 0;
  const missingFields = [];
  for (const f of fields) {
    if (f.done) score += f.pts;
    else missingFields.push(f.key);
  }
  return { score, missingFields };
}

// Writes the completeness snapshot onto the therapist doc. Fire-and-forget —
// do NOT await this; the PATCH response does not need to block on it.
function persistCompletenessSnapshot(client, therapistId, snapshot, nowIso) {
  client
    .patch(therapistId)
    .set({
      portalCompletenessScore: snapshot.score,
      portalCompletionFields: snapshot.missingFields,
      portalCompletenessUpdatedAt: nowIso,
    })
    .commit({ visibility: "async" })
    .catch(() => {});
}

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
    phone: { max: 40, validator: validatePhone },
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
  const { client, config, deps, origin, request, response, routePath, url } = context;

  const { getAuthorizedTherapist, parseBody, readListingRemovalToken, sendJson } = deps;

  if (request.method === "GET" && routePath === "/portal/me") {
    const session = getAuthorizedTherapist(request, config);
    if (!session) {
      sendJson(response, 401, { error: "Not signed in." }, origin, config);
      return true;
    }

    const therapist = await client.fetch(THERAPIST_PORTAL_BY_SLUG, { slug: session.slug });

    if (!therapist) {
      sendJson(response, 404, { error: "Therapist profile not found." }, origin, config);
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
  if (request.method === "POST" && routePath === "/portal/photo") {
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

    const therapist = await client.fetch(
      `*[_type == "therapist" && slug.current == $slug][0]{
        _id, claimStatus, name, email, city, state,
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
      console.error("Sanity asset upload failed for portal photo.", error);
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
  if (
    (request.method === "PATCH" || request.method === "POST") &&
    routePath === "/portal/therapist"
  ) {
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
        _id, claimStatus, therapistReportedFields,
        portalFirstSaveAt, portalSaveCount,
        listingActive, status, bio,
        email, phone, website, bookingUrl
      }`,
      { slug: session.slug },
    );
    if (!existing) {
      sendJson(response, 404, { error: "Therapist profile not found." }, origin, config);
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
    const setFields = { ...validation.setFields };
    const shouldAutoPublish =
      (existing.listingActive === false || existing.status === "pending_profile") &&
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

    const updated = await client.fetch(THERAPIST_PORTAL_SAVE_BY_SLUG, { slug: session.slug });

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
  if (request.method === "GET" && routePath === "/portal/analytics") {
    const session = getAuthorizedTherapist(request, config);
    if (!session) {
      sendJson(response, 401, { error: "Not signed in." }, origin, config);
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
  if (request.method === "POST" && routePath === "/portal/listing-removal/request") {
    const body = await parseBody(request);
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

    const therapist = await client.fetch(
      `*[_type == "therapist" && licenseNumber match $license][0]{
        _id, name, email, website, listingActive, "slug": slug
      }`,
      { license: `*${licenseNumber}*` },
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
      await sendListingRemovalLink(
        config,
        therapist,
        `${url.protocol}//${url.host}`.replace(/\/+$/, ""),
      );
    } catch (error) {
      // Log and still return generic success; an email-delivery
      // failure should not reveal that the listing exists.
      console.error("Failed to send listing removal link:", error);
    }

    return genericSuccess();
  }

  // GET /portal/listing-removal/confirm?token=... — the link the
  // therapist clicks from the confirmation email. Validates the
  // signed token, flips listingActive to false + stamps
  // listingRemovalRequestedAt, and redirects back to /remove with a
  // query param that drives the toast banner. No auth header needed —
  // the signed token is the auth.
  if (request.method === "GET" && routePath === "/portal/listing-removal/confirm") {
    const token = String((url.searchParams && url.searchParams.get("token")) || "").trim();
    const returnBase = `${url.protocol}//${url.host}`.replace(/\/+$/, "");

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
  if (request.method === "GET" && routePath === "/portal/completeness-summary") {
    if (!deps.isAuthorized || !deps.isAuthorized(request, config)) {
      sendJson(response, 401, { error: "Admin session required." }, origin, config);
      return true;
    }
    const rows = await client.fetch(
      `*[_type == "therapist" && claimStatus == "claimed"] | order(portalCompletenessScore asc) {
        "slug": slug.current,
        name,
        email,
        city,
        state,
        portalCompletenessScore,
        portalCompletionFields,
        portalLastSaveAt,
        portalCompletenessUpdatedAt,
        "hasEmail": defined(email) && email != ""
      }`,
    );
    sendJson(response, 200, { ok: true, therapists: rows || [] }, origin, config);
    return true;
  }

  // POST /portal/completeness-nudge — admin-only.
  // Body: { slugs: ["slug1", "slug2", ...] }
  // Sends a personalized profile-completion email to each slug.
  // Returns { sent, failed, results }.
  if (request.method === "POST" && routePath === "/portal/completeness-nudge") {
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

    let sent = 0;
    let failed = 0;
    const results = [];
    for (const t of therapists) {
      const toEmail = String(t.email || "")
        .trim()
        .toLowerCase();
      if (!toEmail) {
        results.push({ slug: t.slug, status: "skipped", reason: "no email on file" });
        continue;
      }
      try {
        await sendPortalCompletenessNudge(config, t, config.portalBaseUrl);
        sent += 1;
        results.push({ slug: t.slug, status: "sent", to: toEmail });
      } catch (err) {
        failed += 1;
        results.push({ slug: t.slug, status: "failed", reason: (err && err.message) || "unknown" });
      }
    }

    sendJson(response, 200, { ok: true, sent, failed, results }, origin, config);
    return true;
  }

  return false;
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

function normalizeLicenseForMatch(value) {
  return String(value || "")
    .replace(/[^a-z0-9]/gi, "")
    .replace(/^[a-z]+/i, "")
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
