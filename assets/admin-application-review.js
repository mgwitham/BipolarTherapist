import {
  bindApplicationPanelInteractions,
  getApplicationActionFlash,
  getRecentApplicationActionFlashes,
} from "./admin-application-actions.js";

function getApplicationStateMeta(config) {
  if (!config) {
    return {
      tone: "neutral",
      title: "Needs review",
      copy: "Open the submitted profile, confirm the trust details, and make a clear decision.",
      badge: "Review pending",
    };
  }
  if (config.isConfirmationRefresh) {
    return {
      tone: "trust",
      title: "Live listing update",
      copy: "This submission changes an existing live profile, so trust and accuracy matter most.",
      badge: "Live trust work",
    };
  }
  if (config.isClaimFlow) {
    return {
      tone: "ownership",
      title: "Claim conversion",
      copy: "This therapist started in the claim flow and now needs a decisive review outcome.",
      badge: "Claim review",
    };
  }
  if (config.isPublishReady) {
    return {
      tone: "publish",
      title: "Strong publish candidate",
      copy: "The trust-critical fields are in good shape and this profile looks ready to go live.",
      badge: "Publish leverage",
    };
  }
  return {
    tone: "trust",
    title: "Needs fixes before publish",
    copy: "The profile is promising, but the trust blockers should be resolved before it goes live.",
    badge: "Needs fixes",
  };
}

function getPrimaryApplicationActionLabel(config) {
  if (!config) {
    return "Publish";
  }
  if (config.isClaimFlow) {
    return "Approve claim";
  }
  if (config.isConfirmationRefresh) {
    return "Apply refresh";
  }
  return "Publish";
}

function buildCompactApplicationFacts(options, config) {
  const facts = [];
  if (!options || !config) {
    return facts;
  }

  const completenessScore =
    config.readiness && Number.isFinite(Number(config.readiness.completeness_score))
      ? Number(config.readiness.completeness_score)
      : null;
  const matchReadinessScore =
    config.readiness && Number.isFinite(Number(config.readiness.score))
      ? Number(config.readiness.score)
      : null;

  if (completenessScore !== null) {
    facts.push({
      label: String(completenessScore) + "/100 complete",
      tone: completenessScore >= 70 ? "publish" : "neutral",
    });
  }
  if (matchReadinessScore !== null) {
    facts.push({
      label: String(matchReadinessScore) + "/100 match-ready",
      tone: matchReadinessScore >= 70 ? "publish" : "neutral",
    });
  }
  if (config.reviewSnapshot && config.reviewSnapshot.missingCriticalFields.length) {
    facts.push({
      label: config.reviewSnapshot.missingCriticalFields[0],
      tone: "trust",
    });
  } else {
    facts.push({
      label:
        config.item && config.item.license_number
          ? "Trust-critical basics present"
          : "License missing",
      tone: config.item && config.item.license_number ? "neutral" : "trust",
    });
  }
  if (config.reviewSnapshot && config.reviewSnapshot.photoStatusLabel) {
    facts.push({
      label: config.reviewSnapshot.photoStatusLabel,
      tone:
        /no headshot|missing/i.test(String(config.reviewSnapshot.photoStatusLabel)) ||
        !config.item.photo
          ? "trust"
          : "neutral",
    });
  }

  return facts.slice(0, 4);
}

function getStatusFilterLabel(value) {
  if (value === "publish_ready") return "Publish-ready";
  if (value === "needs_changes") return "Needs fixes";
  if (value === "on_hold") return "On hold";
  if (value === "rejected") return "Rejected";
  return "All";
}

function getDecisionPlan(config) {
  if (config.item.status === "rejected") {
    return {
      recommendation: "Review details first",
      note: "This signup is already closed out. Open the details if you need context.",
      primaryAction: {
        kind: "details",
        label: "Review",
      },
    };
  }
  if (
    config.reviewSnapshot.focus === "publish_ready" ||
    config.isClaimFlow ||
    config.isConfirmationRefresh
  ) {
    return {
      recommendation: getPrimaryApplicationActionLabel(config),
      note: config.reviewSnapshot.note || config.stateMeta.copy,
      primaryAction: {
        kind: "action",
        action: config.isClaimFlow ? "approve_claim" : "publish",
        label: getPrimaryApplicationActionLabel(config),
      },
    };
  }
  if (
    config.reviewSnapshot.focus === "needs_changes" ||
    config.reviewSnapshot.missingCriticalFields.length >= 2
  ) {
    return {
      recommendation: "Request changes before publishing",
      note:
        config.reviewSnapshot.missingCriticalFields.length > 0
          ? "Blocking trust items: " +
            config.reviewSnapshot.missingCriticalFields.slice(0, 3).join(", ")
          : config.stateMeta.copy,
      primaryAction: {
        kind: "action",
        action: "requested_changes",
        label: "Request changes",
      },
    };
  }
  return {
    recommendation: "Review details first",
    note: config.reviewSnapshot.note || config.stateMeta.copy,
    primaryAction: {
      kind: "details",
      label: "Review",
    },
  };
}

function buildPrimaryActionHtml(options, item, decisionPlan) {
  if (decisionPlan.primaryAction.kind === "details") {
    return (
      '<button class="btn-primary" type="button" data-open-review-details="' +
      options.escapeHtml(item.id) +
      '">' +
      options.escapeHtml(decisionPlan.primaryAction.label) +
      "</button>"
    );
  }
  return (
    '<button class="btn-primary" data-action="' +
    options.escapeHtml(decisionPlan.primaryAction.action) +
    '" data-id="' +
    options.escapeHtml(item.id) +
    '">' +
    options.escapeHtml(decisionPlan.primaryAction.label) +
    "</button>"
  );
}

function buildDetailDecisionBar(options, item, config) {
  if (item.status === "approved") {
    return "";
  }
  const publishLabel = getPrimaryApplicationActionLabel(config);
  return (
    '<div class="review-details-toolbar">' +
    '<button class="btn-primary" data-action="' +
    options.escapeHtml(config.isClaimFlow ? "approve_claim" : "publish") +
    '" data-id="' +
    options.escapeHtml(item.id) +
    '">' +
    options.escapeHtml(publishLabel) +
    '</button><button class="btn-secondary" data-action="requested_changes" data-id="' +
    options.escapeHtml(item.id) +
    '">Request changes</button><button class="btn-secondary" data-action="reject" data-id="' +
    options.escapeHtml(item.id) +
    '">Reject</button><button class="btn-secondary btn-inline" type="button" data-close-review-details="' +
    options.escapeHtml(item.id) +
    '">Close details</button></div>'
  );
}

function buildSummaryStrip(options, summaryCounts) {
  return (
    '<section class="review-summary-strip" aria-label="Signup review summary">' +
    [
      { value: summaryCounts.totalToReview, label: "Total to review" },
      { value: summaryCounts.publishReady, label: "Publish-ready" },
      { value: summaryCounts.needsFixes, label: "Needs fixes" },
      { value: summaryCounts.onHold, label: "On hold" },
    ]
      .concat(summaryCounts.rejected ? [{ value: summaryCounts.rejected, label: "Rejected" }] : [])
      .map(function (item) {
        return (
          '<article class="review-summary-card"><span class="review-summary-value">' +
          options.escapeHtml(String(item.value)) +
          '</span><span class="review-summary-label">' +
          options.escapeHtml(item.label) +
          "</span></article>"
        );
      })
      .join("") +
    "</section>"
  );
}

function buildFilterCards(options, summaryCounts, applicationFilters) {
  const cards = [
    {
      status: "",
      focus: "",
      label: "All",
      value: summaryCounts.totalToReview,
      note: "Every active signup in the review queue.",
    },
    {
      status: "publish_ready",
      focus: "",
      label: "Publish-ready",
      value: summaryCounts.publishReady,
      note: "Strong submissions that can likely be published now.",
    },
    {
      status: "needs_changes",
      focus: "",
      label: "Needs fixes",
      value: summaryCounts.needsFixes,
      note: "Profiles that should loop for changes before publish.",
    },
    {
      status: "on_hold",
      focus: "active_review",
      label: "On hold",
      value: summaryCounts.onHold,
      note: "Already-open reviews that still need a clear next call.",
    },
  ];
  if (summaryCounts.rejected) {
    cards.push({
      status: "rejected",
      focus: "",
      label: "Rejected",
      value: summaryCounts.rejected,
      note: "Closed-out submissions kept here for reference.",
    });
  }
  return (
    '<div class="review-priority-grid">' +
    cards
      .map(function (item) {
        const isActive =
          (applicationFilters.status || "") === (item.status || "") &&
          (applicationFilters.focus || "") === (item.focus || "");
        return (
          '<button type="button" class="review-priority-card' +
          (isActive ? " is-active" : "") +
          '" data-application-status-card="' +
          options.escapeHtml(item.status || "") +
          '" data-application-focus-card="' +
          options.escapeHtml(item.focus || "") +
          '"><div class="review-priority-value">' +
          options.escapeHtml(String(item.value)) +
          '</div><div class="review-priority-label">' +
          options.escapeHtml(item.label) +
          '</div><div class="review-priority-note">' +
          options.escapeHtml(item.note) +
          '</div><div class="review-priority-meta"><span class="review-priority-chip is-neutral">Filter queue</span></div></button>'
        );
      })
      .join("") +
    "</div>"
  );
}

export function renderApplicationsPanel(options) {
  const applications =
    options.dataMode === "sanity" ? options.remoteApplications : options.getApplications();
  const root = document.getElementById("applicationsList");

  if (options.authRequired) {
    root.innerHTML = "";
    return;
  }

  const filteredApplications = applications
    .filter(function (item) {
      const snapshot = options.getApplicationReviewSnapshot(item);
      const haystack = [item.name, item.city, item.state, item.credentials, item.title, item.email]
        .concat(item.specialties || [])
        .join(" ")
        .toLowerCase();

      if (
        options.applicationFilters.q &&
        !haystack.includes(options.applicationFilters.q.toLowerCase())
      ) {
        return false;
      }

      if (options.applicationFilters.status === "publish_ready") {
        return snapshot.focus === "publish_ready";
      }
      if (options.applicationFilters.status === "needs_changes") {
        return snapshot.focus === "needs_changes";
      }
      if (options.applicationFilters.status === "on_hold") {
        return item.status === "reviewing" || snapshot.focus === "active_review";
      }
      if (options.applicationFilters.status === "rejected") {
        return item.status === "rejected";
      }

      if (options.applicationFilters.focus && snapshot.focus !== options.applicationFilters.focus) {
        return false;
      }

      return item.status !== "approved";
    })
    .sort(function (a, b) {
      const sortGoal =
        options.applicationFilters.status === "needs_changes" ? "fix_weak" : "publish_now";
      const scoreDelta =
        options.getGoalAdjustedApplicationPriorityScore(b, sortGoal) -
        options.getGoalAdjustedApplicationPriorityScore(a, sortGoal);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    });

  if (!applications.length) {
    root.innerHTML =
      '<div class="empty"><strong>No signups to review right now.</strong><br />The signup queue is clear for the moment.</div>';
    return;
  }

  if (!filteredApplications.length) {
    root.innerHTML =
      '<div class="empty"><strong>No signups match this filter.</strong><br />Try a different state or clear search.<div style="margin-top:0.8rem"><button class="btn-secondary btn-inline" type="button" data-application-clear-filters>Clear review filters</button></div></div>';
    bindApplicationPanelInteractions(root, {
      applicationFilters: options.applicationFilters,
      recommendedBatch: [],
      reviewGoalMeta: {
        primaryActionMode: "publish_now",
        primaryActionLabel: "Copy publish batch",
      },
      applications: applications,
      dataMode: options.dataMode,
      remoteApplications: options.remoteApplications,
      copyText: options.copyText,
      spotlightSection: options.spotlightSection,
      renderApplications: options.renderApplications,
      renderAll: options.renderAll,
      setCoachActionStatus: options.setCoachActionStatus,
      appendImprovementRequestToNotes: options.appendImprovementRequestToNotes,
      updateTherapistApplication: options.updateTherapistApplication,
      approveTherapistApplication: options.approveTherapistApplication,
      rejectTherapistApplicationRemote: options.rejectTherapistApplicationRemote,
      requestApplicationChanges: options.requestApplicationChanges,
      approveApplication: options.approveApplication,
      publishApplication: options.publishApplication,
      rejectApplication: options.rejectApplication,
      updateApplicationReviewMetadata: options.updateApplicationReviewMetadata,
      setApplyLiveFieldsStatus: options.setApplyLiveFieldsStatus,
      applyTherapistApplicationFields: options.applyTherapistApplicationFields,
      buildApplicationApplySummary: options.buildApplicationApplySummary,
      applicationLiveApplySummaries: options.applicationLiveApplySummaries,
      loadData: options.loadData,
    });
    return;
  }

  const summaryCounts = applications.reduce(
    function (counts, item) {
      const snapshot = options.getApplicationReviewSnapshot(item);
      if (item.status !== "approved" && item.status !== "rejected") {
        counts.totalToReview += 1;
      }
      if (snapshot.focus === "publish_ready") {
        counts.publishReady += 1;
      }
      if (snapshot.focus === "needs_changes") {
        counts.needsFixes += 1;
      }
      if (item.status === "reviewing" || snapshot.focus === "active_review") {
        counts.onHold += 1;
      }
      if (item.status === "rejected") {
        counts.rejected += 1;
      }
      return counts;
    },
    {
      totalToReview: 0,
      publishReady: 0,
      needsFixes: 0,
      onHold: 0,
      rejected: 0,
    },
  );

  const topReviewTarget = filteredApplications[0] || null;
  const recentActionFlashes = getRecentApplicationActionFlashes(3);
  const activeFilterLabel = getStatusFilterLabel(options.applicationFilters.status);

  root.innerHTML =
    (recentActionFlashes.length
      ? '<div class="queue-insights"><div class="queue-insights-title">Done recently</div><div class="queue-insights-grid">' +
        recentActionFlashes
          .map(function (entry) {
            const application = applications.find(function (item) {
              return item.id === entry.id;
            });
            return (
              '<div class="queue-insight-card"><div class="queue-insight-label"><strong>' +
              options.escapeHtml(application && application.name ? application.name : entry.id) +
              '</strong></div><div class="queue-insight-note">' +
              options.escapeHtml(entry.message) +
              "</div></div>"
            );
          })
          .join("") +
        "</div></div>"
      : "") +
    buildSummaryStrip(options, summaryCounts) +
    '<div class="review-ops-bar"><div class="review-ops-title">Review queue</div><div class="review-ops-copy">' +
    options.escapeHtml(
      topReviewTarget
        ? "Showing " +
            activeFilterLabel +
            ". Start with " +
            topReviewTarget.name +
            ". " +
            options.getApplicationReviewSnapshot(topReviewTarget).nextMove
        : "No signup is visible for the current filter.",
    ) +
    '</div><div class="review-ops-meta"><span class="review-priority-chip">' +
    options.escapeHtml(activeFilterLabel) +
    '</span><span class="review-priority-chip is-neutral">Sorted by publish confidence, then newest</span></div><div class="queue-actions" style="margin-top:0"><button class="btn-secondary" type="button" data-application-clear-filters>Clear filters</button>' +
    (topReviewTarget
      ? '<button class="btn-primary" type="button" data-application-jump="' +
        options.escapeHtml(topReviewTarget.id) +
        '">Open top review</button>'
      : "") +
    "</div></div>" +
    buildFilterCards(options, summaryCounts, options.applicationFilters) +
    filteredApplications
      .map(function (item, index) {
        const readiness = options.getTherapistMatchReadiness(item);
        const reviewSnapshot = options.getApplicationReviewSnapshot(item);
        const afterClaimReviewStall = options.getAfterClaimReviewStall(item);
        const portalStateLabel =
          item.portal_state_label || options.formatStatusLabel(item.status || "pending");
        const portalNextStep = item.portal_next_step || reviewSnapshot.nextMove;
        const isClaimFlow = item.submission_intent === "claim";
        const isConfirmationRefresh = options.isConfirmationRefreshApplication(item);
        const fitTags = []
          .concat(item.treatment_modalities || [])
          .concat(item.client_populations || [])
          .slice(0, 8)
          .map(function (tag) {
            return '<span class="tag">' + options.escapeHtml(tag) + "</span>";
          })
          .join("");
        const actionFlash = getApplicationActionFlash(item.id);
        const stateMeta = getApplicationStateMeta({
          isClaimFlow: isClaimFlow,
          isConfirmationRefresh: isConfirmationRefresh,
          isPublishReady: reviewSnapshot.focus === "publish_ready",
        });
        const compactFacts = buildCompactApplicationFacts(options, {
          item: item,
          readiness: readiness,
          reviewSnapshot: reviewSnapshot,
          afterClaimReviewStall: afterClaimReviewStall,
        });
        const decisionPlan = getDecisionPlan({
          item: item,
          reviewSnapshot: reviewSnapshot,
          isClaimFlow: isClaimFlow,
          isConfirmationRefresh: isConfirmationRefresh,
          stateMeta: stateMeta,
        });

        return (
          '<article class="application-card' +
          (index === 0 ? " is-start-here" : "") +
          '"' +
          (actionFlash ? ' data-has-action-flash="true"' : "") +
          ' data-application-card-id="' +
          options.escapeHtml(item.id) +
          '"' +
          (index === 0 ? ' id="applicationReviewStartHere"' : "") +
          ">" +
          '<div class="application-head"><div><h3>' +
          options.escapeHtml(item.name) +
          '</h3><p class="subtle">' +
          options.escapeHtml(item.credentials) +
          (item.title ? " · " + options.escapeHtml(item.title) : "") +
          " · " +
          options.escapeHtml(item.city) +
          ", " +
          options.escapeHtml(item.state) +
          '</p></div><div class="subtle">' +
          options.formatDate(item.created_at) +
          "</div></div>" +
          '<div class="application-card-shell">' +
          '<div class="application-card-topline">' +
          (index === 0 ? '<span class="application-priority-chip">Start here</span>' : "") +
          '<span class="application-priority-chip is-' +
          options.escapeHtml(stateMeta.tone) +
          '">' +
          options.escapeHtml(stateMeta.badge) +
          "</span>" +
          '<span class="application-priority-chip is-neutral">' +
          options.escapeHtml(reviewSnapshot.label) +
          "</span>" +
          '<span class="application-priority-chip is-neutral">' +
          options.escapeHtml(portalStateLabel) +
          "</span></div>" +
          '<p class="application-card-summary"><strong>Recommended:</strong> ' +
          options.escapeHtml(decisionPlan.recommendation) +
          "</p>" +
          '<p class="application-card-subsummary">' +
          options.escapeHtml(decisionPlan.note) +
          "</p>" +
          '<div class="application-card-actions">' +
          buildPrimaryActionHtml(options, item, decisionPlan) +
          (item.status !== "approved"
            ? '<button class="btn-secondary" data-action="reject" data-id="' +
              options.escapeHtml(item.id) +
              '">Reject</button>'
            : "") +
          '<button class="btn-secondary btn-inline" type="button" data-open-review-details="' +
          options.escapeHtml(item.id) +
          '">Details</button></div>' +
          (compactFacts.length
            ? '<div class="application-compact-facts">' +
              compactFacts
                .map(function (fact) {
                  return (
                    '<span class="application-fact-pill is-' +
                    options.escapeHtml(fact.tone || "neutral") +
                    '">' +
                    options.escapeHtml(fact.label) +
                    "</span>"
                  );
                })
                .join("") +
              "</div>"
            : "") +
          (actionFlash
            ? '<div class="review-coach-status">' + options.escapeHtml(actionFlash) + "</div>"
            : "") +
          "</div>" +
          '<details class="review-details" data-review-details-id="' +
          options.escapeHtml(item.id) +
          '"><summary class="review-details-summary">Submitted profile details</summary><div class="review-details-body">' +
          buildDetailDecisionBar(options, item, {
            isClaimFlow: isClaimFlow,
            isConfirmationRefresh: isConfirmationRefresh,
          }) +
          '<div class="review-snapshot-box"><div class="review-snapshot-title">Recommendation</div><div class="review-snapshot-copy"><strong>' +
          options.escapeHtml(decisionPlan.recommendation) +
          ":</strong> " +
          options.escapeHtml(decisionPlan.note) +
          '</div></div><div class="review-snapshot-box"><div class="review-snapshot-title">Trust blockers</div><div class="review-snapshot-copy">' +
          options.escapeHtml(
            reviewSnapshot.missingCriticalFields.length
              ? reviewSnapshot.missingCriticalFields.join(", ")
              : "No trust-critical blockers surfaced in the current review snapshot.",
          ) +
          '</div></div><div class="review-snapshot-box"><div class="review-snapshot-title">Submitted profile details</div><div class="review-snapshot-copy"><strong>' +
          options.escapeHtml(portalStateLabel) +
          ":</strong> " +
          options.escapeHtml(portalNextStep) +
          '</div><div class="review-snapshot-copy"><strong>Match readiness:</strong> ' +
          options.escapeHtml(readiness.label) +
          " (" +
          options.escapeHtml(readiness.score) +
          '/100)</div><div class="review-snapshot-copy"><strong>Profile completeness:</strong> ' +
          options.escapeHtml(readiness.completeness_score) +
          "/100</div></div>" +
          (item.care_approach
            ? '<p class="application-bio"><strong>How they help bipolar clients:</strong> ' +
              options.escapeHtml(item.care_approach) +
              "</p>"
            : "") +
          '<p class="application-bio">' +
          options.escapeHtml(item.bio || "No profile bio submitted yet.") +
          "</p>" +
          '<div class="tag-row">' +
          (item.specialties || [])
            .map(function (specialty) {
              return '<span class="tag">' + options.escapeHtml(specialty) + "</span>";
            })
            .join("") +
          "</div>" +
          (fitTags ? '<div class="tag-row">' + fitTags + "</div>" : "") +
          '<div class="meta-grid"><div><strong>Email:</strong> ' +
          options.escapeHtml(item.email || "Not provided") +
          "</div><div><strong>Phone:</strong> " +
          options.escapeHtml(item.phone || "Not provided") +
          "</div><div><strong>License:</strong> " +
          options.escapeHtml(
            [item.license_state, item.license_number].filter(Boolean).join(" · ") || "Not provided",
          ) +
          "</div><div><strong>Photo:</strong> " +
          options.escapeHtml(reviewSnapshot.photoStatusLabel) +
          "</div><div><strong>Insurance:</strong> " +
          options.escapeHtml((item.insurance_accepted || []).join(", ") || "Not provided") +
          "</div><div><strong>Wait time:</strong> " +
          options.escapeHtml(item.estimated_wait_time || "Not provided") +
          "</div><div><strong>Contact guidance:</strong> " +
          options.escapeHtml(item.contact_guidance || "Not provided") +
          "</div><div><strong>Next step after contact:</strong> " +
          options.escapeHtml(item.first_step_expectation || "Not provided") +
          "</div></div></div></details></article>"
        );
      })
      .join("");

  bindApplicationPanelInteractions(root, {
    applicationFilters: options.applicationFilters,
    recommendedBatch: [],
    reviewGoalMeta: { primaryActionMode: "publish_now", primaryActionLabel: "Copy publish batch" },
    applications: applications,
    dataMode: options.dataMode,
    remoteApplications: options.remoteApplications,
    copyText: options.copyText,
    spotlightSection: options.spotlightSection,
    renderApplications: options.renderApplications,
    renderAll: options.renderAll,
    setCoachActionStatus: options.setCoachActionStatus,
    appendImprovementRequestToNotes: options.appendImprovementRequestToNotes,
    updateTherapistApplication: options.updateTherapistApplication,
    approveTherapistApplication: options.approveTherapistApplication,
    rejectTherapistApplicationRemote: options.rejectTherapistApplicationRemote,
    requestApplicationChanges: options.requestApplicationChanges,
    approveApplication: options.approveApplication,
    publishApplication: options.publishApplication,
    rejectApplication: options.rejectApplication,
    updateApplicationReviewMetadata: options.updateApplicationReviewMetadata,
    setApplyLiveFieldsStatus: options.setApplyLiveFieldsStatus,
    applyTherapistApplicationFields: options.applyTherapistApplicationFields,
    buildApplicationApplySummary: options.buildApplicationApplySummary,
    applicationLiveApplySummaries: options.applicationLiveApplySummaries,
    loadData: options.loadData,
  });

  import("./admin-triage-focus.js").then(function (mod) {
    mod.reapplyFocusAfterRender(root);
  });
}
