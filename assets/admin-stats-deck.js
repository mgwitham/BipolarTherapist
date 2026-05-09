import { escapeHtml } from "./escape-html.js";

function buildExecutiveMetricHtml(metric) {
  return (
    '<div class="executive-metric"><div class="executive-metric-value">' +
    escapeHtml(String(metric.value || 0)) +
    '</div><div class="executive-metric-label">' +
    escapeHtml(metric.label || "") +
    '</div><div class="executive-metric-note">' +
    escapeHtml(metric.note || "") +
    "</div></div>"
  );
}

function buildExecutiveBriefHtml(item) {
  return (
    '<div class="intel-brief"><div class="intel-brief-label">' +
    escapeHtml(item.label || "") +
    '</div><div class="intel-brief-value">' +
    escapeHtml(item.value || "") +
    '</div><div class="intel-brief-note">' +
    escapeHtml(item.note || "") +
    "</div></div>"
  );
}

function buildSessionStepHtml(step, index) {
  return (
    '<div class="session-step"><div class="session-step-index">' +
    escapeHtml(String(index + 1)) +
    '</div><div><div class="session-step-title">' +
    escapeHtml(step.title || "") +
    '</div><div class="session-step-copy">' +
    escapeHtml(step.copy || "") +
    '</div><div class="session-step-meta">' +
    escapeHtml(step.meta || "") +
    '</div><div class="session-step-actions"><button class="btn-secondary" type="button" data-admin-scroll-target="' +
    escapeHtml(step.targetId || "") +
    '" data-admin-workflow-title="' +
    escapeHtml(step.title || "") +
    '" data-admin-workflow-destination="' +
    escapeHtml(step.destination || "") +
    '" data-admin-workflow-first-step="' +
    escapeHtml(step.firstStep || "") +
    '" data-admin-workflow-next-step="' +
    escapeHtml(step.nextStep || "") +
    '" data-admin-workflow-done="' +
    escapeHtml(step.done || "") +
    '" data-admin-workflow-primary-action-label="' +
    escapeHtml(step.actionLabel || "Open lane") +
    '" data-admin-workflow-primary-target-id="' +
    escapeHtml(step.targetId || "") +
    '">' +
    escapeHtml(step.actionLabel || "Open lane") +
    "</button></div></div></div>"
  );
}

export function renderExecutiveCommandDeck(context) {
  var mandateRoot = document.getElementById("executiveMandateBoard");
  var workflowRoot = document.getElementById("bestPathWorkflowBoard");
  var intelligenceRoot = document.getElementById("businessIntelligenceBoard");
  var guideRoot = document.getElementById("firstRunGuideBoard");
  if (!mandateRoot || !workflowRoot || !intelligenceRoot || !guideRoot) {
    return;
  }

  if (context && context.authRequired) {
    mandateRoot.innerHTML = "";
    mandateRoot.hidden = true;
    workflowRoot.innerHTML = "";
    intelligenceRoot.innerHTML = "";
    guideRoot.innerHTML = "";
    return;
  }

  var inboundSupplyCount = context.pendingApplicationsCount + context.candidateReviewCount;
  var trustDebtCount =
    context.strictImportBlockerCount +
    context.profilesNeedingConfirmation +
    context.profilesNeedingRefresh;
  var demandLoadCount =
    context.funnelSummary.searches +
    context.funnelSummary.help_requests +
    context.openConciergeCount;

  var mandate = {
    kicker: "Executive Mandate",
    title: "Turn today's most leveraged operational bottleneck into movement.",
    copy: "This admin should tell a first-time operator what matters right now, why it matters to the business, and which lane creates the highest-value movement next.",
    targetId: "applicationsPanel",
    actionLabel: "Open supply review",
    secondaryTargetId: "candidateQueuePanel",
    secondaryActionLabel: "Open candidate lane",
  };

  if (inboundSupplyCount >= Math.max(trustDebtCount, 4)) {
    mandate.title = "Convert inbound supply into trusted live listings while momentum is there.";
    mandate.copy =
      "The business has enough incoming supply to create visible growth, but only if we make clear publish, approve, and merge decisions instead of letting submissions wait.";
    mandate.targetId =
      context.pendingApplicationsCount >= context.candidateReviewCount
        ? "applicationsPanel"
        : "candidateQueuePanel";
    mandate.actionLabel =
      context.pendingApplicationsCount >= context.candidateReviewCount
        ? "Review pending applications"
        : "Review new listings";
    mandate.secondaryTargetId = "candidateQueuePanel";
    mandate.secondaryActionLabel = "Open candidate lane";
  } else if (trustDebtCount > 0) {
    mandate.title = "Reduce trust debt on live supply so conversion quality stays defensible.";
    mandate.copy =
      "Right now the business risk is not lack of work. It is that live listings are aging or incomplete, which quietly weakens conversion quality and trust.";
    mandate.targetId = "importBlockerSprintSection";
    mandate.actionLabel = "Fix missing details";
    mandate.secondaryTargetId = "confirmationQueueSection";
    mandate.secondaryActionLabel = "Open confirmation work";
  }

  mandateRoot.innerHTML =
    '<div class="executive-kicker">' +
    escapeHtml(mandate.kicker) +
    '</div><h3 class="executive-title">' +
    escapeHtml(mandate.title) +
    '</h3><div class="executive-copy">' +
    escapeHtml(mandate.copy) +
    '</div><div class="executive-metrics">' +
    [
      {
        value: inboundSupplyCount,
        label: "Inbound supply",
        note: "Applications and new listings waiting to become trusted public inventory.",
      },
      {
        value: trustDebtCount,
        label: "Trust debt",
        note: "Live-listing refresh, confirmation, and missing-detail work still unresolved.",
      },
      {
        value: demandLoadCount,
        label: "Demand pressure",
        note: "Search, help, and concierge signals showing how much human support the product needs.",
      },
    ]
      .map(buildExecutiveMetricHtml)
      .join("") +
    '</div><div class="executive-actions"><button class="btn-secondary" type="button" data-admin-scroll-target="' +
    escapeHtml(mandate.targetId) +
    '">' +
    escapeHtml(mandate.actionLabel) +
    '</button><button class="btn-secondary" type="button" data-admin-scroll-target="' +
    escapeHtml(mandate.secondaryTargetId) +
    '">' +
    escapeHtml(mandate.secondaryActionLabel) +
    "</button></div>";
  mandateRoot.hidden = false;

  var sessionSteps = [
    {
      title:
        context.pendingApplicationsCount >= context.candidateReviewCount
          ? "Convert therapist-submitted supply"
          : "Convert sourced supply into inventory",
      copy:
        context.pendingApplicationsCount >= context.candidateReviewCount
          ? "Applications are the faster supply unlock right now. Clear the best pending decisions before they decay."
          : "New listing review is the fastest way to increase trusted inventory right now.",
      meta:
        context.pendingApplicationsCount >= context.candidateReviewCount
          ? context.pendingApplicationsCount +
            " pending applications are waiting on a human decision."
          : context.candidateReviewCount +
            " new listings are waiting for review, publish, or merge.",
      targetId:
        context.pendingApplicationsCount >= context.candidateReviewCount
          ? "applicationsPanel"
          : "candidateQueuePanel",
      destination:
        context.pendingApplicationsCount >= context.candidateReviewCount
          ? "Review Applications"
          : "Add New Listings",
      firstStep: "Open the top card and check trust-critical completeness first.",
      nextStep: "Make a publish, approval, merge, revision, or archive decision before moving on.",
      done: "The record leaves limbo with a clear next state.",
      actionLabel:
        context.pendingApplicationsCount >= context.candidateReviewCount
          ? "Open applications"
          : "Open candidate lane",
    },
    {
      title:
        context.strictImportBlockerCount >= context.profilesNeedingRefresh
          ? "Reduce missing-detail trust debt"
          : "Protect live-listing freshness",
      copy:
        context.strictImportBlockerCount >= context.profilesNeedingRefresh
          ? "Work the highest-value missing detail so live profiles become defensible and conversion-ready."
          : "Review live-listing updates before aging trust signals start weakening conversion quality.",
      meta:
        context.strictImportBlockerCount >= context.profilesNeedingRefresh
          ? context.strictImportBlockerCount + " listings still have trust-critical missing fields."
          : context.profilesNeedingRefresh +
            " live listings need refresh or reconfirmation attention.",
      targetId: "importBlockerSprintSection",
      destination: "Fix Missing Listing Details",
      firstStep: "Take the top listing and verify the single highest-leverage field first.",
      nextStep: "If you cannot prove it, move it into confirmation instead of guessing.",
      done: "The listing is more trustworthy than when the session started.",
      actionLabel: "Open trust debt lane",
    },
  ];

  workflowRoot.innerHTML =
    '<h3 class="intel-panel-title">Best path for this session</h3><div class="intel-panel-copy">Follow this sequence if you want to leave the system in a measurably better business state, even if you only have one focused work block.</div><div class="session-steps">' +
    sessionSteps
      .map(function (step, index) {
        return buildSessionStepHtml(step, index);
      })
      .join("") +
    "</div>";

  var growthConstraint =
    trustDebtCount > inboundSupplyCount
      ? {
          label: "Growth constraint",
          value: "Trust debt is outrunning new supply.",
          note: "The directory is carrying enough missing or aging work that conversion quality may degrade faster than new supply improves it.",
        }
      : inboundSupplyCount > trustDebtCount
        ? {
            label: "Growth constraint",
            value: "Decision throughput is now the main lever.",
            note: "The business has enough inbound supply to grow, but only if applications and listings are pushed to clear next states quickly.",
          }
        : {
            label: "Growth constraint",
            value: "Supply and trust debt are roughly balanced.",
            note: "The system needs both throughput and trust maintenance, so operator sequencing matters more than one heroic lane push.",
          };
  var conversionHealth =
    context.heardBackCount + context.bookedConsultCount > context.openConciergeCount
      ? {
          label: "Conversion health",
          value: "Follow-through signals are present.",
          note: context.bookedConsultCount
            ? context.bookedConsultCount +
              " booked consult outcomes are already showing downstream traction."
            : "Users are still moving through the funnel, which gives room to focus on supply and trust quality.",
        }
      : {
          label: "Conversion health",
          value: "Human guidance demand is high.",
          note: "Concierge and help signals are outweighing strong downstream outcomes, which suggests UX clarity and trusted supply still need tightening.",
        };
  var serviceLoad = {
    label: "Service load",
    value:
      context.openConciergeCount + context.openPortalRequestCount > 0
        ? context.openConciergeCount +
          " concierge + " +
          context.openPortalRequestCount +
          " portal requests open"
        : "Inbound service load is stable.",
    note:
      context.openConciergeCount + context.openPortalRequestCount > 0
        ? "If these queues rise without clear ownership, operator time gets pulled away from publish and trust work."
        : "This is a good window to push core supply and trust workflows without service drag.",
  };
  var supplyReadiness = {
    label: "Supply readiness",
    value:
      context.listingPromotionCount > 0
        ? context.listingPromotionCount + " listings are close to promotion-ready."
        : context.matchReadyCount + " profiles are match-ready today.",
    note:
      context.listingPromotionCount > 0
        ? "There is visible upside in merchandising and promotion once trust/freshness standards are met."
        : "The live inventory is usable, but the next big gain likely comes from new supply or trust cleanup rather than promotion.",
  };

  intelligenceRoot.innerHTML =
    '<h3 class="intel-panel-title">Business intelligence</h3><div class="intel-panel-copy">This is the MBA layer: what is constraining growth, where human effort is leaking, and which operating move is most likely to change the business this week.</div><div class="intel-stack">' +
    [growthConstraint, conversionHealth, serviceLoad, supplyReadiness]
      .map(buildExecutiveBriefHtml)
      .join("") +
    "</div>";

  guideRoot.innerHTML =
    '<h3 class="intel-panel-title">Zero-knowledge operator guide</h3><div class="intel-panel-copy">A first-time operator should be able to land here and work without tribal knowledge. Use this mental model before diving into the detailed queues below.</div><ul class="onboarding-list"><li class="onboarding-item"><strong>1. Start with what is on fire.</strong><span>Open Needs Action Now first. That queue tells you what is overdue, stale, or ownerless, which is the fastest way to prevent operational drift.</span></li><li class="onboarding-item"><strong>2. Then convert supply.</strong><span>Use Add New Listings for sourced supply and Review Applications for therapist-submitted supply. The rule is simple: every record should leave with a clearer state than it arrived with.</span></li><li class="onboarding-item"><strong>3. Protect trust on live supply.</strong><span>Fix Missing Listing Details, Send Confirmation Requests, and Review Listing Updates are the quality-control lanes that keep public inventory credible.</span></li><li class="onboarding-item"><strong>4. Use Intelligence to understand why.</strong><span>The intelligence region is the readout layer. It should help you choose the next operating move, not distract you from making one.</span></li></ul><div class="executive-actions"><button class="btn-secondary" type="button" data-admin-scroll-target="' +
    escapeHtml(mandate.targetId) +
    '">' +
    escapeHtml("Open the best first lane") +
    "</button></div>";
}

function buildWorkflowGuidanceMetricHtml(metric) {
  if (!metric) {
    return "";
  }
  return (
    '<div class="workflow-guidance-metric"><div class="workflow-guidance-metric-label">' +
    escapeHtml(metric.label || "") +
    '</div><div class="workflow-guidance-metric-value">' +
    escapeHtml(metric.value || "0") +
    "</div></div>"
  );
}

function buildWorkflowGuidanceListHtml(items) {
  if (!Array.isArray(items) || !items.length) {
    return "";
  }
  return (
    '<ul class="workflow-guidance-list">' +
    items
      .filter(Boolean)
      .map(function (item) {
        return "<li>" + escapeHtml(item) + "</li>";
      })
      .join("") +
    "</ul>"
  );
}

function renderWorkflowLaneGuidance(rootId, config) {
  var root = document.getElementById(rootId);
  if (!root) {
    return;
  }
  if (!config || !config.title) {
    root.innerHTML = "";
    return;
  }
  root.innerHTML =
    '<details class="workflow-guidance-details"><summary class="workflow-guidance-summary">' +
    '<span class="workflow-guidance-summary-kicker">' +
    escapeHtml(config.kicker || "Workflow guidance") +
    "</span>" +
    '<span class="workflow-guidance-summary-title">' +
    escapeHtml(config.title) +
    "</span>" +
    '<span class="workflow-guidance-summary-badge">' +
    escapeHtml(config.badge || "In focus") +
    "</span>" +
    "</summary>" +
    '<div class="workflow-guidance-card"><div class="workflow-guidance-copy">' +
    escapeHtml(config.copy || "") +
    '</div><div class="workflow-guidance-metrics">' +
    (Array.isArray(config.metrics)
      ? config.metrics.map(buildWorkflowGuidanceMetricHtml).join("")
      : "") +
    '</div><div class="workflow-guidance-grid"><div class="workflow-guidance-section"><div class="workflow-guidance-section-title">Best next move</div>' +
    buildWorkflowGuidanceListHtml(config.steps || []) +
    '</div><div class="workflow-guidance-section"><div class="workflow-guidance-section-title">Success looks like</div>' +
    buildWorkflowGuidanceListHtml(config.success || []) +
    '</div></div><div class="workflow-guidance-callout"><strong>Business read:</strong> ' +
    escapeHtml(config.callout || "") +
    "</div></div></details>";
}

export function renderAdminWorkflowGuidance(context) {
  var candidateReviewCount = Number((context && context.candidateReviewCount) || 0);
  var candidateDuplicateCount = Number((context && context.candidateDuplicateCount) || 0);
  var pendingApplicationsCount = Number((context && context.pendingApplicationsCount) || 0);
  var reviewingApplicationsCount = Number((context && context.reviewingApplicationsCount) || 0);
  var claimFollowUpCount = Number((context && context.claimFollowUpCount) || 0);
  var publishReadyApplicationsCount = Number(
    (context && context.publishReadyApplicationsCount) || 0,
  );
  var openConciergeCount = Number((context && context.openConciergeCount) || 0);
  var openPortalRequestCount = Number((context && context.openPortalRequestCount) || 0);
  var profilesNeedingRefresh = Number((context && context.profilesNeedingRefresh) || 0);
  var strictImportBlockerCount = Number((context && context.strictImportBlockerCount) || 0);

  renderWorkflowLaneGuidance("candidateQueueGuidance", {
    kicker: "Supply conversion",
    title:
      candidateReviewCount > 0
        ? "Convert fresh supply before it decays"
        : "Supply lane is clear for now",
    copy:
      candidateReviewCount > 0
        ? "Treat this lane like pipeline creation. Clear duplicate risk first, then push strong supply into publish or confirmation so promising listings do not age in review."
        : "No unworked candidate supply is waiting right now. Use this lane for net-new sourcing bursts or spot-checks.",
    badge:
      candidateDuplicateCount > 0
        ? candidateDuplicateCount + " possible duplicates"
        : "Lane stable",
    metrics: [{ label: "Listings to work", value: String(candidateReviewCount) }],
    steps: [
      "Work the top card first. Publish, send to review, or delete in one click.",
      "Resolve any duplicate flag before publishing so the provider graph stays clean.",
      "Do not leave candidates as ambiguous maybes. Every card should leave cleaner than it arrived.",
    ],
    success: [
      "Strong listings publish in one click without an intermediate staging step.",
      "Weak or duplicate supply stops clogging the top of the funnel.",
      "The queue reflects deliberate operating choices, not indecision.",
    ],
    callout:
      candidateReviewCount > pendingApplicationsCount
        ? "Sourced supply is outrunning therapist-submitted supply right now, so candidate triage is the faster path to inventory growth."
        : "Candidate volume is under control, which means this lane should optimize quality and conversion rather than just speed.",
  });

  renderWorkflowLaneGuidance("applicationsGuidance", {
    kicker: "Application decisions",
    title:
      pendingApplicationsCount > 0
        ? "Turn therapist intent into live inventory fast"
        : "Application review is under control",
    copy:
      pendingApplicationsCount > 0
        ? "Applicants already raised their hand. The business win here is rapid, high-quality decisions that convert serious therapists into live profiles without endless limbo."
        : "Pending application load is light right now. Use the lane to clean up reviewing items and polish the conversion experience.",
    badge:
      publishReadyApplicationsCount > 0
        ? publishReadyApplicationsCount + " publish-ready"
        : claimFollowUpCount > 0
          ? claimFollowUpCount + " claim follow-ups"
          : "Decision flow stable",
    metrics: [
      { label: "Pending", value: String(pendingApplicationsCount) },
      { label: "Reviewing", value: String(reviewingApplicationsCount) },
      { label: "Claim follow-up", value: String(claimFollowUpCount) },
      { label: "Publish-ready", value: String(publishReadyApplicationsCount) },
    ],
    steps: [
      "Review trust-critical details first, then completeness, then publishability.",
      "If the application is good enough, move it. If it needs work, request specific fixes instead of holding it.",
      "Use claim follow-up as revenue protection. Those records are already warm and should not drift.",
    ],
    success: [
      "Strong applications leave with approval or publish momentum.",
      "Fixable applications get actionable feedback rather than vague delay.",
      "Pending count trends downward without lowering the bar.",
    ],
    callout:
      claimFollowUpCount > 0
        ? "Claim-related follow-up is sitting inside the queue, which is usually the cheapest conversion lift available."
        : "Application flow health depends on decision speed. A clean queue compounds trust with therapists and keeps supply acquisition efficient.",
  });

  renderWorkflowLaneGuidance("opsInboxGuidance", {
    kicker: "Cross-lane leverage",
    title: "Use the inbox for the highest-value next move",
    copy: "This panel should collapse the noise across publish, merge, refresh, and confirmation into the few actions that matter most right now.",
    badge:
      profilesNeedingRefresh + strictImportBlockerCount > 0
        ? "Trust work active"
        : "Inbox balanced",
    metrics: [
      { label: "Refresh risk", value: String(profilesNeedingRefresh) },
      { label: "Missing details", value: String(strictImportBlockerCount) },
      { label: "Concierge", value: String(openConciergeCount) },
      { label: "Portal requests", value: String(openPortalRequestCount) },
    ],
    steps: [
      "Use this lane when you need one high-value action instead of browsing every queue.",
      "Prioritize the item that unlocks trust, publication, or team flow with the least extra work.",
      "After completing the action, jump back here for the next operating move.",
    ],
    success: [
      "The inbox consistently points to the highest-leverage task.",
      "Reviewers spend less time hunting and more time deciding.",
      "Cross-functional requests stay visible without hijacking supply lanes.",
    ],
    callout:
      openPortalRequestCount + openConciergeCount > 0
        ? "Human demand and therapist requests are both active, so this inbox is the bridge between growth work and service work."
        : "When request pressure is low, the inbox should bias toward trust maintenance and supply conversion.",
  });
}
