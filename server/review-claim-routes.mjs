import { log } from "./logger.mjs";
import { normalizeLicenseForMatch } from "../shared/therapist-domain.mjs";
import { readLicenseStateParam } from "./license-states.mjs";
import {
  THERAPIST_SESSION_COOKIE,
  getClientAddress,
  makeSessionHelpers,
} from "./review-http-auth.mjs";
import { verifyTurnstileToken } from "./turnstile-verify.mjs";

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

// Reserve a claim-link rate-limit slot BEFORE sending the email. The
// history write is gated on the document revision we read, so two
// concurrent requests for the same listing can't both pass the cap and
// both send (the naive check-then-send-then-write pattern let racing
// requests exceed 3/hour). On a revision conflict the loop re-reads and
// re-evaluates; if the cap is hit (or the write keeps conflicting), the
// slot is refused — fail closed, the caller treats it as rate-limited.
// buildExtraSet(doc) lets the caller bundle fields (e.g. claimStatus)
// into the same patch.
async function reserveClaimLinkSlot(client, therapistId, buildExtraSet) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const doc = await client.getDocument(therapistId);
    if (!doc) {
      return { ok: false };
    }
    const rate = evaluateClaimLinkRateLimit(doc.claimLinkRequests);
    if (rate.exceeded) {
      return { ok: false };
    }
    const extra = typeof buildExtraSet === "function" ? buildExtraSet(doc) : {};
    try {
      await client
        .patch(therapistId)
        .ifRevisionId(doc._rev || "")
        .set({ claimLinkRequests: rate.nextHistory, ...extra })
        .commit({ visibility: "sync" });
      return { ok: true };
    } catch (_error) {
      // Revision conflict — another request landed between our read and
      // write. Loop to re-read and re-evaluate.
    }
  }
  return { ok: false };
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

import { shapePortalTherapist } from "../shared/therapist-publishing-domain.mjs";

export async function handleClaimRoutes(context) {
  const route = CLAIM_ROUTES.find(
    (r) => r.method === context.request.method && r.path === context.routePath,
  );
  return route ? route.handler(context) : false;
}

const CLAIM_ROUTES = [
  { method: "GET", path: "/portal/quick-claim/lookup", handler: claimGetPortalQuickClaimLookup },
  {
    method: "GET",
    path: "/portal/quick-claim/lookup-by-email",
    handler: claimGetPortalQuickClaimLookupByEmail,
  },
  { method: "GET", path: "/portal/quick-claim/search", handler: claimGetPortalQuickClaimSearch },
  { method: "POST", path: "/portal/claim-by-slug", handler: claimPostPortalClaimBySlug },
  { method: "POST", path: "/portal/quick-claim", handler: claimPostPortalQuickClaim },
  { method: "POST", path: "/portal/sign-in", handler: claimPostPortalSignIn },
  { method: "POST", path: "/portal/claim-link", handler: claimPostPortalClaimLink },
  { method: "POST", path: "/portal/claim-session", handler: claimPostPortalClaimSession },
  { method: "POST", path: "/portal/claim-accept", handler: claimPostPortalClaimAccept },
  { method: "POST", path: "/portal/logout", handler: claimPostPortalLogout },
];

// GET /portal/quick-claim/lookup?slug=X — single-result lookup used
// for deep-link flows (e.g. /claim?slug=X from the /signup search
// results). Returns the same shape as /portal/quick-claim/search so
// the client can call applyPickedResult directly without a second
// query.
async function claimGetPortalQuickClaimLookup(context) {
  const { client, config, origin, response, url } = context;
  const { sendJson } = context.deps;
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
  const statusStanding = verification ? String(doc.licensureVerification.statusStanding || "") : "";
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

// GET /portal/quick-claim/lookup-by-email?q=email — used by the signup
// email-blur duplicate detection nudge. Searches active listings for an
// exact (case-insensitive) email match. Returns { result } or { result: null }.
async function claimGetPortalQuickClaimLookupByEmail(context) {
  const { client, config, origin, response, url } = context;
  const { sendJson } = context.deps;
  const emailQuery = String((url && url.searchParams.get("q")) || "")
    .trim()
    .toLowerCase();
  if (!emailQuery || !emailQuery.includes("@")) {
    sendJson(response, 200, { result: null }, origin, config);
    return true;
  }
  const doc = await client.fetch(
    `*[_type == "therapist" && listingActive == true && defined(slug.current) && lower(email) == $email][0]{
        _id, name, email, city, state, credentials, licenseNumber, claimStatus,
        "slug": slug.current, licensureVerification
      }`,
    { email: emailQuery },
  );
  if (!doc) {
    sendJson(response, 200, { result: null }, origin, config);
    return true;
  }
  const verification =
    doc.licensureVerification && typeof doc.licensureVerification === "object"
      ? doc.licensureVerification
      : null;
  const statusStanding = verification ? String(verification.statusStanding || "") : "";
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
        has_email: true,
        claim_status: doc.claimStatus || "unclaimed",
        license_verified_current: statusStanding === "current",
      },
    },
    origin,
    config,
  );
  return true;
}

async function claimGetPortalQuickClaimSearch(context) {
  const { client, config, origin, response, url } = context;
  const { sendJson } = context.deps;
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

async function claimPostPortalClaimBySlug(context) {
  const { client, config, origin, request, requestId, response } = context;
  const { parseBody, sendJson, sendPortalClaimLink } = context.deps;
  const body = await parseBody(request);
  const slug = String(body.slug || "").trim();

  if (!slug) {
    sendJson(response, 400, { error: "Slug is required." }, origin, config);
    return true;
  }

  const turnstile = await verifyTurnstileToken({
    token: body && body.turnstile_token,
    remoteIp: getClientAddress(request),
    config,
  });
  if (!turnstile.ok) {
    log.warn("Turnstile rejected /portal/claim-by-slug", {
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

  // Reserve the rate-limit slot (and stamp claimStatus) atomically
  // BEFORE sending, so concurrent requests can't race past the cap.
  const reserved = await reserveClaimLinkSlot(client, therapist._id, function (doc) {
    return { claimStatus: doc.claimStatus === "claimed" ? "claimed" : "claim_requested" };
  });
  if (!reserved.ok) {
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

  // Already-claimed therapists land here via re-entry ("send me a
  // fresh link" for a listing they already own). The "activate your
  // listing" copy is wrong for them — they already did that. Pass
  // mode=signin so the email reads as a sign-in link instead.
  const emailMode = therapist.claimStatus === "claimed" ? "signin" : "claim";

  await sendPortalClaimLink(config, therapistForEmail, onFileEmail, config.portalBaseUrl, {
    mode: emailMode,
  });

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

async function claimPostPortalQuickClaim(context) {
  const { client, config, deps, origin, request, requestId, response } = context;
  const { parseBody, sendJson, sendPortalClaimLink } = context.deps;
  const body = await parseBody(request);
  const rawFullName = String(body.full_name || "").trim();
  const rawEmail = String(body.email || "").trim();
  const rawLicense = String(body.license_number || "").trim();

  const fullName = normalizeNameForMatch(rawFullName);
  const requesterEmail = rawEmail.toLowerCase();
  const licenseNumber = normalizeLicenseForMatch(rawLicense);
  const licenseState = readLicenseStateParam(body.license_state);

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

  // Scoped to one state's license namespace: two states can issue the same
  // number, so an unscoped match would resolve the wrong profile once a
  // second state launches. The !defined() escape keeps legacy docs that
  // predate the licenseState field claimable; drop it after a backfill.
  const therapist = await client.fetch(
    `*[_type == "therapist" && (licenseState == $licenseState || !defined(licenseState)) && licenseNumber match $license][0]{
        _id, name, email, website, claimStatus, "slug": slug
      }`,
    { license: `*${licenseNumber}*`, licenseState },
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

  // If neither automatic path verifies ownership, route to manual
  // review. Imposter risk is contained because we already required a
  // name match + license match above, and admin verifies identity
  // before approving. Covers both "no email on file" and "stale email
  // on file" (therapist changed practices, old contact address is
  // dead, no website on profile to domain-match against).
  if (!emailMatches && !domainVerified) {
    const pendingCount = await client.fetch(
      `count(*[_type == "therapistRecoveryRequest" && status == "pending" && licenseNumber match $license])`,
      { license: `*${licenseNumber}*` },
    );
    if (Number(pendingCount) >= 3) {
      sendJson(
        response,
        429,
        {
          error:
            "We already have an open review request for this license. We'll email you within one business day.",
          reason: "rate_limited",
        },
        origin,
        config,
      );
      return true;
    }

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

    const reviewReason = profileEmail ? "stale_email_on_file" : "no_email_on_file";
    const recoveryDoc = {
      _type: "therapistRecoveryRequest",
      fullName: rawFullName,
      licenseNumber: rawLicense,
      requestedEmail: requesterEmail,
      priorEmail: "",
      reason: reviewReason,
      status: "pending",
      therapistSlug: therapist.slug.current,
      therapistDocId: therapist._id,
      profileName: therapist.name || "",
      profileEmailHint: profileEmail ? maskEmail(therapist.email) : "",
      profileClaimedEmail: "",
      requesterIp,
      createdAt: nowIso,
    };
    const created = await client.create(recoveryDoc);

    try {
      await deps.notifyAdminOfRecoveryRequest(config, created);
    } catch (error) {
      log.error("Failed to notify admin of quick-claim manual review", {
        requestId,
        err: error?.message || String(error),
      });
    }
    try {
      await deps.notifyTherapistOfRecoveryReceived(config, created);
    } catch (error) {
      log.error("Failed to send review-received confirmation email", {
        requestId,
        err: error?.message || String(error),
      });
    }

    try {
      await client
        .patch(therapist._id)
        .set({ claimStatus: "claim_requested" })
        .commit({ visibility: "sync" });
    } catch (_error) {
      // Non-fatal — claim status is derived admin state.
    }

    sendJson(
      response,
      202,
      {
        ok: true,
        message:
          "We couldn't auto-verify your email, so we sent this to manual review. Check your inbox for a confirmation. We'll email a decision within one business day.",
        therapist_slug: therapist.slug.current,
        verification_method: "manual_review",
        recovery_request_id: created._id,
      },
      origin,
      config,
    );
    return true;
  }

  await sendPortalClaimLink(config, therapist, requesterEmail, config.portalBaseUrl);

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
async function claimPostPortalSignIn(context) {
  const { client, config, origin, request, requestId, response } = context;
  const {
    canAttemptPortalAuth,
    parseBody,
    recordPortalAuthAttempt,
    sendJson,
    sendPortalClaimLink,
  } = context.deps;
  if (
    typeof canAttemptPortalAuth === "function" &&
    !(await canAttemptPortalAuth(request, config))
  ) {
    sendJson(response, 429, { error: "Too many requests. Try again later." }, origin, config);
    return true;
  }
  if (typeof recordPortalAuthAttempt === "function") {
    await recordPortalAuthAttempt(request, config);
  }

  const body = await parseBody(request);
  const requesterEmail = String(body.email || "")
    .trim()
    .toLowerCase();

  const GENERIC_SUCCESS = {
    ok: true,
    message:
      "If that email matches a claimed profile, we just sent a sign-in link. Valid for 24 hours.",
  };

  if (
    !requesterEmail ||
    requesterEmail.length > 254 ||
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(requesterEmail)
  ) {
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

  // Reserve the rate-limit slot atomically BEFORE sending, so concurrent
  // requests can't race past the cap. Silently succeed when refused —
  // don't leak the rate-limit signal since the generic response promises
  // a link only "if the email matched".
  const reserved = await reserveClaimLinkSlot(client, therapist._id);
  if (!reserved.ok) {
    sendJson(response, 200, GENERIC_SUCCESS, origin, config);
    return true;
  }

  const therapistForEmail = {
    ...therapist,
    slug: { current: resolvedSlug },
  };

  try {
    await sendPortalClaimLink(config, therapistForEmail, requesterEmail, config.portalBaseUrl, {
      mode: "signin",
    });
  } catch (error) {
    // Preserve the generic response contract so delivery outages or
    // downstream write failures cannot become a claimed-email oracle.
    log.error("Portal sign-in link delivery failed", {
      requestId,
      err: error?.message || String(error),
    });
  }

  sendJson(response, 200, GENERIC_SUCCESS, origin, config);
  return true;
}

async function claimPostPortalClaimLink(context) {
  const { client, config, origin, request, requestId, response } = context;
  const {
    canAttemptPortalAuth,
    parseBody,
    recordPortalAuthAttempt,
    sendJson,
    sendPortalClaimLink,
  } = context.deps;
  if (
    typeof canAttemptPortalAuth === "function" &&
    !(await canAttemptPortalAuth(request, config))
  ) {
    sendJson(response, 429, { error: "Too many requests. Try again later." }, origin, config);
    return true;
  }
  if (typeof recordPortalAuthAttempt === "function") {
    await recordPortalAuthAttempt(request, config);
  }

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

  try {
    await sendPortalClaimLink(config, therapist, requesterEmail, config.portalBaseUrl, {
      mode: therapist.claimStatus === "claimed" ? "signin" : "claim",
    });
  } catch (emailError) {
    log.error("Failed to send portal claim link", {
      requestId,
      err: emailError?.message || String(emailError),
    });
    sendJson(
      response,
      500,
      { error: "We couldn't send your link right now. Please try again or contact support." },
      origin,
      config,
    );
    return true;
  }

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

async function claimPostPortalClaimSession(context) {
  const { client, config, origin, request, response } = context;
  const { parseBody, readPortalClaimToken, sendJson } = context.deps;
  const body = await parseBody(request);
  const token = String(body.token || "").trim();
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

  sendJson(response, 200, { ok: true, therapist: shapePortalTherapist(therapist) }, origin, config);
  return true;
}

async function claimPostPortalClaimAccept(context) {
  const { client, config, origin, request, requestId, response } = context;
  const {
    createTherapistSession,
    parseBody,
    readPortalClaimToken,
    sendJson,
    sendPortalWelcomeEmail,
    sendFounderAlert,
  } = context.deps;
  const { setSessionCookie } = makeSessionHelpers(context.deps, context.request, context.response);
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
      await sendPortalWelcomeEmail(config, therapist, payload.email, config.portalBaseUrl);
    } catch (error) {
      log.error("Failed to send portal welcome email", {
        requestId,
        err: error?.message || String(error),
      });
    }
    // Founder alert: a therapist just claimed their profile. Plain-text,
    // single-purpose so it reads cleanly on a phone notification.
    if (typeof sendFounderAlert === "function") {
      try {
        await sendFounderAlert(config, {
          subject: `[CLAIM] ${therapist.name || "Therapist"} claimed their profile`,
          lines: [
            `Name: ${therapist.name || "(none)"}`,
            `Email: ${payload.email || therapist.email || "(none)"}`,
            `Slug: ${therapist.slug?.current || therapist.slug || "(none)"}`,
            `Claimed at: ${now}`,
          ],
        });
      } catch (error) {
        log.error("Failed to send founder alert (claim)", {
          requestId,
          err: error?.message || String(error),
        });
      }
    }
  }

  const therapistSessionToken = createTherapistSession(config, {
    slug: therapist.slug,
    email: payload.email,
  });
  setSessionCookie(
    THERAPIST_SESSION_COOKIE,
    therapistSessionToken,
    Number(config.therapistSessionTtlMs) / 1000,
  );

  sendJson(
    response,
    200,
    {
      ok: true,
      therapist_slug: therapist.slug,
      claimed_by_email: payload.email,
    },
    origin,
    config,
  );
  return true;
}

async function claimPostPortalLogout(context) {
  const { config, origin, response } = context;
  const { sendJson } = context.deps;
  const { clearSessionCookie } = makeSessionHelpers(
    context.deps,
    context.request,
    context.response,
  );
  // Signed, stateless tokens — we can't revoke the bearer here without a
  // session table. The route exists so the client has a trustworthy ack
  // before clearing localStorage and so we have a hook when we later add
  // a session table (for "sign out of all devices"). Funnel event is
  // already tracked client-side before this call; no server logging
  // needed here.
  clearSessionCookie(THERAPIST_SESSION_COOKIE);
  sendJson(response, 200, { ok: true }, origin, config);
  return true;
}
