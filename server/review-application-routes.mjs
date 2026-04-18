export async function handleApplicationRoutes(context) {
  const { client, config, deps, origin, request, response, routePath } = context;

  const {
    buildApplicationDocument,
    buildAppliedFieldReviewStatePatch,
    buildApplicationReviewEvent,
    buildRevisionFieldUpdates,
    buildTherapistApplicationFieldPatch,
    buildTherapistDocument,
    buildTherapistObservationDocuments,
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

    try {
      await notifyApplicantOfDecision(config, application, "approved");
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
