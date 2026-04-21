export async function handleApplicationRoutes(context) {
  const { client, config, deps, origin, request, response, routePath, url } = context;

  const {
    buildApplicationDocument,
    buildAppliedFieldReviewStatePatch,
    buildApplicationReviewEvent,
    buildPortalClaimToken,
    buildRevisionFieldUpdates,
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
  } = deps;

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
  if (request.method === "POST" && routePath === "/applications/intake") {
    const body = await parseBody(request);
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim();
    const licenseNumber = String(body.license_number || "").trim();
    const treatsBipolar =
      body.treats_bipolar === true || body.treats_bipolar === "true" || body.treats_bipolar === 1;

    if (!name || !email || !licenseNumber) {
      sendJson(
        response,
        400,
        { error: "Full name, email, and CA license number are all required." },
        origin,
        config,
      );
      return true;
    }
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

    // Stub the narrative fields the full-form /applications endpoint
    // expects. Empty strings would fail schema validation; these get
    // scrubbed when buildTherapistDocument runs and are replaced by
    // the therapist's own content via the portal editor.
    const STUB_VALUE = "Pending — completed after approval.";
    const intakeBody = {
      name: name,
      email: email,
      license_number: licenseNumber,
      license_state: "CA",
      state: "CA",
      city: String(body.city || "").trim(),
      zip: String(body.zip || "").trim(),
      credentials: String(body.credentials || "").trim() || "Pending",
      bio: STUB_VALUE,
      care_approach: STUB_VALUE,
      intake_source: "signup_instant_checkout",
      submission_intent: "intake",
    };

    const duplicate = await findDuplicateTherapistEntity(client, intakeBody);
    if (duplicate) {
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

    // Synchronous DCA verification. Signup only collects the license
    // number (no type dropdown), so we race all 6 California license
    // types in parallel and take the first verified hit. ~1-2s end to
    // end vs ~2-3 day human review the old flow had.
    let verification;
    try {
      verification = await verifyLicenseAcrossCaTypes(config, licenseNumber);
    } catch (error) {
      console.error("DCA verification threw at intake", error);
      verification = { verified: false, error: "dca_unreachable" };
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

    intakeBody.licensure_verification = verification.licensureVerification;
    intakeBody.license_type = verification.licenseTypeLabel || "";
    // Persist primaryStatus so the admin audit trail shows DCA
    // confirmed the license was active (or in what state) at signup.
    intakeBody.license_verified_at = new Date().toISOString();

    // Build the application doc as an audit trail. Status is
    // auto_approved since the license passed verification and the
    // therapist is going straight to publish. publishedTherapistId
    // is set once the therapist doc is created below.
    const applicationDocument = await buildApplicationDocument(client, intakeBody);
    applicationDocument.status = "auto_approved";
    applicationDocument.reviewedAt = new Date().toISOString();
    applicationDocument.licensureVerification = verification.licensureVerification;
    const applicationCreated = await client.create(applicationDocument);

    // Build the therapist doc directly. Override listingActive=false
    // + status=pending_profile so the stub-bio listing stays out of
    // the public directory until the therapist saves a real bio from
    // the portal editor.
    const therapistDraft = buildTherapistDocument(
      { ...applicationCreated, licensureVerification: verification.licensureVerification },
      undefined,
      publishingHelpers,
    );
    therapistDraft.listingActive = false;
    therapistDraft.status = "pending_profile";
    therapistDraft.claimStatus = "unclaimed";
    therapistDraft.intakeSource = "signup_instant_checkout";
    // Cached copies so admin filters + listings workspace can surface
    // these therapists cleanly without a join.
    therapistDraft.signupCompletedAt = new Date().toISOString();

    const therapistCreated = await client.create(therapistDraft);

    // Link the application to the newly published therapist for the
    // audit trail. Non-fatal if this write fails — the therapist doc
    // is the source of truth for the live listing.
    try {
      await client
        .patch(applicationCreated._id)
        .set({ publishedTherapistId: therapistCreated._id })
        .commit();
    } catch (linkError) {
      console.error("Failed to link application -> therapist", linkError);
    }

    // Admin email stays on the signup-instant path — it's the admin's
    // cue to audit the new listing.
    try {
      await notifyAdminOfSubmission(config, applicationCreated);
    } catch (emailError) {
      console.error("Failed to send admin-notify email for signup intake.", emailError);
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
          "/portal.html?slug=" +
          encodeURIComponent(therapistCreated.slug.current) +
          "&stripe=success",
      });
      stripeUrl = (checkout && checkout.url) || "";
    } catch (error) {
      checkoutError = error && error.message ? error.message : "checkout_unavailable";
      console.error("Stripe checkout session failed at intake", error);
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

  if (request.method === "POST" && routePath === "/applications") {
    const body = await parseBody(request);
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
      console.error("Failed to send new-submission email.", error);
    }
    // Async DCA license verification — don't block the response
    runDcaVerification(client, config, created, body).catch(function (err) {
      console.error("DCA license verification failed for " + created._id, err);
    });
    sendJson(response, 201, normalizeApplication(created), origin, config);
    return true;
  }

  const revisionFetchMatch = routePath.match(/^\/applications\/([^/]+)\/revision$/);
  if (request.method === "GET" && revisionFetchMatch) {
    const applicationId = decodeURIComponent(revisionFetchMatch[1]);
    const application = await client.getDocument(applicationId);
    if (!application || application._type !== "therapistApplication") {
      sendJson(response, 404, { error: "Application not found." }, origin, config);
      return true;
    }

    if (application.status !== "requested_changes") {
      sendJson(
        response,
        409,
        { error: "This application is not currently open for revision." },
        origin,
        config,
      );
      return true;
    }

    sendJson(response, 200, normalizeApplication(application), origin, config);
    return true;
  }

  const revisionSubmitMatch = routePath.match(/^\/applications\/([^/]+)\/revise$/);
  if (request.method === "POST" && revisionSubmitMatch) {
    const applicationId = decodeURIComponent(revisionSubmitMatch[1]);
    const application = await client.getDocument(applicationId);
    if (!application || application._type !== "therapistApplication") {
      sendJson(response, 404, { error: "Application not found." }, origin, config);
      return true;
    }

    if (application.status !== "requested_changes") {
      sendJson(
        response,
        409,
        { error: "This application is not currently open for revision." },
        origin,
        config,
      );
      return true;
    }

    const body = await parseBody(request);
    validateRevisionInput(body);
    const timestamp = new Date().toISOString();
    const updated = await client
      .patch(applicationId)
      .set({
        ...(await buildRevisionFieldUpdates(client, body, application)),
        status: "pending",
        reviewRequestMessage: "",
        updatedAt: timestamp,
        revisionCount: (Number(application.revisionCount || 0) || 0) + 1,
      })
      .setIfMissing({ revisionHistory: [] })
      .append("revisionHistory", [
        {
          _key: `${Date.now()}`,
          type: "resubmitted",
          at: timestamp,
          message: "Therapist submitted an updated revision.",
        },
      ])
      .commit({ visibility: "sync" });

    sendJson(response, 200, normalizeApplication(updated), origin, config);
    return true;
  }

  const updateMatch = routePath.match(/^\/applications\/([^/]+)$/);
  if ((request.method === "PATCH" || request.method === "POST") && updateMatch) {
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

  const applyLiveFieldsMatch = routePath.match(/^\/applications\/([^/]+)\/apply-live-fields$/);
  if (request.method === "POST" && applyLiveFieldsMatch) {
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

  const approveMatch = routePath.match(/^\/applications\/([^/]+)\/approve$/);
  if (request.method === "POST" && approveMatch) {
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
    try {
      const portalBaseUrl =
        url && url.protocol && url.host
          ? `${url.protocol}//${url.host}`.replace(/\/+$/, "")
          : String(config.stripeReturnUrlBase || "").replace(/\/+$/, "");
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
      console.error("Failed to send approval email.", error);
    }

    sendJson(response, 200, { ok: true, therapistId }, origin, config);
    return true;
  }

  const rejectMatch = routePath.match(/^\/applications\/([^/]+)\/reject$/);
  if (request.method === "POST" && rejectMatch) {
    if (!isAuthorized(request, config)) {
      sendJson(response, 401, { error: "Unauthorized." }, origin, config);
      return true;
    }

    const applicationId = decodeURIComponent(rejectMatch[1]);
    const application = await client.getDocument(applicationId);
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

    if (application) {
      try {
        await notifyApplicantOfDecision(config, application, "rejected");
      } catch (error) {
        console.error("Failed to send rejection email.", error);
      }
    }

    sendJson(response, 200, { ok: true }, origin, config);
    return true;
  }

  return false;
}

async function runDcaVerification(client, config, application, body) {
  var { verifyLicense, resolveLicenseTypeCode } = await import("./dca-license-client.mjs");
  var licenseType = body.license_type || "";
  var licenseNumber = body.license_number || application.licenseNumber || "";
  var typeCode = resolveLicenseTypeCode(licenseType);
  if (!typeCode || !licenseNumber) return;

  var result = await verifyLicense(config, typeCode, licenseNumber);
  if (!result.verified) {
    console.log("DCA verification not confirmed for " + application._id + ": " + result.error);
    return;
  }

  await client
    .patch(application._id)
    .set({ licensureVerification: result.licensureVerification })
    .commit();
  console.log(
    "DCA license verified for " +
      application._id +
      ": " +
      result.licensureVerification.primaryStatus,
  );
}

// Synchronous fan-out DCA verification for the signup-intake path.
// Signup only collects a license number (no type dropdown — adding a
// dropdown would be the single biggest friction point on a 5-field
// form), so we race all 6 CA license types in parallel and return the
// first verified match. Only one type can hit for a given license
// number since license numbers aren't unique across types but the
// DCA search will return zero results for a mismatched type.
//
// Returns { verified, licensureVerification, licenseTypeLabel } on
// hit, or { verified: false, error } on miss / all-types-fail.
async function verifyLicenseAcrossCaTypes(config, licenseNumber) {
  const { verifyLicense, getLicenseTypeOptions } = await import("./dca-license-client.mjs");
  const types = getLicenseTypeOptions();
  if (!types || !types.length) {
    return { verified: false, error: "no_license_types_configured" };
  }
  const results = await Promise.all(
    types.map(function (option) {
      return verifyLicense(config, option.code, licenseNumber)
        .then(function (r) {
          return { option, result: r };
        })
        .catch(function (error) {
          return { option, result: { verified: false, error: String(error) } };
        });
    }),
  );
  const hit = results.find(function (r) {
    return r.result && r.result.verified;
  });
  if (!hit) {
    const lastError = (results[0] && results[0].result && results[0].result.error) || "not_found";
    return { verified: false, error: lastError };
  }
  return {
    verified: true,
    licensureVerification: hit.result.licensureVerification,
    licenseTypeLabel: hit.option.label,
  };
}
