export async function handleCandidateRoutes(context) {
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
    buildCandidateReviewEvent,
    buildFieldTrustMeta,
    buildTherapistDocumentFromCandidate,
    computeCandidateReviewMeta,
    computeTherapistVerificationMeta,
    isAuthorized,
    mergeLicensureVerification,
    normalizeLicensureVerification,
    normalizePortableCandidate,
    parseBody,
    publishingHelpers,
    sendJson,
  } = deps;

  const candidateDecisionMatch = routePath.match(/^\/candidates\/([^/]+)\/decision$/);
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
    transaction.createOrReplace(
      buildTherapistDocumentFromCandidate(candidate, therapistId, publishingHelpers),
    );
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
        notes: [application.notes, notes, `Merged candidate: ${candidate.name || candidate.candidateId}`]
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
