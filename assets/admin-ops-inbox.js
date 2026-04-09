import {
  bindCandidateDecisionButtons,
  renderCandidateMergePreview,
  renderCandidateMergeWorkbench,
  renderCandidatePublishPacket,
  renderCandidateTrustChips,
} from "./admin-candidate-review.js";

function getTherapistOpsReason(freshness, item, helpers) {
  const trustSummary = helpers.getTherapistFieldTrustSummary(item);
  if (trustSummary.watchFields.length) {
    return "Field trust attention needed: " + trustSummary.watchFields.join(", ") + ".";
  }
  if (item.source_health_status && !["healthy", "redirected"].includes(item.source_health_status)) {
    return (
      "Primary source health degraded" +
      (item.source_health_error ? ": " + item.source_health_error : ".")
    );
  }
  if (Array.isArray(item.source_drift_signals) && item.source_drift_signals.length) {
    return "Drift signals: " + item.source_drift_signals.slice(0, 3).join(", ");
  }
  if (freshness.needs_reconfirmation_fields.length) {
    return (
      "Operational fields need reconfirmation: " +
      freshness.needs_reconfirmation_fields.map(helpers.formatFieldLabel).slice(0, 3).join(", ")
    );
  }
  if (item.verificationLane === "needs_verification") {
    return "This profile does not have a reliable recent operational review yet.";
  }
  return freshness.note || "Source-backed details are aging and should be refreshed.";
}

function bindTherapistOpsButtons(root, handlers) {
  if (!root) {
    return;
  }

  root.querySelectorAll("[data-therapist-ops]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const id = button.getAttribute("data-therapist-ops");
      const decision = button.getAttribute("data-therapist-next");
      if (!id || !decision) {
        return;
      }

      const prior = button.textContent;
      button.disabled = true;
      button.textContent = decision === "mark_reviewed" ? "Saving..." : "Deferring...";

      try {
        await handlers.decideTherapistOps(id, { decision: decision });
        await handlers.loadData();
      } catch (_error) {
        const status = root.querySelector('[data-therapist-status-id="' + id + '"]');
        if (status) {
          status.textContent = "Could not update this therapist.";
        }
        button.disabled = false;
        button.textContent = prior;
      }
    });
  });
}

function getFieldTrustValue(meta, camelKey, snakeKey) {
  if (!meta || typeof meta !== "object") {
    return null;
  }
  if (meta[camelKey] !== undefined) {
    return meta[camelKey];
  }
  if (meta[snakeKey] !== undefined) {
    return meta[snakeKey];
  }
  return null;
}

function getFieldTrustTier(meta) {
  if (!meta) {
    return "unknown";
  }

  const reviewState = getFieldTrustValue(meta, "reviewState", "review_state");
  const confidenceScore = Number(
    getFieldTrustValue(meta, "confidenceScore", "confidence_score") || 0,
  );
  const staleAfterAt = getFieldTrustValue(meta, "staleAfterAt", "stale_after_at");
  const staleAt = staleAfterAt ? new Date(staleAfterAt).getTime() : null;

  if (staleAt && Number.isFinite(staleAt) && staleAt < Date.now()) {
    return "stale";
  }
  if (reviewState === "needs_reconfirmation" || reviewState === "needs_review") {
    return "watch";
  }
  if (confidenceScore >= 85) {
    return "high";
  }
  if (confidenceScore >= 65) {
    return "medium";
  }
  if (confidenceScore > 0) {
    return "watch";
  }
  return "unknown";
}

function getConversionWatchFields(item, options) {
  if (!item) {
    return [];
  }

  const trustSummary = options.getTherapistFieldTrustSummary(item);
  const watchedTrustFields = (trustSummary.entries || [])
    .filter(function (entry) {
      return ["stale", "watch", "unknown"].includes(getFieldTrustTier(entry.meta));
    })
    .map(function (entry) {
      return entry.key;
    });
  const freshness = options.getDataFreshnessSummary(item);

  const fields = Array.from(
    new Set(
      [].concat(watchedTrustFields, freshness.needs_reconfirmation_fields || []).filter(Boolean),
    ),
  );
  if (!hasFeeCoverage(item)) {
    fields.push("session_fees");
  }
  return Array.from(new Set(fields));
}

function buildConversionRefreshBrief(item, fields, options) {
  const orderedFields = options.getPreferredFieldOrder(fields, "bipolar_years_experience");
  const labelLine = orderedFields.length
    ? orderedFields.map(options.formatFieldLabel).join(", ")
    : "Source review date";

  return [
    "Profile refresh brief",
    "",
    "Therapist: " + (item.name || "Unknown therapist"),
    "Slug: " + (item.slug || ""),
    "Refresh first: " + labelLine,
    "Goal: keep this high-conversion profile decision-ready before trust softens.",
    "",
    "Done when:",
    "- decision-critical fields are refreshed or reconfirmed",
    "- profile trust notes reflect the latest evidence",
    "- next review timing is clear",
  ].join("\n");
}

function hasFeeCoverage(item) {
  if (!item || typeof item !== "object") {
    return false;
  }
  return Boolean(
    item.session_fees ||
    item.sessionFees ||
    item.session_fee_min ||
    item.sessionFeeMin ||
    item.session_fee_max ||
    item.sessionFeeMax,
  );
}

function getConversionFieldActionMeta(field, slug) {
  if (field === "bipolar_years_experience") {
    return {
      label: "Review bipolar experience",
      href: "admin.html#confirmationQueueSection",
    };
  }
  if (field === "estimated_wait_time") {
    return {
      label: "Review wait time",
      href: "admin.html#importBlockerSprintSection",
    };
  }
  if (field === "insurance_accepted") {
    return {
      label: "Review insurance",
      href: "admin.html#confirmationQueueSection",
    };
  }
  if (field === "session_fees") {
    return {
      label: "Copy fees follow-up",
      mode: "copy-fees",
      slug: slug,
    };
  }
  return {
    label: "Review " + field.replace(/_/g, " "),
    href: "admin.html#opsInbox",
  };
}

function buildFeeFollowUpRequest(item) {
  return [
    "Quick fee confirmation for " + (item.name || "this profile"),
    "",
    "We’re updating the practical decision details on your BipolarTherapyHub profile and want to make sure the fee information is still accurate.",
    "",
    "Could you confirm:",
    "- your current session fee or fee range",
    "- whether you offer sliding scale",
    "- whether the listed payment or superbill details are still current",
    "",
    "Thank you,",
    "BipolarTherapyHub",
  ].join("\n");
}

const CONVERSION_RESPONSE_FIELD_META = {
  bipolar_years_experience: {
    responseKey: "bipolarYearsExperience",
    label: "Bipolar years experience",
    placeholder: "e.g. 8",
  },
  estimated_wait_time: {
    responseKey: "estimatedWaitTime",
    label: "Estimated wait time",
    placeholder: "e.g. Within 2 weeks",
  },
  insurance_accepted: {
    responseKey: "insuranceAccepted",
    label: "Insurance accepted",
    placeholder: "Use | between multiple values",
  },
  telehealth_states: {
    responseKey: "telehealthStates",
    label: "Telehealth states",
    placeholder: "e.g. CA|NY",
  },
  session_fee_min: {
    responseKey: "sessionFeeMin",
    label: "Session fee min",
    placeholder: "e.g. 225",
  },
  session_fee_max: {
    responseKey: "sessionFeeMax",
    label: "Session fee max",
    placeholder: "e.g. 325",
  },
  sliding_scale: {
    responseKey: "slidingScale",
    label: "Sliding scale",
    placeholder: "yes / no / limited",
  },
};

function getConversionResponseFields(orderedFields) {
  const mapped = [];
  const seen = new Set();
  (orderedFields || []).forEach(function (field) {
    if (field === "session_fees") {
      ["session_fee_min", "session_fee_max", "sliding_scale"].forEach(function (feeField) {
        if (!seen.has(feeField)) {
          seen.add(feeField);
          mapped.push(feeField);
        }
      });
      return;
    }
    if (CONVERSION_RESPONSE_FIELD_META[field] && !seen.has(field)) {
      seen.add(field);
      mapped.push(field);
    }
  });
  return mapped;
}

function getTherapistResponseCurrentValue(therapist, field) {
  if (!therapist) {
    return "";
  }
  if (field === "insurance_accepted" || field === "telehealth_states") {
    const value = therapist[field];
    return Array.isArray(value) ? value.join("|") : "";
  }
  return therapist[field] == null ? "" : String(therapist[field]);
}

function buildConversionResponseCaptureHtml(slug, responseFields, response) {
  if (!responseFields.length) {
    return "";
  }

  return (
    '<div class="queue-summary"><strong>Confirmed values:</strong> Capture the therapist-confirmed values here so this profile is ready to apply.</div><div class="queue-shortlist" data-conversion-response-form="' +
    slug +
    '">' +
    responseFields
      .map(function (field) {
        const meta = CONVERSION_RESPONSE_FIELD_META[field];
        if (!meta) {
          return "";
        }
        return (
          '<label class="queue-select-label" for="conversion-response-' +
          slug +
          "-" +
          field +
          '">' +
          meta.label +
          '</label><input class="queue-select" id="conversion-response-' +
          slug +
          "-" +
          field +
          '" data-conversion-response-field="' +
          field +
          '" value="' +
          (response[meta.responseKey] || "") +
          '" placeholder="' +
          meta.placeholder +
          '" />'
        );
      })
      .join("") +
    "</div>"
  );
}

function buildConversionApplyPreviewHtml(therapist, responseFields, response) {
  const rows = (responseFields || [])
    .map(function (field) {
      const meta = CONVERSION_RESPONSE_FIELD_META[field];
      if (!meta || !response[meta.responseKey]) {
        return "";
      }
      const currentValue = getTherapistResponseCurrentValue(therapist, field) || "Not set";
      return (
        '<div class="queue-shortlist-item"><strong>' +
        meta.label +
        ":</strong> " +
        currentValue +
        " → " +
        response[meta.responseKey] +
        "</div>"
      );
    })
    .filter(Boolean);

  if (!rows.length) {
    return "";
  }

  return (
    '<div class="queue-summary"><strong>Apply preview:</strong> These confirmed values are ready to move into the live profile update flow.</div><div class="queue-shortlist">' +
    rows.join("") +
    "</div>"
  );
}

export function renderOpsInboxPanel(options) {
  const root = options.root;
  if (!root) {
    return;
  }

  if (options.authRequired) {
    root.innerHTML = "";
    return;
  }

  const candidates = Array.isArray(options.candidates) ? options.candidates : [];
  const therapists = Array.isArray(options.therapists) ? options.therapists : [];
  const applications = Array.isArray(options.applications) ? options.applications : [];
  const licensureRefreshQueue = Array.isArray(options.licensureRefreshQueue)
    ? options.licensureRefreshQueue
    : [];
  const profileConversionFreshnessQueue = Array.isArray(options.profileConversionFreshnessQueue)
    ? options.profileConversionFreshnessQueue
    : [];

  const publishNow = candidates
    .filter(function (item) {
      return item.review_lane === "publish_now" && item.review_status !== "published";
    })
    .sort(function (a, b) {
      return (Number(b.review_priority) || 0) - (Number(a.review_priority) || 0);
    })
    .slice(0, 3);

  const duplicateQueue = candidates
    .filter(function (item) {
      return item.review_lane === "resolve_duplicates" && item.review_status !== "archived";
    })
    .sort(function (a, b) {
      return (Number(b.review_priority) || 0) - (Number(a.review_priority) || 0);
    })
    .slice(0, 3);

  const confirmationQueue = candidates
    .filter(function (item) {
      return item.review_lane === "needs_confirmation" && item.review_status !== "archived";
    })
    .sort(function (a, b) {
      return (Number(b.review_priority) || 0) - (Number(a.review_priority) || 0);
    })
    .slice(0, 3);

  const refreshQueue = therapists
    .map(function (item) {
      return {
        item: item,
        freshness: options.getDataFreshnessSummary(item),
        trustAttentionCount: options.getTherapistFieldTrustAttentionCount(item),
      };
    })
    .filter(function (entry) {
      return (
        (entry.item.verificationLane && entry.item.verificationLane !== "fresh") ||
        entry.trustAttentionCount > 0
      );
    })
    .sort(function (a, b) {
      const priorityDiff =
        (Number(b.item.verificationPriority) || 0) - (Number(a.item.verificationPriority) || 0);
      if (priorityDiff) {
        return priorityDiff;
      }
      return (b.trustAttentionCount || 0) - (a.trustAttentionCount || 0);
    })
    .slice(0, 4);

  const licensureQueue = licensureRefreshQueue.slice(0, 3);
  const conversionFreshnessQueue = profileConversionFreshnessQueue.slice(0, 3);
  const readyToImportQueue = therapists
    .map(function (item) {
      const workflow = options.getConfirmationQueueEntry
        ? options.getConfirmationQueueEntry(item.slug)
        : null;
      const response = options.getConfirmationResponseEntry
        ? options.getConfirmationResponseEntry(item.slug)
        : null;
      if (!workflow || !response) {
        return null;
      }
      const hasCapturedValues = Object.values(response).some(function (value) {
        return value && typeof value === "string" && value.trim() !== "";
      });
      if (!hasCapturedValues) {
        return null;
      }
      if (workflow.status !== "confirmed" && workflow.status !== "applied") {
        return null;
      }
      return {
        item: item,
        agenda: options.getTherapistConfirmationAgenda
          ? options.getTherapistConfirmationAgenda(item)
          : { unknown_fields: [] },
        workflow: workflow,
        response: response,
      };
    })
    .filter(Boolean)
    .sort(function (a, b) {
      const statusWeight = { confirmed: 0, applied: 1 };
      const statusDiff =
        (statusWeight[a.workflow.status] || 9) - (statusWeight[b.workflow.status] || 9);
      if (statusDiff) {
        return statusDiff;
      }
      return (
        new Date(b.workflow.last_updated_at || 0).getTime() -
        new Date(a.workflow.last_updated_at || 0).getTime()
      );
    })
    .slice(0, 4);

  const totalActions =
    publishNow.length +
    duplicateQueue.length +
    confirmationQueue.length +
    refreshQueue.length +
    conversionFreshnessQueue.length +
    readyToImportQueue.length +
    licensureQueue.length;

  if (!totalActions) {
    root.innerHTML =
      '<div class="ops-inbox"><div class="ops-inbox-hero"><strong>No urgent ops work right now.</strong><div class="subtle" style="margin-top:0.35rem">The publish, duplicate, confirmation, refresh, and licensure queues are currently clear.</div></div></div>';
    return;
  }

  function renderCandidateOpsCard(item) {
    const location = [item.city, item.state, item.zip].filter(Boolean).join(", ");
    const match =
      item.matched_therapist_slug || item.matched_application_id || "No linked duplicate yet";
    const evidence = options.getCandidateOpsEvidence(item);
    const trustSummary = options.getCandidateTrustSummary(item);
    const trustRecommendation = options.getCandidateTrustRecommendation(item, trustSummary);
    const publishPacket = options.getCandidatePublishPacket(item, trustSummary);
    const mergePreview = renderCandidateMergePreview(item, {
      therapists: therapists,
      applications: applications,
      escapeHtml: options.escapeHtml,
    });

    return (
      '<article class="ops-card"><div class="ops-card-head"><div><h3 class="ops-card-title">' +
      options.escapeHtml(item.name || "Unnamed candidate") +
      '</h3><div class="ops-card-meta">' +
      options.escapeHtml([item.credentials, location].filter(Boolean).join(" · ")) +
      '</div></div><span class="tag">' +
      options.escapeHtml(options.getCandidateReviewLaneLabel(item.review_lane)) +
      '</span></div><div class="ops-card-body">' +
      '<div class="ops-card-kpi"><div class="ops-card-kpi-label">Priority</div><div class="ops-card-kpi-value">' +
      options.escapeHtml(
        item.review_priority == null ? "Not scored" : item.review_priority + "/100",
      ) +
      '</div></div><div class="ops-card-kpi"><div class="ops-card-kpi-label">Due</div><div class="ops-card-kpi-value">' +
      options.escapeHtml(
        item.next_review_due_at ? options.formatDate(item.next_review_due_at) : "Now",
      ) +
      '</div></div><div class="ops-card-kpi"><div class="ops-card-kpi-label">Recommendation</div><div class="ops-card-kpi-value">' +
      options.escapeHtml(item.publish_recommendation || "Review") +
      '</div></div><div class="ops-card-kpi"><div class="ops-card-kpi-label">Trust watch</div><div class="ops-card-kpi-value">' +
      options.escapeHtml(
        trustSummary.watchFields.length
          ? String(trustSummary.watchFields.length) + " signals"
          : "Stable",
      ) +
      '</div></div><div class="ops-card-kpi"><div class="ops-card-kpi-label">Existing match</div><div class="ops-card-kpi-value">' +
      options.escapeHtml(match) +
      '</div></div></div><div class="subtle" style="margin-top:0.85rem">' +
      options.escapeHtml(options.getCandidateOpsReason(item)) +
      "</div>" +
      (evidence
        ? '<div class="subtle" style="margin-top:0.35rem">' +
          options.escapeHtml(evidence) +
          "</div>"
        : "") +
      '<div class="subtle" style="margin-top:0.35rem">' +
      options.escapeHtml(trustRecommendation) +
      "</div>" +
      renderCandidatePublishPacket(publishPacket, {
        escapeHtml: options.escapeHtml,
      }) +
      renderCandidateTrustChips(trustSummary, 3, {
        escapeHtml: options.escapeHtml,
      }) +
      renderCandidateMergeWorkbench(item, {
        therapists: therapists,
        applications: applications,
        escapeHtml: options.escapeHtml,
      }) +
      mergePreview +
      '<div class="ops-card-actions">' +
      options.buildCandidateDecisionActions(item) +
      (item.source_url
        ? '<a class="btn-secondary btn-inline" href="' +
          options.escapeHtml(item.source_url) +
          '" target="_blank" rel="noopener">Open source</a>'
        : "") +
      '</div><div class="review-coach-status" data-candidate-status-id="' +
      options.escapeHtml(item.id) +
      '"></div></article>'
    );
  }

  function renderTherapistOpsCard(entry) {
    const item = entry.item;
    const freshness = entry.freshness;
    const trustSummary = options.getTherapistFieldTrustSummary(item);
    const nextMove = options.getTherapistTrustRecommendation(item, freshness, trustSummary);
    const evidence = [
      item.source_health_status ? "Source " + item.source_health_status : "",
      freshness.source_review_age_days != null
        ? "Source age " + freshness.source_review_age_days + "d"
        : "",
      item.source_health_checked_at
        ? "Health checked " + options.formatDate(item.source_health_checked_at)
        : "",
      freshness.therapist_confirmation_age_days != null
        ? "Therapist confirmation age " + freshness.therapist_confirmation_age_days + "d"
        : "",
    ]
      .filter(Boolean)
      .join(" · ");

    return (
      '<article class="ops-card"><div class="ops-card-head"><div><h3 class="ops-card-title">' +
      options.escapeHtml(item.name) +
      '</h3><div class="ops-card-meta">' +
      options.escapeHtml(
        [item.credentials, [item.city, item.state, item.zip].filter(Boolean).join(", ")]
          .filter(Boolean)
          .join(" · "),
      ) +
      '</div></div><span class="tag">' +
      options.escapeHtml(options.getVerificationLaneLabel(item.verificationLane)) +
      '</span></div><div class="ops-card-body">' +
      '<div class="ops-card-kpi"><div class="ops-card-kpi-label">Priority</div><div class="ops-card-kpi-value">' +
      options.escapeHtml(
        item.verificationPriority == null
          ? "Not scored"
          : String(item.verificationPriority) + "/100",
      ) +
      '</div></div><div class="ops-card-kpi"><div class="ops-card-kpi-label">Due</div><div class="ops-card-kpi-value">' +
      options.escapeHtml(item.nextReviewDueAt ? options.formatDate(item.nextReviewDueAt) : "Now") +
      '</div></div><div class="ops-card-kpi"><div class="ops-card-kpi-label">Freshness</div><div class="ops-card-kpi-value">' +
      options.escapeHtml(freshness.label) +
      '</div></div><div class="ops-card-kpi"><div class="ops-card-kpi-label">Trust watch</div><div class="ops-card-kpi-value">' +
      options.escapeHtml(
        trustSummary.watchFields.length
          ? String(trustSummary.watchFields.length) + " fields"
          : "Stable",
      ) +
      '</div></div><div class="ops-card-kpi"><div class="ops-card-kpi-label">Next move</div><div class="ops-card-kpi-value">' +
      options.escapeHtml(nextMove) +
      '</div></div></div><div class="subtle" style="margin-top:0.85rem">' +
      options.escapeHtml(getTherapistOpsReason(freshness, item, options)) +
      "</div>" +
      (evidence
        ? '<div class="subtle" style="margin-top:0.35rem">' +
          options.escapeHtml(evidence) +
          "</div>"
        : "") +
      options.renderFieldTrustChips(trustSummary, 4) +
      '<div class="ops-card-actions"><button class="btn-primary" data-therapist-ops="' +
      options.escapeHtml(item.id || item._id || "") +
      '" data-therapist-next="mark_reviewed">Mark reviewed</button><button class="btn-secondary" data-therapist-ops="' +
      options.escapeHtml(item.id || item._id || "") +
      '" data-therapist-next="snooze_7d">Defer 7 days</button><button class="btn-secondary" data-therapist-ops="' +
      options.escapeHtml(item.id || item._id || "") +
      '" data-therapist-next="snooze_30d">Defer 30 days</button><a class="btn-secondary" href="therapist.html?slug=' +
      encodeURIComponent(item.slug) +
      '">Open profile</a>' +
      (item.sourceUrl
        ? '<a class="btn-secondary" href="' +
          options.escapeHtml(item.sourceUrl) +
          '" target="_blank" rel="noopener">Open source</a>'
        : "") +
      '</div><div class="review-coach-status" data-therapist-status-id="' +
      options.escapeHtml(item.id || item._id || "") +
      '"></div></article>'
    );
  }

  function renderLicensureOpsCard(item) {
    const evidence = [
      item.license_number ? "License " + item.license_number : "",
      item.expiration_date ? "Expires " + item.expiration_date : "",
      item.licensure_verified_at
        ? "Verified " + options.formatDate(item.licensure_verified_at)
        : "",
    ]
      .filter(Boolean)
      .join(" · ");

    return (
      '<article class="ops-card"><div class="ops-card-head"><div><h3 class="ops-card-title">' +
      options.escapeHtml(item.name || "Unnamed therapist") +
      '</h3><div class="ops-card-meta">' +
      options.escapeHtml([item.credentials, item.location].filter(Boolean).join(" · ")) +
      '</div></div><span class="tag">' +
      options.escapeHtml(getLicensureLaneLabel(item)) +
      '</span></div><div class="ops-card-body">' +
      '<div class="ops-card-kpi"><div class="ops-card-kpi-label">Status</div><div class="ops-card-kpi-value">' +
      options.escapeHtml(item.refresh_status || "missing") +
      '</div></div><div class="ops-card-kpi"><div class="ops-card-kpi-label">Reason</div><div class="ops-card-kpi-value">' +
      options.escapeHtml(item.queue_reason || "refresh_due") +
      '</div></div><div class="ops-card-kpi"><div class="ops-card-kpi-label">Next move</div><div class="ops-card-kpi-value">' +
      options.escapeHtml(item.next_move || "Refresh licensure") +
      '</div></div></div><div class="subtle" style="margin-top:0.85rem">' +
      options.escapeHtml(item.reason || "Primary-source licensure refresh needed.") +
      "</div>" +
      (evidence
        ? '<div class="subtle" style="margin-top:0.35rem">' +
          options.escapeHtml(evidence) +
          "</div>"
        : "") +
      '<div class="ops-card-actions">' +
      (item.official_profile_url
        ? '<a class="btn-secondary btn-inline" href="' +
          options.escapeHtml(item.official_profile_url) +
          '" target="_blank" rel="noopener">Official source</a>'
        : "") +
      (item.profile_link
        ? '<a class="btn-secondary btn-inline" href="' +
          options.escapeHtml(item.profile_link) +
          '">Open profile</a>'
        : "") +
      '<button class="btn-primary" data-licensure-inbox-copy="' +
      options.escapeHtml(item.therapist_id || "") +
      '">' +
      options.escapeHtml(
        item.queue_reason === "missing_cache" ? "Copy first-pass command" : "Copy refresh command",
      ) +
      "</button></div></article>"
    );
  }

  function renderConversionFreshnessCard(item) {
    const therapist = therapists.find(function (entry) {
      return entry && entry.slug === item.slug;
    });
    const confirmationFields = therapist ? getConversionWatchFields(therapist, options) : [];
    const orderedFields = options.getPreferredFieldOrder(
      confirmationFields,
      confirmationFields.includes("bipolar_years_experience") ? "bipolar_years_experience" : "",
    );
    const fieldActions = orderedFields.map(function (field) {
      return {
        field: field,
        meta: getConversionFieldActionMeta(field, item.slug || ""),
      };
    });
    const responseFields = getConversionResponseFields(orderedFields);
    const workflow = options.getConfirmationQueueEntry
      ? options.getConfirmationQueueEntry(item.slug)
      : null;
    const response = options.getConfirmationResponseEntry
      ? options.getConfirmationResponseEntry(item.slug)
      : {};
    const reason =
      item.freshness_reason || "Freshness attention needed for this high-impact profile.";
    const nextMove = item.next_move || "Refresh decision-critical trust details.";
    const dueLabel = item.next_review_due_at
      ? options.formatDate(item.next_review_due_at)
      : "Watch now";
    const statusLabel =
      item.queue_status === "active_risk"
        ? "Active risk"
        : item.queue_status === "upcoming_watch"
          ? "Upcoming watch"
          : "Watch";

    return (
      '<article class="ops-card"><div class="ops-card-head"><div><h3 class="ops-card-title">' +
      options.escapeHtml(item.name || "Unnamed therapist") +
      '</h3><div class="ops-card-meta">' +
      options.escapeHtml("Conversion rank " + (item.conversion_priority_rank || "Unranked")) +
      '</div></div><span class="tag">' +
      options.escapeHtml(statusLabel) +
      '</span></div><div class="ops-card-body">' +
      '<div class="ops-card-kpi"><div class="ops-card-kpi-label">Freshness rank</div><div class="ops-card-kpi-value">' +
      options.escapeHtml(item.freshness_priority_rank || "Unranked") +
      '</div></div><div class="ops-card-kpi"><div class="ops-card-kpi-label">Impact</div><div class="ops-card-kpi-value">' +
      options.escapeHtml(item.high_impact_profile === "yes" ? "High" : "Standard") +
      '</div></div><div class="ops-card-kpi"><div class="ops-card-kpi-label">Due</div><div class="ops-card-kpi-value">' +
      options.escapeHtml(dueLabel) +
      '</div></div><div class="ops-card-kpi"><div class="ops-card-kpi-label">Gap count</div><div class="ops-card-kpi-value">' +
      options.escapeHtml(item.conversion_gap_count || "0") +
      '</div></div><div class="ops-card-kpi"><div class="ops-card-kpi-label">Next move</div><div class="ops-card-kpi-value">' +
      options.escapeHtml(nextMove) +
      '</div></div></div><div class="subtle" style="margin-top:0.85rem">' +
      options.escapeHtml(reason) +
      '</div><div class="subtle" style="margin-top:0.35rem">' +
      options.escapeHtml(
        item.decision_strength_label
          ? "Decision strength: " + item.decision_strength_label
          : "Use this queue to refresh the trust details that matter most for conversion.",
      ) +
      "</div>" +
      (workflow
        ? '<div class="subtle" style="margin-top:0.35rem"><strong>Confirmation workflow:</strong> ' +
          options.escapeHtml(options.formatStatusLabel(workflow.status || "not_started")) +
          "</div>"
        : "") +
      (orderedFields.length
        ? '<div class="subtle" style="margin-top:0.35rem"><strong>Re-confirm:</strong> ' +
          options.escapeHtml(orderedFields.map(options.formatFieldLabel).join(", ")) +
          "</div>"
        : "") +
      (therapist
        ? buildConversionResponseCaptureHtml(item.slug || "", responseFields, response)
        : "") +
      (therapist ? buildConversionApplyPreviewHtml(therapist, responseFields, response) : "") +
      (fieldActions.length
        ? '<div class="ops-card-actions">' +
          fieldActions
            .map(function (entry) {
              if (entry.meta.mode === "copy-fees") {
                return (
                  '<button class="btn-secondary" data-conversion-watch-copy-fees="' +
                  options.escapeHtml(item.slug || "") +
                  '">' +
                  options.escapeHtml(entry.meta.label) +
                  "</button>"
                );
              }
              return (
                '<a class="btn-secondary" href="' +
                options.escapeHtml(entry.meta.href) +
                '">' +
                options.escapeHtml(entry.meta.label) +
                "</a>"
              );
            })
            .join("") +
          "</div>"
        : "") +
      '<div class="ops-card-actions"><a class="btn-primary" href="therapist.html?slug=' +
      encodeURIComponent(item.slug || "") +
      '">Open profile</a>' +
      (therapist
        ? '<button class="btn-secondary" data-conversion-watch-copy-brief="' +
          options.escapeHtml(item.slug || "") +
          '">Copy refresh brief</button>'
        : "") +
      (therapist
        ? '<button class="btn-secondary" data-conversion-watch-refresh="' +
          options.escapeHtml(item.slug || "") +
          '">Mark refreshed</button>'
        : "") +
      (therapist && orderedFields.length
        ? '<button class="btn-secondary" data-conversion-watch-copy-request="' +
          options.escapeHtml(item.slug || "") +
          '">Copy confirmation request</button>'
        : "") +
      (therapist && orderedFields.length
        ? '<button class="btn-secondary" data-conversion-watch-send="' +
          options.escapeHtml(item.slug || "") +
          '">Send confirmation</button>'
        : "") +
      (therapist && responseFields.length
        ? '<button class="btn-secondary" data-conversion-response-save="' +
          options.escapeHtml(item.slug || "") +
          '">Save confirmed values</button>'
        : "") +
      (therapist && responseFields.length
        ? '<button class="btn-secondary" data-conversion-response-clear="' +
          options.escapeHtml(item.slug || "") +
          '">Clear values</button>'
        : "") +
      (therapist && responseFields.length
        ? '<button class="btn-secondary" data-conversion-mark-confirmed="' +
          options.escapeHtml(item.slug || "") +
          '">Mark confirmed</button>'
        : "") +
      (therapist && responseFields.length
        ? '<button class="btn-secondary" data-conversion-copy-apply-brief="' +
          options.escapeHtml(item.slug || "") +
          '">Copy apply brief</button>'
        : "") +
      (therapist && responseFields.length
        ? '<button class="btn-secondary" data-conversion-mark-applied="' +
          options.escapeHtml(item.slug || "") +
          '">Mark applied</button>'
        : "") +
      '<a class="btn-secondary" href="admin.html#confirmationQueue">Open confirmation queue</a>' +
      '</div><div class="review-coach-status" data-conversion-watch-status="' +
      options.escapeHtml(item.slug || "") +
      '"></div></article>'
    );
  }

  function renderReadyToImportCard(entry) {
    const item = entry.item;
    const workflow = entry.workflow;
    const response = entry.response || {};
    const captured = [
      response.bipolarYearsExperience ? "Bipolar years: " + response.bipolarYearsExperience : "",
      response.estimatedWaitTime ? "Wait time: " + response.estimatedWaitTime : "",
      response.insuranceAccepted ? "Insurance: " + response.insuranceAccepted : "",
      response.sessionFeeMin || response.sessionFeeMax
        ? "Fees: " +
          [
            response.sessionFeeMin ? "$" + response.sessionFeeMin : "",
            response.sessionFeeMax ? "$" + response.sessionFeeMax : "",
          ]
            .filter(Boolean)
            .join(" - ")
        : "",
      response.slidingScale ? "Sliding scale: " + response.slidingScale : "",
    ].filter(Boolean);

    return (
      '<article class="ops-card"><div class="ops-card-head"><div><h3 class="ops-card-title">' +
      options.escapeHtml(item.name || "Unnamed therapist") +
      '</h3><div class="ops-card-meta">' +
      options.escapeHtml(
        [item.credentials, [item.city, item.state].filter(Boolean).join(", ")]
          .filter(Boolean)
          .join(" · "),
      ) +
      '</div></div><span class="tag">' +
      options.escapeHtml(options.formatStatusLabel(workflow.status || "confirmed")) +
      '</span></div><div class="ops-card-body">' +
      '<div class="ops-card-kpi"><div class="ops-card-kpi-label">Status</div><div class="ops-card-kpi-value">' +
      options.escapeHtml(options.formatStatusLabel(workflow.status || "confirmed")) +
      '</div></div><div class="ops-card-kpi"><div class="ops-card-kpi-label">Updated</div><div class="ops-card-kpi-value">' +
      options.escapeHtml(
        workflow.last_updated_at ? options.formatDate(workflow.last_updated_at) : "Recently",
      ) +
      '</div></div><div class="ops-card-kpi"><div class="ops-card-kpi-label">Captured fields</div><div class="ops-card-kpi-value">' +
      options.escapeHtml(String(captured.length || 0)) +
      '</div></div><div class="ops-card-kpi"><div class="ops-card-kpi-label">Next move</div><div class="ops-card-kpi-value">' +
      options.escapeHtml(
        workflow.status === "confirmed"
          ? "Apply or export this profile in the next import wave."
          : "Keep this in the next import wave until the live import is complete.",
      ) +
      "</div></div></div>" +
      (captured.length
        ? '<div class="queue-shortlist">' +
          captured
            .map(function (line) {
              return '<div class="queue-shortlist-item">' + options.escapeHtml(line) + "</div>";
            })
            .join("") +
          "</div>"
        : "") +
      '<div class="ops-card-actions"><button class="btn-secondary" data-conversion-copy-apply-brief="' +
      options.escapeHtml(item.slug || "") +
      '">Copy apply brief</button><button class="btn-secondary" data-conversion-mark-applied="' +
      options.escapeHtml(item.slug || "") +
      '">Mark applied</button><a class="btn-secondary" href="therapist.html?slug=' +
      encodeURIComponent(item.slug || "") +
      '">Open profile</a><a class="btn-secondary" href="admin.html#confirmationQueue">Open confirmation queue</a></div><div class="review-coach-status" data-conversion-watch-status="' +
      options.escapeHtml(item.slug || "") +
      '"></div></article>'
    );
  }

  function renderGroup(title, note, rowsHtml, actionsHtml) {
    return (
      '<section class="ops-group"><div class="ops-group-head"><div><h3 class="ops-group-title">' +
      options.escapeHtml(title) +
      '</h3><div class="subtle">' +
      options.escapeHtml(note) +
      "</div></div>" +
      (actionsHtml ? '<div class="ops-card-actions">' + actionsHtml + "</div>" : "") +
      '</div><div class="ops-list">' +
      rowsHtml +
      "</div></section>"
    );
  }

  root.innerHTML =
    '<div class="ops-inbox"><div class="ops-inbox-hero"><strong>Today’s work</strong><div class="subtle" style="margin-top:0.35rem">Start with the highest-priority publish, duplicate, confirmation, and refresh items. This is the shortest path to a healthier therapist graph.</div><div class="ops-inbox-grid">' +
    [
      { value: publishNow.length, label: "Publish now" },
      { value: duplicateQueue.length, label: "Resolve duplicates" },
      { value: confirmationQueue.length, label: "Needs confirmation" },
      { value: refreshQueue.length, label: "Refresh live profiles" },
      { value: conversionFreshnessQueue.length, label: "Conversion watch" },
      { value: readyToImportQueue.length, label: "Ready to import" },
      { value: licensureQueue.length, label: "Licensure work" },
    ]
      .map(function (item) {
        return (
          '<div class="ops-kpi"><div class="ops-kpi-value">' +
          options.escapeHtml(item.value) +
          '</div><div class="ops-kpi-label">' +
          options.escapeHtml(item.label) +
          "</div></div>"
        );
      })
      .join("") +
    '</div></div><div class="review-coach-status" id="opsInboxExportStatus"></div>' +
    renderGroup(
      "Publish now",
      "High-readiness candidates that are closest to becoming live therapists.",
      publishNow.length
        ? publishNow.map(renderCandidateOpsCard).join("")
        : '<div class="subtle">No immediate publish candidates right now.</div>',
    ) +
    renderGroup(
      "Resolve duplicates",
      "Protect the provider graph before adding anything new.",
      duplicateQueue.length
        ? duplicateQueue.map(renderCandidateOpsCard).join("")
        : '<div class="subtle">No duplicate work is blocking the queue right now.</div>',
    ) +
    renderGroup(
      "Needs confirmation",
      "Good candidates that need one more trust pass before publish.",
      confirmationQueue.length
        ? confirmationQueue.map(renderCandidateOpsCard).join("")
        : '<div class="subtle">No confirmation-driven candidate work is waiting right now.</div>',
    ) +
    renderGroup(
      "Refresh live profiles",
      "Keep listed therapists fresh so the product stays trustworthy and ranking stays healthy.",
      refreshQueue.length
        ? refreshQueue.map(renderTherapistOpsCard).join("")
        : '<div class="subtle">No live profiles currently need refresh attention.</div>',
    ) +
    renderGroup(
      "Conversion freshness watch",
      "High-conversion profiles that should be refreshed before trust and contact intent soften.",
      conversionFreshnessQueue.length
        ? conversionFreshnessQueue.map(renderConversionFreshnessCard).join("")
        : '<div class="subtle">No conversion freshness watch items are waiting right now.</div>',
    ) +
    renderGroup(
      "Ready to import",
      "Recently confirmed or applied profiles with captured values that should move together in the next import wave.",
      readyToImportQueue.length
        ? readyToImportQueue.map(renderReadyToImportCard).join("")
        : '<div class="subtle">No confirmed profiles are queued for the next import wave yet.</div>',
      readyToImportQueue.length
        ? '<button class="btn-secondary" data-ready-import-export="apply-csv">Copy apply CSV</button><button class="btn-secondary" data-ready-import-export="apply-summary">Copy apply summary</button><button class="btn-secondary" data-ready-import-export="apply-checklist">Copy apply checklist</button>'
        : "",
    ) +
    renderGroup(
      "Licensure trust",
      "Primary-source licensure upgrades and refreshes that strengthen identity and compliance confidence.",
      licensureQueue.length
        ? licensureQueue.map(renderLicensureOpsCard).join("")
        : '<div class="subtle">No licensure work is waiting right now.</div>',
    ) +
    "</div>";

  bindCandidateDecisionButtons(root, {
    decideTherapistCandidate: options.decideTherapistCandidate,
    loadData: options.loadData,
  });
  bindTherapistOpsButtons(root, {
    decideTherapistOps: options.decideTherapistOps,
    loadData: options.loadData,
  });
  root.querySelectorAll("[data-licensure-inbox-copy]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const therapistId = button.getAttribute("data-licensure-inbox-copy");
      const item = licensureQueue.find(function (entry) {
        return entry.therapist_id === therapistId;
      });
      const original = button.textContent;
      try {
        await options.copyText(buildLicensureRefreshCommand(item));
        button.textContent = "Command copied";
        window.setTimeout(function () {
          button.textContent = original;
        }, 1400);
      } catch (_error) {
        button.textContent = "Copy failed";
        window.setTimeout(function () {
          button.textContent = original;
        }, 1600);
      }
    });
  });
  root.querySelectorAll("[data-ready-import-export]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const mode = button.getAttribute("data-ready-import-export");
      const text =
        mode === "apply-csv"
          ? options.buildConfirmationApplyCsv(readyToImportQueue)
          : mode === "apply-summary"
            ? options.buildConfirmationApplySummary(
                readyToImportQueue,
                "# Ready To Import Apply Summary",
              )
            : mode === "apply-checklist"
              ? options.buildConfirmationApplyOperatorChecklist(
                  readyToImportQueue,
                  "# Ready To Import Apply Checklist",
                )
              : "";
      const success = text ? await options.copyText(text) : false;
      const status = root.querySelector("#opsInboxExportStatus");
      if (status) {
        status.textContent = success
          ? mode === "apply-csv"
            ? "Ready-to-import apply CSV copied."
            : mode === "apply-summary"
              ? "Ready-to-import apply summary copied."
              : "Ready-to-import apply checklist copied."
          : mode === "apply-csv"
            ? "Could not copy ready-to-import apply CSV."
            : mode === "apply-summary"
              ? "Could not copy ready-to-import apply summary."
              : "Could not copy ready-to-import apply checklist.";
      }
    });
  });
  root.querySelectorAll("[data-conversion-watch-copy-brief]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const slug = button.getAttribute("data-conversion-watch-copy-brief");
      const therapist = therapists.find(function (entry) {
        return entry && entry.slug === slug;
      });
      const status = root.querySelector('[data-conversion-watch-status="' + slug + '"]');
      const original = button.textContent;
      if (!therapist) {
        if (status) {
          status.textContent = "Could not find the live therapist record.";
        }
        return;
      }

      try {
        const fields = getConversionWatchFields(therapist, options);
        await options.copyText(buildConversionRefreshBrief(therapist, fields, options));
        button.textContent = "Brief copied";
        if (status) {
          status.textContent = "Refresh brief copied for this profile.";
        }
      } catch (_error) {
        button.textContent = "Copy failed";
        if (status) {
          status.textContent = "Could not copy the refresh brief.";
        }
      }

      window.setTimeout(function () {
        button.textContent = original;
      }, 1400);
    });
  });
  root.querySelectorAll("[data-conversion-watch-copy-request]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const slug = button.getAttribute("data-conversion-watch-copy-request");
      const therapist = therapists.find(function (entry) {
        return entry && entry.slug === slug;
      });
      const status = root.querySelector('[data-conversion-watch-status="' + slug + '"]');
      const original = button.textContent;
      if (!therapist) {
        if (status) {
          status.textContent = "Could not find the live therapist record.";
        }
        return;
      }

      try {
        const fields = getConversionWatchFields(therapist, options);
        const orderedFields = options.getPreferredFieldOrder(fields, "bipolar_years_experience");
        await options.copyText(
          options.buildTherapistFieldConfirmationPrompt(therapist, orderedFields),
        );
        button.textContent = "Request copied";
        if (status) {
          status.textContent = "Confirmation request copied for the watched fields.";
        }
      } catch (_error) {
        button.textContent = "Copy failed";
        if (status) {
          status.textContent = "Could not copy the confirmation request.";
        }
      }

      window.setTimeout(function () {
        button.textContent = original;
      }, 1400);
    });
  });
  root.querySelectorAll("[data-conversion-watch-copy-fees]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const slug = button.getAttribute("data-conversion-watch-copy-fees");
      const therapist = therapists.find(function (entry) {
        return entry && entry.slug === slug;
      });
      const status = root.querySelector('[data-conversion-watch-status="' + slug + '"]');
      const original = button.textContent;
      if (!therapist) {
        if (status) {
          status.textContent = "Could not find the live therapist record.";
        }
        return;
      }

      try {
        await options.copyText(buildFeeFollowUpRequest(therapist));
        button.textContent = "Fees ask copied";
        if (status) {
          status.textContent = "Fee follow-up copied for this profile.";
        }
      } catch (_error) {
        button.textContent = "Copy failed";
        if (status) {
          status.textContent = "Could not copy the fee follow-up.";
        }
      }

      window.setTimeout(function () {
        button.textContent = original;
      }, 1400);
    });
  });
  root.querySelectorAll("[data-conversion-response-save]").forEach(function (button) {
    button.addEventListener("click", function () {
      const slug = button.getAttribute("data-conversion-response-save");
      const form = root.querySelector('[data-conversion-response-form="' + slug + '"]');
      const status = root.querySelector('[data-conversion-watch-status="' + slug + '"]');
      if (!slug || !form || !options.updateConfirmationResponseEntry) {
        return;
      }

      const updates = {};
      form.querySelectorAll("[data-conversion-response-field]").forEach(function (input) {
        const field = input.getAttribute("data-conversion-response-field");
        const meta = field ? CONVERSION_RESPONSE_FIELD_META[field] : null;
        if (!meta) {
          return;
        }
        updates[meta.responseKey] = String(input.value || "").trim();
      });
      options.updateConfirmationResponseEntry(slug, updates);
      if (status) {
        status.textContent = "Confirmed values saved.";
      }
      if (options.renderOpsInbox) {
        options.renderOpsInbox();
      }
    });
  });
  root.querySelectorAll("[data-conversion-response-clear]").forEach(function (button) {
    button.addEventListener("click", function () {
      const slug = button.getAttribute("data-conversion-response-clear");
      const status = root.querySelector('[data-conversion-watch-status="' + slug + '"]');
      if (!slug || !options.clearConfirmationResponseEntry) {
        return;
      }

      options.clearConfirmationResponseEntry(slug);
      if (status) {
        status.textContent = "Confirmed values cleared.";
      }
      if (options.renderOpsInbox) {
        options.renderOpsInbox();
      }
    });
  });
  root.querySelectorAll("[data-conversion-watch-refresh]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const slug = button.getAttribute("data-conversion-watch-refresh");
      const therapist = therapists.find(function (entry) {
        return entry && entry.slug === slug;
      });
      const therapistId =
        therapist && (therapist.id || therapist._id) ? therapist.id || therapist._id : "";
      const status = root.querySelector('[data-conversion-watch-status="' + slug + '"]');
      const original = button.textContent;
      if (!therapistId) {
        if (status) {
          status.textContent = "Could not find the live therapist record.";
        }
        return;
      }

      button.disabled = true;
      button.textContent = "Saving...";
      try {
        await options.decideTherapistOps(therapistId, { decision: "mark_reviewed" });
        if (status) {
          status.textContent = "Profile marked reviewed.";
        }
        await options.loadData();
      } catch (_error) {
        if (status) {
          status.textContent = "Could not mark this profile reviewed.";
        }
        button.disabled = false;
        button.textContent = original;
        return;
      }
    });
  });
  root.querySelectorAll("[data-conversion-watch-send]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const slug = button.getAttribute("data-conversion-watch-send");
      const therapist = therapists.find(function (entry) {
        return entry && entry.slug === slug;
      });
      const status = root.querySelector('[data-conversion-watch-status="' + slug + '"]');
      const original = button.textContent;
      if (!therapist) {
        if (status) {
          status.textContent = "Could not find the live therapist record.";
        }
        return;
      }

      button.disabled = true;
      button.textContent = "Sending...";
      try {
        const fields = getConversionWatchFields(therapist, options);
        const orderedFields = options.getPreferredFieldOrder(fields, "bipolar_years_experience");
        const text = [
          options.buildTherapistFieldConfirmationPrompt(therapist, orderedFields),
          "",
          "Confirmation form:",
          "admin.html#confirmationQueue",
        ]
          .filter(Boolean)
          .join("\n");
        const copied = await options.copyText(text);
        if (!copied) {
          throw new Error("copy failed");
        }
        options.updateConfirmationQueueEntry(slug, {
          status: "sent",
          last_sent_at: new Date().toISOString(),
        });
        options.renderStats();
        options.renderImportBlockerSprint();
        options.renderCaliforniaPriorityConfirmationWave();
        options.renderConfirmationSprint();
        options.renderConfirmationQueue();
        if (status) {
          status.textContent = "Confirmation request copied and marked sent.";
        }
        button.textContent = "Sent";
      } catch (_error) {
        if (status) {
          status.textContent = "Could not send the confirmation request.";
        }
        button.disabled = false;
        button.textContent = original;
        return;
      }

      window.setTimeout(function () {
        button.textContent = original;
        button.disabled = false;
      }, 1400);
    });
  });
  root.querySelectorAll("[data-conversion-mark-confirmed]").forEach(function (button) {
    button.addEventListener("click", function () {
      const slug = button.getAttribute("data-conversion-mark-confirmed");
      const status = root.querySelector('[data-conversion-watch-status="' + slug + '"]');
      if (!slug || !options.updateConfirmationQueueEntry) {
        return;
      }
      options.updateConfirmationQueueEntry(slug, {
        status: "confirmed",
      });
      options.renderStats();
      options.renderConfirmationSprint();
      options.renderConfirmationQueue();
      if (options.renderOpsInbox) {
        options.renderOpsInbox();
      }
      if (status) {
        status.textContent = "Profile marked confirmed.";
      }
    });
  });
  root.querySelectorAll("[data-conversion-copy-apply-brief]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const slug = button.getAttribute("data-conversion-copy-apply-brief");
      const therapist = therapists.find(function (entry) {
        return entry && entry.slug === slug;
      });
      const status = root.querySelector('[data-conversion-watch-status="' + slug + '"]');
      if (!slug || !therapist || !options.buildConfirmationApplyBrief) {
        return;
      }
      const orderedFields = getConversionWatchFields(therapist, options);
      try {
        const brief = options.buildConfirmationApplyBrief(
          therapist,
          { unknown_fields: orderedFields },
          options.getConfirmationQueueEntry(slug),
        );
        await options.copyText(brief);
        if (status) {
          status.textContent = "Apply brief copied.";
        }
      } catch (_error) {
        if (status) {
          status.textContent = "Could not copy the apply brief.";
        }
      }
    });
  });
  root.querySelectorAll("[data-conversion-mark-applied]").forEach(function (button) {
    button.addEventListener("click", function () {
      const slug = button.getAttribute("data-conversion-mark-applied");
      const status = root.querySelector('[data-conversion-watch-status="' + slug + '"]');
      if (!slug || !options.updateConfirmationQueueEntry) {
        return;
      }
      options.updateConfirmationQueueEntry(slug, {
        status: "applied",
        confirmation_applied_at: new Date().toISOString(),
      });
      options.renderStats();
      options.renderConfirmationSprint();
      options.renderConfirmationQueue();
      if (options.renderOpsInbox) {
        options.renderOpsInbox();
      }
      if (status) {
        status.textContent = "Profile marked applied.";
      }
    });
  });
}

function getLicensureLaneLabel(item) {
  if (item.refresh_status === "failed") {
    return "Failed refresh";
  }
  if (item.queue_reason === "missing_cache") {
    return "Missing cache";
  }
  if (item.expiration_date) {
    return "Expiration watch";
  }
  return "Refresh due";
}

function buildLicensureRefreshCommand(item) {
  const id = item && item.therapist_id ? item.therapist_id : "";
  const base =
    "PATH=/opt/homebrew/bin:$PATH npm run cms:enrich:california-licensure -- --scope=therapists --id=" +
    id +
    " --limit=1 --delay-ms=5000";
  if (item && item.refresh_status === "failed") {
    return base + " --force";
  }
  return base;
}
