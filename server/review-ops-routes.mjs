export async function handleOpsRoutes(context) {
  const {
    client,
    config,
    deps,
    origin,
    request,
    response,
    routePath,
  } = context;

  const {
    addDays,
    buildFieldTrustMeta,
    buildLicensureOpsEvent,
    buildTherapistOpsEvent,
    computeTherapistVerificationMeta,
    isAuthorized,
    parseBody,
    sendJson,
  } = deps;

  const therapistOpsMatch = routePath.match(/^\/therapists\/([^/]+)\/ops$/);
  if (request.method === "POST" && therapistOpsMatch) {
    if (!isAuthorized(request, config)) {
      sendJson(response, 401, { error: "Unauthorized." }, origin, config);
      return true;
    }

    const therapistId = decodeURIComponent(therapistOpsMatch[1]);
    const therapist = await client.getDocument(therapistId);
    if (!therapist || therapist._type !== "therapist") {
      sendJson(response, 404, { error: "Therapist not found." }, origin, config);
      return true;
    }

    const body = await parseBody(request);
    const decision = String(body.decision || "").trim();
    const notes = String(body.notes || "").trim();
    const allowedDecisions = new Set(["mark_reviewed", "snooze_7d", "snooze_30d"]);

    if (!allowedDecisions.has(decision)) {
      sendJson(response, 400, { error: "Unsupported therapist ops decision." }, origin, config);
      return true;
    }

    const nowIso = new Date().toISOString();
    let patchFields;
    let eventType;
    let changedFields;

    if (decision === "mark_reviewed") {
      const nextTherapist = {
        ...therapist,
        sourceReviewedAt: nowIso,
      };
      const verificationMeta = computeTherapistVerificationMeta({
        ...nextTherapist,
      });
      patchFields = {
        sourceReviewedAt: nowIso,
        lastOperationalReviewAt: verificationMeta.lastOperationalReviewAt,
        nextReviewDueAt: verificationMeta.nextReviewDueAt,
        verificationPriority: verificationMeta.verificationPriority,
        verificationLane: verificationMeta.verificationLane,
        dataCompletenessScore: verificationMeta.dataCompletenessScore,
        fieldTrustMeta: buildFieldTrustMeta(nextTherapist),
      };
      eventType = "therapist_review_completed";
      changedFields = [
        "sourceReviewedAt",
        "lastOperationalReviewAt",
        "nextReviewDueAt",
        "verificationPriority",
        "verificationLane",
        "dataCompletenessScore",
        "fieldTrustMeta",
      ];
    } else {
      const snoozeDays = decision === "snooze_30d" ? 30 : 7;
      patchFields = {
        nextReviewDueAt: addDays(nowIso, snoozeDays),
        verificationLane: "refresh_soon",
      };
      eventType = "therapist_review_deferred";
      changedFields = ["nextReviewDueAt", "verificationLane"];
    }

    const transaction = client.transaction();
    transaction.patch(therapistId, function (patch) {
      return patch.set(patchFields);
    });
    transaction.create(
      buildTherapistOpsEvent(therapist, {
        eventType,
        decision,
        notes,
        changedFields,
      }),
    );

    await transaction.commit({ visibility: "sync" });
    const updatedTherapist = await client.getDocument(therapistId);
    sendJson(response, 200, { ok: true, therapist: updatedTherapist }, origin, config);
    return true;
  }

  const licensureOpsMatch = routePath.match(/^\/licensure-records\/([^/]+)\/ops$/);
  if (request.method === "POST" && licensureOpsMatch) {
    if (!isAuthorized(request, config)) {
      sendJson(response, 401, { error: "Unauthorized." }, origin, config);
      return true;
    }

    const recordId = decodeURIComponent(licensureOpsMatch[1]);
    const record = await client.getDocument(recordId);
    if (!record || record._type !== "licensureRecord") {
      sendJson(response, 404, { error: "Licensure record not found." }, origin, config);
      return true;
    }

    const body = await parseBody(request);
    const decision = String(body.decision || "").trim();
    const notes = String(body.notes || "").trim();
    const allowedDecisions = new Set(["snooze_7d", "snooze_30d", "unsnooze_now"]);
    if (!allowedDecisions.has(decision)) {
      sendJson(response, 400, { error: "Unsupported licensure ops decision." }, origin, config);
      return true;
    }

    const nowIso = new Date().toISOString();
    let patchFields;
    let changedFields;
    let eventType;

    if (decision === "unsnooze_now") {
      patchFields = {
        deferredUntilAt: "",
        nextRefreshDueAt: nowIso,
        refreshStatus:
          record.refreshStatus === "healthy" ? "needs_refresh" : record.refreshStatus || "queued",
      };
      changedFields = ["deferredUntilAt", "nextRefreshDueAt", "refreshStatus"];
      eventType = "licensure_refresh_deferred";
    } else {
      const snoozeDays = decision === "snooze_30d" ? 30 : 7;
      patchFields = {
        deferredUntilAt: addDays(nowIso, snoozeDays),
        nextRefreshDueAt: addDays(nowIso, snoozeDays),
        refreshStatus:
          record.refreshStatus === "failed" ? "needs_refresh" : record.refreshStatus || "queued",
      };
      changedFields = ["deferredUntilAt", "nextRefreshDueAt", "refreshStatus"];
      eventType = "licensure_refresh_deferred";
    }

    const transaction = client.transaction();
    transaction.patch(recordId, function (patch) {
      return patch.set(patchFields);
    });
    transaction.create(
      buildLicensureOpsEvent(record, {
        eventType,
        decision,
        notes,
        changedFields,
      }),
    );

    await transaction.commit({ visibility: "sync" });
    const updatedRecord = await client.getDocument(recordId);
    sendJson(response, 200, { ok: true, licensureRecord: updatedRecord }, origin, config);
    return true;
  }

  return false;
}
