import { buildEngagementPeriodKey } from "../shared/therapist-engagement-domain.mjs";
import { scrubIntakeStub } from "../shared/therapist-publishing-domain.mjs";

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

// Rate-limit window for claim-link requests: max 3 fresh links per
// slug per hour. Stored as an array of ISO timestamps on the therapist
// doc so limiting survives across Vercel serverless cold starts (which
// would reset any in-memory counter). Filter window, check count,
// append timestamp, persist — cheap patch alongside the claimStatus
// update we were already doing.
const CLAIM_LINK_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const CLAIM_LINK_MAX_PER_WINDOW = 3;
const CLAIM_LINK_HISTORY_CAP = 10;

function evaluateClaimLinkRateLimit(requestHistory) {
  const history = Array.isArray(requestHistory) ? requestHistory : [];
  const cutoff = Date.now() - CLAIM_LINK_WINDOW_MS;
  const recent = history.filter(function (iso) {
    const t = new Date(iso).getTime();
    return Number.isFinite(t) && t >= cutoff;
  });
  return {
    exceeded: recent.length >= CLAIM_LINK_MAX_PER_WINDOW,
    recentCount: recent.length,
    nextHistory: recent.concat(new Date().toISOString()).slice(-CLAIM_LINK_HISTORY_CAP),
  };
}

function maskEmail(email) {
  const trimmed = String(email || "").trim();
  if (!trimmed) {
    return "";
  }
  const at = trimmed.indexOf("@");
  if (at < 1) {
    return trimmed.slice(0, 1) + "***";
  }
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const domainHead = dot > 0 ? domain.slice(0, dot) : domain;
  const domainTail = dot > 0 ? domain.slice(dot) : "";
  const maskLocal = local.slice(0, 1) + "***";
  const maskDomain = (domainHead ? domainHead.slice(0, 1) + "***" : "***") + domainTail;
  return maskLocal + "@" + maskDomain;
}

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
  };
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
    phone: { max: 40 },
    website: { max: 500, url: true },
    bookingUrl: { max: 500, url: true, bodyKey: "booking_url" },
    preferredContactLabel: { max: 60, bodyKey: "preferred_contact_label" },
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
    const value = String(raw).trim();
    if (value.length > spec.max) {
      return { error: `${bodyKey} is too long.`, field: bodyKey };
    }
    if (spec.url && !/^https?:\/\//i.test(value)) {
      return { error: `${bodyKey} must start with http:// or https://.`, field: bodyKey };
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

export async function handleAuthAndPortalRoutes(context) {
  const { client, config, deps, origin, request, response, routePath, url } = context;

  const {
    buildPortalRequestDocument,
    canAttemptLogin,
    clearFailedLogins,
    createFeaturedCheckoutSession,
    createSignedSession,
    createTherapistSession,
    getAuthorizedTherapist,
    getSecurityWarnings,
    normalizePortalRequest,
    parseAuthorizationHeader,
    parseBody,
    readListingRemovalToken,
    readPortalClaimToken,
    readSignedSession,
    recordFailedLogin,
    sendJson,
    sendListingRemovalLink,
    sendPortalClaimLink,
    sendPortalWelcomeEmail,
    updatePortalRequestFields,
  } = deps;

  if (request.method === "POST" && routePath === "/auth/login") {
    if (!canAttemptLogin(request, config)) {
      sendJson(
        response,
        429,
        { error: "Too many login attempts. Try again later." },
        origin,
        config,
      );
      return true;
    }

    const body = await parseBody(request);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const usingUserPass = config.adminUsername && config.adminPassword;
    const usingLegacyKey = config.allowLegacyKey && config.adminKey;

    const valid =
      (usingUserPass && username === config.adminUsername && password === config.adminPassword) ||
      (usingLegacyKey && password === config.adminKey);

    if (!valid) {
      recordFailedLogin(request, config);
      sendJson(response, 401, { error: "Invalid admin credentials." }, origin, config);
      return true;
    }

    clearFailedLogins(request);
    const sessionToken = createSignedSession(config, {
      username: usingUserPass ? username || config.adminUsername : "legacy-admin-key",
    });
    const actorId = usingUserPass ? username || config.adminUsername : "legacy-admin-key";
    sendJson(
      response,
      200,
      {
        ok: true,
        sessionToken,
        actorId,
        actorName: actorId,
        authMode: usingUserPass ? "password" : "legacy-key",
      },
      origin,
      config,
    );
    return true;
  }

  if (request.method === "GET" && routePath === "/auth/session") {
    const session = readSignedSession(parseAuthorizationHeader(request), config);
    if (!session) {
      sendJson(response, 401, { authenticated: false }, origin, config);
      return true;
    }

    sendJson(
      response,
      200,
      {
        authenticated: true,
        expiresAt: session.exp,
        actorId: session.username || "admin",
        actorName: session.username || "admin",
      },
      origin,
      config,
    );
    return true;
  }

  if (request.method === "POST" && routePath === "/auth/logout") {
    sendJson(response, 200, { ok: true }, origin, config);
    return true;
  }

  if (request.method === "GET" && routePath === "/health") {
    sendJson(
      response,
      200,
      {
        ok: true,
        authMode: config.adminUsername && config.adminPassword ? "password" : "legacy-key",
        sessionTtlMs: config.sessionTtlMs,
        legacyKeyEnabled: config.allowLegacyKey && Boolean(config.adminKey),
        securityWarnings: getSecurityWarnings(config),
      },
      origin,
      config,
    );
    return true;
  }

  if (request.method === "GET" && routePath === "/portal/requests") {
    if (!deps.isAuthorized(request, config)) {
      sendJson(response, 401, { error: "Unauthorized." }, origin, config);
      return true;
    }

    // Join each portal request against the therapist's subscription so
    // the admin inbox can promote paid-tier requests to the top and
    // surface a visible priority badge. Paid therapists are promised
    // same-day edit review as part of their $19/mo; the ordering below
    // is how that promise is kept operationally.
    const docs = await client.fetch(
      `*[_type == "therapistPortalRequest"]{
        _id, _createdAt, therapistSlug, therapistName, requestType, requesterName,
        requesterEmail, licenseNumber, message, status, requestedAt, reviewedAt,
        "subscriptionPlan": *[_type == "therapistSubscription" && therapistSlug == ^.therapistSlug][0].plan,
        "subscriptionStatus": *[_type == "therapistSubscription" && therapistSlug == ^.therapistSlug][0].status
      } | order(
        select(
          status == "open" && subscriptionPlan == "featured" && subscriptionStatus in ["active", "trialing"] => 0,
          status == "open" => 1,
          2
        ) asc,
        coalesce(requestedAt, _createdAt) desc
      )`,
    );

    sendJson(response, 200, docs.map(normalizePortalRequest), origin, config);
    return true;
  }

  if (request.method === "POST" && routePath === "/portal/requests") {
    const body = await parseBody(request);
    const document = buildPortalRequestDocument(body);
    const created = await client.create(document);
    sendJson(response, 201, normalizePortalRequest(created), origin, config);
    return true;
  }

  // POST /portal/recovery-request — therapist-initiated account
  // recovery. When a claimed therapist has lost access to their
  // on-file email AND can't domain-verify, they file this and admin
  // reviews manually. Creates a therapistRecoveryRequest doc in
  // "pending" state and fires a notification to admin. Rate-limited
  // to 3 pending per license to prevent flooding.
  if (request.method === "POST" && routePath === "/portal/recovery-request") {
    const body = await parseBody(request);
    const fullName = String(body.full_name || "").trim();
    const licenseNumber = String(body.license_number || "").trim();
    const requestedEmail = String(body.requested_email || "")
      .trim()
      .toLowerCase();
    const priorEmail = String(body.prior_email || "")
      .trim()
      .toLowerCase();
    const reason = String(body.reason || "").trim();

    if (!fullName || !licenseNumber || !requestedEmail) {
      sendJson(
        response,
        400,
        { error: "Full name, license number, and recovery email are required." },
        origin,
        config,
      );
      return true;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(requestedEmail)) {
      sendJson(
        response,
        400,
        { error: "Recovery email does not look valid.", field: "requested_email" },
        origin,
        config,
      );
      return true;
    }
    if (fullName.length > 200 || requestedEmail.length > 200 || reason.length > 2000) {
      sendJson(response, 400, { error: "One of the fields is too long." }, origin, config);
      return true;
    }

    // Rate limit: max 3 pending requests for the same license.
    const normalizedLicense = normalizeLicenseForMatch(licenseNumber);
    const pending = await client.fetch(
      `count(*[_type == "therapistRecoveryRequest" && status == "pending" && licenseNumber match $license])`,
      { license: `*${normalizedLicense}*` },
    );
    if (Number(pending) >= 3) {
      sendJson(
        response,
        429,
        {
          error:
            "We already have an open recovery request for this license. Please wait for our team to review, or reply to the confirmation email you got earlier.",
          reason: "rate_limited",
        },
        origin,
        config,
      );
      return true;
    }

    // Look up the matching therapist for context (slug, profile name,
    // masked email). Not required — if no profile matches we still
    // accept the request so the admin can check a misremembered license.
    const therapist = await client.fetch(
      `*[_type == "therapist" && licenseNumber match $license][0]{
        _id, name, email, claimedByEmail, "slug": slug.current
      }`,
      { license: `*${normalizedLicense}*` },
    );

    const nowIso = new Date().toISOString();
    const requesterIp = (() => {
      const raw =
        (request.headers && (request.headers["x-forwarded-for"] || request.headers["x-real-ip"])) ||
        (request.socket && request.socket.remoteAddress) ||
        "";
      const first = String(raw).split(",")[0].trim();
      const parts = first.split(".");
      return parts.length === 4 ? parts.slice(0, 3).join(".") + ".x" : "";
    })();

    // The GROQ projection casts slug to a string, but the in-memory
    // test client doesn't honor projections and returns the raw doc.
    // Coerce defensively so both shapes produce a clean string.
    const resolvedSlug =
      (therapist && therapist.slug && therapist.slug.current) ||
      (therapist && typeof therapist.slug === "string" ? therapist.slug : "") ||
      "";

    const document = {
      _type: "therapistRecoveryRequest",
      fullName,
      licenseNumber,
      requestedEmail,
      priorEmail: priorEmail || "",
      reason,
      status: "pending",
      therapistSlug: resolvedSlug,
      therapistDocId: (therapist && therapist._id) || "",
      profileName: (therapist && therapist.name) || "",
      profileEmailHint: therapist ? maskEmail(therapist.email) : "",
      profileClaimedEmail: (therapist && therapist.claimedByEmail) || "",
      requesterIp,
      createdAt: nowIso,
    };
    const created = await client.create(document);

    // Fire-and-forget notifications — don't fail the request if the
    // email provider is down.
    try {
      await deps.notifyAdminOfRecoveryRequest(config, created);
    } catch (error) {
      console.error("Failed to notify admin of recovery request.", error);
    }
    try {
      await deps.notifyTherapistOfRecoveryReceived(config, created);
    } catch (error) {
      console.error("Failed to send recovery-received confirmation email.", error);
    }

    sendJson(
      response,
      201,
      {
        ok: true,
        id: created._id,
        status: "pending",
        message:
          "Recovery request received. Check your inbox for a confirmation, and we'll email a verified decision within one business day.",
      },
      origin,
      config,
    );
    return true;
  }

  // GET /recovery-requests — admin list. Pending first.
  if (request.method === "GET" && routePath === "/recovery-requests") {
    if (!deps.isAuthorized(request, config)) {
      sendJson(response, 401, { error: "Unauthorized." }, origin, config);
      return true;
    }
    const requests = await client.fetch(
      `*[_type == "therapistRecoveryRequest"] | order(
        select(status == "pending" => 0, status == "approved" => 1, 2),
        createdAt desc
      )[0...200]{
        _id, fullName, licenseNumber, requestedEmail, priorEmail, reason,
        status, therapistSlug, therapistDocId, profileName, profileEmailHint,
        profileClaimedEmail, adminNote, outcomeMessage,
        reviewedAt, reviewedBy, requesterIp, createdAt
      }`,
    );
    sendJson(response, 200, { ok: true, requests: requests || [] }, origin, config);
    return true;
  }

  // POST /recovery-requests/:id/approve — admin approves, server
  // generates a magic link to the requestedEmail, updates
  // claimedByEmail on the therapist doc, and emails the therapist.
  const recoveryApproveMatch = routePath.match(/^\/recovery-requests\/([^/]+)\/approve$/);
  if (request.method === "POST" && recoveryApproveMatch) {
    if (!deps.isAuthorized(request, config)) {
      sendJson(response, 401, { error: "Unauthorized." }, origin, config);
      return true;
    }
    const requestId = decodeURIComponent(recoveryApproveMatch[1]);
    const body = await parseBody(request);
    const customMessage = String(body.outcome_message || "").trim();
    const adminNote = String(body.admin_note || "").trim();

    const recovery = await client.getDocument(requestId);
    if (!recovery || recovery._type !== "therapistRecoveryRequest") {
      sendJson(response, 404, { error: "Recovery request not found." }, origin, config);
      return true;
    }
    if (recovery.status !== "pending") {
      sendJson(response, 409, { error: "This request has already been resolved." }, origin, config);
      return true;
    }
    if (!recovery.therapistDocId || !recovery.therapistSlug) {
      sendJson(
        response,
        400,
        {
          error:
            "This request was not linked to a matching therapist profile. Reject with a note instead.",
        },
        origin,
        config,
      );
      return true;
    }

    // Build a magic-link token tied to the therapist + the requested
    // email. The portal's claim-accept handler treats an already-
    // claimed profile as idempotent re-entry, so this token seamlessly
    // signs the therapist in.
    const therapist = await client.fetch(
      `*[_type == "therapist" && _id == $id][0]{ _id, name, claimStatus, "slug": slug }`,
      { id: recovery.therapistDocId },
    );
    if (!therapist) {
      sendJson(
        response,
        404,
        { error: "Target therapist profile no longer exists. Reject with a note." },
        origin,
        config,
      );
      return true;
    }

    const nowIso = new Date().toISOString();

    // Update the therapist doc: promote claimedByEmail to the new
    // address and mark claimed (if it wasn't already). This is the
    // actual recovery — the therapist can now sign in with the new
    // email both via this magic link AND via /claim going forward.
    await client
      .patch(therapist._id)
      .set({
        claimStatus: "claimed",
        claimedByEmail: recovery.requestedEmail,
        claimedAt: therapist.claimStatus === "claimed" ? undefined : nowIso,
      })
      .commit({ visibility: "sync" });

    // Build and send the magic link. deps.sendPortalClaimLink expects
    // a therapist with slug.current. Build the shape it wants.
    const therapistForLink =
      typeof therapist.slug === "string"
        ? { ...therapist, slug: { current: therapist.slug } }
        : therapist;

    const portalBaseUrl = `${url.protocol}//${url.host}`.replace(/\/+$/, "");
    const magicLink = deps.buildRecoveryMagicLink(
      config,
      therapistForLink,
      recovery.requestedEmail,
      portalBaseUrl,
    );

    try {
      await deps.sendRecoveryApprovedEmail(config, recovery, magicLink, customMessage);
    } catch (error) {
      sendJson(
        response,
        502,
        { error: "Approval saved on therapist, but email delivery failed: " + error.message },
        origin,
        config,
      );
      return true;
    }

    const reviewer = deps.getAuthorizedActor(request, config);
    const updated = await client
      .patch(recovery._id)
      .set({
        status: "approved",
        reviewedAt: nowIso,
        reviewedBy: (reviewer && (reviewer.name || reviewer.id)) || "admin",
        outcomeMessage: customMessage,
        adminNote: adminNote || recovery.adminNote || "",
      })
      .commit({ visibility: "sync" });

    sendJson(response, 200, { ok: true, request: updated }, origin, config);
    return true;
  }

  // POST /recovery-requests/:id/reject — admin rejects, therapist
  // gets an explanation email.
  const recoveryRejectMatch = routePath.match(/^\/recovery-requests\/([^/]+)\/reject$/);
  if (request.method === "POST" && recoveryRejectMatch) {
    if (!deps.isAuthorized(request, config)) {
      sendJson(response, 401, { error: "Unauthorized." }, origin, config);
      return true;
    }
    const requestId = decodeURIComponent(recoveryRejectMatch[1]);
    const body = await parseBody(request);
    const outcomeMessage = String(body.outcome_message || "").trim();
    const adminNote = String(body.admin_note || "").trim();

    const recovery = await client.getDocument(requestId);
    if (!recovery || recovery._type !== "therapistRecoveryRequest") {
      sendJson(response, 404, { error: "Recovery request not found." }, origin, config);
      return true;
    }
    if (recovery.status !== "pending") {
      sendJson(response, 409, { error: "This request has already been resolved." }, origin, config);
      return true;
    }

    try {
      await deps.sendRecoveryRejectedEmail(config, recovery, outcomeMessage);
    } catch (error) {
      console.error("Failed to send rejection email.", error);
    }

    const reviewer = deps.getAuthorizedActor(request, config);
    const updated = await client
      .patch(recovery._id)
      .set({
        status: "rejected",
        reviewedAt: new Date().toISOString(),
        reviewedBy: (reviewer && (reviewer.name || reviewer.id)) || "admin",
        outcomeMessage,
        adminNote: adminNote || recovery.adminNote || "",
      })
      .commit({ visibility: "sync" });

    sendJson(response, 200, { ok: true, request: updated }, origin, config);
    return true;
  }

  const portalRequestUpdateMatch = routePath.match(/^\/portal\/requests\/([^/]+)$/);
  if ((request.method === "PATCH" || request.method === "POST") && portalRequestUpdateMatch) {
    if (!deps.isAuthorized(request, config)) {
      sendJson(response, 401, { error: "Unauthorized." }, origin, config);
      return true;
    }

    const requestId = decodeURIComponent(portalRequestUpdateMatch[1]);
    const existing = await client.getDocument(requestId);
    if (!existing || existing._type !== "therapistPortalRequest") {
      sendJson(response, 404, { error: "Portal request not found." }, origin, config);
      return true;
    }

    const body = await parseBody(request);
    const updated = await updatePortalRequestFields(client, requestId, body);
    sendJson(response, 200, normalizePortalRequest(updated), origin, config);
    return true;
  }

  // GET /portal/quick-claim/lookup?slug=X — single-result lookup used
  // for deep-link flows (e.g. /claim?slug=X from the /signup search
  // results). Returns the same shape as /portal/quick-claim/search so
  // the client can call applyPickedResult directly without a second
  // query.
  if (request.method === "GET" && routePath === "/portal/quick-claim/lookup") {
    const lookupSlug = String((url && url.searchParams.get("slug")) || "").trim();
    if (!lookupSlug) {
      sendJson(response, 400, { error: "slug is required" }, origin, config);
      return true;
    }
    const doc = await client.fetch(
      `*[_type == "therapist" && slug.current == $slug][0]{
        _id, name, email, city, state, credentials, licenseNumber, claimStatus,
        "slug": slug.current, licensureVerification
      }`,
      { slug: lookupSlug },
    );
    if (!doc) {
      sendJson(response, 404, { error: "not_found", reason: "not_found" }, origin, config);
      return true;
    }
    const verification =
      (doc.licensureVerification && typeof doc.licensureVerification === "object") || false;
    const statusStanding = verification
      ? String(doc.licensureVerification.statusStanding || "")
      : "";
    sendJson(
      response,
      200,
      {
        result: {
          slug: doc.slug,
          name: doc.name || "",
          city: doc.city || "",
          state: doc.state || "",
          credentials: doc.credentials || "",
          license_number: doc.licenseNumber || "",
          email_hint: maskEmail(doc.email),
          has_email: Boolean(doc.email),
          claim_status: doc.claimStatus || "unclaimed",
          license_verified_current: statusStanding === "current",
          license_verified_at: verification ? doc.licensureVerification.verifiedAt || "" : "",
        },
      },
      origin,
      config,
    );
    return true;
  }

  if (request.method === "GET" && routePath === "/portal/quick-claim/search") {
    const query = String((url && url.searchParams.get("q")) || "").trim();
    if (query.length < 2) {
      sendJson(response, 200, { results: [] }, origin, config);
      return true;
    }

    // licenseOnly=1 is used by the /signup duplicate-detection nudge: we
    // only want license hits there, because fuzzy name matching on a
    // license string (e.g. "A179040") picks up anyone with an "A" name.
    const licenseOnly = String((url && url.searchParams.get("licenseOnly")) || "") === "1";

    const normalizedLicense = normalizeLicenseForMatch(query);
    const normalizedName = licenseOnly ? "" : normalizeNameForMatch(query);
    const nameMatcher = normalizedName ? `*${normalizedName.split(" ").join("*")}*` : "";
    // Glob pattern lets "179040" match stored values like "A179040" or
    // "PSY 179040" — GROQ match on a plain string requires token equality,
    // which fails on any credential-prefixed stored license.
    const licenseGlob = normalizedLicense ? `*${normalizedLicense}*` : "";

    const docs = await client.fetch(
      `*[_type == "therapist" && listingActive == true && defined(slug.current) && (
        ($licenseGlob != "" && licenseNumber match $licenseGlob) ||
        ($nameMatcher != "" && name match $nameMatcher)
      )] | order(name asc) [0...8]{
        _id, name, email, city, state, credentials, licenseNumber, claimStatus,
        "slug": slug.current, licensureVerification
      }`,
      { licenseGlob: licenseGlob || "__none__", nameMatcher: nameMatcher || "__none__" },
    );

    const results = (docs || []).map(function (doc) {
      const verification =
        doc.licensureVerification && typeof doc.licensureVerification === "object"
          ? doc.licensureVerification
          : null;
      const statusStanding = verification ? String(verification.statusStanding || "") : "";
      return {
        slug: doc.slug,
        name: doc.name || "",
        city: doc.city || "",
        state: doc.state || "",
        credentials: doc.credentials || "",
        license_number: doc.licenseNumber || "",
        email_hint: maskEmail(doc.email),
        has_email: Boolean(doc.email),
        claim_status: doc.claimStatus || "unclaimed",
        license_verified_current: statusStanding === "current",
        license_verified_at: (verification && verification.verifiedAt) || "",
      };
    });

    sendJson(response, 200, { results }, origin, config);
    return true;
  }

  if (request.method === "POST" && routePath === "/portal/claim-by-slug") {
    const body = await parseBody(request);
    const slug = String(body.slug || "").trim();

    if (!slug) {
      sendJson(response, 400, { error: "Slug is required." }, origin, config);
      return true;
    }

    const therapist = await client.fetch(
      `*[_type == "therapist" && slug.current == $slug][0]{
        _id, name, email, claimStatus, claimedByEmail, claimLinkRequests, "slug": slug
      }`,
      { slug },
    );

    const resolvedSlug =
      (therapist && therapist.slug && therapist.slug.current) ||
      (therapist && typeof therapist.slug === "string" ? therapist.slug : "");

    if (!therapist || !resolvedSlug) {
      sendJson(
        response,
        404,
        {
          error: "We couldn't find that profile. Try searching again.",
          reason: "not_found",
        },
        origin,
        config,
      );
      return true;
    }

    // When a profile is already claimed, prefer sending the sign-in
    // link to the email address that originally claimed it — not the
    // public contact email, which may differ (a therapist can claim
    // with a work inbox while listing a front-desk address publicly).
    // Falling back to the public email keeps unclaimed profiles
    // working as before.
    const publicEmail = String(therapist.email || "")
      .trim()
      .toLowerCase();
    const claimedEmail = String(therapist.claimedByEmail || "")
      .trim()
      .toLowerCase();
    const onFileEmail =
      therapist.claimStatus === "claimed" && claimedEmail ? claimedEmail : publicEmail;

    if (!onFileEmail) {
      sendJson(
        response,
        409,
        {
          error:
            "No email is on file for this profile. Use the form below to verify ownership another way.",
          reason: "no_email_on_file",
        },
        origin,
        config,
      );
      return true;
    }

    // Rate limit: max 3 claim-link emails per slug per hour.
    const rate = evaluateClaimLinkRateLimit(therapist.claimLinkRequests);
    if (rate.exceeded) {
      sendJson(
        response,
        429,
        {
          error:
            "Too many claim link requests for this listing. Try again in an hour or contact support.",
          reason: "rate_limited",
        },
        origin,
        config,
      );
      return true;
    }

    const therapistForEmail = {
      ...therapist,
      slug: { current: resolvedSlug },
    };

    await sendPortalClaimLink(
      config,
      therapistForEmail,
      onFileEmail,
      `${url.protocol}//${url.host}`.replace(/\/+$/, ""),
    );

    const claimStatusUpdate = therapist.claimStatus === "claimed" ? "claimed" : "claim_requested";
    await client
      .patch(therapist._id)
      .set({ claimStatus: claimStatusUpdate, claimLinkRequests: rate.nextHistory })
      .commit({ visibility: "sync" });

    sendJson(
      response,
      200,
      {
        ok: true,
        message: "Claim link sent. Check your inbox.",
        therapist_slug: resolvedSlug,
        email_hint: maskEmail(onFileEmail),
        verification_method: "email_on_file",
      },
      origin,
      config,
    );
    return true;
  }

  // POST /portal/claim-trial — one-click trial path.
  // Starts a Stripe Checkout session AND fires the ownership verification
  // link in parallel, so the user pays first (2 clicks) and activates their
  // profile whenever they check email. Falls back to /portal/claim-by-slug
  // semantics for no-email-on-file (errors out) and not-found.
  if (request.method === "POST" && routePath === "/portal/claim-trial") {
    const body = await parseBody(request);
    const slug = String((body && body.slug) || "").trim();
    const overrideEmail = String((body && body.override_email) || "")
      .trim()
      .toLowerCase();

    if (!slug) {
      sendJson(response, 400, { error: "Slug is required." }, origin, config);
      return true;
    }

    if (typeof createFeaturedCheckoutSession !== "function") {
      sendJson(
        response,
        503,
        { error: "Checkout is not configured on this server." },
        origin,
        config,
      );
      return true;
    }

    const therapist = await client.fetch(
      `*[_type == "therapist" && slug.current == $slug][0]{
        _id, name, email, claimStatus, claimLinkRequests, "slug": slug
      }`,
      { slug },
    );

    const resolvedSlug =
      (therapist && therapist.slug && therapist.slug.current) ||
      (therapist && typeof therapist.slug === "string" ? therapist.slug : "");

    if (!therapist || !resolvedSlug) {
      sendJson(
        response,
        404,
        {
          error: "We couldn't find that profile. Try searching again.",
          reason: "not_found",
        },
        origin,
        config,
      );
      return true;
    }

    const onFileEmail = String(therapist.email || "")
      .trim()
      .toLowerCase();

    // Use override_email only when no on-file email exists. Never let the
    // client choose where verification goes when we already have a
    // trusted address — otherwise an imposter could verify themselves.
    const verificationEmail = onFileEmail || overrideEmail;

    if (!verificationEmail) {
      sendJson(
        response,
        409,
        {
          error:
            "No email is on file for this profile. Provide an email at checkout so we can send the activation link.",
          reason: "no_email_on_file",
        },
        origin,
        config,
      );
      return true;
    }

    // Rate limit: max 3 claim-link emails per slug per hour. Shared
    // counter with /portal/claim-by-slug so trials + free claims
    // together can't spam a therapist's inbox.
    const rate = evaluateClaimLinkRateLimit(therapist.claimLinkRequests);
    if (rate.exceeded) {
      sendJson(
        response,
        429,
        {
          error:
            "Too many claim link requests for this listing. Try again in an hour or contact support.",
          reason: "rate_limited",
        },
        origin,
        config,
      );
      return true;
    }

    const therapistForEmail = {
      ...therapist,
      slug: { current: resolvedSlug },
    };

    const portalBaseUrl = `${url.protocol}//${url.host}`.replace(/\/+$/, "");

    // Fire verification link first — if email send fails, fail the whole
    // request so the user doesn't end up paying without a way to activate.
    try {
      await sendPortalClaimLink(config, therapistForEmail, verificationEmail, portalBaseUrl);
    } catch (error) {
      sendJson(
        response,
        500,
        {
          error:
            (error && error.message) ||
            "We couldn't send the activation link. Try again in a moment.",
          reason: "email_send_failed",
        },
        origin,
        config,
      );
      return true;
    }

    // Create Stripe Checkout session. Pre-fill customer_email so the
    // therapist doesn't retype it. return_path brings them back to the
    // portal with ?stripe=success and the success banner fires.
    let checkoutSession;
    try {
      checkoutSession = await createFeaturedCheckoutSession(config, {
        therapistSlug: resolvedSlug,
        customerEmail: verificationEmail,
        plan: "paid_monthly",
        returnPath: `/portal.html?slug=${encodeURIComponent(resolvedSlug)}`,
      });
    } catch (error) {
      sendJson(
        response,
        500,
        {
          error: (error && error.message) || "We couldn't open checkout. Try again in a moment.",
          reason: "checkout_failed",
        },
        origin,
        config,
      );
      return true;
    }

    // Mark the claim as requested so admin views reflect the trial-start
    // intent even before verification lands. Append rate-limit history
    // here too so /portal/claim-trial counts toward the per-slug window.
    const claimStatusUpdate = therapist.claimStatus === "claimed" ? "claimed" : "claim_requested";
    try {
      await client
        .patch(therapist._id)
        .set({ claimStatus: claimStatusUpdate, claimLinkRequests: rate.nextHistory })
        .commit({ visibility: "sync" });
    } catch (_error) {
      // Non-fatal: claim status is derived admin state, checkout already created
    }

    sendJson(
      response,
      200,
      {
        ok: true,
        therapist_slug: resolvedSlug,
        email_hint: maskEmail(verificationEmail),
        stripe_url: checkoutSession.url,
        stripe_session_id: checkoutSession.id,
      },
      origin,
      config,
    );
    return true;
  }

  if (request.method === "POST" && routePath === "/portal/quick-claim") {
    const body = await parseBody(request);
    const rawFullName = String(body.full_name || "").trim();
    const rawEmail = String(body.email || "").trim();
    const rawLicense = String(body.license_number || "").trim();

    const fullName = normalizeNameForMatch(rawFullName);
    const requesterEmail = rawEmail.toLowerCase();
    const licenseNumber = normalizeLicenseForMatch(rawLicense);

    if (!fullName || !requesterEmail || !licenseNumber) {
      sendJson(
        response,
        400,
        { error: "Full name, email, and CA license number are all required." },
        origin,
        config,
      );
      return true;
    }

    const therapist = await client.fetch(
      `*[_type == "therapist" && licenseNumber match $license][0]{
        _id, name, email, website, claimStatus, "slug": slug
      }`,
      { license: `*${licenseNumber}*` },
    );

    if (!therapist || !therapist.slug || !therapist.slug.current) {
      sendJson(
        response,
        404,
        {
          error:
            "We do not see a profile for that license in our directory yet. Create a new listing below.",
          reason: "not_found",
        },
        origin,
        config,
      );
      return true;
    }

    const profileName = normalizeNameForMatch(therapist.name);
    if (!profileName || profileName !== fullName) {
      sendJson(
        response,
        403,
        {
          error:
            "The name you entered doesn't match the profile for that license. Double-check spelling, or use the search above to find your listing.",
          reason: "name_mismatch",
          name_hint: therapist.name
            ? therapist.name.charAt(0) + "***" + therapist.name.slice(-1)
            : "",
        },
        origin,
        config,
      );
      return true;
    }

    const profileEmail = String(therapist.email || "")
      .trim()
      .toLowerCase();
    const emailMatches = profileEmail && profileEmail === requesterEmail;
    const domainVerified =
      !emailMatches && emailDomainMatchesWebsite(requesterEmail, therapist.website);

    if (!emailMatches && !domainVerified) {
      sendJson(
        response,
        403,
        {
          error:
            "That email doesn't match the contact email on your profile. Use the email on file, or contact us if you no longer have access to it.",
          reason: "email_mismatch",
          email_hint: maskEmail(therapist.email),
        },
        origin,
        config,
      );
      return true;
    }

    await sendPortalClaimLink(
      config,
      therapist,
      requesterEmail,
      `${url.protocol}//${url.host}`.replace(/\/+$/, ""),
    );

    const claimStatusUpdate = therapist.claimStatus === "claimed" ? "claimed" : "claim_requested";
    const patchBuilder = client.patch(therapist._id).set({ claimStatus: claimStatusUpdate });
    if (domainVerified) {
      patchBuilder.set({
        lastClaimVerificationMethod: "email_domain_match",
        lastClaimVerificationAt: new Date().toISOString(),
      });
    }
    await patchBuilder.commit({ visibility: "sync" });

    sendJson(
      response,
      200,
      {
        ok: true,
        message: domainVerified
          ? "Claim link sent. We verified ownership via your practice website domain."
          : "Claim link sent. Check your inbox.",
        therapist_slug: therapist.slug.current,
        verification_method: domainVerified ? "email_domain_match" : "email_on_file",
      },
      origin,
      config,
    );
    return true;
  }

  // POST /portal/sign-in — email-only sign-in for returning therapists.
  // Looks up a CLAIMED therapist by claimedByEmail (case-insensitive),
  // sends a magic link to that address. Always returns the same generic
  // success response to prevent email enumeration. Per-therapist rate
  // limit piggybacks on claimLinkRequests (3/hour) — same bucket used
  // by /portal/claim-link so a determined attacker can't multiply the
  // budget by spreading across endpoints.
  if (request.method === "POST" && routePath === "/portal/sign-in") {
    const body = await parseBody(request);
    const requesterEmail = String(body.email || "")
      .trim()
      .toLowerCase();

    const GENERIC_SUCCESS = {
      ok: true,
      message:
        "If that email matches a claimed profile, we just sent a sign-in link. The link expires in 15 minutes.",
    };

    if (!requesterEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(requesterEmail)) {
      sendJson(response, 400, { error: "Enter a valid email." }, origin, config);
      return true;
    }

    const therapist = await client.fetch(
      `*[_type == "therapist" && claimStatus == "claimed" && lower(claimedByEmail) == $email][0]{
        _id, name, email, claimStatus, claimedByEmail, claimLinkRequests, "slug": slug
      }`,
      { email: requesterEmail },
    );

    const resolvedSlug =
      (therapist && therapist.slug && therapist.slug.current) ||
      (therapist && typeof therapist.slug === "string" ? therapist.slug : "");

    if (!therapist || !resolvedSlug) {
      // Silently succeed to prevent enumeration.
      sendJson(response, 200, GENERIC_SUCCESS, origin, config);
      return true;
    }

    const rate = evaluateClaimLinkRateLimit(therapist.claimLinkRequests);
    if (rate.exceeded) {
      // Silently succeed — don't leak the rate-limit signal since the
      // generic response promises a link only "if the email matched".
      sendJson(response, 200, GENERIC_SUCCESS, origin, config);
      return true;
    }

    const therapistForEmail = {
      ...therapist,
      slug: { current: resolvedSlug },
    };

    await sendPortalClaimLink(
      config,
      therapistForEmail,
      requesterEmail,
      `${url.protocol}//${url.host}`.replace(/\/+$/, ""),
    );

    await client
      .patch(therapist._id)
      .set({ claimLinkRequests: rate.nextHistory })
      .commit({ visibility: "sync" });

    sendJson(response, 200, GENERIC_SUCCESS, origin, config);
    return true;
  }

  if (request.method === "POST" && routePath === "/portal/claim-link") {
    const body = await parseBody(request);
    const therapistSlug = String(body.therapist_slug || "").trim();
    const requesterEmail = String(body.requester_email || "")
      .trim()
      .toLowerCase();

    if (!therapistSlug || !requesterEmail) {
      sendJson(response, 400, { error: "Missing therapist slug or email." }, origin, config);
      return true;
    }

    const therapist = await client.fetch(
      `*[_type == "therapist" && slug.current == $slug][0]{
        _id, name, email, claimStatus, claimedByEmail, "slug": slug
      }`,
      { slug: therapistSlug },
    );

    if (!therapist || !therapist.slug || !therapist.slug.current) {
      sendJson(response, 404, { error: "Therapist profile not found." }, origin, config);
      return true;
    }

    // Accept either the public profile email OR the address the profile
    // was originally claimed with. The second case matters when a
    // therapist claims with a work email that's different from their
    // public contact email, or when they update their public email
    // later — without this, a legitimate owner can't get a fresh
    // sign-in link.
    const profileEmail = String(therapist.email || "")
      .trim()
      .toLowerCase();
    const claimedEmail = String(therapist.claimedByEmail || "")
      .trim()
      .toLowerCase();
    const matchesProfile = profileEmail && profileEmail === requesterEmail;
    const matchesClaimed = claimedEmail && claimedEmail === requesterEmail;
    if (!matchesProfile && !matchesClaimed) {
      sendJson(
        response,
        403,
        {
          error:
            "That email doesn't match the public contact email or the address this profile was claimed with. Use the request form below so we can verify ownership manually.",
        },
        origin,
        config,
      );
      return true;
    }

    await sendPortalClaimLink(
      config,
      therapist,
      requesterEmail,
      `${url.protocol}//${url.host}`.replace(/\/+$/, ""),
    );

    await client
      .patch(therapist._id)
      .set({
        claimStatus: therapist.claimStatus === "claimed" ? "claimed" : "claim_requested",
      })
      .commit({ visibility: "sync" });

    sendJson(
      response,
      200,
      { ok: true, message: "Claim link sent if the profile email matched." },
      origin,
      config,
    );
    return true;
  }

  if (request.method === "GET" && routePath === "/portal/claim-session") {
    const token = String(url.searchParams.get("token") || "").trim();
    const payload = readPortalClaimToken(config, token);
    if (!payload) {
      sendJson(response, 401, { error: "Claim link is invalid or expired." }, origin, config);
      return true;
    }

    // Full projection mirrors /portal/me so magic-link arrivals hydrate
    // the edit form with bio, chip pickers, therapist_reported_fields,
    // etc. — everything the portal UI needs to render. Previously this
    // returned a slim object and the edit card rendered empty, which
    // also suppressed the review banner (no pre-filled data detected).
    const therapist = await client.fetch(
      `*[_type == "therapist" && slug.current == $slug][0]{
        _id, name, email, city, state, zip, practiceName, status, listingActive,
        claimStatus, claimedByEmail, claimedAt,
        portalLastSeenAt, listingPauseRequestedAt, listingRemovalRequestedAt,
        "slug": slug.current,
        bio, credentials, title, phone, website, bookingUrl,
        preferredContactMethod, preferredContactLabel, contactGuidance, firstStepExpectation,
        acceptingNewPatients, acceptsTelehealth, acceptsInPerson,
        sessionFeeMin, sessionFeeMax, slidingScale,
        specialties, insuranceAccepted, telehealthStates, treatmentModalities, languages, clientPopulations,
        careApproach, estimatedWaitTime, yearsExperience, bipolarYearsExperience,
        medicationManagement, therapistReportedFields, portalFirstSaveAt, portalLastSaveAt, portalSaveCount
      }`,
      { slug: payload.slug },
    );

    if (!therapist) {
      sendJson(response, 404, { error: "Therapist profile not found." }, origin, config);
      return true;
    }

    sendJson(
      response,
      200,
      { ok: true, therapist: shapePortalTherapist(therapist) },
      origin,
      config,
    );
    return true;
  }

  if (request.method === "POST" && routePath === "/portal/claim-accept") {
    const body = await parseBody(request);
    const token = String(body.token || "").trim();
    const payload = readPortalClaimToken(config, token);
    if (!payload) {
      sendJson(response, 401, { error: "Claim link is invalid or expired." }, origin, config);
      return true;
    }

    const therapist = await client.fetch(
      `*[_type == "therapist" && slug.current == $slug][0]{
        _id, name, "slug": slug.current, usedClaimTokenNonces,
        claimStatus, claimedByEmail
      }`,
      { slug: payload.slug },
    );
    if (!therapist) {
      sendJson(response, 404, { error: "Therapist profile not found." }, origin, config);
      return true;
    }

    // One-time-use: if this token's nonce has already been consumed,
    // reject — EXCEPT when the doc is already claimed by the same email
    // this token represents. That case is a legitimate re-entry (user
    // refreshed the page, went back, or clicked the link twice). Issuing
    // a fresh session is safe because (a) the token is still signed + not
    // expired, and (b) the claim is already complete — there's no new
    // state change to guard against replay of. Prevents the classic
    // "This claim link has already been used" dead-end where a user
    // can't get back into their own portal.
    const usedNonces = Array.isArray(therapist.usedClaimTokenNonces)
      ? therapist.usedClaimTokenNonces
      : [];
    const nonceAlreadyUsed = Boolean(payload.nonce && usedNonces.indexOf(payload.nonce) !== -1);
    const alreadyClaimedBySameEmail =
      therapist.claimStatus === "claimed" &&
      String(therapist.claimedByEmail || "")
        .trim()
        .toLowerCase() ===
        String(payload.email || "")
          .trim()
          .toLowerCase();
    if (nonceAlreadyUsed && !alreadyClaimedBySameEmail) {
      sendJson(
        response,
        401,
        {
          error: "This claim link has already been used. Request a fresh one from the claim page.",
          reason: "token_already_used",
        },
        origin,
        config,
      );
      return true;
    }

    const now = new Date().toISOString();
    // Append used nonce, trim to last 20 (plenty of headroom given
    // 24h TTL + rate limit of 3 fresh tokens per hour).
    const nextUsedNonces = payload.nonce ? usedNonces.concat(payload.nonce).slice(-20) : usedNonces;

    await client
      .patch(therapist._id)
      .set({
        claimStatus: "claimed",
        claimedByEmail: payload.email,
        claimedAt: now,
        portalLastSeenAt: now,
        usedClaimTokenNonces: nextUsedNonces,
      })
      .commit({ visibility: "sync" });

    // Welcome email fires only on the unclaimed → claimed transition.
    // Skips when the doc was already claimed pre-patch (e.g. a second
    // magic link clicked after the therapist was already onboarded).
    const wasUnclaimedBeforePatch = therapist.claimStatus !== "claimed";
    if (wasUnclaimedBeforePatch) {
      try {
        await sendPortalWelcomeEmail(
          config,
          therapist,
          payload.email,
          `${url.protocol}//${url.host}`.replace(/\/+$/, ""),
        );
      } catch (error) {
        console.error("Failed to send portal welcome email.", error);
      }
    }

    const therapistSessionToken = createTherapistSession(config, {
      slug: therapist.slug,
      email: payload.email,
    });

    sendJson(
      response,
      200,
      {
        ok: true,
        therapist_slug: therapist.slug,
        claimed_by_email: payload.email,
        therapist_session_token: therapistSessionToken,
      },
      origin,
      config,
    );
    return true;
  }

  if (request.method === "GET" && routePath === "/portal/me") {
    const session = getAuthorizedTherapist(request, config);
    if (!session) {
      sendJson(response, 401, { error: "Not signed in." }, origin, config);
      return true;
    }

    const therapist = await client.fetch(
      `*[_type == "therapist" && slug.current == $slug][0]{
        _id, name, email, city, state, zip, practiceName, status, listingActive,
        claimStatus, claimedByEmail, claimedAt,
        portalLastSeenAt, listingPauseRequestedAt, listingRemovalRequestedAt,
        "slug": slug.current,
        bio, credentials, title, phone, website, bookingUrl,
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
        portalFirstSaveAt, portalSaveCount
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

    let patch = client.patch(existing._id);
    if (Object.keys(validation.setFields).length) {
      patch = patch.set(validation.setFields);
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
        claimStatus, claimedByEmail, claimedAt,
        portalLastSeenAt, listingPauseRequestedAt, listingRemovalRequestedAt,
        "slug": slug.current,
        bio, credentials, title, phone, website, bookingUrl,
        preferredContactMethod, preferredContactLabel, contactGuidance, firstStepExpectation,
        acceptingNewPatients, acceptsTelehealth, acceptsInPerson,
        sessionFeeMin, sessionFeeMax, slidingScale,
        specialties, insuranceAccepted, telehealthStates, treatmentModalities, languages, clientPopulations,
        careApproach, estimatedWaitTime, yearsExperience, bipolarYearsExperience,
        medicationManagement, therapistReportedFields, portalFirstSaveAt, portalLastSaveAt, portalSaveCount
      }`,
      { slug: session.slug },
    );

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
  // listingRemovalRequestedAt, and redirects back to /signup with a
  // query param that drives the toast banner. No auth header needed —
  // the signed token is the auth.
  if (request.method === "GET" && routePath === "/portal/listing-removal/confirm") {
    const token = String((url.searchParams && url.searchParams.get("token")) || "").trim();
    const returnBase = `${url.protocol}//${url.host}`.replace(/\/+$/, "");

    function redirect(status) {
      response.statusCode = 302;
      response.setHeader("Location", `${returnBase}/claim?removed=${status}`);
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

    return redirect("ok");
  }

  return false;
}
