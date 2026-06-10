import crypto from "node:crypto";
import { normalizeLicenseForMatch } from "../shared/therapist-domain.mjs";
import { log } from "./logger.mjs";
import { sendPortalContactEmail } from "./review-email.mjs";
import { getClientAddress } from "./review-http-auth.mjs";
import { verifyTurnstileToken } from "./turnstile-verify.mjs";
import { validateBody } from "./validate.mjs";

const RECOVERY_REQUEST_SCHEMA = {
  full_name: { type: "string", required: true, maxLength: 200 },
  license_number: { type: "string", required: true, maxLength: 32 },
  requested_email: { type: "email", required: true },
  prior_email: { type: "email" },
  reason: { type: "string", maxLength: 2000 },
};

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

export async function handleRecoveryRoutes(context) {
  const { client, config, deps, origin, request, response, routePath, url } = context;
  const contextRequestId = context.requestId;

  const {
    canAttemptPortalAuth,
    normalizePortalRequest,
    parseBody,
    recordPortalAuthAttempt,
    sendJson,
    updatePortalRequestFields,
  } = deps;

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
    const portalRequestValidation = validateBody(
      {
        requester_name: { type: "string", required: true, maxLength: 200 },
        requester_email: { type: "email", required: true },
        message: { type: "string", maxLength: 2000 },
      },
      body,
    );
    if (!portalRequestValidation.ok) {
      sendJson(response, 400, { error: portalRequestValidation.error }, origin, config);
      return true;
    }
    await sendPortalContactEmail(config, body);
    sendJson(response, 200, { ok: true }, origin, config);
    return true;
  }

  // POST /portal/recovery-request — therapist-initiated account
  // recovery. When a claimed therapist has lost access to their
  // on-file email AND can't domain-verify, they file this and admin
  // reviews manually. Creates a therapistRecoveryRequest doc in
  // "pending" state and fires a notification to admin. Rate-limited
  // to 3 pending per license to prevent flooding.
  if (request.method === "POST" && routePath === "/portal/recovery-request") {
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

    const turnstile = await verifyTurnstileToken({
      token: body && body.turnstile_token,
      remoteIp: getClientAddress(request),
      config,
    });
    if (!turnstile.ok) {
      log.warn("Turnstile rejected /portal/recovery-request", {
        requestId: contextRequestId,
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

    const recoveryValidation = validateBody(RECOVERY_REQUEST_SCHEMA, body);
    if (!recoveryValidation.ok) {
      sendJson(
        response,
        400,
        { error: recoveryValidation.error, field: recoveryValidation.field },
        origin,
        config,
      );
      return true;
    }
    const fullName = String(body.full_name || "").trim();
    const licenseNumber = String(body.license_number || "").trim();
    const requestedEmail = String(body.requested_email || "")
      .trim()
      .toLowerCase();
    const priorEmail = String(body.prior_email || "")
      .trim()
      .toLowerCase();
    const reason = String(body.reason || "").trim();
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
      log.error("Failed to notify admin of recovery request", {
        err: error?.message || String(error),
      });
    }
    try {
      await deps.notifyTherapistOfRecoveryReceived(config, created);
    } catch (error) {
      log.error("Failed to send recovery-received confirmation email", {
        err: error?.message || String(error),
      });
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

  // GET /recovery-requests — admin list. Pending first. Enriches each
  // request with verification anchors pulled from the linked therapist
  // (DCA address, license status, expiration, discipline flag, website,
  // phone) so the admin reviewer has everything in one card without
  // hunting around. Also flags suspicious patterns the admin should
  // weight when deciding (same IP filing multiple recoveries, free-
  // email requested address, recently-changed on-file email, etc.).
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
        profileClaimedEmail, adminNote, identityVerification, outcomeMessage,
        reviewedAt, reviewedBy, requesterIp, createdAt,
        confirmationChannel, confirmationChannelContext, confirmationSentAt,
        confirmationResponse, confirmationRespondedAt, confirmationSendHistory,
        verificationMethods
      }`,
    );

    const list = Array.isArray(requests) ? requests : [];
    const therapistDocIds = [...new Set(list.map((r) => r.therapistDocId).filter(Boolean))];
    const therapistAnchors =
      therapistDocIds.length > 0
        ? await client.fetch(
            `*[_type == "therapist" && _id in $ids]{
              _id, name, email, phone, website, claimStatus, claimedByEmail,
              "addressCity": licensureVerification.addressCity,
              "addressState": licensureVerification.addressState,
              "addressZip": licensureVerification.addressZip,
              "licenseStatus": licensureVerification.primaryStatus,
              "licenseExpDate": licensureVerification.expirationDate,
              "disciplineFlag": licensureVerification.disciplineFlag,
              "boardName": licensureVerification.boardName,
              "verifiedAt": licensureVerification.verifiedAt,
              "providerNpi": providerId
            }`,
            { ids: therapistDocIds },
          )
        : [];
    const anchorById = new Map(therapistAnchors.map((t) => [t._id, t]));

    // Suspicious-pattern detection: count how many DIFFERENT licenses
    // each IP has filed under in the last 30d. >1 means same person/IP
    // is filing for multiple therapists — suspicious.
    const ipCounts = new Map();
    for (const r of list) {
      if (!r.requesterIp) continue;
      const cutoff = Date.now() - 30 * 86400000;
      const created = new Date(r.createdAt || 0).getTime();
      if (created < cutoff) continue;
      if (!ipCounts.has(r.requesterIp)) ipCounts.set(r.requesterIp, new Set());
      ipCounts.get(r.requesterIp).add(r.licenseNumber);
    }

    const FREE_EMAIL = new Set([
      "gmail.com",
      "yahoo.com",
      "outlook.com",
      "hotmail.com",
      "icloud.com",
      "me.com",
      "aol.com",
      "proton.me",
      "protonmail.com",
      "mail.com",
    ]);

    const enriched = list.map((req) => {
      const anchor = req.therapistDocId ? anchorById.get(req.therapistDocId) : null;
      const flags = [];
      const requestedDomain = String(req.requestedEmail || "")
        .split("@")[1]
        ?.toLowerCase();
      if (requestedDomain && FREE_EMAIL.has(requestedDomain)) {
        flags.push({
          severity: "warn",
          code: "free_email_provider",
          message:
            "Requested email is at a free provider (gmail/yahoo/etc.), no domain anchor. Verify identity through another channel.",
        });
      }
      const ipLicenses = req.requesterIp ? ipCounts.get(req.requesterIp) : null;
      if (ipLicenses && ipLicenses.size > 1) {
        flags.push({
          severity: "high",
          code: "multi_license_same_ip",
          message: `Same IP (${req.requesterIp}) has filed recovery requests for ${ipLicenses.size} different licenses in the last 30 days. Investigate before approving.`,
        });
      }
      if (anchor && anchor.disciplineFlag) {
        flags.push({
          severity: "high",
          code: "discipline_on_file",
          message:
            "DCA shows public disciplinary actions on this license. Approval will give the requester control of a profile that may need to be unpublished.",
        });
      }
      if (anchor && anchor.licenseStatus && anchor.licenseStatus !== "active") {
        flags.push({
          severity: "high",
          code: "license_not_active",
          message: `DCA shows license status as "${anchor.licenseStatus}" (not active). Verify before approving. The listing may need to be unpublished instead.`,
        });
      }
      if (anchor && !anchor.email && !anchor.website) {
        flags.push({
          severity: "warn",
          code: "no_anchors_available",
          message:
            "No email, no website on the profile. Only DCA address-of-record + phone (if any) are verification channels. Consider phone verification or postal code.",
        });
      }
      return { ...req, anchor: anchor || null, flags };
    });

    sendJson(response, 200, { ok: true, requests: enriched }, origin, config);
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
    const reviewer = deps.getAuthorizedActor(request, config);

    // Atomic claim FIRST: transition the recovery doc pending->approved
    // gated on its revision. This is the lock — if two admins approve the
    // same request concurrently (or one double-clicks), only one commit
    // succeeds; the loser hits the revision conflict here and bails before
    // any side effects, so we never double-grant access or double-send the
    // approval email.
    let updated;
    try {
      updated = await client
        .patch(recovery._id)
        .ifRevisionId(recovery._rev)
        .set({
          status: "approved",
          reviewedAt: nowIso,
          reviewedBy: (reviewer && (reviewer.name || reviewer.id)) || "admin",
          outcomeMessage: customMessage,
          adminNote: adminNote || recovery.adminNote || "",
        })
        .commit({ visibility: "sync" });
    } catch (error) {
      log.warn("[recovery approve] revision conflict — already resolved", {
        requestId: contextRequestId,
        err: error?.message || String(error),
      });
      sendJson(
        response,
        409,
        { error: "This request was just resolved by another action." },
        origin,
        config,
      );
      return true;
    }

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

    const portalBaseUrl = config.portalBaseUrl;
    const magicLink = deps.buildRecoveryMagicLink(
      config,
      therapistForLink,
      recovery.requestedEmail,
      portalBaseUrl,
    );

    try {
      await deps.sendRecoveryApprovedEmail(config, recovery, magicLink, customMessage);
    } catch (error) {
      // The recovery is already approved and access is granted; only the
      // email failed. Point the admin at "Resend sign-in" (purpose-built
      // for approved recoveries) instead of leaving it half-done, and keep
      // the provider error in the logs rather than the response.
      log.error("[recovery approve] approval email delivery failed", {
        requestId: contextRequestId,
        err: error?.message || String(error),
      });
      sendJson(
        response,
        502,
        {
          error: "Approval saved, but the sign-in email could not be sent. Use Resend sign-in.",
          reason: "email_failed",
        },
        origin,
        config,
      );
      return true;
    }

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
      log.error("Failed to send rejection email", { err: error?.message || String(error) });
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

  // POST /recovery-requests/:id/dismiss — admin clears a duplicate or
  // junk request without emailing the therapist. Use when the same
  // person submitted twice, or when the request is clearly noise.
  // The admin note captures why so the audit trail isn't blank.
  const recoveryDismissMatch = routePath.match(/^\/recovery-requests\/([^/]+)\/dismiss$/);
  if (request.method === "POST" && recoveryDismissMatch) {
    if (!deps.isAuthorized(request, config)) {
      sendJson(response, 401, { error: "Unauthorized." }, origin, config);
      return true;
    }
    const requestId = decodeURIComponent(recoveryDismissMatch[1]);
    const body = await parseBody(request);
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

    const reviewer = deps.getAuthorizedActor(request, config);
    const updated = await client
      .patch(recovery._id)
      .set({
        status: "dismissed",
        reviewedAt: new Date().toISOString(),
        reviewedBy: (reviewer && (reviewer.name || reviewer.id)) || "admin",
        adminNote: adminNote || recovery.adminNote || "",
      })
      .commit({ visibility: "sync" });

    sendJson(response, 200, { ok: true, request: updated }, origin, config);
    return true;
  }

  // POST /recovery-requests/:id/resend-signin — admin-only fallback
  // for when an approved recovery didn't get its sign-in email delivered
  // (Resend outage, typo, spam folder). Re-mints a magic link and re-
  // sends the approved email. No state change on the recovery doc.
  const recoveryResendSigninMatch = routePath.match(
    /^\/recovery-requests\/([^/]+)\/resend-signin$/,
  );
  if (request.method === "POST" && recoveryResendSigninMatch) {
    if (!deps.isAuthorized(request, config)) {
      sendJson(response, 401, { error: "Unauthorized." }, origin, config);
      return true;
    }
    const requestId = decodeURIComponent(recoveryResendSigninMatch[1]);
    const recovery = await client.getDocument(requestId);
    if (!recovery || recovery._type !== "therapistRecoveryRequest") {
      sendJson(response, 404, { error: "Recovery request not found." }, origin, config);
      return true;
    }
    if (recovery.status !== "approved") {
      sendJson(
        response,
        409,
        {
          error: "Resend only applies to already-approved recoveries. Approve this request first.",
          reason: "not_approved",
        },
        origin,
        config,
      );
      return true;
    }
    if (!recovery.therapistDocId) {
      sendJson(
        response,
        400,
        { error: "This request is missing its therapist link." },
        origin,
        config,
      );
      return true;
    }
    const therapist = await client.fetch(
      `*[_type == "therapist" && _id == $id][0]{ _id, name, claimStatus, "slug": slug }`,
      { id: recovery.therapistDocId },
    );
    if (!therapist) {
      sendJson(
        response,
        404,
        { error: "Target therapist profile no longer exists." },
        origin,
        config,
      );
      return true;
    }
    const therapistForLink =
      typeof therapist.slug === "string"
        ? { ...therapist, slug: { current: therapist.slug } }
        : therapist;
    const portalBaseUrl = config.portalBaseUrl;
    const magicLink = deps.buildRecoveryMagicLink(
      config,
      therapistForLink,
      recovery.requestedEmail,
      portalBaseUrl,
    );
    try {
      await deps.sendRecoveryApprovedEmail(config, recovery, magicLink, "");
    } catch (error) {
      sendJson(
        response,
        502,
        { error: "Resend failed: " + (error.message || "unknown") },
        origin,
        config,
      );
      return true;
    }
    sendJson(response, 200, { ok: true, message: "Sign-in link resent." }, origin, config);
    return true;
  }

  // POST /recovery-requests/:id/send-confirmation — admin pastes an
  // out-of-band email address they sourced from a public record (DCA,
  // practice website, PT profile). Server mints a single-use token,
  // emails a "did you request this?" prompt to that address. When the
  // therapist clicks yes/no, the recovery request auto-resolves.
  const recoverySendConfirmationMatch = routePath.match(
    /^\/recovery-requests\/([^/]+)\/send-confirmation$/,
  );
  if (request.method === "POST" && recoverySendConfirmationMatch) {
    if (!deps.isAuthorized(request, config)) {
      sendJson(response, 401, { error: "Unauthorized." }, origin, config);
      return true;
    }
    const requestId = decodeURIComponent(recoverySendConfirmationMatch[1]);
    const body = await parseBody(request);
    const channelEmail = String(body.channel_email || "")
      .trim()
      .toLowerCase();
    const channelContext = String(body.channel_context || "").trim();

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(channelEmail)) {
      sendJson(
        response,
        400,
        { error: "Enter a valid confirmation channel email." },
        origin,
        config,
      );
      return true;
    }
    if (channelContext.length < 3) {
      sendJson(
        response,
        400,
        {
          error:
            "Note where you sourced this email (e.g., 'DCA record', 'Psychology Today profile').",
        },
        origin,
        config,
      );
      return true;
    }

    const recovery = await client.getDocument(requestId);
    if (!recovery || recovery._type !== "therapistRecoveryRequest") {
      sendJson(response, 404, { error: "Recovery request not found." }, origin, config);
      return true;
    }
    if (recovery.status !== "pending") {
      sendJson(response, 409, { error: "This request has already been resolved." }, origin, config);
      return true;
    }

    // Rate limit: 5 send-confirmation calls per recovery per rolling
    // 24h window. Protects the therapist's publicly-listed inboxes from
    // being spammed by a compromised admin account or a malicious
    // insider cycling through channels.
    const sendHistory = Array.isArray(recovery.confirmationSendHistory)
      ? recovery.confirmationSendHistory
      : [];
    const cutoff = Date.now() - 1000 * 60 * 60 * 24;
    const recentSends = sendHistory.filter(function (iso) {
      const t = Date.parse(iso);
      return Number.isFinite(t) && t >= cutoff;
    });
    if (recentSends.length >= 5) {
      sendJson(
        response,
        429,
        {
          error:
            "This request has hit the send-confirmation limit (5 per 24h). If the therapist isn't responding, use the manual identity-verification fallback or wait.",
          reason: "send_confirmation_rate_limited",
        },
        origin,
        config,
      );
      return true;
    }

    if (
      String(recovery.requestedEmail || "")
        .trim()
        .toLowerCase() === channelEmail
    ) {
      sendJson(
        response,
        400,
        {
          error:
            "Confirmation channel must be an address the requester did NOT provide, otherwise the requester could self-confirm. Source it from DCA, a practice website, or similar.",
          reason: "channel_matches_requester",
        },
        origin,
        config,
      );
      return true;
    }

    const nonce = crypto.randomBytes(12).toString("hex");
    const token = deps.buildRecoveryConfirmToken(config, recovery._id, nonce);
    const portalBaseUrl = config.portalBaseUrl;
    const confirmUrl =
      portalBaseUrl + "/confirm-claim?token=" + encodeURIComponent(token) + "&response=yes";
    const denyUrl =
      portalBaseUrl + "/confirm-claim?token=" + encodeURIComponent(token) + "&response=no";

    try {
      await deps.sendRecoveryConfirmationEmail(
        config,
        recovery,
        confirmUrl,
        denyUrl,
        channelEmail,
        channelContext,
      );
    } catch (error) {
      sendJson(
        response,
        502,
        { error: "Email send failed: " + (error.message || "unknown") },
        origin,
        config,
      );
      return true;
    }

    // Ping the requester's submitted email so they know to check their
    // other inbox. The channel is masked so a requester who happens to
    // be an attacker doesn't learn which public address we used.
    // Best-effort — send-confirmation succeeds even if this fails.
    try {
      await deps.sendRecoveryConfirmationHeadsUp(config, recovery, maskEmail(channelEmail));
    } catch (error) {
      log.error("Failed to send heads-up to requester email", {
        err: error?.message || String(error),
      });
    }

    const nowIso = new Date().toISOString();
    const nextHistory = recentSends.concat([nowIso]);
    const updated = await client
      .patch(recovery._id)
      .set({
        confirmationChannel: channelEmail,
        confirmationChannelContext: channelContext,
        confirmationSentAt: nowIso,
        confirmationTokenNonce: nonce,
        confirmationResponse: "pending",
        confirmationSendHistory: nextHistory,
      })
      .commit({ visibility: "sync" });

    sendJson(response, 200, { ok: true, request: updated }, origin, config);
    return true;
  }

  // GET /recovery-confirm?token=X — public. Renders context for the
  // public confirm-claim.html page so the therapist sees what they're
  // approving. Masks the requester IP so we don't leak attacker geo
  // info to the therapist unnecessarily.
  if (request.method === "GET" && routePath === "/recovery-confirm") {
    const token = String(url.searchParams.get("token") || "");
    if (!token) {
      sendJson(response, 400, { error: "Missing token." }, origin, config);
      return true;
    }
    const payload = deps.readRecoveryConfirmToken(config, token);
    if (!payload) {
      sendJson(
        response,
        400,
        { error: "This confirmation link is invalid or has expired.", reason: "invalid_token" },
        origin,
        config,
      );
      return true;
    }
    const recovery = await client.getDocument(payload.recovery);
    if (!recovery || recovery._type !== "therapistRecoveryRequest") {
      sendJson(
        response,
        404,
        { error: "Confirmation target not found.", reason: "not_found" },
        origin,
        config,
      );
      return true;
    }
    if (recovery.confirmationTokenNonce !== payload.nonce) {
      sendJson(
        response,
        410,
        {
          error: "This confirmation link has already been used or replaced.",
          reason: "used_or_replaced",
        },
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
        therapist_name: recovery.fullName || recovery.profileName || "",
        license_number: recovery.licenseNumber || "",
        requested_email: recovery.requestedEmail || "",
        already_responded:
          recovery.confirmationResponse && recovery.confirmationResponse !== "pending"
            ? recovery.confirmationResponse
            : null,
        status: recovery.status,
      },
      origin,
      config,
    );
    return true;
  }

  // POST /recovery-confirm — public. Body: { token, response: "yes"|"no" }.
  // Yes auto-approves the recovery (claim link goes to requestedEmail).
  // No auto-rejects and notifies admin so they can follow up if the
  // real therapist is being targeted.
  if (request.method === "POST" && routePath === "/recovery-confirm") {
    const body = await parseBody(request);
    const token = String(body.token || "");
    const therapistResponse = String(body.response || "").toLowerCase();

    if (therapistResponse !== "yes" && therapistResponse !== "no") {
      sendJson(response, 400, { error: "Response must be 'yes' or 'no'." }, origin, config);
      return true;
    }
    const payload = deps.readRecoveryConfirmToken(config, token);
    if (!payload) {
      sendJson(
        response,
        400,
        { error: "This confirmation link is invalid or has expired.", reason: "invalid_token" },
        origin,
        config,
      );
      return true;
    }
    const recovery = await client.getDocument(payload.recovery);
    if (!recovery || recovery._type !== "therapistRecoveryRequest") {
      sendJson(response, 404, { error: "Confirmation target not found." }, origin, config);
      return true;
    }
    if (recovery.confirmationTokenNonce !== payload.nonce) {
      sendJson(
        response,
        410,
        {
          error: "This link has already been used. If that wasn't you, contact us.",
          reason: "used_or_replaced",
        },
        origin,
        config,
      );
      return true;
    }
    if (recovery.status !== "pending") {
      sendJson(
        response,
        409,
        { error: "This request was already resolved.", reason: "already_resolved" },
        origin,
        config,
      );
      return true;
    }

    const nowIso = new Date().toISOString();
    const newNonce = crypto.randomBytes(12).toString("hex");

    // Atomic nonce rotation: claim the right to act on this link by
    // patching with ifRevisionId(recovery._rev). If another concurrent
    // request already rotated the nonce (e.g., double-click), Sanity
    // will throw a revision-mismatch error and we return 410. This is
    // the gate — once we get past this patch, we "own" the response and
    // can safely do the expensive side effects (email, therapist
    // updates) below without racing. In-memory test client no-ops
    // ifRevisionId since tests don't exercise real concurrency.
    try {
      await client
        .patch(recovery._id)
        .ifRevisionId(recovery._rev || "")
        .set({
          confirmationResponse: therapistResponse,
          confirmationRespondedAt: nowIso,
          confirmationTokenNonce: newNonce,
        })
        .commit({ visibility: "sync" });
    } catch (error) {
      const errMessage = String((error && error.message) || "");
      if (/revision|_rev|mutation conflict/i.test(errMessage)) {
        sendJson(
          response,
          410,
          {
            error: "This link has already been used. If that wasn't you, contact us.",
            reason: "used_or_replaced",
          },
          origin,
          config,
        );
        return true;
      }
      throw error;
    }

    if (therapistResponse === "no") {
      await client
        .patch(recovery._id)
        .set({
          status: "rejected",
          reviewedAt: nowIso,
          reviewedBy: "therapist-self-confirm",
          outcomeMessage:
            "Therapist reported they did NOT request access. Request blocked without notifying the requester.",
        })
        .commit({ visibility: "sync" });

      // Alert admin — a denial on a cold takeover is worth investigating
      // (possibly an active attacker). Best-effort; don't fail the
      // request if email is down.
      try {
        await deps.notifyAdminOfRecoveryRequest(config, {
          ...recovery,
          adminAlert: "therapist_denied_confirmation",
        });
      } catch (error) {
        log.error("Failed to alert admin of therapist denial", {
          err: error?.message || String(error),
        });
      }

      sendJson(
        response,
        200,
        {
          ok: true,
          outcome: "denied",
          message: "Thanks. We've blocked the request and our team has been alerted.",
        },
        origin,
        config,
      );
      return true;
    }

    // therapistResponse === "yes" → auto-approve, same effect as the
    // admin approve path but with identityVerification auto-filled.
    if (!recovery.therapistDocId || !recovery.therapistSlug) {
      sendJson(
        response,
        400,
        { error: "This request is missing its therapist link. Please contact support." },
        origin,
        config,
      );
      return true;
    }

    const therapist = await client.fetch(
      `*[_type == "therapist" && _id == $id][0]{ _id, name, claimStatus, "slug": slug }`,
      { id: recovery.therapistDocId },
    );
    if (!therapist) {
      sendJson(
        response,
        404,
        { error: "Target therapist profile no longer exists." },
        origin,
        config,
      );
      return true;
    }

    await client
      .patch(therapist._id)
      .set({
        claimStatus: "claimed",
        claimedByEmail: recovery.requestedEmail,
        claimedAt: therapist.claimStatus === "claimed" ? undefined : nowIso,
      })
      .commit({ visibility: "sync" });

    const therapistForLink =
      typeof therapist.slug === "string"
        ? { ...therapist, slug: { current: therapist.slug } }
        : therapist;
    const portalBaseUrl = config.portalBaseUrl;
    const magicLink = deps.buildRecoveryMagicLink(
      config,
      therapistForLink,
      recovery.requestedEmail,
      portalBaseUrl,
    );

    try {
      await deps.sendRecoveryApprovedEmail(config, recovery, magicLink, "");
    } catch (error) {
      // Generic message to the (anonymous) caller; the provider-side
      // failure detail goes to server logs only — don't leak Resend
      // error strings to an unauthenticated confirm-page request.
      log.error("[recovery-confirm] sign-in email delivery failed", {
        requestId: contextRequestId,
        err: error?.message || String(error),
      });
      sendJson(
        response,
        502,
        { error: "Confirmation saved, but the sign-in email could not be sent. Contact support." },
        origin,
        config,
      );
      return true;
    }

    const autoVerificationNote =
      "Confirmed by therapist via " +
      (recovery.confirmationChannel || "email") +
      " (" +
      (recovery.confirmationChannelContext || "admin-sourced channel") +
      ") at " +
      nowIso +
      ".";

    await client
      .patch(recovery._id)
      .set({
        status: "approved",
        reviewedAt: nowIso,
        reviewedBy: "therapist-self-confirm",
        outcomeMessage: "",
        identityVerification: autoVerificationNote,
        confirmationResponse: "yes",
        confirmationRespondedAt: nowIso,
        confirmationTokenNonce: newNonce,
      })
      .commit({ visibility: "sync" });

    sendJson(
      response,
      200,
      {
        ok: true,
        outcome: "confirmed",
        message: "Thanks, you're back in. Check your inbox for the sign-in link.",
      },
      origin,
      config,
    );
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

  return false;
}
