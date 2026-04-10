export async function handleCandidateRoutes(context) {
  const { client, config, deps, origin, request, response, routePath } = context;

  const {
    addDays,
    buildCandidateReviewEvent,
    buildFieldTrustMeta,
    buildTherapistDocumentFromCandidate,
    buildTherapistObservationDocuments,
    computeCandidateReviewMeta,
    computeTherapistVerificationMeta,
    getAuthorizedActor,
    isAuthorized,
    mergeLicensureVerification,
    normalizeLicensureVerification,
    normalizePortableCandidate,
    parseBody,
    publishingHelpers,
    sendJson,
  } = deps;

  const candidateDecisionMatch = routePath.match(/^\/candidates\/([^/]+)\/decision$/);
  const candidateUpdateMatch = routePath.match(/^\/candidates\/([^/]+)$/);
  if ((request.method === "PATCH" || request.method === "POST") && candidateUpdateMatch) {
    if (!isAuthorized(request, config)) {
      sendJson(response, 401, { error: "Unauthorized." }, origin, config);
      return true;
    }

    const candidateId = decodeURIComponent(candidateUpdateMatch[1]);
    const candidate = await client.getDocument(candidateId);
    if (!candidate || candidate._type !== "therapistCandidate") {
      sendJson(response, 404, { error: "Candidate not found." }, origin, config);
      return true;
    }

    const body = await parseBody(request);
    const allowedUpdates = {};
    if (typeof body.notes === "string") {
      allowedUpdates.notes = body.notes.trim();
    }
    if (body.review_follow_up && typeof body.review_follow_up === "object") {
      const assigneeName = String(
        body.review_follow_up.assignee_name || body.review_follow_up.assignee || "",
      ).trim();
      allowedUpdates.reviewFollowUp = {
        status: String(body.review_follow_up.status || "open").trim() || "open",
        note: String(body.review_follow_up.note || "").trim(),
        assigneeId: String(body.review_follow_up.assignee_id || "").trim(),
        assigneeName: assigneeName,
        assignee: assigneeName,
        dueAt: String(body.review_follow_up.due_at || "").trim(),
        updatedAt: new Date().toISOString(),
      };
    }
    if (!Object.keys(allowedUpdates).length) {
      sendJson(
        response,
        400,
        { error: "No valid candidate updates were provided." },
        origin,
        config,
      );
      return true;
    }

    allowedUpdates.lastReviewedAt = candidate.lastReviewedAt || "";
    const updated = await client
      .patch(candidateId)
      .set(allowedUpdates)
      .commit({ visibility: "sync" });
    if (body.review_follow_up && typeof body.review_follow_up === "object") {
      await client.create(
        buildCandidateReviewEvent(candidate, {
          eventType: "candidate_follow_up_updated",
          decision: "update_follow_up",
          reviewStatus: candidate.reviewStatus || "queued",
          publishRecommendation: candidate.publishRecommendation || "",
          actorName: getAuthorizedActor(request, config) || "admin",
          rationale: String(body.review_follow_up.note || "").trim(),
          notes: String(body.review_follow_up.note || "").trim(),
          changedFields: ["reviewFollowUp"],
        }),
      );
    }
    sendJson(
      response,
      200,
      normalizePortableCandidate(updated, {
        normalizeLicensureVerification,
      }),
      origin,
      config,
    );
    return true;
  }

  if (!(request.method === "POST" && candidateDecisionMatch)) {
    return false;
  }

  if (!isAuthorized(request, config)) {
    sendJson(response, 401, { error: "Unauthorized." }, origin, config);
    return true;
  }

  const candidateId = decodeURIComponent(candidateDecisionMatch[1]);
  const candidate = await client.getDocument(candidateId);
  if (!candidate || candidate._type !== "therapistCandidate") {
    sendJson(response, 404, { error: "Candidate not found." }, origin, config);
    return true;
  }

  const body = await parseBody(request);
  const decision = String(body.decision || "").trim();
  const notes = String(body.notes || "").trim();
  const allowedDecisions = new Set([
    "mark_ready",
    "needs_review",
    "needs_confirmation",
    "archive",
    "reject_duplicate",
    "merge_to_therapist",
    "merge_to_application",
    "publish",
  ]);

  if (!allowedDecisions.has(decision)) {
    sendJson(response, 400, { error: "Unsupported candidate decision." }, origin, config);
    return true;
  }

  const now = new Date().toISOString();
  const actorName = getAuthorizedActor(request, config) || "admin";
  const historyEntry = {
    _key: `${Date.now()}`,
    type: "review_decision",
    at: now,
    decision,
    note: notes,
  };

  let reviewStatus = candidate.reviewStatus || "queued";
  let publishRecommendation = candidate.publishRecommendation || "";
  let dedupeStatus = candidate.dedupeStatus || "unreviewed";
  let eventType = "candidate_reviewed";
  let therapistId = "";
  let applicationId = "";
  const changedFields = [
    "reviewStatus",
    "publishRecommendation",
    "notes",
    "reviewHistory",
    "reviewLane",
    "reviewPriority",
    "nextReviewDueAt",
    "lastReviewedAt",
  ];

  if (decision === "mark_ready") {
    reviewStatus = "ready_to_publish";
    publishRecommendation = "ready";
  } else if (decision === "needs_review") {
    reviewStatus = "needs_review";
  } else if (decision === "needs_confirmation") {
    reviewStatus = "needs_confirmation";
    publishRecommendation = "needs_confirmation";
  } else if (decision === "archive") {
    reviewStatus = "archived";
    publishRecommendation = "hold";
    eventType = "candidate_archived";
  } else if (decision === "reject_duplicate") {
    reviewStatus = "archived";
    publishRecommendation = "reject";
    dedupeStatus = "rejected_duplicate";
    eventType = "candidate_marked_duplicate";
    changedFields.push("dedupeStatus");
  } else if (decision === "merge_to_therapist") {
    therapistId = candidate.matchedTherapistId || "";
    if (!therapistId) {
      sendJson(
        response,
        409,
        { error: "This candidate is not linked to an existing therapist yet." },
        origin,
        config,
      );
      return true;
    }
    reviewStatus = "archived";
    publishRecommendation = "hold";
    dedupeStatus = "merged";
    eventType = "candidate_merged";
    changedFields.push("matchedTherapistId", "dedupeStatus");
  } else if (decision === "publish") {
    const nextTherapist = buildTherapistDocumentFromCandidate(
      candidate,
      candidate.matchedTherapistId,
      publishingHelpers,
    );
    therapistId = nextTherapist._id;
    reviewStatus = "published";
    publishRecommendation = "ready";
    eventType = "candidate_published";
    changedFields.push("publishedTherapistId", "publishedAt", "matchedTherapistId");
  } else if (decision === "merge_to_application") {
    applicationId = candidate.matchedApplicationId || "";
    if (!applicationId) {
      sendJson(
        response,
        409,
        { error: "This candidate is not linked to an existing application yet." },
        origin,
        config,
      );
      return true;
    }
    reviewStatus = "archived";
    publishRecommendation = "hold";
    dedupeStatus = "merged";
    eventType = "candidate_merged";
    changedFields.push("matchedApplicationId", "dedupeStatus");
  }

  const reviewMeta = computeCandidateReviewMeta({
    ...candidate,
    reviewStatus,
    publishRecommendation,
    dedupeStatus,
  });

  const transaction = client.transaction();
  if (decision === "publish") {
    const therapistDocument = buildTherapistDocumentFromCandidate(
      candidate,
      therapistId,
      publishingHelpers,
    );
    transaction.createOrReplace(therapistDocument);
    buildTherapistObservationDocuments(therapistDocument).forEach(function (observation) {
      transaction.createOrReplace(observation);
    });
    transaction.delete(`drafts.${therapistId}`);
  } else if (decision === "merge_to_therapist") {
    const therapist = await client.getDocument(therapistId);
    if (!therapist || therapist._type !== "therapist") {
      sendJson(response, 404, { error: "Matched therapist not found." }, origin, config);
      return true;
    }
    const mergedTherapistDraft = {
      ...therapist,
      licensureVerification: mergeLicensureVerification(
        therapist.licensureVerification,
        candidate.licensureVerification,
      ),
      supportingSourceUrls: (function mergeUniqueUrls(primary, supporting, extra) {
        const urls = []
          .concat(primary ? [primary] : [])
          .concat(Array.isArray(supporting) ? supporting : [])
          .concat(Array.isArray(extra) ? extra : [])
          .map(function (value) {
            return String(value || "").trim();
          })
          .filter(Boolean);

        return Array.from(new Set(urls));
      })(
        therapist.sourceUrl,
        therapist.supportingSourceUrls,
        (function mergeUniqueUrls(primary, supporting, extra) {
          const urls = []
            .concat(primary ? [primary] : [])
            .concat(Array.isArray(supporting) ? supporting : [])
            .concat(Array.isArray(extra) ? extra : [])
            .map(function (value) {
              return String(value || "").trim();
            })
            .filter(Boolean);

          return Array.from(new Set(urls));
        })(
          candidate.sourceUrl,
          candidate.supportingSourceUrls,
          candidate.website ? [candidate.website] : [],
        ),
      ),
      sourceReviewedAt: candidate.sourceReviewedAt || therapist.sourceReviewedAt || now,
    };

    transaction.patch(therapistId, function (patch) {
      return patch.set({
        licensureVerification: mergedTherapistDraft.licensureVerification,
        supportingSourceUrls: mergedTherapistDraft.supportingSourceUrls,
        sourceReviewedAt: mergedTherapistDraft.sourceReviewedAt,
        fieldTrustMeta: buildFieldTrustMeta(mergedTherapistDraft),
      });
    });
  } else if (decision === "merge_to_application") {
    const application = await client.getDocument(applicationId);
    if (!application || application._type !== "therapistApplication") {
      sendJson(response, 404, { error: "Matched application not found." }, origin, config);
      return true;
    }

    transaction.patch(applicationId, function (patch) {
      return patch.set({
        licensureVerification: mergeLicensureVerification(
          application.licensureVerification,
          candidate.licensureVerification,
        ),
        supportingSourceUrls: (function mergeUniqueUrls(primary, supporting, extra) {
          const urls = []
            .concat(primary ? [primary] : [])
            .concat(Array.isArray(supporting) ? supporting : [])
            .concat(Array.isArray(extra) ? extra : [])
            .map(function (value) {
              return String(value || "").trim();
            })
            .filter(Boolean);

          return Array.from(new Set(urls));
        })(
          application.sourceUrl,
          application.supportingSourceUrls,
          (function mergeUniqueUrls(primary, supporting, extra) {
            const urls = []
              .concat(primary ? [primary] : [])
              .concat(Array.isArray(supporting) ? supporting : [])
              .concat(Array.isArray(extra) ? extra : [])
              .map(function (value) {
                return String(value || "").trim();
              })
              .filter(Boolean);

            return Array.from(new Set(urls));
          })(
            candidate.sourceUrl,
            candidate.supportingSourceUrls,
            candidate.website ? [candidate.website] : [],
          ),
        ),
        sourceReviewedAt: candidate.sourceReviewedAt || application.sourceReviewedAt || now,
        notes: [
          application.notes,
          notes,
          `Merged candidate: ${candidate.name || candidate.candidateId}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      });
    });
  }

  transaction.patch(candidateId, function (patch) {
    return patch
      .set({
        reviewStatus,
        publishRecommendation,
        dedupeStatus,
        reviewLane: reviewMeta.reviewLane,
        reviewPriority: reviewMeta.reviewPriority,
        nextReviewDueAt: reviewMeta.nextReviewDueAt,
        lastReviewedAt: now,
        notes,
        sourceReviewedAt: candidate.sourceReviewedAt || now,
        ...(therapistId
          ? {
              matchedTherapistId: therapistId,
              ...(decision === "publish"
                ? {
                    publishedTherapistId: therapistId,
                    publishedAt: now,
                  }
                : {}),
            }
          : {}),
        ...(applicationId ? { matchedApplicationId: applicationId } : {}),
      })
      .setIfMissing({ reviewHistory: [] })
      .append("reviewHistory", [historyEntry]);
  });

  transaction.create(
    buildCandidateReviewEvent(candidate, {
      eventType,
      therapistId,
      applicationId,
      decision,
      reviewStatus,
      publishRecommendation,
      actorName,
      rationale: notes,
      notes,
      changedFields,
    }),
  );

  await transaction.commit({ visibility: "sync" });
  const updatedCandidate = await client.getDocument(candidateId);
  sendJson(
    response,
    200,
    {
      ok: true,
      candidate: normalizePortableCandidate(updatedCandidate, {
        normalizeLicensureVerification,
      }),
      therapistId: therapistId || updatedCandidate.publishedTherapistId || "",
    },
    origin,
    config,
  );
  return true;
}
