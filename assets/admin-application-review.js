import {
  bindApplicationPanelInteractions,
  getApplicationActionFlash,
  getRecentApplicationActionFlashes,
} from "./admin-application-actions.js";
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
  facts.push({
    label:
      config.item && config.item.license_number
        ? "License on file"
        : config.isClaimFlow
          ? "License needs check"
          : "License missing",
    tone: config.item && config.item.license_number ? "neutral" : "trust",
  });
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
  if (config.afterClaimReviewStall && config.afterClaimReviewStall.stalled) {
    facts.push({
      label: "Review age " + String(config.afterClaimReviewStall.ageDays) + "d",
      tone: "ownership",
    });
  }
  return facts.slice(0, 4);
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
        const reviewSnapshot = options.getApplicationReviewSnapshot(item);
        const afterClaimReviewStall = options.getAfterClaimReviewStall(item);
        const portalStateLabel =
          item.portal_state_label || options.formatStatusLabel(item.status || "pending");
        const portalNextStep = item.portal_next_step || reviewSnapshot.nextMove;
        const isClaimFlow = item.submission_intent === "claim";
        const claimFollowUpLabel = options.getClaimFollowUpLabel(item.claim_follow_up_status);
        const claimFollowUpUrgency = options.getClaimFollowUpUrgency(item);
        const isConfirmationRefresh = options.isConfirmationRefreshApplication(item);
        const claimFollowUpMessage = options.buildClaimFollowUpMessage(item);
        const fitTags = []
          .concat(item.treatment_modalities || [])
          .concat(item.client_populations || [])
          .slice(0, 8)
          .map(function (tag) {
            return '<span class="tag">' + options.escapeHtml(tag) + "</span>";
          })
          .join("");

        const primaryActionHtml =
          item.status !== "approved"
            ? '<button class="btn-primary" data-action="' +
              (isClaimFlow ? "approve_claim" : "publish") +
              '" data-id="' +
              item.id +
              '">' +
              options.escapeHtml(
                getPrimaryApplicationActionLabel({
                  isClaimFlow: isClaimFlow,
                  isConfirmationRefresh: isConfirmationRefresh,
                }),
              ) +
              "</button>"
            : "";
        const actionFlash = getApplicationActionFlash(item.id);
        const stateMeta = getApplicationStateMeta({
          escapeHtml: options.escapeHtml,
          isClaimFlow: isClaimFlow,
          isConfirmationRefresh: isConfirmationRefresh,
          isPublishReady: reviewSnapshot.focus === "publish_ready",
          isUrgent: claimFollowUpUrgency.tone === "urgent" || afterClaimReviewStall.stalled,
        });
        const compactFacts = buildCompactApplicationFacts(options, {
          item: item,
          readiness: readiness,
          reviewSnapshot: reviewSnapshot,
          afterClaimReviewStall: afterClaimReviewStall,
          isClaimFlow: isClaimFlow,
          isConfirmationRefresh: isConfirmationRefresh,
        });
        const deleteActionHtml =
          item.status === "approved"
            ? ""
            : '<button class="btn-secondary" data-action="reject" data-id="' +
              item.id +
              '">' +
              options.escapeHtml(isClaimFlow ? "Reject" : "Delete") +
              "</button>";
        const compactActions = []
          .concat(primaryActionHtml ? [primaryActionHtml] : [])
          .concat(deleteActionHtml ? [deleteActionHtml] : [])
          .concat([
            '<button class="btn-secondary btn-inline" type="button" data-open-review-details="' +
              options.escapeHtml(item.id) +
              '">Details</button>',
          ]);

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
          "</span>" +
          "</div>" +
          '<p class="application-card-summary"><strong>Recommended:</strong> ' +
          options.escapeHtml(reviewSnapshot.nextMove) +
          "</p>" +
          (reviewSnapshot.note
            ? '<p class="application-card-subsummary">' +
              options.escapeHtml(reviewSnapshot.note) +
              "</p>"
            : "") +
          '<div class="application-card-actions">' +
          compactActions.join("") +
          "</div>" +
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
          '"><summary class="review-details-summary">Submitted profile details</summary><div class="review-details-body"><div class="review-details-toolbar"><button class="btn-secondary btn-inline" type="button" data-close-review-details="' +
          options.escapeHtml(item.id) +
          '">Close details</button></div>' +
          '<div class="review-snapshot-box"><div class="review-snapshot-title">Why this is in queue</div><div class="review-snapshot-copy"><strong>' +
          options.escapeHtml(stateMeta.title) +
          ":</strong> " +
          options.escapeHtml(stateMeta.copy) +
          '</div><div class="review-snapshot-copy"><strong>Queue lane:</strong> ' +
          options.escapeHtml(
            isConfirmationRefresh
              ? "Live profile refresh"
              : item.submission_intent === "claim"
                ? "Claim conversion"
                : "Full profile review",
          ) +
          "</div></div>" +
          '<div class="review-snapshot-box"><div class="review-snapshot-title">Therapist-facing lifecycle</div><div class="review-snapshot-copy"><strong>' +
          options.escapeHtml(portalStateLabel) +
          ":</strong> " +
          options.escapeHtml(portalNextStep) +
          '</div><div class="review-snapshot-copy">' +
          options.escapeHtml(
            item.submission_intent === "claim"
              ? "This therapist is still in the claim-first path. Keep the review focused on ownership, licensure, and core profile trust."
              : "This therapist has already submitted the fuller profile, so the review can focus on publish readiness, fit clarity, and trust details.",
          ) +
          (item.upgrade_eligible
            ? '</div><div class="review-snapshot-copy"><strong>Upgrade eligibility:</strong> This profile can be offered growth features after review.</div>'
            : "") +
          "</div>" +
          '<div class="review-snapshot-box"><div class="review-snapshot-title">Review snapshot</div><div class="review-snapshot-copy"><strong>Photo status:</strong> ' +
          options.escapeHtml(reviewSnapshot.photoNextMove) +
          '</div><div class="review-snapshot-copy"><strong>Match readiness:</strong> ' +
          options.escapeHtml(readiness.label) +
          " (" +
          options.escapeHtml(readiness.score) +
          '/100)</div><div class="review-snapshot-copy"><strong>Profile completeness:</strong> ' +
          options.escapeHtml(readiness.completeness_score) +
          "/100</div>" +
          (reviewSnapshot.missingCriticalFields.length
            ? '<div class="tag-row">' +
              reviewSnapshot.missingCriticalFields
                .map(function (field) {
                  return '<span class="tag">' + options.escapeHtml(field) + "</span>";
                })
                .join("") +
              "</div>"
            : "") +
          "</div>" +
          (item.care_approach
            ? '<p class="application-bio"><strong>How they help bipolar clients:</strong> ' +
              options.escapeHtml(item.care_approach) +
              "</p>"
            : "") +
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
          "</div></details>" +
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
