import { log } from "./logger.mjs";
// CA-specific number normalization lives with the CA verifier. This path is
// DCA-only by construction: the boardCode gate below short-circuits any
// candidate without a DCA board code, so a non-CA candidate never reaches
// the normalize/verify calls. Route through getLicenseVerifierForState()
// when candidates can carry non-CA verifications.
import { cleanLicenseNumber as cleanLicenseNumberForDca } from "./dca-license-client.mjs";

// Re-verify a candidate's CA license against DCA at publish time. The
// stored licensureVerification snapshot may be stale; re-checking
// catches revocations / discipline that landed between ingest and
// admin promotion. Returns:
//   { block: false } — allowed to publish (verification skipped or passed)
//   { block: true, body } — error response 422 to send back
//   licensureVerification — refreshed snapshot to write to the new
//     therapist doc, when verification succeeded
async function reverifyCandidateAtPublish(candidate, config, verifyLicense) {
  if (!verifyLicense) return { block: false }; // dep not wired (test harnesses)
  const boardCode =
    (candidate.licensureVerification && candidate.licensureVerification.boardCode) || "";
  if (!boardCode) {
    // No prior DCA verification on file. Don't block — admin will have
    // already had to add a license number; a candidate without a board
    // code likely belongs to a board the API can't reach (out-of-state,
    // unmapped license type) and admin discretion takes over.
    return { block: false };
  }
  const cleanNumber = cleanLicenseNumberForDca(candidate.licenseNumber);
  if (!cleanNumber) return { block: false };

  let result;
  try {
    result = await verifyLicense(config, boardCode, cleanNumber);
  } catch (err) {
    // Soft-fail on transient API issues — don't block admin's publish
    // decision because of a temporary DCA outage. Cron freshness check
    // will catch any actual status problem on the next run.
    log.error("DCA reverify threw at publish; allowing publish", {
      err: err?.message || String(err),
    });
    return { block: false };
  }
  if (!result || !result.verified) {
    // License was previously verified but DCA now returns no record.
    // Could be transient or could be a real issue — soft-fail like
    // above; the freshness cron is the safety net.
    return { block: false };
  }
  if (!result.isActive) {
    const status =
      (result.licensureVerification && result.licensureVerification.primaryStatus) || "unknown";
    return {
      block: true,
      body: {
        error: `Cannot publish. DCA shows this candidate's CA license as "${status}" (no longer active in good standing). The license status changed since this candidate was ingested. Refresh the candidate or archive it.`,
        reason: "license_not_active_at_publish",
        dca_status: status,
      },
    };
  }
  if (result.hasDiscipline) {
    return {
      block: true,
      body: {
        error:
          "Cannot publish. DCA now shows public disciplinary actions on this candidate's CA license. Review the discipline summary in the licensure record before deciding.",
        reason: "license_has_discipline_at_publish",
      },
    };
  }
  return { block: false, licensureVerification: result.licensureVerification };
}

export async function handleCandidateRoutes(context) {
  const { client, config, deps, origin, request, response, routePath } = context;

  const {
    buildCandidateReviewEvent,
    buildCandidateMergeFillFields,
    buildFieldTrustMeta,
    buildTherapistDocumentFromCandidate,
    buildTherapistObservationDocuments,
    computeCandidateReviewMeta,
    getAuthorizedActor,
    isAuthorized,
    mergeLicensureVerification,
    normalizeLicensureVerification,
    normalizePortableCandidate,
    parseBody,
    publishingHelpers,
    sendJson,
    verifyLicense,
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

    // Profile fields
    const stringFields = [
      ["name", "name"],
      ["credentials", "credentials"],
      ["title", "title"],
      ["practice_name", "practiceName"],
      ["gender", "gender"],
      ["city", "city"],
      ["state", "state"],
      ["zip", "zip"],
      ["license_state", "licenseState"],
      ["license_number", "licenseNumber"],
      ["email", "email"],
      ["phone", "phone"],
      ["website", "website"],
      ["booking_url", "bookingUrl"],
      ["care_approach", "careApproach"],
      ["estimated_wait_time", "estimatedWaitTime"],
      ["preferred_contact_method", "preferredContactMethod"],
      ["preferred_contact_label", "preferredContactLabel"],
      ["contact_guidance", "contactGuidance"],
      ["first_step_expectation", "firstStepExpectation"],
      ["availability_posture", "availabilityPosture"],
      ["prescribing_mode", "prescribingMode"],
      ["crisis_posture", "crisisPosture"],
    ];
    for (const [bodyKey, sanityKey] of stringFields) {
      if (typeof body[bodyKey] === "string") {
        allowedUpdates[sanityKey] = body[bodyKey].trim();
      }
    }

    const arrayFields = [
      ["specialties", "specialties"],
      ["treatment_modalities", "treatmentModalities"],
      ["client_populations", "clientPopulations"],
      ["insurance_accepted", "insuranceAccepted"],
      ["languages", "languages"],
      ["telehealth_states", "telehealthStates"],
    ];
    for (const [bodyKey, sanityKey] of arrayFields) {
      if (Array.isArray(body[bodyKey])) {
        allowedUpdates[sanityKey] = body[bodyKey].map(String).filter(Boolean);
      }
    }

    const boolFields = [
      ["accepts_telehealth", "acceptsTelehealth"],
      ["accepts_in_person", "acceptsInPerson"],
      ["accepting_new_patients", "acceptingNewPatients"],
      ["sliding_scale", "slidingScale"],
      ["medication_management", "medicationManagement"],
    ];
    for (const [bodyKey, sanityKey] of boolFields) {
      if (typeof body[bodyKey] === "boolean") {
        allowedUpdates[sanityKey] = body[bodyKey];
      }
    }

    if (typeof body.session_fee_min === "number") {
      allowedUpdates.sessionFeeMin = body.session_fee_min;
    }
    if (typeof body.session_fee_max === "number") {
      allowedUpdates.sessionFeeMax = body.session_fee_max;
    }
    if (typeof body.waitlist_weeks === "number") {
      allowedUpdates.waitlistWeeks = body.waitlist_weeks;
    }
    if (typeof body.bipolar_years_experience === "number" && body.bipolar_years_experience >= 0) {
      allowedUpdates.bipolarYearsExperience = body.bipolar_years_experience;
    }
    if (typeof body.years_experience === "number" && body.years_experience >= 0) {
      allowedUpdates.yearsExperience = body.years_experience;
    }

    if (typeof body.notes === "string") {
      allowedUpdates.notes = body.notes.trim();
    }
    // dedupeStatus is patchable so the admin Resolve Duplicate workflow can
    // record decisions (e.g. "rejected_duplicate" when the email collision
    // is real but the people are actually different). Validated against the
    // schema enum.
    if (typeof body.dedupe_status === "string") {
      const allowedDedupe = new Set([
        "unreviewed",
        "unique",
        "definite_duplicate",
        "possible_duplicate",
        "merged",
        "rejected_duplicate",
      ]);
      if (allowedDedupe.has(body.dedupe_status)) {
        allowedUpdates.dedupeStatus = body.dedupe_status;
      }
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
    "mark_unique",
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

  const REJECTION_REASON_VALUES = new Set([
    "not_a_specialist",
    "dead_site",
    "group_practice",
    "aggregator_url",
    "out_of_state",
    "license_unverifiable",
    "duplicate",
    "other",
  ]);
  const rejectionReason = String(body.rejection_reason || "").trim();
  const rejectionNotes = String(body.rejection_notes || "").trim();
  const decisionCapturesRejection = decision === "archive" || decision === "reject_duplicate";
  if (rejectionReason && !REJECTION_REASON_VALUES.has(rejectionReason)) {
    sendJson(response, 400, { error: "Unsupported rejection reason." }, origin, config);
    return true;
  }
  const appliedRejectionReason = decisionCapturesRejection ? rejectionReason : "";
  const appliedRejectionNotes = decisionCapturesRejection ? rejectionNotes : "";

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
    "reviewHistory",
    "reviewLane",
    "reviewPriority",
    "nextReviewDueAt",
    "lastReviewedAt",
  ];
  if (notes) {
    changedFields.push("notes");
  }

  if (decision === "mark_ready") {
    reviewStatus = "ready_to_publish";
    publishRecommendation = "ready";
  } else if (decision === "mark_unique") {
    dedupeStatus = "unique";
    if (reviewStatus === "queued" || !reviewStatus) {
      reviewStatus = "needs_review";
    }
    eventType = "candidate_marked_unique";
    changedFields.push("dedupeStatus");
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
    changedFields.push("matchedTherapistId", "dedupeStatus", "publishedTherapistId", "publishedAt");
  } else if (decision === "publish") {
    // Publish is not idempotent: it rebuilds the therapist doc via
    // createOrReplace, so publishing twice (stale admin tab, concurrent
    // reviewers) would overwrite the live profile and any edits made since.
    // publishedTherapistId is stamped by both publish and merge_to_therapist,
    // so this also blocks re-publishing an already-merged candidate.
    if (String(candidate.publishedTherapistId || "").trim()) {
      sendJson(
        response,
        409,
        {
          error:
            "This candidate was already published. Re-publishing would overwrite the live therapist profile and any edits made since.",
          therapistId: candidate.publishedTherapistId,
        },
        origin,
        config,
      );
      return true;
    }
    if (!String(candidate.licenseNumber || "").trim()) {
      sendJson(
        response,
        409,
        {
          error:
            "This candidate has no license number. Add a verified license number before publishing.",
        },
        origin,
        config,
      );
      return true;
    }
    // Re-verify license against DCA at publish time. The licensureVerification
    // snapshot on the candidate may be hours/days/weeks stale by the time
    // admin clicks Publish — re-checking catches statuses that changed
    // between ingest and review (revocation, surrender, new discipline).
    // We trust the boardCode the candidate already has (set by the
    // ingest-time verification); if absent, skip the gate rather than
    // block — admin can manually verify.
    const reverifyResult = await reverifyCandidateAtPublish(candidate, config, verifyLicense);
    if (reverifyResult && reverifyResult.block) {
      sendJson(response, 422, reverifyResult.body, origin, config);
      return true;
    }
    const nextTherapist = buildTherapistDocumentFromCandidate(
      candidate,
      candidate.matchedTherapistId,
      publishingHelpers,
    );
    therapistId = nextTherapist._id;

    // Collision guard: the id is derived from name+city+state, so two
    // different providers can slugify to the same id. When the candidate
    // wasn't deliberately matched to an existing therapist (no
    // matchedTherapistId) but a live doc already occupies the derived id,
    // publishing would createOrReplace — silently replacing someone ELSE's
    // live profile. Refuse and route the admin through dedupe instead.
    if (!String(candidate.matchedTherapistId || "").trim()) {
      const occupant = await client.getDocument(therapistId);
      if (occupant) {
        sendJson(
          response,
          409,
          {
            error:
              "A live therapist profile already exists with this derived id (same name, city, and state). Publishing would overwrite it. Use the dedupe flow to merge, or adjust the candidate's identity fields first.",
            therapistId,
          },
          origin,
          config,
        );
        return true;
      }
    }
    // Refresh the candidate's licensureVerification with what DCA returned
    // just now so the published therapist doc carries the freshest snapshot.
    if (reverifyResult && reverifyResult.licensureVerification) {
      candidate.licensureVerification = reverifyResult.licensureVerification;
    }
    reviewStatus = "archived";
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
    // When the candidate was deliberately matched to an existing therapist,
    // replacing that doc is the point. Otherwise use create() so the
    // collision pre-check above is enforced atomically at commit time: a
    // concurrent publish that claims the same derived id between the
    // pre-check fetch and this commit fails the transaction instead of
    // silently overwriting the other profile.
    if (String(candidate.matchedTherapistId || "").trim()) {
      transaction.createOrReplace(therapistDocument);
    } else {
      transaction.create(therapistDocument);
    }
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

    // Fill therapist fields the existing record is missing from candidate data
    // so a fresh ingest tops up an existing profile instead of being discarded.
    // Existing values are never overwritten — claimed therapists may have
    // human-edited data that should win over scraped candidate data.
    const fillMissing = buildCandidateMergeFillFields(therapist, candidate, publishingHelpers);
    Object.assign(mergedTherapistDraft, fillMissing);

    transaction.patch(therapistId, function (patch) {
      return patch.set({
        ...fillMissing,
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

  if (decisionCapturesRejection && appliedRejectionReason) {
    changedFields.push("rejectionReason");
    if (appliedRejectionNotes) {
      changedFields.push("rejectionNotes");
    }
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
        // Only overwrite notes when the decision supplied one — a bare
        // decision (e.g. the inspector's one-click publish) must not erase
        // ingest-written warnings like DCA name mismatches. The per-decision
        // note is always captured in reviewHistory below either way.
        ...(notes ? { notes } : {}),
        sourceReviewedAt: candidate.sourceReviewedAt || now,
        ...(decisionCapturesRejection && appliedRejectionReason
          ? {
              rejectionReason: appliedRejectionReason,
              rejectionNotes: appliedRejectionNotes,
            }
          : {}),
        ...(therapistId
          ? {
              matchedTherapistId: therapistId,
              ...(decision === "publish" || decision === "merge_to_therapist"
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

  const eventRationale = appliedRejectionReason
    ? [
        "rejection_reason=" + appliedRejectionReason,
        appliedRejectionNotes,
        notes && notes !== appliedRejectionNotes ? notes : "",
      ]
        .filter(Boolean)
        .join(" | ")
    : notes;

  transaction.create(
    buildCandidateReviewEvent(candidate, {
      eventType,
      therapistId,
      applicationId,
      decision,
      reviewStatus,
      publishRecommendation,
      actorName,
      rationale: eventRationale,
      notes: eventRationale,
      changedFields,
    }),
  );

  try {
    await transaction.commit({ visibility: "sync" });
  } catch (error) {
    const message = (error && error.message) || "";
    const documentAlreadyExists =
      (error && error.statusCode === 409) || /already exist/i.test(message);
    if (decision === "publish" && documentAlreadyExists) {
      sendJson(
        response,
        409,
        {
          error:
            "A live therapist profile already exists with this derived id (same name, city, and state). Publishing would overwrite it. Use the dedupe flow to merge, or adjust the candidate's identity fields first.",
          therapistId,
        },
        origin,
        config,
      );
      return true;
    }
    throw error;
  }
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
