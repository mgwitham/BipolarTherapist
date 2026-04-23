import {
  bindApplicationPanelInteractions,
  getApplicationActionFlash,
  getRecentApplicationActionFlashes,
} from "./admin-application-actions.js";
import {
  renderActionFirstIntro,
  renderDecisionGuide,
  renderRecommendedActionBar,
} from "./admin-action-first.js";

function renderApplicationCommandStrip(config) {
  if (!config) {
    return "";
  }
  return (
    '<div class="card-command-strip"><div class="card-command-kicker">Review command</div><div class="card-command-title">' +
    config.escapeHtml(config.title || "Choose the next application decision") +
    '</div><div class="card-command-copy">' +
    config.escapeHtml(config.copy || "") +
    '</div><div class="card-command-grid"><div class="card-command-cell"><div class="card-command-label">Lifecycle lane</div><div class="card-command-value">' +
    config.escapeHtml(config.lane || "") +
    '</div></div><div class="card-command-cell"><div class="card-command-label">Review goal</div><div class="card-command-value">' +
    config.escapeHtml(config.goal || "") +
    '</div></div><div class="card-command-cell"><div class="card-command-label">Success condition</div><div class="card-command-value">' +
    config.escapeHtml(config.success || "") +
    '</div></div></div><div class="card-command-callout"><strong>Business impact:</strong> ' +
    config.escapeHtml(config.callout || "") +
    "</div></div>"
  );
}

function getApplicationStateMeta(config) {
  if (!config) {
    return {
      tone: "ownership",
      title: "Needs explicit review ownership",
      copy: "This record should leave with a clearer state than it entered.",
      badge: "Review pending",
      chips: ["Decision required", "Operator judgment"],
    };
  }
  if (config.isClaimFlow) {
    if (config.isUrgent) {
      return {
        tone: "ownership",
        title: "Warm claim at risk of cooling off",
        copy: "This is not just a form review. It is a conversion opportunity that loses value if follow-up slows down.",
        badge: "Follow-up risk",
        chips: ["Claim conversion", "Needs owner now"],
      };
    }
    return {
      tone: "ownership",
      title: "Claim flow needs decisive follow-through",
      copy: "The main win is moving therapist intent into a fuller profile or a clear no, without leaving the claim in limbo.",
      badge: "Claim workflow",
      chips: ["Warm pipeline", "Ownership matters"],
    };
  }
  if (config.isConfirmationRefresh) {
    return {
      tone: "trust",
      title: "Live listing trust update",
      copy: "This submission affects a live profile. Accuracy and clean application of updates matter more than speed alone.",
      badge: "Live trust work",
      chips: ["Protect live quality", "Maintenance lane"],
    };
  }
  if (config.isPublishReady) {
    return {
      tone: "publish",
      title: "Strong candidate for live inventory",
      copy: "This application is close to becoming public supply. A clean review pass here is often the fastest path to trusted growth.",
      badge: "Publish leverage",
      chips: ["Near publish", "Growth-ready"],
    };
  }
  return {
    tone: "trust",
    title: "Quality gate before publication",
    copy: "This application is promising, but trust and completeness still determine whether it should move, loop for fixes, or stop.",
    badge: "Review quality",
    chips: ["Trust decision", "Quality control"],
  };
}

function renderApplicationStateStrip(config) {
  var meta = getApplicationStateMeta(config);
  return (
    '<div class="card-state-strip is-' +
    config.escapeHtml(meta.tone) +
    '"><div class="card-state-head"><div><div class="card-state-kicker">Application state</div><div class="card-state-title">' +
    config.escapeHtml(meta.title) +
    '</div><div class="card-state-copy">' +
    config.escapeHtml(meta.copy) +
    '</div></div><div class="card-state-badge">' +
    config.escapeHtml(meta.badge) +
    '</div></div><div class="card-state-meta">' +
    meta.chips
      .map(function (chip) {
        return (
          '<span class="tag is-' +
          config.escapeHtml(meta.tone) +
          '">' +
          config.escapeHtml(chip) +
          "</span>"
        );
      })
      .join("") +
    "</div></div>"
  );
}

function renderApplicationActionClusters(config) {
  if (!config) {
    return "";
  }
  var primaryActionHtml = config.primaryActionHtml || "";
  var secondaryActions = Array.isArray(config.secondaryActions) ? config.secondaryActions : [];
  var contextActions = Array.isArray(config.contextActions) ? config.contextActions : [];
  return (
    '<div class="action-cluster-grid"><div class="action-cluster is-primary"><div class="action-cluster-label">Best move</div><div class="action-cluster-copy">' +
    config.escapeHtml(config.primaryCopy || "Choose the clearest next state and move the record.") +
    '</div><div class="action-cluster-actions">' +
    primaryActionHtml +
    '</div></div><div class="action-cluster is-secondary"><div class="action-cluster-label">Fallback moves</div><div class="action-cluster-copy">' +
    config.escapeHtml(
      config.secondaryCopy ||
        "Use these options when the recommended path fails trust, fit, or readiness review.",
    ) +
    '</div><div class="action-cluster-actions">' +
    secondaryActions.join("") +
    '</div></div><div class="action-cluster is-context"><div class="action-cluster-label">Context</div><div class="action-cluster-copy">' +
    config.escapeHtml(
      config.contextCopy || "Keep communication and context tools close to the decision surface.",
    ) +
    '</div><div class="action-cluster-actions">' +
    contextActions.join("") +
    "</div></div></div>"
  );
}

function getReviewAgeDays(value) {
  if (!value) {
    return null;
  }
  var timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  var delta = Date.now() - timestamp;
  if (delta < 0) {
    return 0;
  }
  return Math.max(0, Math.floor(delta / 86400000));
}

function getOperationalTimestampLabel(item, formatDate) {
  if (!item) {
    return "";
  }
  var pendingAgeDays = getReviewAgeDays(item.created_at);
  var reviewAgeDays = getReviewAgeDays(item.updated_at || item.created_at);
  if (item.status === "pending" && pendingAgeDays !== null) {
    return "Awaiting review " + pendingAgeDays + "d";
  }
  if (item.status === "reviewing" && reviewAgeDays !== null) {
    return "In review " + reviewAgeDays + "d";
  }
  if (item.updated_at && item.updated_at !== item.created_at) {
    return "Updated " + formatDate(item.updated_at);
  }
  if (item.created_at) {
    return "Submitted " + formatDate(item.created_at);
  }
  return "Review timing unavailable";
}

function getWorkflowStateTone(status) {
  if (status === "approved") {
    return "publish";
  }
  if (status === "reviewing") {
    return "ownership";
  }
  if (status === "requested_changes" || status === "rejected") {
    return "trust";
  }
  return "neutral";
}

function getWorkflowStateLabel(status, formatStatusLabel) {
  if (status === "pending") {
    return "Pending review";
  }
  if (status === "reviewing") {
    return "In review";
  }
  if (status === "requested_changes") {
    return "Needs changes";
  }
  if (status === "approved") {
    return "Approved";
  }
  if (status === "rejected") {
    return "Blocked";
  }
  return formatStatusLabel(status || "pending");
}

function getWorkTypeMeta(item, reviewSnapshot, isClaimFlow, isConfirmationRefresh) {
  if (isConfirmationRefresh) {
    return {
      value: "Confirmation update",
      tone: "trust",
    };
  }
  if (reviewSnapshot && reviewSnapshot.focus === "claim_conversion") {
    return {
      value: "Post-claim profile",
      tone: "publish",
    };
  }
  if (isClaimFlow) {
    return {
      value: "Claim review",
      tone: "ownership",
    };
  }
  return {
    value: "Signup",
    tone: "neutral",
  };
}

function getPriorityMeta(index, reviewSnapshot, claimFollowUpUrgency, afterClaimReviewStall) {
  if (index === 0) {
    return {
      value: "Start here",
      tone: "ownership",
      note: "Top queue target",
    };
  }
  if (
    (claimFollowUpUrgency && claimFollowUpUrgency.tone === "urgent") ||
    (afterClaimReviewStall && afterClaimReviewStall.stalled)
  ) {
    return {
      value: "Urgent",
      tone: "trust",
      note: "Aging or overdue",
    };
  }
  if (reviewSnapshot && reviewSnapshot.focus === "publish_ready") {
    return {
      value: "High leverage",
      tone: "publish",
      note: "Close to publish",
    };
  }
  return {
    value: "Normal",
    tone: "neutral",
    note: "Standard review",
  };
}

function uniqueIssueList(items) {
  var seen = new Set();
  return (Array.isArray(items) ? items : []).filter(function (item) {
    var value = String(item || "").trim();
    var key = value.toLowerCase();
    if (!value || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function getIssueBuckets(config) {
  var reviewSnapshot = config.reviewSnapshot;
  var readiness = config.readiness;
  var freshness = config.freshness;
  var claimFollowUpUrgency = config.claimFollowUpUrgency;
  var afterClaimReviewStall = config.afterClaimReviewStall;
  var liveSyncSnapshot = config.liveSyncSnapshot;

  var blocking = uniqueIssueList(
    (reviewSnapshot && reviewSnapshot.missingCriticalFields) || [],
  ).map(function (item) {
    return item.charAt(0).toUpperCase() + item.slice(1);
  });

  var recommended = uniqueIssueList((readiness && readiness.missing_items) || [])
    .filter(function (item) {
      return !blocking.some(function (blockingItem) {
        return blockingItem.toLowerCase().includes(String(item).toLowerCase());
      });
    })
    .slice(0, 4);

  var advisory = [];
  if (readiness && Number(readiness.score) < 60) {
    advisory.push("Match-readiness is still low at " + readiness.score + "/100.");
  }
  if (freshness && freshness.note) {
    advisory.push(freshness.note);
  }
  if (claimFollowUpUrgency && claimFollowUpUrgency.tone === "urgent" && claimFollowUpUrgency.note) {
    advisory.push(claimFollowUpUrgency.note);
  }
  if (afterClaimReviewStall && afterClaimReviewStall.stalled && afterClaimReviewStall.note) {
    advisory.push(afterClaimReviewStall.note);
  }
  if (liveSyncSnapshot && liveSyncSnapshot.changedCount) {
    advisory.push(liveSyncSnapshot.syncLabel + ".");
  }

  return {
    blocking: blocking,
    recommended: recommended,
    advisory: uniqueIssueList(advisory).slice(0, 3),
  };
}

function renderStatusCell(config) {
  return (
    '<div class="application-status-cell"><div class="application-status-label">' +
    config.escapeHtml(config.label) +
    '</div><span class="queue-chip queue-chip--' +
    config.escapeHtml(config.tone || "neutral") +
    '">' +
    config.escapeHtml(config.value) +
    "</span>" +
    (config.note
      ? '<div class="application-status-note">' + config.escapeHtml(config.note) + "</div>"
      : "") +
    "</div>"
  );
}

function renderIssueColumn(config) {
  var items = Array.isArray(config.items) ? config.items : [];
  return (
    '<div class="application-issue-column"><div class="application-issue-label">' +
    config.escapeHtml(config.label) +
    '</div><div class="application-issue-copy">' +
    config.escapeHtml(config.copy) +
    "</div>" +
    (items.length
      ? '<ul class="application-issue-list">' +
        items
          .map(function (item) {
            return "<li>" + config.escapeHtml(item) + "</li>";
          })
          .join("") +
        "</ul>"
      : '<div class="application-issue-empty">None right now.</div>') +
    "</div>"
  );
}

export function renderApplicationsPanel(options) {
  const applications =
    options.dataMode === "sanity" ? options.remoteApplications : options.getApplications();
  const root = document.getElementById("applicationsList");
  const reviewGoalMeta = options.getApplicationReviewGoalMeta(options.applicationFilters.goal);
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

      if (options.applicationFilters.status && item.status !== options.applicationFilters.status) {
        return false;
      }

      if (options.applicationFilters.focus) {
        if (
          options.applicationFilters.focus === "claim_flow" &&
          item.submission_intent !== "claim"
        ) {
          return false;
        }
        if (
          options.applicationFilters.focus === "full_profile_flow" &&
          item.submission_intent === "claim"
        ) {
          return false;
        }
        if (
          options.applicationFilters.focus === "claimed_ready_for_profile" &&
          item.portal_state !== "claimed_ready_for_profile"
        ) {
          return false;
        }
        if (
          options.applicationFilters.focus === "claim_follow_up_due" &&
          snapshot.focus !== "claim_follow_up_due"
        ) {
          return false;
        }
        if (
          options.applicationFilters.focus === "claim_conversion" &&
          snapshot.focus !== "claim_conversion"
        ) {
          return false;
        }
        if (
          options.applicationFilters.focus === "stalled_after_claim_review" &&
          snapshot.focus !== "stalled_after_claim_review"
        ) {
          return false;
        }
        if (
          ![
            "claim_flow",
            "full_profile_flow",
            "claim_follow_up_due",
            "claimed_ready_for_profile",
            "claim_conversion",
            "stalled_after_claim_review",
          ].includes(options.applicationFilters.focus) &&
          snapshot.focus !== options.applicationFilters.focus
        ) {
          return false;
        }
      }

      return true;
    })
    .sort(function (a, b) {
      var scoreDelta =
        options.getGoalAdjustedApplicationPriorityScore(b, options.applicationFilters.goal) -
        options.getGoalAdjustedApplicationPriorityScore(a, options.applicationFilters.goal);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    });

  if (options.authRequired) {
    root.innerHTML = "";
    return;
  }

  if (!applications.length) {
    root.innerHTML =
      '<div class="empty"><strong>No applications to review right now.</strong><br />The applications lane is empty, so there is nothing for an operator to process here yet.<div style="margin-top:0.8rem"><a class="btn-secondary btn-inline" href="#candidateQueuePanel">Go to Add New Listings instead</a></div></div>';
    return;
  }

  if (!filteredApplications.length) {
    root.innerHTML =
      '<div class="empty"><strong>No applications match this view.</strong><br />' +
      options.escapeHtml(options.getApplicationEmptyStateCopy(options.applicationFilters.goal)) +
      '<div style="margin-top:0.8rem"><button class="btn-secondary btn-inline" type="button" id="applicationEmptyClearFilters">Clear review filters</button></div></div>';
    var emptyClearFilters = document.getElementById("applicationEmptyClearFilters");
    if (emptyClearFilters) {
      emptyClearFilters.addEventListener("click", function () {
        options.applicationFilters.q = "";
        options.applicationFilters.status = "";
        options.applicationFilters.focus = "";
        options.applicationFilters.goal = "balanced";
        var search = document.getElementById("applicationSearch");
        var status = document.getElementById("applicationStatusFilter");
        var focus = document.getElementById("applicationFocusFilter");
        var goal = document.getElementById("applicationReviewGoal");
        if (search) {
          search.value = "";
        }
        if (status) {
          status.value = "";
        }
        if (focus) {
          focus.value = "";
        }
        if (goal) {
          goal.value = "balanced";
        }
        renderApplicationsPanel(options);
      });
    }
    return;
  }

  const summaryCounts = applications.reduce(
    function (accumulator, item) {
      const snapshot = options.getApplicationReviewSnapshot(item);
      accumulator.pending += item.status === "pending" ? 1 : 0;
      accumulator.reviewing += item.status === "reviewing" ? 1 : 0;
      accumulator.claims += item.submission_intent === "claim" ? 1 : 0;
      accumulator.full_profiles += item.submission_intent === "claim" ? 0 : 1;
      accumulator.approved_claims += item.portal_state === "claimed_ready_for_profile" ? 1 : 0;
      accumulator.claim_follow_up_due += snapshot.focus === "claim_follow_up_due" ? 1 : 0;
      accumulator.stalled_after_claim_review +=
        snapshot.focus === "stalled_after_claim_review" ? 1 : 0;
      accumulator.claim_conversions += snapshot.focus === "claim_conversion" ? 1 : 0;
      accumulator.publish_ready += snapshot.focus === "publish_ready" ? 1 : 0;
      accumulator.needs_changes += snapshot.focus === "needs_changes" ? 1 : 0;
      accumulator.confirmation_refresh += snapshot.focus === "confirmation_refresh" ? 1 : 0;
      return accumulator;
    },
    {
      pending: 0,
      reviewing: 0,
      claims: 0,
      full_profiles: 0,
      approved_claims: 0,
      claim_follow_up_due: 0,
      stalled_after_claim_review: 0,
      claim_conversions: 0,
      publish_ready: 0,
      needs_changes: 0,
      confirmation_refresh: 0,
    },
  );
  const recommendedBatch = filteredApplications.slice(0, 3);
  const topReviewTarget = recommendedBatch[0] || null;
  const activeFilterChips = options.getApplicationFilterChips();
  const claimFunnel = {
    submitted: applications.filter(function (item) {
      return item.submission_intent === "claim";
    }).length,
    approved: applications.filter(function (item) {
      return item.portal_state === "claimed_ready_for_profile";
    }).length,
    followUpSent: applications.filter(function (item) {
      return ["sent", "responded", "full_profile_started"].includes(item.claim_follow_up_status);
    }).length,
    fullProfileStarted: applications.filter(function (item) {
      return item.claim_follow_up_status === "full_profile_started";
    }).length,
    fullProfileSubmitted: applications.filter(function (item) {
      return ["profile_submitted_after_claim", "profile_in_review_after_claim"].includes(
        item.portal_state,
      );
    }).length,
    followUpDue: applications.filter(function (item) {
      return options.getClaimFollowUpUrgency(item).tone === "urgent";
    }).length,
    stalledReviews: applications.filter(function (item) {
      return options.getAfterClaimReviewStall(item).stalled;
    }).length,
  };
  const claimApprovalRate = claimFunnel.submitted
    ? (claimFunnel.approved / claimFunnel.submitted) * 100
    : 0;
  const claimFollowUpRate = claimFunnel.approved
    ? (claimFunnel.followUpSent / claimFunnel.approved) * 100
    : 0;
  const claimConversionRate = claimFunnel.approved
    ? (claimFunnel.fullProfileSubmitted / claimFunnel.approved) * 100
    : 0;
  const recentActionFlashes = getRecentApplicationActionFlashes(3);
  const claimRates = {
    approvalRate: claimApprovalRate,
    followUpRate: claimFollowUpRate,
    conversionRate: claimConversionRate,
  };
  const claimBottleneck = options.getClaimFunnelBottleneck(claimFunnel, claimRates);
  const claimActionQueue = options.getClaimActionQueue(applications);
  const claimLaunchCandidates = options.getClaimLaunchCandidates(applications);
  const stalledAfterClaimReviews = options.getStalledAfterClaimReviews(applications);
  const overdueClaims = applications
    .filter(function (item) {
      return options.getClaimFollowUpUrgency(item).tone === "urgent";
    })
    .sort(function (a, b) {
      return new Date(a.updated_at || 0).getTime() - new Date(b.updated_at || 0).getTime();
    })
    .slice(0, 3);

  root.innerHTML =
    (recentActionFlashes.length
      ? '<div class="queue-insights"><div class="queue-insights-title">Done Recently</div><div class="queue-insights-grid">' +
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
    '<div class="queue-insights"><div class="queue-insights-title">Application pipeline snapshot</div><div class="subtle" style="margin-bottom:0.7rem">Use this to track whether approved claims are actually turning into fuller profile submissions.</div><div class="mini-status" style="margin-bottom:0.8rem"><strong>Bottleneck:</strong> ' +
    options.escapeHtml(claimBottleneck) +
    '</div><div class="queue-actions" style="margin-bottom:0.8rem"><button class="btn-secondary" type="button" data-claim-funnel-focus="claim_follow_up_due">Show overdue claims</button><button class="btn-secondary" type="button" data-claim-funnel-focus="stalled_after_claim_review">Show stalled reviews</button><button class="btn-secondary" type="button" data-claim-funnel-focus="claim_conversion">Show after-claim profiles</button><button class="btn-secondary" type="button" data-claim-funnel-export="launch">Copy fast-track supply batch</button><button class="btn-secondary" type="button" data-claim-funnel-export="stalled">Copy stalled review batch</button><button class="btn-secondary" type="button" data-claim-funnel-export="overdue">Copy overdue follow-up batch</button></div><div class="review-coach-status" id="claimFunnelExportStatus"></div><div class="queue-insights-grid">' +
    [
      {
        label: "Claims submitted",
        value: claimFunnel.submitted,
        note: "Total free-claim entries in the application queue.",
      },
      {
        label: "Claims approved",
        value: claimFunnel.approved,
        note: options.formatPercent(claimApprovalRate) + " of submitted claims",
      },
      {
        label: "Follow-up sent",
        value: claimFunnel.followUpSent,
        note: options.formatPercent(claimFollowUpRate) + " of approved claims",
      },
      {
        label: "Full profile started",
        value: claimFunnel.fullProfileStarted,
        note: "Approved claims where the therapist has re-entered the fuller profile flow.",
      },
      {
        label: "Full profile submitted",
        value: claimFunnel.fullProfileSubmitted,
        note: options.formatPercent(claimConversionRate) + " of approved claims",
      },
      {
        label: "Fast-track supply",
        value: claimLaunchCandidates.length,
        note: "After-claim profiles that are close enough to live supply to deserve accelerated review.",
      },
      {
        label: "Stalled in review",
        value: claimFunnel.stalledReviews,
        note: "After-claim profiles that have already been in review too long and need a decisive call.",
      },
      {
        label: "Follow-up due now",
        value: claimFunnel.followUpDue,
        note: "Approved claims that have gone too long without a follow-up send.",
      },
    ]
      .map(function (item) {
        return (
          '<div class="queue-insight-card"><div class="queue-insight-label"><strong>' +
          options.escapeHtml(String(item.value)) +
          '</strong></div><div class="queue-insight-note">' +
          options.escapeHtml(item.label) +
          '</div><div class="queue-insight-note">' +
          options.escapeHtml(item.note) +
          "</div></div>"
        );
      })
      .join("") +
    "</div></div>" +
    (claimActionQueue.length
      ? '<div class="queue-insights"><div class="queue-insights-title">Top therapist actions right now</div><div class="subtle" style="margin-bottom:0.7rem">These are the highest-leverage therapist follow-up moves based on delay risk and follow-through value.</div><div class="queue-insights-grid">' +
        claimActionQueue
          .map(function (item) {
            return (
              '<button type="button" class="queue-insight-card" data-application-jump="' +
              options.escapeHtml(item.id) +
              '"><div class="queue-insight-label"><strong>' +
              options.escapeHtml(item.title) +
              '</strong></div><div class="queue-insight-note">' +
              options.escapeHtml(item.lane) +
              '</div><div class="queue-insight-note">' +
              options.escapeHtml(item.note) +
              "</div></button>"
            );
          })
          .join("") +
        "</div></div>"
      : "") +
    (claimLaunchCandidates.length
      ? '<div class="queue-insights"><div class="queue-insights-title">Fastest path to a live listing</div><div class="subtle" style="margin-bottom:0.7rem">These fuller profiles are the strongest candidates to turn into trustworthy live listings with one focused review pass.</div><div class="queue-insights-grid">' +
        claimLaunchCandidates
          .map(function (item) {
            return (
              '<button type="button" class="queue-insight-card" data-application-jump="' +
              options.escapeHtml(item.id) +
              '"><div class="queue-insight-label"><strong>' +
              options.escapeHtml(item.name) +
              '</strong></div><div class="queue-insight-note">' +
              options.escapeHtml(item.readiness.label) +
              " · " +
              options.escapeHtml(item.readiness.score) +
              '/100</div><div class="queue-insight-note">' +
              options.escapeHtml(item.reason) +
              '</div><div class="queue-insight-note">' +
              options.escapeHtml(item.snapshot.nextMove) +
              "</div></button>"
            );
          })
          .join("") +
        "</div></div>"
      : "") +
    (stalledAfterClaimReviews.length
      ? '<div class="queue-insights"><div class="queue-insights-title">Stalled fuller-profile reviews</div><div class="subtle" style="margin-bottom:0.7rem">These therapists already came back after claim approval, but their fuller profiles have started aging in review.</div><div class="queue-insights-grid">' +
        stalledAfterClaimReviews
          .map(function (item) {
            return (
              '<button type="button" class="queue-insight-card" data-application-jump="' +
              options.escapeHtml(item.id) +
              '"><div class="queue-insight-label"><strong>' +
              options.escapeHtml(item.name) +
              '</strong></div><div class="queue-insight-note">' +
              options.escapeHtml(item.stall.label) +
              " · " +
              options.escapeHtml(item.stall.ageDays) +
              ' days</div><div class="queue-insight-note">' +
              options.escapeHtml(item.stall.note) +
              '</div><div class="queue-insight-note">' +
              options.escapeHtml(item.nextMove) +
              "</div></button>"
            );
          })
          .join("") +
        "</div></div>"
      : "") +
    (overdueClaims.length
      ? '<div class="queue-insights"><div class="queue-insights-title">Urgent therapist follow-ups</div><div class="subtle" style="margin-bottom:0.7rem">These approved claims are the most likely to cool off if you do not send follow-up now.</div><div class="queue-insights-grid">' +
        overdueClaims
          .map(function (item) {
            var urgency = options.getClaimFollowUpUrgency(item);
            return (
              '<button type="button" class="queue-insight-card" data-application-jump="' +
              options.escapeHtml(item.id) +
              '"><div class="queue-insight-label"><strong>' +
              options.escapeHtml(item.name) +
              '</strong></div><div class="queue-insight-note">' +
              options.escapeHtml(urgency.label) +
              '</div><div class="queue-insight-note">' +
              options.escapeHtml(urgency.note) +
              '</div><div class="queue-insight-note">' +
              options.escapeHtml(item.email || "No email on file") +
              "</div></button>"
            );
          })
          .join("") +
        "</div></div>"
      : "") +
    '<div class="review-priority-grid">' +
    [
      {
        status: "pending",
        focus: "",
        label: "Pending",
        value: summaryCounts.pending,
        note: "Submissions still waiting for an explicit review decision.",
      },
      {
        status: "reviewing",
        focus: "active_review",
        label: "Reviewing",
        value: summaryCounts.reviewing,
        note: "Applications already in motion and needing a next clear call.",
      },
      {
        status: "",
        focus: "claim_flow",
        label: "Claims",
        value: summaryCounts.claims,
        note: "Free-claim submissions that mainly need ownership and core-detail verification.",
      },
      {
        status: "",
        focus: "claim_follow_up_due",
        label: "Follow-up due",
        value: summaryCounts.claim_follow_up_due,
        note: "Approved claims that are already overdue for outreach and risk cooling off.",
      },
      {
        status: "",
        focus: "stalled_after_claim_review",
        label: "Stalled reviews",
        value: summaryCounts.stalled_after_claim_review,
        note: "After-claim profiles already in review that now need a decisive next call.",
      },
      {
        status: "",
        focus: "claimed_ready_for_profile",
        label: "Approved claims",
        value: summaryCounts.approved_claims,
        note: "Claims that are approved and now need follow-up to get the fuller profile completed.",
      },
      {
        status: "",
        focus: "claim_conversion",
        label: "After-claim profiles",
        value: summaryCounts.claim_conversions,
        note: "Therapists who came back after claim approval and submitted the fuller profile for real review.",
      },
      {
        status: "",
        focus: "full_profile_flow",
        label: "Full profiles",
        value: summaryCounts.full_profiles,
        note: "Richer profile submissions that can move toward publish once trust is cleared.",
      },
      {
        status: "",
        focus: "publish_ready",
        label: "Publish-ready",
        value: summaryCounts.publish_ready,
        note: "Strong candidates likely worth a final trust pass and then publish.",
      },
      {
        status: "",
        focus: "needs_changes",
        label: "Needs fixes",
        value: summaryCounts.needs_changes,
        note: "Applications missing too many trust-critical basics to publish cleanly yet.",
      },
      {
        status: "",
        focus: "confirmation_refresh",
        label: "Refresh updates",
        value: summaryCounts.confirmation_refresh,
        note: "Live-profile confirmation updates that should be handled as upkeep, not new supply.",
      },
    ]
      .map(function (item) {
        var isGoalMatch = options.isGoalMatchedReviewCard(options.applicationFilters.goal, item);
        return (
          '<button type="button" class="review-priority-card' +
          (isGoalMatch ? " is-goal-match" : "") +
          (options.applicationFilters.focus === item.focus &&
          options.applicationFilters.status === (item.status || "")
            ? " is-active"
            : "") +
          '" data-application-status-card="' +
          options.escapeHtml(item.status || "") +
          '" data-application-focus-card="' +
          options.escapeHtml(item.focus) +
          '"><div class="review-priority-value">' +
          options.escapeHtml(item.value) +
          '</div><div class="review-priority-label">' +
          options.escapeHtml(item.label) +
          '</div><div class="review-priority-note">' +
          options.escapeHtml(item.note) +
          '</div><div class="review-priority-meta"><span class="review-priority-chip' +
          (isGoalMatch ? "" : " is-neutral") +
          '">' +
          options.escapeHtml(isGoalMatch ? "Best fit for this goal" : "Available lane") +
          "</span></div>" +
          "</button>"
        );
      })
      .join("") +
    '</div><div class="review-ops-bar"><div class="review-ops-title">Review Command Bar</div><div class="review-ops-copy">' +
    options.escapeHtml(
      topReviewTarget
        ? "Start with " +
            topReviewTarget.name +
            ". " +
            options.getApplicationReviewSnapshot(topReviewTarget).nextMove
        : "No top review target is available for the current filters.",
    ) +
    '</div><div class="review-ops-meta"><span class="review-priority-chip">' +
    options.escapeHtml(reviewGoalMeta.label) +
    "</span>" +
    (activeFilterChips.length
      ? activeFilterChips
          .map(function (chip) {
            return (
              '<span class="review-priority-chip is-neutral">' +
              options.escapeHtml(chip) +
              "</span>"
            );
          })
          .join("")
      : '<span class="review-priority-chip is-neutral">No extra filters</span>') +
    '</div><div class="queue-actions" style="margin-top:0"><button class="btn-secondary" type="button" data-application-clear-filters>Clear filters</button>' +
    (topReviewTarget
      ? '<button class="btn-primary" type="button" data-application-jump="' +
        options.escapeHtml(topReviewTarget.id) +
        '">Open top review</button>'
      : "") +
    "</div></div>" +
    (recommendedBatch.length
      ? '<div class="queue-insights"><div class="queue-insights-title">' +
        options.escapeHtml(reviewGoalMeta.batchTitle) +
        '</div><div class="subtle" style="margin-bottom:0.7rem">' +
        options.escapeHtml(reviewGoalMeta.batchIntro) +
        '</div><div class="queue-actions" style="margin-bottom:0.8rem"><button class="btn-primary" data-review-batch-export="' +
        options.escapeHtml(reviewGoalMeta.primaryActionMode) +
        '">' +
        options.escapeHtml(reviewGoalMeta.primaryActionLabel) +
        '</button><button class="btn-secondary" data-review-batch-export="packet">Copy review batch packet</button><button class="btn-secondary" data-review-batch-export="requests">Copy top improvement requests</button></div><div class="review-coach-status" id="reviewBatchExportStatus"></div><div class="queue-insights-grid">' +
        recommendedBatch
          .map(function (item) {
            var snapshot = options.getApplicationReviewSnapshot(item);
            var batchReason = options.getApplicationBatchReason(
              item,
              options.applicationFilters.goal,
            );
            return (
              '<button type="button" class="queue-insight-card" data-application-jump="' +
              options.escapeHtml(item.id) +
              '"><div class="queue-insight-label"><strong>' +
              options.escapeHtml(item.name) +
              '</strong></div><div class="queue-insight-note">' +
              options.escapeHtml(snapshot.label) +
              '</div><div class="queue-insight-note">' +
              options.escapeHtml(batchReason) +
              '</div><div class="queue-insight-note">' +
              options.escapeHtml(snapshot.nextMove) +
              "</div></button>"
            );
          })
          .join("") +
        "</div></div>"
      : "") +
    filteredApplications
      .map(function (item, index) {
        const readiness = options.getTherapistMatchReadiness(item);
        const freshness = options.getDataFreshnessSummary(item);
        const coaching = options.getTherapistReviewCoaching(item);
        const reviewSnapshot = options.getApplicationReviewSnapshot(item);
        const afterClaimReviewStall = options.getAfterClaimReviewStall(item);
        const portalStateLabel =
          item.portal_state_label || options.formatStatusLabel(item.status || "pending");
        const portalNextStep = item.portal_next_step || reviewSnapshot.nextMove;
        const isClaimFlow = item.submission_intent === "claim";
        const claimFollowUpLabel = options.getClaimFollowUpLabel(item.claim_follow_up_status);
        const claimFollowUpUrgency = options.getClaimFollowUpUrgency(item);
        const isConfirmationRefresh = options.isConfirmationRefreshApplication(item);
        const therapistReportedFields = Array.isArray(item.therapist_reported_fields)
          ? item.therapist_reported_fields
          : [];
        const therapistReportedDate = item.therapist_reported_confirmed_at
          ? options.formatDate(item.therapist_reported_confirmed_at)
          : "";
        const editorialFollowUps = therapistReportedFields.filter(function (fieldName) {
          return !item[fieldName] && item[fieldName] !== false;
        });
        const improvementRequest = options.buildImprovementRequest(item, coaching);
        const claimRequest = options.buildClaimReviewRequest(item);
        const claimFollowUpMessage = options.buildClaimFollowUpMessage(item);
        const reviewEvents = options.getReviewEventsForApplication(item);
        const revisionLink = new URL(
          "signup.html?revise=" + encodeURIComponent(item.id),
          window.location.href,
        ).toString();
        const confirmationLink = item.slug ? options.buildConfirmationLink(item.slug) : "";
        const linkedTherapist = options.getApplicationLinkedTherapist(item);
        const liveSyncSnapshot =
          linkedTherapist &&
          ["claim_existing", "update_existing", "confirmation_update"].includes(
            String(item.intake_type || ""),
          )
            ? options.getApplicationLiveSyncSnapshot(item, linkedTherapist)
            : null;
        const applicationDiffHtml =
          linkedTherapist &&
          ["claim_existing", "update_existing", "confirmation_update"].includes(
            String(item.intake_type || ""),
          )
            ? options.renderApplicationDiffHtml(item, linkedTherapist)
            : "";
        const fitTags = []
          .concat(item.treatment_modalities || [])
          .concat(item.client_populations || [])
          .slice(0, 8)
          .map(function (tag) {
            return '<span class="tag">' + options.escapeHtml(tag) + "</span>";
          })
          .join("");

        const operationalTimestamp = getOperationalTimestampLabel(item, options.formatDate);
        const workflowState = {
          label: "Workflow state",
          value: getWorkflowStateLabel(item.status, options.formatStatusLabel),
          tone: getWorkflowStateTone(item.status),
        };
        const workType = Object.assign(
          {
            label: "Work type",
          },
          getWorkTypeMeta(item, reviewSnapshot, isClaimFlow, isConfirmationRefresh),
        );
        const priorityMeta = Object.assign(
          {
            label: "Priority",
          },
          getPriorityMeta(index, reviewSnapshot, claimFollowUpUrgency, afterClaimReviewStall),
        );
        const issueBuckets = getIssueBuckets({
          reviewSnapshot: reviewSnapshot,
          readiness: readiness,
          freshness: freshness,
          claimFollowUpUrgency: claimFollowUpUrgency,
          afterClaimReviewStall: afterClaimReviewStall,
          liveSyncSnapshot: liveSyncSnapshot,
        });
        const recommendationTitle = String(reviewSnapshot.nextMove || "Review this submission now.")
          .replace(/\.+$/, "")
          .trim();
        const recommendationReason = issueBuckets.blocking.length
          ? "Blocking issues visible on this card: " + issueBuckets.blocking.join(", ") + "."
          : issueBuckets.recommended.length
            ? "Best improvements before publish: " +
              issueBuckets.recommended.slice(0, 2).join(", ") +
              "."
            : reviewSnapshot.note;
        const readinessMeaning =
          Number(readiness.score) >= 75
            ? "Strong enough to support confident matching if trust checks also pass."
            : Number(readiness.score) >= 60
              ? "Usable, but match confidence still depends on tightening a few profile details."
              : "Still weak for matching. Profile quality likely needs work before publish confidence is high.";
        const completenessMeaning =
          Number(readiness.completeness_score) >= 75
            ? "Most core profile inputs are present."
            : Number(readiness.completeness_score) >= 60
              ? "Core profile basics are partly there, but some operational trust details are still thin."
              : "Too many basics are still missing for a clean publish decision.";
        const detailsSummaryLabel = "View submission details";
        const reviewDetailsId = "application-details-" + item.id;
        const reviewPrimaryActionHtml =
          item.status === "pending"
            ? '<button class="btn-primary" data-action="reviewing" data-id="' +
              item.id +
              '">Review</button>'
            : item.status === "requested_changes"
              ? '<button class="btn-primary" data-action="reviewing" data-id="' +
                item.id +
                '">Resume review</button>'
              : item.status === "reviewing"
                ? '<button class="btn-primary" data-action="' +
                  (isClaimFlow ? "approve_claim" : "publish") +
                  '" data-id="' +
                  item.id +
                  '">' +
                  (isClaimFlow ? "Approve claim" : "Publish") +
                  "</button>"
                : '<span class="status ' + item.status + '">' + workflowState.value + "</span>";
        const requestChangesActionHtml =
          item.status === "pending" ||
          item.status === "reviewing" ||
          item.status === "requested_changes"
            ? '<button class="btn-secondary" data-action="requested_changes" data-id="' +
              item.id +
              '" data-request="' +
              options.escapeHtml(isClaimFlow ? claimRequest : improvementRequest) +
              '" data-link="' +
              options.escapeHtml(isConfirmationRefresh ? confirmationLink : revisionLink) +
              '">Request changes</button>'
            : "";
        const rejectActionHtml =
          item.status === "pending" || item.status === "reviewing"
            ? '<button class="btn-danger-quiet" data-action="reject" data-id="' +
              item.id +
              '">Reject</button>'
            : "";
        const actionFlash = getApplicationActionFlash(item.id);
        const secondaryActionList = [];
        if (item.status === "reviewing" || item.status === "requested_changes") {
          secondaryActionList.push(
            '<button class="btn-secondary" data-action="pending" data-id="' +
              item.id +
              '">Move to pending</button>',
          );
        }
        const contextActionList = [];
        if (item.email) {
          contextActionList.push(
            '<a class="btn-secondary btn-inline" href="mailto:' +
              options.escapeHtml(item.email) +
              '">Email therapist</a>',
          );
        }
        if (item.status === "requested_changes" || item.status === "approved") {
          contextActionList.push(
            '<button class="btn-secondary" data-action="copy-revision-link" data-id="' +
              item.id +
              '" data-link="' +
              options.escapeHtml(
                item.status === "approved" && isClaimFlow
                  ? revisionLink
                  : isConfirmationRefresh
                    ? confirmationLink
                    : revisionLink,
              ) +
              '">' +
              options.escapeHtml(
                item.status === "approved" && isClaimFlow
                  ? "Copy full-profile invite"
                  : isConfirmationRefresh
                    ? "Copy confirmation link"
                    : isClaimFlow
                      ? "Copy claim fix link"
                      : "Copy fix request link",
              ) +
              "</button>",
          );
        }

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
          '<div class="application-identity-row">' +
          '<div class="application-identity-main">' +
          (index === 0 ? '<div class="start-here-chip">Start here</div>' : "") +
          "<div><h3>" +
          options.escapeHtml(item.name) +
          '</h3><p class="subtle application-identity-meta">' +
          options.escapeHtml(item.credentials) +
          (item.title ? " · " + options.escapeHtml(item.title) : "") +
          " · " +
          options.escapeHtml(item.city) +
          ", " +
          options.escapeHtml(item.state) +
          '</p></div></div><div class="application-identity-time">' +
          options.escapeHtml(operationalTimestamp) +
          "</div></div>" +
          '<div class="application-status-row">' +
          renderStatusCell({
            label: workflowState.label,
            value: workflowState.value,
            tone: workflowState.tone,
            escapeHtml: options.escapeHtml,
          }) +
          renderStatusCell({
            label: workType.label,
            value: workType.value,
            tone: workType.tone,
            escapeHtml: options.escapeHtml,
          }) +
          renderStatusCell({
            label: priorityMeta.label,
            value: priorityMeta.value,
            note: priorityMeta.note,
            tone: priorityMeta.tone,
            escapeHtml: options.escapeHtml,
          }) +
          "</div>" +
          '<div class="application-recommendation-block"><div class="application-recommendation-label">Recommended action</div><div class="application-recommendation-title">' +
          options.escapeHtml(recommendationTitle) +
          '</div><div class="application-recommendation-copy">' +
          options.escapeHtml(recommendationReason) +
          '</div><div class="application-recommendation-evidence"><strong>Why:</strong> ' +
          options.escapeHtml(reviewSnapshot.note) +
          "</div></div>" +
          '<div class="application-action-row"><div class="application-action-main">' +
          reviewPrimaryActionHtml +
          requestChangesActionHtml +
          '<button class="btn-secondary" type="button" data-review-details-open="' +
          options.escapeHtml(reviewDetailsId) +
          '" aria-expanded="false">View details</button>' +
          rejectActionHtml +
          '</div><div class="application-action-note">' +
          options.escapeHtml(
            item.status === "pending"
              ? "Open the submission, verify the trust-critical basics, then move it into a clear review state."
              : portalNextStep,
          ) +
          "</div></div>" +
          '<div class="application-readiness-block"><div class="application-readiness-metrics"><div class="application-metric-card"><div class="application-metric-label">Completion</div><div class="application-metric-value">' +
          options.escapeHtml(String(readiness.completeness_score) + "/100") +
          '</div><div class="application-metric-note">' +
          options.escapeHtml(completenessMeaning) +
          '</div></div><div class="application-metric-card"><div class="application-metric-label">Match readiness</div><div class="application-metric-value">' +
          options.escapeHtml(String(readiness.score) + "/100") +
          '</div><div class="application-metric-note">' +
          options.escapeHtml(readinessMeaning) +
          '</div></div></div><div class="application-issues-grid">' +
          renderIssueColumn({
            label: "Blocking",
            copy: "These issues should stop a safe publish or approval decision until they are resolved.",
            items: issueBuckets.blocking,
            escapeHtml: options.escapeHtml,
          }) +
          renderIssueColumn({
            label: "Recommended before publish",
            copy: "These improvements increase confidence and match quality, but they are lower-severity than blockers.",
            items: issueBuckets.recommended,
            escapeHtml: options.escapeHtml,
          }) +
          renderIssueColumn({
            label: "Advisory",
            copy: "These are watchouts that help explain the recommendation without blocking the next action by themselves.",
            items: issueBuckets.advisory,
            escapeHtml: options.escapeHtml,
          }) +
          "</div>" +
          (actionFlash && index !== 0
            ? '<div class="review-coach-status">' + options.escapeHtml(actionFlash) + "</div>"
            : "") +
          '<details class="review-details" data-review-details-id="' +
          options.escapeHtml(reviewDetailsId) +
          '"><summary class="review-details-summary">' +
          detailsSummaryLabel +
          '</summary><div class="review-details-body">' +
          '<div class="queue-actions application-context-actions" style="margin-top:0.75rem">' +
          contextActionList.join("") +
          secondaryActionList.join("") +
          "</div>" +
          (item.care_approach
            ? '<p class="application-bio"><strong>How they help bipolar clients:</strong> ' +
              options.escapeHtml(item.care_approach) +
              "</p>"
            : "") +
          '<div class="review-snapshot-box"><div class="review-snapshot-title">Review snapshot</div><div class="review-snapshot-copy"><strong>' +
          options.escapeHtml(portalStateLabel) +
          ":</strong> " +
          options.escapeHtml(portalNextStep) +
          '</div><div class="review-snapshot-copy">' +
          options.escapeHtml(reviewSnapshot.photoNextMove) +
          "</div></div>" +
          applicationDiffHtml +
          '<p class="application-bio">' +
          options.escapeHtml(item.bio) +
          "</p>" +
          '<div class="tag-row">' +
          (item.specialties || [])
            .map(function (specialty) {
              return '<span class="tag">' + options.escapeHtml(specialty) + "</span>";
            })
            .join("") +
          "</div>" +
          (fitTags ? '<div class="tag-row">' + fitTags + "</div>" : "") +
          '<div class="meta-grid">' +
          "<div><strong>Email:</strong> " +
          options.escapeHtml(item.email) +
          "</div>" +
          "<div><strong>Phone:</strong> " +
          options.escapeHtml(item.phone || "Not provided") +
          "</div>" +
          "<div><strong>License:</strong> " +
          options.escapeHtml(
            [item.license_state, item.license_number].filter(Boolean).join(" · ") || "Not provided",
          ) +
          "</div>" +
          "<div><strong>Photo source:</strong> " +
          options.escapeHtml(reviewSnapshot.photoStatusLabel) +
          "</div>" +
          "<div><strong>Portal lifecycle:</strong> " +
          options.escapeHtml(portalStateLabel) +
          "</div>" +
          "<div><strong>Photo permission:</strong> " +
          options.escapeHtml(
            item.photo_usage_permission_confirmed ? "Confirmed" : "Not confirmed",
          ) +
          "</div>" +
          "<div><strong>Wait time:</strong> " +
          options.escapeHtml(item.estimated_wait_time || "Not provided") +
          "</div>" +
          "<div><strong>Insurance:</strong> " +
          options.escapeHtml((item.insurance_accepted || []).join(", ") || "Not provided") +
          "</div>" +
          "<div><strong>Format:</strong> " +
          [item.accepts_telehealth ? "Telehealth" : "", item.accepts_in_person ? "In-Person" : ""]
            .filter(Boolean)
            .join(" / ") +
          "</div>" +
          "<div><strong>Preferred contact:</strong> " +
          options.escapeHtml(
            item.preferred_contact_method
              ? item.preferred_contact_method === "booking"
                ? "Booking link"
                : item.preferred_contact_method
              : "Not provided",
          ) +
          "</div>" +
          "<div><strong>CTA label:</strong> " +
          options.escapeHtml(item.preferred_contact_label || "Not provided") +
          "</div>" +
          "<div><strong>Booking URL:</strong> " +
          (item.booking_url
            ? '<a href="' +
              options.escapeHtml(item.booking_url) +
              '" target="_blank" rel="noopener">Open link</a>'
            : "Not provided") +
          "</div>" +
          "<div><strong>Contact guidance:</strong> " +
          options.escapeHtml(item.contact_guidance || "Not provided") +
          "</div>" +
          "<div><strong>After outreach:</strong> " +
          options.escapeHtml(item.first_step_expectation || "Not provided") +
          "</div>" +
          "<div><strong>Languages:</strong> " +
          options.escapeHtml((item.languages || []).join(", ") || "English") +
          "</div>" +
          "<div><strong>Telehealth states:</strong> " +
          options.escapeHtml((item.telehealth_states || []).join(", ") || "Not provided") +
          "</div>" +
          "<div><strong>Upgrade eligible:</strong> " +
          options.escapeHtml(item.upgrade_eligible ? "Yes" : "Not yet") +
          "</div>" +
          "</div>" +
          (item.portal_state === "claimed_ready_for_profile"
            ? '<div class="notes-box"><label><strong>Approved-claim follow-up</strong></label><div class="subtle"><strong>Status:</strong> ' +
              options.escapeHtml(claimFollowUpLabel) +
              '</div><div class="subtle"><strong>Urgency:</strong> ' +
              options.escapeHtml(claimFollowUpUrgency.label) +
              "</div>" +
              (claimFollowUpUrgency.note
                ? '<div class="subtle">' + options.escapeHtml(claimFollowUpUrgency.note) + "</div>"
                : "") +
              "</div>" +
              (item.claim_follow_up_sent_at
                ? '<div class="subtle"><strong>Last sent:</strong> ' +
                  options.escapeHtml(options.formatDate(item.claim_follow_up_sent_at)) +
                  "</div>"
                : "") +
              (item.claim_follow_up_response_at
                ? '<div class="subtle"><strong>Last response:</strong> ' +
                  options.escapeHtml(options.formatDate(item.claim_follow_up_response_at)) +
                  "</div>"
                : "") +
              '<div class="subtle" style="margin-top:0.4rem">Use this once the claim is approved and you need the therapist to finish the fuller profile.</div><div class="review-coach-actions"><button class="btn-secondary" data-action="copy-claim-follow-up" data-id="' +
              item.id +
              '" data-request="' +
              options.escapeHtml(claimFollowUpMessage) +
              '">Copy follow-up email</button><button class="btn-secondary" data-action="mark-claim-follow-up-sent" data-id="' +
              item.id +
              '">Mark sent</button><button class="btn-secondary" data-action="mark-claim-follow-up-responded" data-id="' +
              item.id +
              '">Mark responded</button><button class="btn-secondary" data-action="mark-full-profile-started" data-id="' +
              item.id +
              '">Mark full profile started</button><span class="review-coach-status" data-coach-status-id="' +
              item.id +
              '">Ready for follow-up</span></div></div>'
            : "") +
          (isConfirmationRefresh
            ? '<div class="notes-box"><label><strong>Confirmation refresh</strong></label><div class="subtle">This submission is tied to an existing live therapist profile and is meant to refresh high-value operational details without creating a brand-new listing.</div>' +
              (item.published_therapist_id
                ? '<div class="subtle">Linked live therapist ID: ' +
                  options.escapeHtml(item.published_therapist_id) +
                  "</div>"
                : "") +
              (confirmationLink
                ? '<div class="subtle">Therapist update link: <a href="' +
                  options.escapeHtml(confirmationLink) +
                  '" target="_blank" rel="noopener">Open confirmation form</a></div>'
                : "") +
              "</div>"
            : "") +
          (therapistReportedFields.length
            ? '<div class="notes-box"><label><strong>Source clarity</strong></label><div class="tag-row">' +
              therapistReportedFields
                .map(function (fieldName) {
                  return (
                    '<span class="tag">' +
                    options.escapeHtml(options.formatFieldLabel(fieldName)) +
                    " · therapist confirmed</span>"
                  );
                })
                .join("") +
              '</div><div class="subtle">Last specialist confirmation: ' +
              options.escapeHtml(therapistReportedDate || "Not provided") +
              "</div>" +
              (editorialFollowUps.length
                ? '<div class="subtle">Still worth editorial follow-up: ' +
                  options.escapeHtml(
                    editorialFollowUps.map(options.formatFieldLabel).join(", ") ||
                      "None currently flagged",
                  ) +
                  "</div>"
                : "")
            : '<div class="notes-box"><label><strong>Source clarity</strong></label><div class="subtle">No therapist-confirmed operational fields are marked yet.</div>') +
          "</div>" +
          '<div class="notes-box"><label><strong>Field-level review states</strong></label>' +
          options.buildFieldReviewControls(item) +
          '<div class="subtle">Use this to distinguish details that are still therapist-confirmed from details your team has independently verified.</div></div>' +
          '<div class="notes-box"><label><strong>Freshness audit</strong></label><div class="subtle"><strong>' +
          options.escapeHtml(freshness.label) +
          ":</strong> " +
          options.escapeHtml(freshness.note) +
          "</div></div>" +
          (readiness.strengths.length
            ? '<div class="notes-box"><label><strong>Already strong for matching</strong></label><div class="tag-row">' +
              readiness.strengths
                .map(function (strength) {
                  return '<span class="tag">' + options.escapeHtml(strength) + "</span>";
                })
                .join("") +
              "</div></div>"
            : "") +
          (readiness.missing_items.length
            ? '<div class="notes-box"><label><strong>Best next fixes for match quality</strong></label><div class="tag-row">' +
              readiness.missing_items
                .map(function (itemText) {
                  return '<span class="tag">' + options.escapeHtml(itemText) + "</span>";
                })
                .join("") +
              "</div></div>"
            : "") +
          (coaching.length
            ? '<div class="notes-box review-coach-box"><label><strong>Reviewer coaching prompts</strong></label><div class="review-coach-list">' +
              coaching
                .map(function (itemText) {
                  return (
                    '<div class="review-coach-item">' + options.escapeHtml(itemText) + "</div>"
                  );
                })
                .join("") +
              '</div><div class="review-coach-actions"><button class="btn-secondary" data-action="copy-improvement-request" data-id="' +
              item.id +
              '" data-request="' +
              options.escapeHtml(improvementRequest) +
              '">Copy improvement request</button><button class="btn-secondary" data-action="append-improvement-request" data-id="' +
              item.id +
              '" data-request="' +
              options.escapeHtml(improvementRequest) +
              '">Add request to notes</button><span class="review-coach-status" data-coach-status-id="' +
              item.id +
              '">Ready to reuse</span></div>' +
              "</div></div>"
            : "") +
          options.renderReviewEventSnippetHtml(reviewEvents, {
            escapeHtml: options.escapeHtml,
            formatDate: options.formatDate,
          }) +
          options.renderReviewEventTimelineHtml(reviewEvents, {
            escapeHtml: options.escapeHtml,
            formatDate: options.formatDate,
          }) +
          options.renderReviewEntityTaskHtml("application", item.id, {
            escapeHtml: options.escapeHtml,
            formatDate: options.formatDate,
          }) +
          options.buildRevisionHistoryHtml(item) +
          '<div class="notes-box"><label><strong>Internal notes</strong></label><textarea data-notes-id="' +
          item.id +
          '" placeholder="Add review notes, follow-up items, or context for later...">' +
          (item.notes || "") +
          '</textarea><div class="notes-actions"><button class="btn-secondary" data-action="save-notes" data-id="' +
          item.id +
          '">Save Notes</button><span class="mini-status">' +
          (item.notes ? "Notes saved" : "No notes yet") +
          "</span></div></div></div></details>" +
          "</article>"
        );
      })
      .join("");

  bindApplicationPanelInteractions(root, {
    applicationFilters: options.applicationFilters,
    recommendedBatch: recommendedBatch,
    reviewGoalMeta: reviewGoalMeta,
    applications: applications,
    dataMode: options.dataMode,
    remoteApplications: options.remoteApplications,
    buildRecommendedReviewBatchRequests: options.buildRecommendedReviewBatchRequests,
    buildRecommendedReviewBatchPacket: options.buildRecommendedReviewBatchPacket,
    buildClaimLaunchPriorityPacket: options.buildClaimLaunchPriorityPacket,
    buildStalledAfterClaimReviewPacket: options.buildStalledAfterClaimReviewPacket,
    buildOverdueClaimFollowUpPacket: options.buildOverdueClaimFollowUpPacket,
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

  // Restore Focus mode position if it was active before this re-render.
  import("./admin-triage-focus.js").then(function (mod) {
    mod.reapplyFocusAfterRender(root);
  });
}
