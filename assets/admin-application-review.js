import {
  bindApplicationPanelInteractions,
  getApplicationActionFlash,
  getRecentApplicationActionFlashes,
} from "./admin-application-actions.js";

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
      '<div class="empty"><strong>No applications to review right now.</strong><br />The application queue is empty, so there is nothing for an operator to process in this lane yet.<div style="margin-top:0.8rem"><a class="btn-secondary btn-inline" href="#candidateQueuePanel">Go to Add New Listings instead</a></div></div>';
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
    '<div class="queue-insights"><div class="queue-insights-title">Claim funnel snapshot</div><div class="subtle" style="margin-bottom:0.7rem">Use this to track whether approved claims are actually converting into fuller profile submissions.</div><div class="mini-status" style="margin-bottom:0.8rem"><strong>Bottleneck:</strong> ' +
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
      ? '<div class="queue-insights"><div class="queue-insights-title">Top claim actions right now</div><div class="subtle" style="margin-bottom:0.7rem">These are the highest-leverage therapist funnel moves based on delay risk and follow-through value.</div><div class="queue-insights-grid">' +
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
      ? '<div class="queue-insights"><div class="queue-insights-title">Fastest path to live supply</div><div class="subtle" style="margin-bottom:0.7rem">These after-claim profiles are the strongest candidates to turn into trustworthy live supply with one focused review pass.</div><div class="queue-insights-grid">' +
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
      ? '<div class="queue-insights"><div class="queue-insights-title">Stalled after-claim reviews</div><div class="subtle" style="margin-bottom:0.7rem">These therapists already came back after claim approval, but their fuller profiles have started aging in review.</div><div class="queue-insights-grid">' +
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
      ? '<div class="queue-insights"><div class="queue-insights-title">Urgent follow-up queue</div><div class="subtle" style="margin-bottom:0.7rem">These approved claims are the most likely to cool off if you do not send follow-up now.</div><div class="queue-insights-grid">' +
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

        const actions =
          item.status === "pending"
            ? '<button class="btn-secondary" data-action="reviewing" data-id="' +
              item.id +
              '">' +
              (isClaimFlow ? "Start review now" : "Start review now") +
              '</button><button class="btn-secondary" data-action="requested_changes" data-id="' +
              item.id +
              '" data-request="' +
              options.escapeHtml(isClaimFlow ? claimRequest : improvementRequest) +
              '" data-link="' +
              options.escapeHtml(isConfirmationRefresh ? confirmationLink : revisionLink) +
              '">' +
              (isClaimFlow ? "Request fixes" : "Request fixes") +
              '</button><button class="btn-primary" data-action="' +
              (isClaimFlow ? "approve_claim" : "publish") +
              '" data-id="' +
              item.id +
              '">' +
              (isClaimFlow ? "Approve claim now" : "Publish now") +
              '</button><button class="btn-secondary" data-action="reject" data-id="' +
              item.id +
              '">Reject</button>'
            : item.status === "reviewing"
              ? '<button class="btn-primary" data-action="' +
                (isClaimFlow ? "approve_claim" : "publish") +
                '" data-id="' +
                item.id +
                '">' +
                (isClaimFlow ? "Approve claim now" : "Publish now") +
                '</button><button class="btn-secondary" data-action="requested_changes" data-id="' +
                item.id +
                '" data-request="' +
                options.escapeHtml(isClaimFlow ? claimRequest : improvementRequest) +
                '" data-link="' +
                options.escapeHtml(isConfirmationRefresh ? confirmationLink : revisionLink) +
                '">' +
                (isClaimFlow ? "Request fixes" : "Request fixes") +
                '</button><button class="btn-secondary" data-action="pending" data-id="' +
                item.id +
                '">Move to Pending</button><button class="btn-secondary" data-action="reject" data-id="' +
                item.id +
                '">Reject</button>'
              : item.status === "requested_changes"
                ? '<span class="status requested_changes">requested changes</span><button class="btn-secondary" data-action="copy-revision-link" data-id="' +
                  item.id +
                  '" data-link="' +
                  options.escapeHtml(isConfirmationRefresh ? confirmationLink : revisionLink) +
                  '">' +
                  (isConfirmationRefresh
                    ? "Copy confirmation link"
                    : isClaimFlow
                      ? "Copy claim fix link"
                      : "Copy fix request link") +
                  '</button><button class="btn-secondary" data-action="pending" data-id="' +
                  item.id +
                  '">Move to Pending</button>'
                : item.status === "approved"
                  ? '<span class="status approved">' +
                    options.escapeHtml(isClaimFlow ? "claim approved" : "approved") +
                    "</span>" +
                    (isClaimFlow
                      ? '<button class="btn-secondary" data-action="copy-revision-link" data-id="' +
                        item.id +
                        '" data-link="' +
                        options.escapeHtml(revisionLink) +
                        '">Copy full-profile invite</button>'
                      : "")
                  : '<span class="status ' + item.status + '">' + item.status + "</span>";
        const primaryActionHtml =
          item.status === "pending" || item.status === "reviewing"
            ? '<button class="btn-primary" data-action="' +
              (isClaimFlow ? "approve_claim" : "publish") +
              '" data-id="' +
              item.id +
              '">' +
              (isClaimFlow ? "Approve claim now" : "Publish now") +
              "</button>"
            : "";
        const secondaryActions =
          index === 0 && primaryActionHtml ? actions.replace(primaryActionHtml, "") : actions;
        const actionFlash = getApplicationActionFlash(item.id);

        return (
          '<article class="application-card' +
          (index === 0 ? " is-start-here" : "") +
          '" data-application-card-id="' +
          options.escapeHtml(item.id) +
          '"' +
          (index === 0 ? ' id="applicationReviewStartHere"' : "") +
          ">" +
          (index === 0
            ? '<div class="start-here-chip">Start here</div><div class="start-here-copy">Open this application first. It is the top review target for the current goal and filters.</div><div class="start-here-action">Do this now: review trust-critical details first, then approve, request changes, reject, or publish before leaving the card.</div>'
            : "") +
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
          '<div class="tag-row"><span class="tag">' +
          options.escapeHtml(item.verification_status || "under_review").replace(/_/g, " ") +
          "</span>" +
          '<span class="tag">' +
          options.escapeHtml(item.submission_intent === "claim" ? "Free claim" : "Full profile") +
          "</span>" +
          (isConfirmationRefresh
            ? '<span class="tag">Live profile confirmation update</span>'
            : "") +
          '<span class="tag">' +
          options.escapeHtml(portalStateLabel) +
          "</span>" +
          '<span class="tag">' +
          options.escapeHtml(reviewSnapshot.label) +
          "</span>" +
          (item.bipolar_years_experience
            ? '<span class="tag">' +
              options.escapeHtml(item.bipolar_years_experience) +
              " yrs bipolar care</span>"
            : "") +
          '<span class="tag">' +
          options.escapeHtml(reviewSnapshot.photoStatusLabel) +
          "</span>" +
          (item.medication_management ? '<span class="tag">Medication management</span>' : "") +
          '<span class="tag">' +
          options.escapeHtml(readiness.label) +
          " · " +
          options.escapeHtml(readiness.score) +
          "/100</span>" +
          (liveSyncSnapshot && liveSyncSnapshot.lastAppliedLabel
            ? '<span class="tag">' +
              options.escapeHtml(liveSyncSnapshot.lastAppliedLabel) +
              "</span>"
            : "") +
          (liveSyncSnapshot
            ? '<span class="tag">' + options.escapeHtml(liveSyncSnapshot.syncLabel) + "</span>"
            : "") +
          (afterClaimReviewStall.stalled
            ? '<span class="tag">' +
              options.escapeHtml("Review age · " + afterClaimReviewStall.ageDays + " days") +
              "</span>"
            : "") +
          "</div>" +
          (item.care_approach
            ? '<p class="application-bio"><strong>How they help bipolar clients:</strong> ' +
              options.escapeHtml(item.care_approach) +
              "</p>"
            : "") +
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
          '<div class="review-snapshot-box"><div class="review-snapshot-title">Recommended next move</div><div class="review-snapshot-copy">' +
          options.escapeHtml(reviewSnapshot.nextMove) +
          '</div><div class="review-snapshot-copy">' +
          options.escapeHtml(reviewSnapshot.note) +
          '</div><div class="review-snapshot-copy"><strong>Photo status:</strong> ' +
          options.escapeHtml(reviewSnapshot.photoNextMove) +
          "</div>" +
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
          "<div><strong>Match readiness:</strong> " +
          options.escapeHtml(readiness.label) +
          " (" +
          options.escapeHtml(readiness.score) +
          "/100)</div>" +
          "<div><strong>Profile completeness:</strong> " +
          options.escapeHtml(readiness.completeness_score) +
          "/100</div>" +
          "<div><strong>Upgrade eligible:</strong> " +
          options.escapeHtml(item.upgrade_eligible ? "Yes" : "Not yet") +
          "</div>" +
          "</div>" +
          (index === 0 && primaryActionHtml
            ? '<div class="recommended-action-bar"><div class="recommended-action-label">Recommended action</div><div class="recommended-action-row">' +
              primaryActionHtml +
              '</div></div><div class="action-row secondary-actions">'
            : '<div class="action-row">') +
          secondaryActions +
          "</div>" +
          (actionFlash
            ? '<div class="review-coach-status">' + options.escapeHtml(actionFlash) + "</div>"
            : "") +
          '<details class="review-details"><summary class="review-details-summary">Review details</summary><div class="review-details-body">' +
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
}
