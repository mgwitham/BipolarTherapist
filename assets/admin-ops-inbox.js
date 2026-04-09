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

  const totalActions =
    publishNow.length +
    duplicateQueue.length +
    confirmationQueue.length +
    refreshQueue.length +
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

  function renderGroup(title, note, rowsHtml) {
    return (
      '<section class="ops-group"><div class="ops-group-head"><div><h3 class="ops-group-title">' +
      options.escapeHtml(title) +
      '</h3><div class="subtle">' +
      options.escapeHtml(note) +
      '</div></div></div><div class="ops-list">' +
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
    "</div></div>" +
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
