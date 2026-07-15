import { log } from "./logger.mjs";
import { validateBody } from "./validate.mjs";
import {
  DEFAULT_LICENSE_STATE,
  SUPPORTED_LICENSE_STATES,
  getLicenseVerifierForState,
} from "./license-states.mjs";
import { getClientAddress } from "./review-http-auth.mjs";
import { verifyTurnstileToken } from "./turnstile-verify.mjs";
import { applicantNameMatchesDcaLicensee } from "../shared/dca-name-match.mjs";

const INTAKE_SCHEMA = {
  name: { type: "string", required: true, maxLength: 200 },
  email: { type: "email", required: true },
  license_number: { type: "string", required: true, maxLength: 32 },
};

export async function handleApplicationRoutes(context) {
  for (const route of APPLICATION_ROUTES) {
    if (!route.methods.includes(context.request.method)) continue;
    if (route.path) {
      if (route.path !== context.routePath) continue;
      return route.handler(context);
    }
    const match = route.pattern.exec(context.routePath);
    if (match) return route.handler(context, match);
  }
  return false;
}

const APPLICATION_ROUTES = [
  { methods: ["POST"], path: "/applications/intake", handler: applicationPostIntake },
  {
    methods: ["POST"],
    path: "/applications/free-path-selected",
    handler: applicationPostFreePathSelected,
  },
  { methods: ["POST"], path: "/applications", handler: applicationPostApplications },
  {
    methods: ["PATCH", "POST"],
    pattern: /^\/applications\/([^/]+)$/,
    handler: applicationUpdate,
  },
  {
    methods: ["POST"],
    pattern: /^\/applications\/([^/]+)\/apply-live-fields$/,
    handler: applicationPostApplyLiveFields,
  },
  {
    methods: ["POST"],
    pattern: /^\/applications\/([^/]+)\/approve$/,
    handler: applicationPostApprove,
  },
  {
    methods: ["POST"],
    pattern: /^\/applications\/([^/]+)\/reject$/,
    handler: applicationPostReject,
  },
];

// POST /applications/intake — short-form signup with synchronous
// license verification and immediate checkout. The therapist pays
// right after license verification, no admin review gate. Flow:
//
//   1. Validate inputs + check for duplicates
//   2. Sync DCA verification (try all 6 CA license types in parallel)
//   3. On fail: 422 with license-not-verified — no charge, no doc
//   4. On pass: build application doc (audit trail) + therapist doc
//      (listingActive=false so stub bios don't leak into the public
//      directory; therapist flips live from portal once a real bio
//      is saved)
//   5. Compose Stripe checkout session + portal claim token
//   6. Return {stripe_url, claim_token, therapist_slug} — client
//      redirects directly to Stripe
//
// Admin visibility is preserved through the audit-trail application
// doc (status=auto_approved, intake_source=signup_instant_checkout)
// and the therapist doc itself (listed in the admin listings
// workspace with listingActive=false + status=pending_profile).
async function applicationPostIntake(context) {
  const { client, config, origin, request, requestId, response } = context;
  const {
    canAttemptIntake,
    recordIntakeAttempt,
    buildApplicationDocument,
    buildPortalClaimToken,
    buildTherapistDocument,
    createFeaturedCheckoutSession,
    findDuplicateTherapistEntity,
    notifyAdminOfSubmission,
    parseBody,
    publishingHelpers,
    sendJson,
  } = context.deps;
  if (!(await canAttemptIntake(request, config))) {
    sendJson(
      response,
      429,
      { error: "Too many submission attempts. Please wait a few minutes and try again." },
      origin,
      config,
    );
    return true;
  }
  await recordIntakeAttempt(request, config);

  const body = await parseBody(request);

  const turnstile = await verifyTurnstileToken({
    token: body && body.turnstile_token,
    remoteIp: getClientAddress(request),
    config,
  });
  if (!turnstile.ok) {
    log.warn("Turnstile rejected /applications/intake", {
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

  const intakeValidation = validateBody(INTAKE_SCHEMA, body);
  if (!intakeValidation.ok) {
    sendJson(response, 400, { error: intakeValidation.error }, origin, config);
    return true;
  }
  const name = String(body.name || "").trim();
  const email = String(body.email || "")
    .trim()
    .toLowerCase();
  const licenseNumber = String(body.license_number || "")
    .trim()
    .replace(/\s+/g, "");
  const treatsBipolar =
    body.treats_bipolar === true || body.treats_bipolar === "true" || body.treats_bipolar === 1;
  if (!treatsBipolar) {
    sendJson(
      response,
      400,
      {
        error:
          "Please confirm you treat bipolar disorder. This directory is specifically for bipolar-specialist care.",
      },
      origin,
      config,
    );
    return true;
  }

  // License state comes from the form (hidden CA input today, a visible
  // select at multi-state launch) and is validated against the supported
  // set rather than silently forced to the default — a tampered or
  // premature non-CA value gets a clean rejection instead of being
  // verified against the wrong state's board and mislabeled.
  const licenseState =
    String(body.license_state || DEFAULT_LICENSE_STATE)
      .trim()
      .toUpperCase() || DEFAULT_LICENSE_STATE;
  if (!SUPPORTED_LICENSE_STATES.has(licenseState)) {
    sendJson(
      response,
      422,
      {
        error:
          "We can't verify licenses for that state yet. The directory currently supports California licenses only.",
        reason: "license_state_not_supported",
      },
      origin,
      config,
    );
    return true;
  }

  // Stub the narrative fields the full-form /applications endpoint
  // expects. Empty strings would fail schema validation; these get
  // scrubbed when buildTherapistDocument runs and are replaced by
  // the therapist's own content via the portal editor.
  const STUB_VALUE = "Pending, completed after approval.";
  const intakeBody = {
    name: name,
    email: email,
    license_number: licenseNumber,
    license_state: licenseState,
    state: licenseState,
    city: String(body.city || "").trim(),
    zip: String(body.zip || "").trim(),
    credentials: String(body.credentials || "").trim() || "Pending",
    bio: STUB_VALUE,
    care_approach: STUB_VALUE,
    intake_source: "signup_instant_checkout",
    submission_intent: "intake",
    // Optional headshot uploaded inline on the signup form.
    // buildApplicationDocument → uploadPhotoAssetIfPresent decodes the
    // base64 data URL and uploads it to Sanity. photoSourceType marks
    // it as therapist-uploaded so the portal won't show the
    // "public-source fallback" prompt.
    photo_upload_base64: String(body.photo_upload_base64 || "").trim(),
    photo_filename: String(body.photo_filename || "").trim(),
    photo_source_type:
      String(body.photo_upload_base64 || "").trim().length > 0 ? "therapist_uploaded" : "",
  };

  // Include archived therapists in the dupe check so a returning
  // therapist whose listing was soft-deleted can be restored instead
  // of creating a duplicate doc. The downstream branch below routes
  // archived matches to the restore path; only ACTIVE duplicates
  // return 409.
  const duplicate = await findDuplicateTherapistEntity(client, intakeBody, {
    includeArchived: true,
  });
  if (duplicate && !(duplicate.kind === "therapist" && duplicate.archived)) {
    const responsePayload =
      duplicate.kind === "therapist"
        ? {
            error:
              "A listing already exists for this license number. Use 'Manage my existing listing' above to claim it.",
            duplicate_kind: duplicate.kind,
            duplicate_slug: duplicate.slug,
            duplicate_name: duplicate.name,
            recommended_intake_type: "claim_existing",
          }
        : {
            error:
              "An application is already in progress for this therapist. We'll email the address on file about next steps.",
            duplicate_kind: duplicate.kind,
            duplicate_slug: duplicate.slug,
            duplicate_name: duplicate.name,
            duplicate_status: duplicate.status,
            recommended_intake_type: "update_existing",
          };
    sendJson(response, 409, responsePayload, origin, config);
    return true;
  }

  // Track the archived match so the post-verification branch knows to
  // un-archive instead of creating a fresh therapist doc. Cleared if
  // verification gates fail (the doc stays archived in that case).
  //
  // Only restore when the archived doc is corroborated by a STRONG identity
  // signal — a matching license number or email. The slug is derived from
  // name+city+state, so two distinct providers with the same name in the
  // same city collide on slug alone; restoring on that weak signal would
  // overwrite a stranger's archived listing with this applicant's identity.
  // A genuine returning provider matches their own license (this flow already
  // DCA-verified it), so the "license"/"email" reason will be present.
  const archivedDuplicate =
    duplicate && duplicate.kind === "therapist" && duplicate.archived ? duplicate : null;
  const archivedMatchIsStrong =
    archivedDuplicate &&
    Array.isArray(archivedDuplicate.reasons) &&
    archivedDuplicate.reasons.some(function (reason) {
      return reason === "license" || reason === "email";
    });
  if (archivedDuplicate && !archivedMatchIsStrong) {
    sendJson(
      response,
      409,
      {
        error:
          "An archived listing already exists with a matching name and location, but we couldn't confirm it belongs to you. Please email support so we can verify and restore it safely.",
        reason: "archived_match_unverified",
      },
      origin,
      config,
    );
    return true;
  }
  const archivedRestoreTarget = archivedMatchIsStrong ? archivedDuplicate : null;

  // Synchronous DCA verification. Signup only collects the license
  // number (no type dropdown), so we race all 6 California license
  // types in parallel and take the first verified hit. ~1-2s end to
  // end vs ~2-3 day human review the old flow had.
  let verification;
  if (licenseNumber === DEV_SENTINEL_LICENSE) {
    // Dev-only sentinel license bypass. Mirrors the /portal/dev-login pattern.
    // In production: log the probe attempt and fall through to a normal 422.
    // In dev without ALLOW_DEV_LOGIN: also reject so the sentinel never
    // accidentally passes in a misconfigured environment.
    if (process.env.NODE_ENV === "production") {
      const probeIp =
        (request.socket && request.socket.remoteAddress) ||
        request.headers["x-forwarded-for"] ||
        "unknown";
      log.warn("[DEV SENTINEL] TEST-0000 submitted in production", { requestId, ip: probeIp });
      verification = { verified: false, error: "not_found" };
    } else if (!isDevBypassEnabled(config)) {
      verification = { verified: false, error: "not_found" };
    } else {
      log.warn(
        "[DEV BYPASS] Sentinel license TEST-0000 used at intake — skipping DCA verification",
        { requestId },
      );
      verification = buildSentinelVerification(name);
    }
  } else {
    try {
      // Route through the per-state verifier registry. licenseState was
      // validated against SUPPORTED_LICENSE_STATES above, so a null
      // verifier here means the registry and the supported set drifted —
      // fail closed rather than silently verifying against the wrong board.
      const verifier = await getLicenseVerifierForState(licenseState);
      verification = verifier
        ? await verifier.verifyByNumber(config, licenseNumber)
        : { verified: false, error: "no_verifier_for_state" };
    } catch (error) {
      log.error("License verification threw at intake", {
        requestId,
        err: error?.message || String(error),
      });
      verification = { verified: false, error: "dca_unreachable" };
    }
  }
  if (!verification.verified) {
    sendJson(
      response,
      422,
      {
        error:
          verification.error === "dca_unreachable"
            ? "We couldn't reach the license verification service. Please try again in a minute."
            : "We couldn't verify that CA license. Double-check the number and try again. If it's correct and this keeps failing, email support and we'll sort it out.",
        reason: "license_not_verified",
        dca_error: verification.error || "",
      },
      origin,
      config,
    );
    return true;
  }

  // Active-status gate. DCA returns verified=true for any record on
  // file (including revoked/cancelled/surrendered/expired). Reject
  // anything that isn't currently active in good standing.
  if (!verification.isActive) {
    const status =
      (verification.licensureVerification && verification.licensureVerification.primaryStatus) ||
      "unknown";
    sendJson(
      response,
      422,
      {
        error: `That CA license shows status "${status}" with the state board. Only active, in-good-standing licenses can be listed. If this looks wrong, contact CA DCA to update your record, then try again.`,
        reason: "license_not_active",
        dca_status: status,
      },
      origin,
      config,
    );
    return true;
  }

  // Discipline gate. Block if CA DCA shows any public disciplinary
  // actions, citations, convictions, etc. on the license.
  if (verification.hasDiscipline) {
    sendJson(
      response,
      422,
      {
        error:
          "That CA license has public disciplinary actions on record with the state board. We cannot list providers with active discipline. If you believe this is in error, email support.",
        reason: "license_has_discipline",
      },
      origin,
      config,
    );
    return true;
  }

  // Name-match gate. The licensee on file at DCA must match the
  // applicant's submitted name. Stops someone from looking up a
  // colleague's license number and registering under their own name.
  if (!applicantNameMatchesDcaLicensee(name, verification.licenseeName)) {
    const dcaName = verification.licenseeName
      ? `${verification.licenseeName.firstName} ${verification.licenseeName.lastName}`.trim()
      : "(not returned)";
    sendJson(
      response,
      422,
      {
        error: `The name on that CA license (${dcaName}) doesn't match the name you submitted. Please use your legal name as it appears on your CA license, or double-check the license number.`,
        reason: "license_name_mismatch",
        submitted_name: name,
        dca_name: dcaName,
      },
      origin,
      config,
    );
    return true;
  }

  intakeBody.licensure_verification = verification.licensureVerification;
  intakeBody.license_type = verification.licenseTypeLabel || "";
  // Persist primaryStatus so the admin audit trail shows DCA
  // confirmed the license was active (or in what state) at signup.
  intakeBody.license_verified_at = new Date().toISOString();

  // Build the application doc as an audit trail. Status is
  // auto_approved since the license passed verification and the
  // therapist is going straight to publish. publishedTherapistId
  // is set once the therapist doc is created below.
  let applicationDocument;
  try {
    applicationDocument = await buildApplicationDocument(client, intakeBody);
  } catch (error) {
    const message = error?.message || String(error);
    if (/^(Invalid headshot upload format|Headshot )/.test(message)) {
      sendJson(response, 400, { error: message }, origin, config);
      return true;
    }
    throw error;
  }
  applicationDocument.status = "auto_approved";
  applicationDocument.reviewedAt = new Date().toISOString();
  applicationDocument.licensureVerification = verification.licensureVerification;
  const applicationCreated = await client.create(applicationDocument);

  // Build the therapist doc shape (snake-cased application → camel
  // Sanity doc). For a fresh intake we'll create it; for an archived
  // restore we'll patch the existing doc with these fields.
  const therapistDraft = buildTherapistDocument(
    { ...applicationCreated, licensureVerification: verification.licensureVerification },
    undefined,
    publishingHelpers,
  );
  therapistDraft.listingActive = false;
  therapistDraft.status = "pending_profile";
  therapistDraft.claimStatus = "unclaimed";
  therapistDraft.intakeSource = archivedRestoreTarget
    ? "signup_restore_after_archive"
    : "signup_instant_checkout";
  // Cached copies so admin filters + listings workspace can surface
  // these therapists cleanly without a join.
  therapistDraft.signupCompletedAt = new Date().toISOString();

  // Restore-on-re-signup path: a matching archived therapist was
  // found in the dupe check. Patch the existing doc instead of
  // creating a duplicate. Preserves outreach.emailLog, audit notes,
  // claim history, and the public slug.
  //
  // We strip any keys that would conflict on patch (_id, _type,
  // _rev, slug — keep the existing slug so old links don't break)
  // and apply everything else from the freshly-built draft.
  let therapistCreated;
  if (archivedRestoreTarget) {
    const nowIso = new Date().toISOString();
    const restorePatch = { ...therapistDraft };
    delete restorePatch._id;
    delete restorePatch._type;
    delete restorePatch._rev;
    delete restorePatch.slug;
    // Append a restore audit line to internal notes for traceability.
    const existing = await client.fetch(
      `*[_type == "therapist" && _id == $id][0]{ _id, notes, "slug": slug }`,
      { id: archivedRestoreTarget.id },
    );
    if (!existing) {
      sendJson(
        response,
        409,
        {
          error:
            "Could not find the previously archived listing to restore. Please retry, and if it keeps failing, email support.",
        },
        origin,
        config,
      );
      return true;
    }
    const restoreNote = `[${nowIso.slice(0, 10)}] Restored from archive via signup re-entry.`;
    restorePatch.notes = existing.notes ? `${existing.notes}\n${restoreNote}` : restoreNote;
    therapistCreated = await client
      .patch(archivedRestoreTarget.id)
      .set(restorePatch)
      .commit({ returnDocuments: true });
    // Sanity returns the post-patch doc here. Normalize slug shape so
    // downstream code (which reads therapistCreated.slug.current) keeps
    // working — the existing doc's slug field may already match this
    // shape, but defensively coerce.
    if (typeof therapistCreated?.slug === "string") {
      therapistCreated.slug = { current: therapistCreated.slug };
    }
  } else {
    therapistCreated = await client.create(therapistDraft);
  }

  // Link the application to the newly published therapist for the
  // audit trail. Non-fatal if this write fails — the therapist doc
  // is the source of truth for the live listing.
  try {
    await client
      .patch(applicationCreated._id)
      .set({ publishedTherapistId: therapistCreated._id })
      .commit();
  } catch (linkError) {
    log.error("Failed to link application -> therapist", {
      requestId,
      err: linkError?.message || String(linkError),
    });
  }

  // Admin email stays on the signup-instant path — it's the admin's
  // cue to audit the new listing.
  try {
    await notifyAdminOfSubmission(config, applicationCreated);
  } catch (emailError) {
    log.error("Failed to send admin-notify email for signup intake", {
      requestId,
      err: emailError?.message || String(emailError),
    });
  }

  // Compose Stripe checkout + portal claim token so the client can
  // fire a single redirect straight to Stripe. The portal claim
  // token embeds slug+email; post-Stripe return hits /portal?slug=X
  // &token=... and auto-accepts (#235).
  let stripeUrl = "";
  let checkoutError = "";
  try {
    const checkout = await createFeaturedCheckoutSession(config, {
      therapistSlug: therapistCreated.slug.current,
      customerEmail: email,
      plan: "paid_monthly",
      returnPath:
        "/portal?slug=" + encodeURIComponent(therapistCreated.slug.current) + "&stripe=success",
    });
    stripeUrl = (checkout && checkout.url) || "";
  } catch (error) {
    checkoutError = error && error.message ? error.message : "checkout_unavailable";
    log.error("Stripe checkout session failed at intake", {
      requestId,
      err: error?.message || String(error),
    });
  }

  const claimToken = buildPortalClaimToken(config, therapistCreated, email, {
    ttlMs: 7 * 24 * 60 * 60 * 1000,
  });

  sendJson(
    response,
    200,
    {
      ok: true,
      therapist_slug: therapistCreated.slug.current,
      therapist_id: therapistCreated._id,
      claim_token: claimToken,
      stripe_url: stripeUrl,
      stripe_error: checkoutError || undefined,
      license_verified_at: intakeBody.license_verified_at,
    },
    origin,
    config,
  );
  return true;
}

// POST /applications/free-path-selected — called from the signup
// plan-choice card when the therapist picks "List free for now"
// instead of starting a Stripe trial. The in-URL claim token returned
// by /applications/intake already lands them in the portal right now;
// this endpoint exists so they get a durable magic-login email as a
// way back in after their session cookie expires. Non-fatal if the
// email send fails — the client still redirects them into the portal
// on return.
async function applicationPostFreePathSelected(context) {
  const { client, config, origin, request, requestId, response } = context;
  const { parseBody, readPortalClaimToken, sendJson, sendPortalClaimLink } = context.deps;
  const body = await parseBody(request);
  const claimToken = String(body.claim_token || "").trim();
  if (!claimToken) {
    sendJson(response, 400, { error: "Missing claim_token." }, origin, config);
    return true;
  }
  const payload = readPortalClaimToken(config, claimToken);
  if (!payload || !payload.slug || !payload.email) {
    sendJson(response, 401, { error: "Invalid or expired claim token." }, origin, config);
    return true;
  }
  const therapist = await client.fetch(`*[_type == "therapist" && slug.current == $slug][0]`, {
    slug: payload.slug,
  });
  if (!therapist) {
    sendJson(response, 404, { error: "Listing not found." }, origin, config);
    return true;
  }
  const portalBaseUrl = config.portalBaseUrl;
  let emailSent = false;
  try {
    await sendPortalClaimLink(config, therapist, payload.email, portalBaseUrl);
    emailSent = true;
  } catch (error) {
    log.error("Failed to send free-path claim email", {
      requestId,
      err: error?.message || String(error),
    });
  }
  sendJson(response, 200, { ok: true, email_sent: emailSent }, origin, config);
  return true;
}

async function applicationPostApplications(context) {
  const { client, config, origin, request, requestId, response } = context;
  const {
    buildApplicationDocument,
    findDuplicateTherapistEntity,
    normalizeApplication,
    notifyAdminOfSubmission,
    parseBody,
    sendJson,
  } = context.deps;
  const rawBody = await parseBody(request);
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    sendJson(response, 400, { error: "Invalid application payload." }, origin, config);
    return true;
  }
  // Strip privileged linkage/verification fields from the untrusted public
  // body. published_therapist_id / target_therapist_id let a crafted
  // application target (and, on approval, createOrReplace-overwrite) an
  // arbitrary live therapist; licensure_verification would let an applicant
  // present a forged "DCA-verified" snapshot that gets published as
  // editorially_verified. Only the server-side /applications/intake flow —
  // which sets licensure_verification from an actual DCA response — is
  // trusted to populate these.
  const body = { ...rawBody };
  delete body.published_therapist_id;
  delete body.target_therapist_id;
  delete body.target_therapist_slug;
  delete body.licensure_verification;
  const duplicate = await findDuplicateTherapistEntity(client, body);
  if (duplicate) {
    const responsePayload =
      duplicate.kind === "therapist"
        ? {
            error:
              "This therapist already has a listing. Please claim or update the existing profile instead of creating a new application.",
            duplicate_kind: duplicate.kind,
            duplicate_id: duplicate.id,
            duplicate_slug: duplicate.slug,
            duplicate_name: duplicate.name,
            duplicate_reasons: duplicate.reasons,
            recommended_intake_type: "claim_existing",
          }
        : {
            error:
              "An application is already in progress for this therapist. Please continue that application instead of starting a new one.",
            duplicate_kind: duplicate.kind,
            duplicate_id: duplicate.id,
            duplicate_slug: duplicate.slug,
            duplicate_name: duplicate.name,
            duplicate_status: duplicate.status,
            duplicate_reasons: duplicate.reasons,
            recommended_intake_type: "update_existing",
          };
    sendJson(response, 409, responsePayload, origin, config);
    return true;
  }
  const document = await buildApplicationDocument(client, body);
  const created = await client.create(document);
  try {
    await notifyAdminOfSubmission(config, created);
  } catch (error) {
    log.error("Failed to send new-submission email", {
      requestId,
      err: error?.message || String(error),
    });
  }
  // Async DCA license verification — don't block the response
  runDcaVerification(client, config, created, body).catch(function (err) {
    log.error("DCA license verification failed", {
      id: created._id,
      err: err?.message || String(err),
    });
  });
  sendJson(response, 201, normalizeApplication(created), origin, config);
  return true;
}

// NOTE: The /applications/:id/revision (GET) and /applications/:id/revise
// (POST) endpoints previously lived here. They were unauthenticated and
// returned full applicant PII keyed only on a Sanity doc ID (no signed
// token), but were never wired up to any frontend caller. Removed to
// eliminate the latent PII-exposure surface. If we add a therapist-facing
// revision flow back, the new endpoints should mint a signed token at
// status-change time and require it on both reads and writes.

async function applicationUpdate(context, match) {
  const updateMatch = match;
  const { client, config, origin, request, response } = context;
  const {
    buildApplicationReviewEvent,
    getAuthorizedActor,
    isAuthorized,
    normalizeApplication,
    parseBody,
    sendJson,
    updateApplicationFields,
  } = context.deps;
  if (!isAuthorized(request, config)) {
    sendJson(response, 401, { error: "Unauthorized." }, origin, config);
    return true;
  }

  const applicationId = decodeURIComponent(updateMatch[1]);
  const existing = await client.getDocument(applicationId);
  if (!existing || existing._type !== "therapistApplication") {
    sendJson(response, 404, { error: "Application not found." }, origin, config);
    return true;
  }

  const body = await parseBody(request);
  const updated = await updateApplicationFields(client, applicationId, body);
  if (body.review_follow_up && typeof body.review_follow_up === "object") {
    const actorName = getAuthorizedActor(request, config) || "admin";
    await client.create(
      buildApplicationReviewEvent(existing, {
        eventType: "application_follow_up_updated",
        therapistId: existing.publishedTherapistId || existing.targetTherapistId || "",
        decision: "update_follow_up",
        reviewStatus: existing.status || "pending",
        actorName,
        rationale: String(body.review_follow_up.note || "").trim(),
        notes: String(body.review_follow_up.note || "").trim(),
        changedFields: ["reviewFollowUp"],
      }),
    );
  }
  sendJson(response, 200, normalizeApplication(updated), origin, config);
  return true;
}

async function applicationPostApplyLiveFields(context, match) {
  const applyLiveFieldsMatch = match;
  const { client, config, origin, request, response } = context;
  const {
    buildAppliedFieldReviewStatePatch,
    buildApplicationReviewEvent,
    buildTherapistApplicationFieldPatch,
    getAuthorizedActor,
    isAuthorized,
    normalizeApplication,
    parseBody,
    publishingHelpers,
    sendJson,
  } = context.deps;
  if (!isAuthorized(request, config)) {
    sendJson(response, 401, { error: "Unauthorized." }, origin, config);
    return true;
  }

  const applicationId = decodeURIComponent(applyLiveFieldsMatch[1]);
  const application = await client.getDocument(applicationId);
  if (!application || application._type !== "therapistApplication") {
    sendJson(response, 404, { error: "Application not found." }, origin, config);
    return true;
  }

  const body = await parseBody(request);
  const actorName = getAuthorizedActor(request, config) || "admin";
  const selectedFields = Array.isArray(body.fields) ? body.fields : [];
  if (!selectedFields.length) {
    sendJson(response, 400, { error: "No fields selected." }, origin, config);
    return true;
  }

  const therapistId =
    application.targetTherapistId ||
    application.publishedTherapistId ||
    (application.targetTherapistSlug ? `therapist-${application.targetTherapistSlug}` : "");
  if (!therapistId) {
    sendJson(
      response,
      409,
      { error: "This application is not linked to a live therapist yet." },
      origin,
      config,
    );
    return true;
  }

  const therapist = await client.getDocument(therapistId);
  if (!therapist || therapist._type !== "therapist") {
    sendJson(response, 404, { error: "Linked therapist not found." }, origin, config);
    return true;
  }

  const nowIso = new Date().toISOString();
  const nextPatch = buildTherapistApplicationFieldPatch(
    application,
    therapist,
    selectedFields,
    nowIso,
    publishingHelpers,
  );
  const fieldReviewStatePatch = buildAppliedFieldReviewStatePatch(selectedFields);
  if (!nextPatch.appliedFields.length) {
    sendJson(
      response,
      400,
      { error: "No supported changed fields were selected." },
      origin,
      config,
    );
    return true;
  }

  const transaction = client.transaction();
  transaction.patch(therapistId, function (patch) {
    return patch.set({
      ...nextPatch.patch,
      ...(Object.keys(fieldReviewStatePatch).length
        ? {
            fieldReviewStates: {
              ...(therapist.fieldReviewStates || {}),
              ...fieldReviewStatePatch,
            },
          }
        : {}),
    });
  });
  transaction.patch(applicationId, function (patch) {
    return patch
      .set({
        status: "approved",
        updatedAt: nowIso,
        publishedTherapistId: therapistId,
        ...(Object.keys(fieldReviewStatePatch).length
          ? {
              fieldReviewStates: {
                ...(application.fieldReviewStates || {}),
                ...fieldReviewStatePatch,
              },
            }
          : {}),
      })
      .setIfMissing({ revisionHistory: [] })
      .append("revisionHistory", [
        {
          _key: `${Date.now()}`,
          type: "applied_live_fields",
          at: nowIso,
          message: `Applied live fields: ${nextPatch.appliedFields.join(", ")}`,
        },
      ]);
  });
  transaction.create(
    buildApplicationReviewEvent(application, {
      eventType: "therapist_live_fields_applied",
      therapistId,
      decision: "apply_live_fields",
      actorName,
      rationale: body.rationale || `Applied live fields from application ${applicationId}`,
      notes: `Application ${applicationId} applied fields: ${nextPatch.appliedFields.join(", ")}`,
      changedFields: nextPatch.appliedFields,
    }),
  );

  await transaction.commit({ visibility: "sync" });
  const updatedTherapist = await client.getDocument(therapistId);
  const updatedApplication = await client.getDocument(applicationId);
  sendJson(
    response,
    200,
    {
      ok: true,
      therapist: updatedTherapist,
      application: normalizeApplication(updatedApplication),
      applied_fields: nextPatch.appliedFields,
    },
    origin,
    config,
  );
  return true;
}

async function applicationPostApprove(context, match) {
  const approveMatch = match;
  const { client, config, origin, request, requestId, response } = context;
  const {
    buildApplicationReviewEvent,
    buildPortalClaimToken,
    buildTherapistDocument,
    buildTherapistObservationDocuments,
    getAuthorizedActor,
    isAuthorized,
    notifyApplicantOfDecision,
    parseBody,
    publishingHelpers,
    sendJson,
    slugify,
  } = context.deps;
  if (!isAuthorized(request, config)) {
    sendJson(response, 401, { error: "Unauthorized." }, origin, config);
    return true;
  }

  const applicationId = decodeURIComponent(approveMatch[1]);
  const application = await client.getDocument(applicationId);
  if (!application || application._type !== "therapistApplication") {
    sendJson(response, 404, { error: "Application not found." }, origin, config);
    return true;
  }

  // Approval is not idempotent: it rebuilds the therapist doc from the
  // application via createOrReplace, so a second approve (stale admin tab,
  // double-click, concurrent reviewers) would wipe any portal edits made
  // since the first. Re-approving a *rejected* application stays allowed.
  if (application.status === "approved") {
    sendJson(
      response,
      409,
      {
        error:
          "This application was already approved. Re-approving would rebuild the live profile and overwrite edits made since.",
        therapistId: application.publishedTherapistId || "",
      },
      origin,
      config,
    );
    return true;
  }

  if (!String(application.licenseNumber || "").trim()) {
    sendJson(
      response,
      409,
      {
        error:
          "This application has no license number. Collect a verified license number before approving.",
      },
      origin,
      config,
    );
    return true;
  }

  const slug =
    application.submittedSlug ||
    slugify([application.name, application.city, application.state].filter(Boolean).join(" "));
  const therapistId = application.publishedTherapistId || `therapist-${slug}`;

  // Collision guard: the id is derived from name+city+state, so two
  // different providers can slugify to the same id. When this application
  // hasn't published before (no publishedTherapistId) but a live doc
  // already occupies the derived id, approving would createOrReplace —
  // silently replacing someone ELSE's live profile. Refuse and make the
  // admin disambiguate.
  if (!String(application.publishedTherapistId || "").trim()) {
    const occupant = await client.getDocument(therapistId);
    if (occupant) {
      sendJson(
        response,
        409,
        {
          error:
            "A live therapist profile already exists with this derived id (same name, city, and state). Approving would overwrite it. Adjust the applicant's identity fields or resolve the duplicate first.",
          therapistId,
        },
        origin,
        config,
      );
      return true;
    }
  }

  const actorName = getAuthorizedActor(request, config) || "admin";
  const body = await parseBody(request);

  const transaction = client.transaction();
  const therapistDocument = buildTherapistDocument(application, therapistId, publishingHelpers);
  transaction.createOrReplace(therapistDocument);
  buildTherapistObservationDocuments(therapistDocument).forEach(function (observation) {
    transaction.createOrReplace(observation);
  });
  transaction.delete(`drafts.${therapistId}`);
  transaction.patch(applicationId, function (patch) {
    return patch.set({
      status: "approved",
      updatedAt: new Date().toISOString(),
      publishedTherapistId: therapistId,
    });
  });
  transaction.create(
    buildApplicationReviewEvent(application, {
      eventType: "application_approved",
      therapistId,
      decision: "approve",
      reviewStatus: "approved",
      actorName,
      rationale: String(body.rationale || body.notes || "").trim(),
      notes: String(body.notes || "").trim(),
      changedFields: ["status", "publishedTherapistId"],
    }),
  );

  await transaction.commit({ visibility: "sync" });

  // Send the applicant an approval email with a portal magic link
  // so they can finish their profile without hunting for the portal
  // themselves. Uses the just-created therapist doc to build the
  // token, 7-day TTL, bound to the applicant's email. Same token
  // flow as /portal/quick-claim — the portal treats either path
  // identically once the token is verified.
  let approvalEmailFailed = false;
  try {
    const portalBaseUrl = config.portalBaseUrl;
    // buildTherapistDocument returns the doc we just wrote; read
    // it back from Sanity so the email has the canonical slug
    // structure the token builder expects.
    const approvedTherapist = await client.getDocument(therapistId);
    await notifyApplicantOfDecision(config, application, "approved", {
      therapist: approvedTherapist,
      portalBaseUrl,
      buildPortalClaimToken,
    });
  } catch (error) {
    approvalEmailFailed = true;
    log.error("Failed to send approval email", {
      requestId,
      err: error?.message || String(error),
    });
  }

  sendJson(
    response,
    200,
    {
      ok: true,
      therapistId,
      ...(approvalEmailFailed
        ? {
            email_warning:
              "Approval email failed to send. The therapist will need a manual portal link.",
          }
        : {}),
    },
    origin,
    config,
  );
  return true;
}

async function applicationPostReject(context, match) {
  const rejectMatch = match;
  const { client, config, origin, request, requestId, response } = context;
  const {
    buildApplicationReviewEvent,
    getAuthorizedActor,
    isAuthorized,
    notifyApplicantOfDecision,
    parseBody,
    sendJson,
  } = context.deps;
  if (!isAuthorized(request, config)) {
    sendJson(response, 401, { error: "Unauthorized." }, origin, config);
    return true;
  }

  const applicationId = decodeURIComponent(rejectMatch[1]);
  const application = await client.getDocument(applicationId);
  // Guard the document type before patching status:"rejected". Without this,
  // a stale/mistyped id pointing at a live therapist doc would stamp
  // status:"rejected" onto it (a meaningful field there), and a missing id
  // would 500 on commit instead of returning a clean 404.
  if (!application || application._type !== "therapistApplication") {
    sendJson(response, 404, { error: "Application not found." }, origin, config);
    return true;
  }
  const actorName = getAuthorizedActor(request, config) || "admin";
  const body = await parseBody(request);
  await client
    .transaction()
    .patch(applicationId, function (patch) {
      return patch.set({ status: "rejected", updatedAt: new Date().toISOString() });
    })
    .create(
      buildApplicationReviewEvent(
        application || {
          _id: applicationId,
          providerId: "",
          publishedTherapistId: "",
          targetTherapistId: "",
        },
        {
          eventType: "application_rejected",
          decision: "reject",
          reviewStatus: "rejected",
          actorName,
          rationale: String(body.rationale || body.notes || "").trim(),
          notes: String(body.notes || "").trim(),
          changedFields: ["status"],
        },
      ),
    )
    .commit({ visibility: "sync" });

  let rejectionEmailFailed = false;
  if (application) {
    try {
      await notifyApplicantOfDecision(config, application, "rejected");
    } catch (error) {
      rejectionEmailFailed = true;
      log.error("Failed to send rejection email", {
        requestId,
        err: error?.message || String(error),
      });
    }
  }

  sendJson(
    response,
    200,
    {
      ok: true,
      ...(rejectionEmailFailed ? { email_warning: "Rejection email failed to send." } : {}),
    },
    origin,
    config,
  );
  return true;
}

// Sentinel license for dev-only bypass. Matches what the intake handler checks.
const DEV_SENTINEL_LICENSE = "TEST-0000";

function isDevBypassEnabled(config) {
  if (process.env.NODE_ENV !== "development") return false;
  if (config && config.allowDevLogin === true) return true;
  return process.env.ALLOW_DEV_LOGIN === "true";
}

// Builds a fake passing verification result whose licenseeName is derived
// from the submitted name so the name-match gate passes automatically.
function buildSentinelVerification(fullName) {
  const parts = String(fullName || "Dev Tester")
    .trim()
    .split(/\s+/);
  return {
    verified: true,
    isActive: true,
    hasDiscipline: false,
    licenseeName: {
      firstName: parts[0] || "Dev",
      lastName: parts.slice(1).join(" ") || "Tester",
    },
    licensureVerification: { primaryStatus: "ACTIVE", licenseType: "DEV_TEST" },
    licenseTypeLabel: "DEV_TEST",
  };
}

async function runDcaVerification(client, config, application, body) {
  const { verifyLicense, resolveLicenseTypeCode } = await import("./dca-license-client.mjs");
  const licenseType = body.license_type || "";
  const licenseNumber = body.license_number || application.licenseNumber || "";
  const typeCode = resolveLicenseTypeCode(licenseType);
  if (!typeCode || !licenseNumber) return;

  const result = await verifyLicense(config, typeCode, licenseNumber);
  if (!result.verified) {
    log.info("DCA verification not confirmed", { id: application._id, error: result.error });
    return;
  }

  await client
    .patch(application._id)
    .set({ licensureVerification: result.licensureVerification })
    .commit();
  log.info("DCA license verified", {
    id: application._id,
    status: result.licensureVerification.primaryStatus,
  });
}
