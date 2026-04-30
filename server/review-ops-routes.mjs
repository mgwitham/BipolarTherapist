// Lifecycle values that allow a profile to be Live; everything else
// implies the listing should be hidden from public queries.
const APPROVED_LIFECYCLE = "approved";
const LISTED_VISIBILITY = "listed";

// Fields whose changes are worth recording in the audit log. These are
// the fields that affect Live status or are high-stakes admin signals.
const AUDIT_TRACKED_FIELDS = [
  "lifecycle",
  "visibilityIntent",
  "listingActive",
  "status",
  "acceptingNewPatients",
  "name",
  "email",
  "phone",
  "licenseNumber",
];

function shouldBeListingActive(lifecycle, visibilityIntent) {
  return lifecycle === APPROVED_LIFECYCLE && visibilityIntent === LISTED_VISIBILITY;
}

function diffTrackedFields(before, after) {
  const changes = {};
  for (const field of AUDIT_TRACKED_FIELDS) {
    const b = before[field];
    const a = after[field];
    if (b !== a) {
      changes[field] = { before: b ?? null, after: a ?? null };
    }
  }
  return changes;
}

export async function handleOpsRoutes(context) {
  const { client, config, deps, origin, request, response, routePath } = context;

  const {
    addDays,
    buildFieldTrustMeta,
    buildLicensureOpsEvent,
    buildTherapistOpsEvent,
    computeTherapistVerificationMeta,
    getAuthorizedActor,
    isAuthorized,
    parseBody,
    sendJson,
  } = deps;

  const therapistPatchMatch = routePath.match(/^\/therapists\/([^/]+)$/);
  if (request.method === "PATCH" && therapistPatchMatch) {
    if (!isAuthorized(request, config)) {
      sendJson(response, 401, { error: "Unauthorized." }, origin, config);
      return true;
    }
    const therapistId = decodeURIComponent(therapistPatchMatch[1]);
    const therapist = await client.getDocument(therapistId);
    if (!therapist || therapist._type !== "therapist") {
      sendJson(response, 404, { error: "Therapist not found." }, origin, config);
      return true;
    }
    const body = await parseBody(request);
    const patchFields = {};
    const stringFields = [
      "name",
      "credentials",
      "title",
      "practiceName",
      "city",
      "state",
      "zip",
      "licenseState",
      "licenseNumber",
      "email",
      "phone",
      "website",
      "bookingUrl",
      "careApproach",
      "estimatedWaitTime",
    ];
    stringFields.forEach(function (f) {
      if (typeof body[f] === "string") patchFields[f] = body[f];
    });
    const arrayFields = [
      "specialties",
      "treatmentModalities",
      "clientPopulations",
      "insuranceAccepted",
      "languages",
      "telehealthStates",
    ];
    arrayFields.forEach(function (f) {
      if (Array.isArray(body[f])) patchFields[f] = body[f];
    });
    const boolFields = [
      "acceptsTelehealth",
      "acceptsInPerson",
      "acceptingNewPatients",
      "slidingScale",
      "medicationManagement",
    ];
    boolFields.forEach(function (f) {
      if (typeof body[f] === "boolean") patchFields[f] = body[f];
    });

    // Lifecycle / visibility — admin's primary intent signals. Validated
    // against a closed enum; unknown values are silently dropped.
    const allowedLifecycle = new Set([
      "draft",
      "in_review",
      "awaiting_confirmation",
      "approved",
      "paused",
      "archived",
    ]);
    const allowedVisibility = new Set(["listed", "hidden"]);
    if (typeof body.lifecycle === "string" && allowedLifecycle.has(body.lifecycle)) {
      patchFields.lifecycle = body.lifecycle;
    }
    if (typeof body.visibilityIntent === "string" && allowedVisibility.has(body.visibilityIntent)) {
      patchFields.visibilityIntent = body.visibilityIntent;
    }

    if (Object.keys(patchFields).length === 0) {
      sendJson(response, 400, { error: "No valid fields to update." }, origin, config);
      return true;
    }

    // listingActive coupling: keep the legacy directory-query flag in sync
    // with the lifecycle/visibility intent. If admin is approving a listed
    // profile, also flip status to active. If admin is hiding/pausing/
    // archiving, just turn listingActive off and leave status alone — the
    // recovery path can re-set it explicitly. See shared/profile-live-status.mjs
    // for the canonical Live computation; listingActive is now a derived
    // flag that exists for backward compatibility with the public GROQ
    // query in assets/cms.js.
    const nextLifecycle = patchFields.lifecycle ?? therapist.lifecycle;
    const nextVisibility = patchFields.visibilityIntent ?? therapist.visibilityIntent;
    const nextShouldBeActive = shouldBeListingActive(nextLifecycle, nextVisibility);
    const wasShouldBeActive = shouldBeListingActive(
      therapist.lifecycle,
      therapist.visibilityIntent,
    );
    if (nextShouldBeActive !== wasShouldBeActive) {
      patchFields.listingActive = nextShouldBeActive;
      if (nextShouldBeActive) {
        patchFields.status = "active";
      }
    }

    // Build the post-save snapshot of tracked fields and diff against the
    // current document. One audit entry captures the whole save (covers
    // both routine edits and high-impact changes; the reason field
    // distinguishes them when the client sends one).
    const after = { ...therapist, ...patchFields };
    const changes = diffTrackedFields(therapist, after);
    const actor = getAuthorizedActor(request, config) || "admin";
    const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : "";

    const transaction = client.transaction();
    transaction.patch(therapistId, function (patch) {
      let p = patch.set(patchFields);
      if (Object.keys(changes).length > 0) {
        p = p.setIfMissing({ auditLog: [] }).append("auditLog", [
          {
            _type: "object",
            timestamp: new Date().toISOString(),
            actor,
            action: "edit",
            before: JSON.stringify(
              Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.before])),
            ),
            after: JSON.stringify(
              Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.after])),
            ),
            reason,
          },
        ]);
      }
      return p;
    });
    await transaction.commit({ visibility: "sync" });
    const updated = await client.getDocument(therapistId);
    sendJson(response, 200, { ok: true, therapist: updated }, origin, config);
    return true;
  }

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
    const actorName = getAuthorizedActor(request, config) || "admin";
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
        actorName,
        rationale: notes,
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
    const actorName = getAuthorizedActor(request, config) || "admin";
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
        actorName,
        rationale: notes,
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
