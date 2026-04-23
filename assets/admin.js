import {
  approveApplication,
  getApplications,
  getTherapists,
  requestApplicationChanges,
  publishApplication,
  rejectApplication,
  updateApplicationReviewMetadata,
} from "./store.js";
import { fetchPublicTherapists } from "./cms.js";
import { setActiveView as setActiveAdminView } from "./admin-view-tabs.js";
import {
  checkAdminReviewApiAvailability,
  loadGeneratedAdminArtifacts,
  loadRemoteAdminSnapshot,
} from "./admin-data.js";
import { createAdminReviewModels } from "./admin-review-models.js";
import { promptForRejectionReason } from "./admin-rejection-reason-picker.js";
import { createReviewerWorkspace } from "./admin-reviewer-workspace.js";
import {
  approveTherapistApplication,
  applyTherapistApplicationFields,
  checkReviewApiHealth,
  decideTherapistCandidate,
  decideLicensureOps,
  decideTherapistOps,
  exportReviewEvents,
  fetchAdminSession,
  fetchReviewEvents,
  fetchTherapistCandidates,
  fetchTherapistPortalRequests,
  fetchTherapistReviewers,
  getAdminActorId,
  getAdminActorName,
  getAdminSessionToken,
  fetchTherapistApplications,
  rejectTherapistApplication as rejectTherapistApplicationRemote,
  setAdminSessionToken,
  signInAdmin,
  signOutAdmin,
  updateTherapistApplication,
  updateTherapistCandidate,
  updateTherapistPortalRequest,
} from "./review-api.js";
import {
  buildTherapistFieldConfirmationPrompt,
  getDataFreshnessSummary,
  getEditoriallyVerifiedOperationalCount,
  getTherapistConfirmationAgenda,
  getTherapistMatchReadiness,
  getTherapistMerchandisingQuality,
  getRecentConfirmationSummary,
  getTherapistReviewCoaching,
} from "./matching-model.js";
import {
  readFunnelEvents,
  setPromotedExperimentVariant,
  summarizeContactRouteOutcomePerformance,
  summarizeAdaptiveSignals,
  summarizeDirectoryProfileOpenQuality,
  summarizeExperimentDecisions,
  summarizeExperimentPerformance,
  summarizeFunnelEvents,
  summarizeProfileContactExperimentDecision,
  summarizeProfileContactOutcomeValidation,
  summarizeProfileContactSignals,
  summarizeProfileQueueProgress,
  summarizePatientJourney,
} from "./funnel-analytics.js";
import { createConfirmationWorkspace } from "./admin-confirmation-workspace.js";
import { createListingsWorkspace } from "./admin-listings-workspace.js";
import { getNextBestAdminActions } from "./admin-priority-actions.js";
import { createAdminWorkflowNavigator } from "./admin-workflow-navigation.js";
import { createAdminDashboardCardBuilders } from "./admin-dashboard-cards.js";
import { createAdminRouteHealthActions } from "./admin-route-health-actions.js";
import { getSourceReferenceMeta } from "./admin-source-reference.js";
import {
  getRouteHealthWarnings,
  isBookingRouteHealthy,
  isWebsiteRouteHealthy,
} from "./route-health.js";
import {
  createAdminRuntimeState,
  createRemoteAuthRequiredState,
  createRemoteSignedInState,
} from "./admin-state.js";
import {
  bindCandidateEditDrawer,
  openCandidateEditDrawer,
  openTherapistEditDrawer,
} from "./admin-candidate-edit.js";

if (typeof document !== "undefined" && document.documentElement) {
  document.documentElement.setAttribute("data-admin-boot", "script-loaded");
}
if (typeof window !== "undefined" && window.addEventListener && document.documentElement) {
  window.addEventListener("error", function (event) {
    document.documentElement.setAttribute("data-admin-boot", "boot-error");
    document.documentElement.setAttribute(
      "data-admin-boot-error",
      String(
        (event && event.error && event.error.message) ||
          (event && event.message) ||
          "unknown-error",
      ),
    );
  });
  window.addEventListener("unhandledrejection", function (event) {
    var reason = event ? event.reason : "";
    document.documentElement.setAttribute("data-admin-boot", "boot-error");
    document.documentElement.setAttribute(
      "data-admin-boot-error",
      String((reason && reason.message) || reason || "unhandled-rejection"),
    );
  });
}

let dataMode = "local";
let remoteApplications = [];
let remoteCandidates = [];
let remotePortalRequests = [];
let remoteReviewEvents = [];
let reviewActivityItems = [];
let reviewActivityNextCursor = "";
let reviewActivityLoading = false;
let publishedTherapists = [];
let applicationLiveApplySummaries = {};
let ingestionAutomationHistory = [];
let licensureRefreshQueue = [];
let deferredLicensureQueue = [];
let licensureActivityFeed = [];
let profileConversionFreshnessQueue = [];
let authRequired = false;
let authErrorVisible = false;
let licensureQueueFilter = "";
let licensureActivityFilter = "";
let reviewActivityFilter = "";
let reviewActivitySavedViewId = "";
let adminWorkflowUrlParamsApplied = false;
let conciergeFilters = {
  status: "",
};
let portalRequestFilters = {
  status: "",
};
let adminInspectorSelection = {
  kind: "",
  id: "",
};
let adminInspectorActionStatus = "";
let commandPaletteOpen = false;
let commandPaletteQuery = "";
let commandPaletteActiveIndex = 0;
const adminLazyModuleCache = new Map();
const CONCIERGE_REQUESTS_KEY = "bth_concierge_requests_v1";
const OUTREACH_OUTCOMES_KEY = "bth_outreach_outcomes_v1";
const REVIEW_ACTIVITY_VIEW_KEY = "bth_review_activity_view_v1";
const REVIEW_ACTIVITY_SAVED_VIEWS_KEY = "bth_review_activity_saved_views_v1";
const COMMAND_PALETTE_RECENTS_KEY = "bth_admin_command_palette_recents_v1";
const COMMAND_PALETTE_FAVORITES_KEY = "bth_admin_command_palette_favorites_v1";
const REQUEST_STATUS_OPTIONS = ["new", "triaging", "in_progress", "waiting_on_user", "resolved"];
const THERAPIST_FOLLOW_UP_OPTIONS = [
  "unreviewed",
  "good_candidate",
  "suggest_contact",
  "needs_review",
  "not_a_fit",
];
const CONFIRMATION_STATUS_OPTIONS = [
  "not_started",
  "sent",
  "waiting_on_therapist",
  "confirmed",
  "applied",
];
let applicationFilters = {
  q: "",
  status: "",
  focus: "",
  goal: "balanced",
};
let candidateFilters = {
  q: "",
  review_status: "",
  dedupe_status: "",
  review_lane: "",
};
let reviewFilters = {
  q: "",
  dedupe_status: "",
};
const reviewerWorkspace = createReviewerWorkspace({
  escapeHtml: escapeHtml,
  formatDate: formatDate,
  getPublishedTherapists: function () {
    return dataMode === "sanity" ? publishedTherapists : getTherapists();
  },
  getRuntimeState: function () {
    return {
      dataMode: dataMode,
      remoteApplications: remoteApplications,
      remoteCandidates: remoteCandidates,
    };
  },
});
const reviewModels = createAdminReviewModels({
  applicationFilters: applicationFilters,
  applicationLiveApplySummaries: function () {
    return applicationLiveApplySummaries;
  },
  escapeHtml: escapeHtml,
  formatDate: formatDate,
  formatFieldLabel: formatFieldLabel,
  formatLocationLine: formatLocationLine,
  formatStatusLabel: formatStatusLabel,
  getAfterClaimReviewStall: getAfterClaimReviewStall,
  getBooleanRecordValue: getBooleanRecordValue,
  getClaimFollowUpUrgency: getClaimFollowUpUrgency,
  getDataMode: function () {
    return dataMode;
  },
  getPhotoSourceLabel: getPhotoSourceLabel,
  getPublishedTherapists: function () {
    return publishedTherapists;
  },
  getRecordValue: getRecordValue,
  getTherapistMatchReadiness: getTherapistMatchReadiness,
  getTherapists: getTherapists,
  hasPreferredPhotoSource: hasPreferredPhotoSource,
  isConfirmationRefreshApplication: isConfirmationRefreshApplication,
  normalizeListValue: normalizeListValue,
});
const confirmationWorkspace = createConfirmationWorkspace({
  buildConfirmationApplyBrief: buildConfirmationApplyBrief,
  buildImportBlockerRequestMessage: buildImportBlockerRequestMessage,
  buildImportBlockerRequestSubject: buildImportBlockerRequestSubject,
  buildOrderedConfirmationRequestMessage: buildOrderedConfirmationRequestMessage,
  buildTherapistFieldConfirmationPrompt: buildTherapistFieldConfirmationPrompt,
  californiaPriorityConfirmationMeta: {
    "maya-smolarek-pasadena-ca": {
      first_action:
        "Ask for Dr. Maya Smolarek by name and confirm whether Pasadena or California telehealth is the right intake path first.",
      follow_up_rule:
        "If front-desk staff cannot confirm on the call, ask for the best email or callback path and follow up within 2 business days.",
      follow_up_business_days: 2,
    },
    "dr-stacia-mills-pasadena-ca": {
      first_action:
        "Lead with the free mini-consultation framing and keep the ask tight: bipolar-years first, wait time second.",
      follow_up_rule:
        "If there is no reply, follow up once after 4 business days and then leave the fields unchanged until confirmed.",
      follow_up_business_days: 4,
    },
    "dr-sylvia-cartwright-la-jolla-ca": {
      first_action:
        "Use the online scheduling or contact path and position this as a brief profile-accuracy confirmation for California telehealth patients.",
      follow_up_rule:
        "If there is no response through the website path, try one phone follow-up during listed office hours before pausing.",
      follow_up_business_days: 2,
    },
    "dr-je-ko-los-angeles-ca": {
      first_action:
        "Lead with whether the inquiry is for Westwood in-person care or California telepsychiatry, then keep the ask tight: bipolar-years first, timing second.",
      follow_up_rule:
        "If there is no response through the website path, follow up once by phone during listed office hours before pausing.",
      follow_up_business_days: 2,
    },
    "dr-daniel-kaushansky-los-angeles-ca": {
      first_action:
        "Lead with the free bipolar therapy consultation framing and keep the ask focused on bipolar-years first, then timing and insurance stance if available.",
      follow_up_rule:
        "If there is no reply, follow up once by email or phone within 3 business days and then leave the fields unchanged until confirmed.",
      follow_up_business_days: 3,
    },
  },
  californiaPriorityConfirmationSlugs: [
    "maya-smolarek-pasadena-ca",
    "dr-stacia-mills-pasadena-ca",
    "dr-sylvia-cartwright-la-jolla-ca",
    "dr-je-ko-los-angeles-ca",
    "dr-daniel-kaushansky-los-angeles-ca",
  ],
  confirmationQueueKey: "bth_confirmation_queue_v1",
  confirmationResponseFields: [
    "bipolarYearsExperience",
    "estimatedWaitTime",
    "insuranceAccepted",
    "yearsExperience",
    "telehealthStates",
    "sessionFeeMin",
    "sessionFeeMax",
    "slidingScale",
  ],
  confirmationResponseItemFieldMap: {
    bipolarYearsExperience: ["bipolarYearsExperience", "bipolar_years_experience"],
    estimatedWaitTime: ["estimatedWaitTime", "estimated_wait_time"],
    insuranceAccepted: ["insuranceAccepted", "insurance_accepted"],
    yearsExperience: ["yearsExperience", "years_experience"],
    telehealthStates: ["telehealthStates", "telehealth_states"],
    sessionFeeMin: ["sessionFeeMin", "session_fee_min"],
    sessionFeeMax: ["sessionFeeMax", "session_fee_max"],
    slidingScale: ["slidingScale", "sliding_scale"],
  },
  confirmationResponseValuesKey: "bth_confirmation_response_values_v1",
  confirmationStatusOptions: CONFIRMATION_STATUS_OPTIONS,
  copyText: copyText,
  escapeHtml: escapeHtml,
  formatDate: formatDate,
  formatFieldLabel: formatFieldLabel,
  formatStatusLabel: formatStatusLabel,
  getPreferredFieldOrder: getPreferredFieldOrder,
  getRuntimeState: function () {
    return {
      authRequired: authRequired,
      dataMode: dataMode,
      publishedTherapists: publishedTherapists,
    };
  },
  getTherapistConfirmationAgenda: getTherapistConfirmationAgenda,
  getTherapists: getTherapists,
  renderConfirmationQueue: function () {
    renderConfirmationQueue();
  },
  renderConfirmationSprint: function () {
    renderConfirmationSprint();
  },
  renderImportBlockerSprint: function () {
    renderImportBlockerSprint();
  },
  renderStats: function () {
    renderStats();
  },
});
const listingsWorkspace = createListingsWorkspace({
  escapeHtml: escapeHtml,
  formatDate: formatDate,
  getConfirmationGraceWindowNote: getConfirmationGraceWindowNote,
  getDataFreshnessSummary: getDataFreshnessSummary,
  getEditoriallyVerifiedOperationalCount: getEditoriallyVerifiedOperationalCount,
  getRecentConfirmationSummary: getRecentConfirmationSummary,
  getRuntimeState: function () {
    return {
      authRequired: authRequired,
      dataMode: dataMode,
      publishedTherapists: publishedTherapists,
    };
  },
  getTherapistConfirmationAgenda: getTherapistConfirmationAgenda,
  getTherapistMatchReadiness: getTherapistMatchReadiness,
  getTherapistMerchandisingQuality: getTherapistMerchandisingQuality,
  getRouteHealthWarnings: getRouteHealthWarnings,
  getRouteHealthActionItems: function (record) {
    return getRouteHealthActionItems(record);
  },
  queueRouteHealthFollowUp: function (therapistId, actionKey) {
    return queueRouteHealthFollowUp(therapistId, actionKey);
  },
  getTherapists: getTherapists,
});
const savedReviewActivityView = readReviewActivityView();
if (savedReviewActivityView && typeof savedReviewActivityView.filter === "string") {
  reviewActivityFilter = savedReviewActivityView.filter;
}
if (typeof window !== "undefined") {
  var reviewActivityLaneParam = new URL(window.location.href).searchParams.get(
    "reviewActivityLane",
  );
  if (typeof reviewActivityLaneParam === "string") {
    reviewActivityFilter = reviewActivityLaneParam;
  }
}
applyAdminWorkflowUrlParams();

function ensureWorkflowSectionRendered(sectionId) {
  switch (sectionId) {
    case "candidateQueuePanel":
      renderCandidateQueue();
      break;
    case "reviewQueuePanel":
      renderReviewQueue();
      break;
    case "applicationsPanel":
      renderApplications();
      break;
    case "importBlockerSprintSection":
      renderImportBlockerSprint();
      break;
    case "confirmationQueueSection":
      renderConfirmationQueue();
      break;
    case "confirmationSprintSection":
      renderConfirmationSprint();
      break;
    case "publishedListingsSection":
      renderListings();
      break;
    default:
      break;
  }
}
const workflowNavigator = createAdminWorkflowNavigator({
  escapeHtml: escapeHtml,
  ensureSectionRendered: ensureWorkflowSectionRendered,
  setActiveView: setActiveAdminView,
  getGrid: function () {
    return document.querySelector("#adminApp .grid");
  },
  workflowHashMap: {
    candidateQueueStartHere: "candidateQueuePanel",
    applicationReviewStartHere: "applicationsPanel",
    importBlockerStartHere: "importBlockerSprintSection",
    confirmationQueueStartHere: "confirmationQueueSection",
    confirmationSprintStartHere: "confirmationSprintSection",
    publishedListingsStartHere: "publishedListingsSection",
  },
});
const applyWorkflowFocusMode = workflowNavigator.applyWorkflowFocusMode;
const spotlightSection = workflowNavigator.spotlightSection;
const clearWorkflowFocusMode = workflowNavigator.clearWorkflowFocusMode;
const clearWorkflowHandoffs = workflowNavigator.clearWorkflowHandoffs;
const focusAdminWorkflowTarget = workflowNavigator.focusAdminWorkflowTarget;
const handleWorkflowPrimaryActionClick = workflowNavigator.handleWorkflowPrimaryActionClick;
const scrollToElementWithOffset = workflowNavigator.scrollToElementWithOffset;
const syncWorkflowFocusFromHash = workflowNavigator.syncWorkflowFocusFromHash;
const ADMIN_REGION_IDS = [
  "opsControlRegion",
  "supplyReviewRegion",
  "liveListingsRegion",
  "confirmationRegion",
  "requestsRegion",
  "intelligenceRegion",
];

function setQuickNavActiveState(activeId) {
  if (typeof document === "undefined") {
    return;
  }
  document.querySelectorAll("#adminQuickNav a[href^='#']").forEach(function (link) {
    var targetId = String(link.getAttribute("href") || "").replace(/^#/, "");
    var isActive = Boolean(activeId) && targetId === activeId;
    link.classList.toggle("is-active", isActive);
    if (isActive) {
      link.setAttribute("aria-current", "true");
    } else {
      link.removeAttribute("aria-current");
    }
  });
}

function setOperatorGuideActiveState(activeId) {
  if (typeof document === "undefined") {
    return;
  }
  document.querySelectorAll(".operator-guide-main[href^='#']").forEach(function (link) {
    var targetId = String(link.getAttribute("href") || "").replace(/^#/, "");
    var isActive = Boolean(activeId) && targetId === activeId;
    link.classList.toggle("is-active", isActive);
    if (isActive) {
      link.setAttribute("aria-current", "true");
    } else {
      link.removeAttribute("aria-current");
    }
  });
}

function syncAdminQuickNavFromViewport() {
  if (typeof document === "undefined" || authRequired) {
    return;
  }
  var activeId = "";
  var bestOffset = Number.POSITIVE_INFINITY;

  ADMIN_REGION_IDS.forEach(function (sectionId) {
    var section = document.getElementById(sectionId);
    if (!section) {
      return;
    }
    var rect = section.getBoundingClientRect();
    var offset = Math.abs(rect.top - 128);
    var isCandidate = rect.top <= 180 && rect.bottom > 160;
    if (isCandidate && offset < bestOffset) {
      bestOffset = offset;
      activeId = sectionId;
    }
  });

  if (!activeId) {
    ADMIN_REGION_IDS.some(function (sectionId) {
      var section = document.getElementById(sectionId);
      if (!section) {
        return false;
      }
      var rect = section.getBoundingClientRect();
      if (rect.top > 0) {
        activeId = sectionId;
        return true;
      }
      return false;
    });
  }

  if (!activeId) {
    activeId = ADMIN_REGION_IDS[ADMIN_REGION_IDS.length - 1] || "";
  }

  setQuickNavActiveState(activeId);
}

function focusAdminAnchorTarget(targetId, options) {
  if (typeof document === "undefined" || !targetId) {
    return;
  }
  prefetchAdminModulesForTarget(targetId);
  var target = document.getElementById(targetId);
  if (!target) {
    return;
  }
  var viewHost = target.closest("[data-view-group]");
  var targetGroup = viewHost ? viewHost.getAttribute("data-view-group") : "";
  var currentView = document.body.getAttribute("data-admin-view") || "today";
  var needsViewSwitch = targetGroup && targetGroup !== currentView;
  if (needsViewSwitch) {
    setActiveAdminView(targetGroup);
  }
  var runFocus = function () {
    if (options && options.useWorkflowMode) {
      applyWorkflowFocusMode(target);
      spotlightSection(target);
    }
    scrollToElementWithOffset(target, "start");
  };
  if (needsViewSwitch && typeof window !== "undefined") {
    window.requestAnimationFrame(runFocus);
  } else {
    runFocus();
  }
  if (typeof window !== "undefined") {
    var nextHash = "#" + targetId;
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, "", nextHash);
    }
  }
  setQuickNavActiveState(targetId);
  setOperatorGuideActiveState(targetId);
}

function bindAdminNavigationInteractions() {
  if (typeof document === "undefined") {
    return;
  }
  document.querySelectorAll("#adminQuickNav a[href^='#']").forEach(function (link) {
    var targetId = String(link.getAttribute("href") || "").replace(/^#/, "");
    link.addEventListener("mouseenter", function () {
      prefetchAdminModulesForTarget(targetId);
    });
    link.addEventListener("focus", function () {
      prefetchAdminModulesForTarget(targetId);
    });
    link.addEventListener("click", function (event) {
      if (!targetId) {
        return;
      }
      event.preventDefault();
      focusAdminAnchorTarget(targetId);
    });
  });

  document.querySelectorAll(".operator-guide-main[href^='#']").forEach(function (link) {
    var targetId = String(link.getAttribute("href") || "").replace(/^#/, "");
    link.addEventListener("mouseenter", function () {
      prefetchAdminModulesForTarget(targetId);
    });
    link.addEventListener("focus", function () {
      prefetchAdminModulesForTarget(targetId);
    });
    link.addEventListener("click", function (event) {
      if (!targetId) {
        return;
      }
      event.preventDefault();
      focusAdminAnchorTarget(targetId, { useWorkflowMode: true });
    });
  });
}

function readAdminWorkflowUrlParams() {
  if (typeof window === "undefined") {
    return { owner: "", therapistSlug: "", ticketKind: "", ticketId: "" };
  }
  var params = new URLSearchParams(window.location.search || "");
  return {
    owner: String(params.get("owner") || "").trim(),
    therapistSlug: String(params.get("therapistSlug") || "").trim(),
    ticketKind: String(params.get("ticketKind") || "").trim(),
    ticketId: String(params.get("ticketId") || "").trim(),
  };
}

function applyAdminWorkflowUrlParams() {
  if (typeof window === "undefined" || adminWorkflowUrlParamsApplied) {
    return;
  }
  var params = readAdminWorkflowUrlParams();
  if (
    params.ticketId &&
    (params.ticketKind === "candidate" || params.ticketKind === "application")
  ) {
    adminInspectorSelection = {
      kind: params.ticketKind,
      id: params.ticketId,
    };
  }
  adminWorkflowUrlParamsApplied = true;
}

function syncAdminInspectorUrl() {
  if (typeof window === "undefined" || !window.history || !window.location) {
    return;
  }
  var params = new URLSearchParams(window.location.search || "");
  if (adminInspectorSelection.kind && adminInspectorSelection.id) {
    params.set("ticketKind", adminInspectorSelection.kind);
    params.set("ticketId", adminInspectorSelection.id);
  } else {
    params.delete("ticketKind");
    params.delete("ticketId");
  }
  var query = params.toString();
  var nextUrl =
    window.location.pathname + (query ? "?" + query : "") + (window.location.hash || "");
  window.history.replaceState({}, "", nextUrl);
}

function syncAdminWorkflowUrlFocus() {
  if (typeof window === "undefined") {
    return;
  }
  var params = readAdminWorkflowUrlParams();
  if (!params.therapistSlug) {
    return;
  }

  var hash = window.location.hash ? window.location.hash.slice(1) : "";
  var sectionTarget = hash ? document.getElementById(hash) : null;
  var safeSlug = params.therapistSlug.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  var scopedTarget = document.querySelector('[data-admin-therapist-slug="' + safeSlug + '"]');
  var target = scopedTarget || sectionTarget;
  if (!target) {
    return;
  }
  if (sectionTarget) {
    applyWorkflowFocusMode(sectionTarget);
  }
  scrollToElementWithOffset(target, "start");
  spotlightSection(target);
}

if (typeof window !== "undefined") {
  if (window.history && "scrollRestoration" in window.history) {
    window.history.scrollRestoration = "manual";
  }
  bindAdminNavigationInteractions();
  window.addEventListener(
    "scroll",
    function () {
      syncAdminQuickNavFromViewport();
    },
    { passive: true },
  );
  window.addEventListener("hashchange", function () {
    syncWorkflowFocusFromHash();
    window.setTimeout(function () {
      syncAdminWorkflowUrlFocus();
      syncAdminQuickNavFromViewport();
    }, 120);
  });
  window.setTimeout(function () {
    applyAdminWorkflowUrlParams();
    syncWorkflowFocusFromHash();
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(function () {
        warmAdminLikelyNextModules();
      });
    } else {
      window.setTimeout(function () {
        warmAdminLikelyNextModules();
      }, 1200);
    }
    window.setTimeout(function () {
      syncAdminWorkflowUrlFocus();
      syncAdminQuickNavFromViewport();
    }, 120);
    if (!window.location.hash && !readAdminWorkflowUrlParams().therapistSlug) {
      window.scrollTo({ top: 0, behavior: "auto" });
      syncAdminQuickNavFromViewport();
    }
  }, 0);

  document.addEventListener("click", function (event) {
    var candidateCard = event.target.closest("[data-candidate-card-id]");
    if (candidateCard) {
      setAdminInspectorSelection(
        "candidate",
        String(candidateCard.getAttribute("data-candidate-card-id") || ""),
      );
      renderAdminRecordInspector();
    }

    var applicationCard = event.target.closest("[data-application-card-id]");
    if (applicationCard) {
      setAdminInspectorSelection(
        "application",
        String(applicationCard.getAttribute("data-application-card-id") || ""),
      );
      renderAdminRecordInspector();
    }

    var inspectorFocusButton = event.target.closest("[data-inspector-focus-kind]");
    if (inspectorFocusButton) {
      var focusKind = String(inspectorFocusButton.getAttribute("data-inspector-focus-kind") || "");
      var focusId = String(inspectorFocusButton.getAttribute("data-inspector-focus-id") || "");
      var selector =
        focusKind === "candidate"
          ? '[data-candidate-card-id="' + focusId.replace(/"/g, '\\"') + '"]'
          : '[data-application-card-id="' + focusId.replace(/"/g, '\\"') + '"]';
      var target = document.querySelector(selector);
      if (target) {
        spotlightSection(target);
        scrollToElementWithOffset(target, "start");
      }
    }

    var inspectorNavButton = event.target.closest("[data-inspector-nav-direction]");
    if (inspectorNavButton) {
      var direction = String(inspectorNavButton.getAttribute("data-inspector-nav-direction") || "");
      var sequenceMeta = getInspectorSequenceMeta();
      var targetEntry = direction === "prev" ? sequenceMeta.previous : sequenceMeta.next;
      if (targetEntry) {
        setAdminInspectorSelection(targetEntry.kind, targetEntry.id);
        renderAdminRecordInspector();
        if (targetEntry.node) {
          spotlightSection(targetEntry.node);
          scrollToElementWithOffset(targetEntry.node, "start");
        }
      }
    }

    var inspectorActionButton = event.target.closest("[data-inspector-action]");
    if (inspectorActionButton) {
      var inspectorAction = String(
        inspectorActionButton.getAttribute("data-inspector-action") || "",
      );
      var inspectorId = String(inspectorActionButton.getAttribute("data-inspector-id") || "");
      if (!inspectorId || !inspectorAction) {
        return;
      }
      inspectorActionButton.disabled = true;
      Promise.resolve()
        .then(function () {
          return executeInspectorAction(inspectorAction, inspectorId);
        })
        .catch(function (error) {
          console.error("Inspector action failed:", error);
          adminInspectorActionStatus = "Inspector action failed. Try the full card controls.";
          renderAdminRecordInspector();
        })
        .finally(function () {
          inspectorActionButton.disabled = false;
        });
    }
  });

  document.addEventListener("keydown", function (event) {
    var target = event.target;
    var isTypingTarget =
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable);
    if ((event.metaKey || event.ctrlKey) && String(event.key || "").toLowerCase() === "k") {
      event.preventDefault();
      if (commandPaletteOpen) {
        closeCommandPalette();
      } else {
        openCommandPalette();
      }
      return;
    }
    if (!commandPaletteOpen && !isTypingTarget && event.key === "/") {
      event.preventDefault();
      openCommandPalette();
      return;
    }
    if (!commandPaletteOpen) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeCommandPalette();
      return;
    }
    var commands = getFilteredCommandPaletteCommands();
    if (event.key === "ArrowDown") {
      event.preventDefault();
      commandPaletteActiveIndex = Math.min(commandPaletteActiveIndex + 1, commands.length - 1);
      renderCommandPalette();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      commandPaletteActiveIndex = Math.max(commandPaletteActiveIndex - 1, 0);
      renderCommandPalette();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      runCommandPaletteSelection(commandPaletteActiveIndex);
    }
  });

  document.addEventListener("input", function (event) {
    if (event.target && event.target.id === "commandPaletteInput") {
      commandPaletteQuery = String(event.target.value || "");
      commandPaletteActiveIndex = 0;
      renderCommandPalette();
    }
  });

  document.addEventListener("click", function (event) {
    if (event.target && event.target.id === "commandPaletteShell") {
      closeCommandPalette();
      return;
    }
    var paletteFavoriteButton = event.target.closest("[data-command-palette-favorite]");
    if (paletteFavoriteButton) {
      var favoriteIndex = Number(
        paletteFavoriteButton.getAttribute("data-command-palette-favorite") || "0",
      );
      var favoriteCommand = getFilteredCommandPaletteCommands()[favoriteIndex];
      if (favoriteCommand) {
        toggleCommandPaletteFavorite(favoriteCommand.id || favoriteCommand.key || "");
        renderCommandPalette();
      }
      return;
    }
    var paletteItem = event.target.closest("[data-command-palette-index]");
    if (paletteItem) {
      runCommandPaletteSelection(
        Number(paletteItem.getAttribute("data-command-palette-index") || "0"),
      );
    }
  });
}

function applyAdminRuntimeState(nextState) {
  if (!nextState) {
    return;
  }

  if (Object.prototype.hasOwnProperty.call(nextState, "dataMode")) {
    dataMode = nextState.dataMode;
  }
  if (Object.prototype.hasOwnProperty.call(nextState, "remoteApplications")) {
    remoteApplications = nextState.remoteApplications;
  }
  if (Object.prototype.hasOwnProperty.call(nextState, "remoteCandidates")) {
    remoteCandidates = nextState.remoteCandidates;
  }
  if (Object.prototype.hasOwnProperty.call(nextState, "remotePortalRequests")) {
    remotePortalRequests = nextState.remotePortalRequests;
  }
  if (Object.prototype.hasOwnProperty.call(nextState, "remoteReviewEvents")) {
    remoteReviewEvents = nextState.remoteReviewEvents;
  }
  if (Object.prototype.hasOwnProperty.call(nextState, "reviewActivityItems")) {
    reviewActivityItems = nextState.reviewActivityItems;
  }
  if (Object.prototype.hasOwnProperty.call(nextState, "reviewActivityNextCursor")) {
    reviewActivityNextCursor = nextState.reviewActivityNextCursor;
  }
  if (Object.prototype.hasOwnProperty.call(nextState, "reviewActivityLoading")) {
    reviewActivityLoading = nextState.reviewActivityLoading;
  }
  if (Object.prototype.hasOwnProperty.call(nextState, "publishedTherapists")) {
    publishedTherapists = nextState.publishedTherapists;
  }
  if (Object.prototype.hasOwnProperty.call(nextState, "ingestionAutomationHistory")) {
    ingestionAutomationHistory = nextState.ingestionAutomationHistory;
  }
  if (Object.prototype.hasOwnProperty.call(nextState, "licensureRefreshQueue")) {
    licensureRefreshQueue = nextState.licensureRefreshQueue;
  }
  if (Object.prototype.hasOwnProperty.call(nextState, "deferredLicensureQueue")) {
    deferredLicensureQueue = nextState.deferredLicensureQueue;
  }
  if (Object.prototype.hasOwnProperty.call(nextState, "licensureActivityFeed")) {
    licensureActivityFeed = nextState.licensureActivityFeed;
  }
  if (Object.prototype.hasOwnProperty.call(nextState, "profileConversionFreshnessQueue")) {
    profileConversionFreshnessQueue = nextState.profileConversionFreshnessQueue;
  }
  if (Object.prototype.hasOwnProperty.call(nextState, "authRequired")) {
    authRequired = nextState.authRequired;
  }
}

function renderFallbackStats() {
  var statsRoot = document.getElementById("adminStats");
  if (!statsRoot || authRequired) {
    return;
  }
  var fallbackCards = [
    buildOperatorGuideCard({
      kicker: "Add Supply",
      title: "Add New Listings",
      copy: "Work newly discovered listings into the system so good supply does not sit unreviewed.",
      steps: [
        "Open the new-listings lane and inspect the original source.",
        "Decide whether the listing is publishable, needs confirmation, or is a duplicate.",
      ],
      done: "The listing is moved into the right next state.",
      actionLabel: "Open new-listings overview",
      directActionLabel: "Start with first listing",
      targetId: "candidateQueuePanel",
      focusTargetId: "candidateQueueStartHere",
      targetSummary: "Add New Listings -> first listing row",
    }),
    buildOperatorGuideCard({
      kicker: "Review Supply",
      title: "Review Applications",
      copy: "Review therapist-submitted applications so strong profiles can turn into live listings fast.",
      steps: [
        "Open the applications lane and start with the oldest or strongest pending item.",
        "Approve, request changes, reject, or publish so the application leaves limbo.",
      ],
      done: "The application has a clear decision.",
      actionLabel: "Open applications overview",
      directActionLabel: "Start with top application",
      targetId: "applicationsPanel",
      focusTargetId: "applicationReviewStartHere",
      targetSummary: "Review Applications -> top pending application",
    }),
    buildOperatorGuideCard({
      kicker: "Verify Trust",
      title: "Fix Missing Listing Details",
      copy: "Fix missing listing details so live profiles can become fully trusted and ready for use.",
      steps: [
        "Open the missing-details lane and start with the top listing.",
        "Verify the first missing detail or move the listing into confirmation if therapist input is required.",
      ],
      done: "The listing is no longer blocked by its top missing detail.",
      actionLabel: "Open missing-details overview",
      directActionLabel: "Start with first listing",
      targetId: "importBlockerSprintSection",
      focusTargetId: "importBlockerStartHere",
      targetSummary: "Fix Missing Listing Details -> first listing row",
    }),
  ];
  statsRoot.innerHTML =
    '<div class="mini-status" style="margin-bottom:1rem"><strong>Admin note:</strong> Showing the resilient workflow launcher while the full dashboard reloads.</div>' +
    wrapStatsGroup("Start Here", fallbackCards, "ops-grid");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const adminLazyModuleLoaders = import.meta.glob([
  "./admin-candidate-queue.js",
  "./admin-application-review.js",
  "./admin-ops-inbox.js",
  "./admin-concierge-queue.js",
  "./admin-portal-requests.js",
  "./admin-confirmation-queue.js",
  "./admin-confirmation-sprint.js",
  "./admin-import-blocker-sprint.js",
  "./admin-sourcing-intelligence.js",
  "./admin-ingestion-scorecard.js",
  "./admin-licensure-queue.js",
  "./admin-licensure-sprint.js",
  "./admin-licensure-deferred-queue.js",
  "./admin-licensure-activity.js",
]);

function loadAdminLazyModule(path) {
  if (!adminLazyModuleCache.has(path)) {
    const loader = adminLazyModuleLoaders[path];
    adminLazyModuleCache.set(path, loader ? loader() : import(path));
  }
  return adminLazyModuleCache.get(path);
}

function getAdminPrefetchModulesForTarget(targetId) {
  var map = {
    supplyReviewRegion: ["./admin-candidate-queue.js", "./admin-application-review.js"],
    candidateQueuePanel: ["./admin-candidate-queue.js"],
    applicationsPanel: ["./admin-application-review.js"],
    requestsRegion: [
      "./admin-ops-inbox.js",
      "./admin-concierge-queue.js",
      "./admin-portal-requests.js",
    ],
    confirmationRegion: [
      "./admin-import-blocker-sprint.js",
      "./admin-confirmation-sprint.js",
      "./admin-confirmation-queue.js",
    ],
    intelligenceRegion: ["./admin-sourcing-intelligence.js", "./admin-ingestion-scorecard.js"],
  };
  return map[targetId] || [];
}

function prefetchAdminModulesForTarget(targetId) {
  getAdminPrefetchModulesForTarget(targetId).forEach(function (path) {
    loadAdminLazyModule(path);
  });
}

function warmAdminLikelyNextModules() {
  [
    "./admin-candidate-queue.js",
    "./admin-application-review.js",
    "./admin-ops-inbox.js",
    "./admin-confirmation-queue.js",
  ].forEach(function (path) {
    loadAdminLazyModule(path);
  });
}

function withLazyAdminModule(path, onReady, onError) {
  loadAdminLazyModule(path)
    .then(function (module) {
      onReady(module || {});
    })
    .catch(function (error) {
      console.error("Admin lazy module failed to load:", path, error);
      if (typeof onError === "function") {
        onError(error);
      }
    });
}

function readReviewActivityView() {
  try {
    return JSON.parse(window.localStorage.getItem(REVIEW_ACTIVITY_VIEW_KEY) || "{}");
  } catch (_error) {
    return {};
  }
}

function writeReviewActivityView(value) {
  try {
    window.localStorage.setItem(REVIEW_ACTIVITY_VIEW_KEY, JSON.stringify(value || {}));
  } catch (_error) {
    // Ignore storage errors and keep the UI usable.
  }
}

function readReviewActivitySavedViews() {
  try {
    var views = JSON.parse(window.localStorage.getItem(REVIEW_ACTIVITY_SAVED_VIEWS_KEY) || "[]");
    return Array.isArray(views) ? views : [];
  } catch (_error) {
    return [];
  }
}

function writeReviewActivitySavedViews(value) {
  try {
    window.localStorage.setItem(
      REVIEW_ACTIVITY_SAVED_VIEWS_KEY,
      JSON.stringify(Array.isArray(value) ? value : []),
    );
  } catch (_error) {
    // Ignore storage errors and keep the UI usable.
  }
}

function buildReviewActivityDeepLink() {
  if (typeof window === "undefined") {
    return "";
  }
  var nextUrl = new URL(window.location.href);
  if (reviewActivityFilter) {
    nextUrl.searchParams.set("reviewActivityLane", reviewActivityFilter);
  } else {
    nextUrl.searchParams.delete("reviewActivityLane");
  }
  return nextUrl.toString();
}

function syncReviewActivityDeepLink() {
  if (typeof window === "undefined" || !window.history || !window.history.replaceState) {
    return;
  }
  window.history.replaceState({}, "", buildReviewActivityDeepLink());
}

function renderReviewActivitySavedViews() {
  var select = document.getElementById("reviewActivitySavedView");
  if (!select) {
    return;
  }
  var views = readReviewActivitySavedViews();
  select.innerHTML =
    '<option value="">Saved views</option>' +
    views
      .map(function (view) {
        return (
          '<option value="' +
          escapeHtml(view.id) +
          '">' +
          escapeHtml(view.name || view.filter || "Saved view") +
          "</option>"
        );
      })
      .join("");
  select.value = reviewActivitySavedViewId || "";
}

function getActiveReviewActivitySavedView() {
  if (!reviewActivitySavedViewId) {
    return null;
  }
  return (
    readReviewActivitySavedViews().find(function (item) {
      return item.id === reviewActivitySavedViewId;
    }) || null
  );
}

function renderReviewActivitySavedViewMeta() {
  var root = document.getElementById("reviewActivitySavedViewMeta");
  if (!root) {
    return;
  }
  var activeView = getActiveReviewActivitySavedView();
  if (!activeView) {
    root.innerHTML = "";
    return;
  }
  var statusLabel =
    activeView.status === "resolved"
      ? "Resolved"
      : activeView.status === "blocked"
        ? "Blocked"
        : activeView.status === "watching"
          ? "Watching"
          : "Open";
  root.innerHTML =
    '<div class="mini-card" style="padding:0.9rem 1rem;margin:0 0 0.85rem">' +
    '<div style="display:flex;justify-content:space-between;gap:0.8rem;align-items:flex-start;flex-wrap:wrap">' +
    '<div><div style="font-weight:700;color:var(--navy)">' +
    escapeHtml(activeView.name || "Saved review view") +
    '</div><div class="subtle" style="margin-top:0.2rem">Saved handoff workspace for the current audit slice.</div></div>' +
    '<span class="tag">' +
    escapeHtml(statusLabel) +
    "</span></div>" +
    (activeView.note
      ? '<div style="margin-top:0.7rem;font-size:0.88rem;color:var(--slate)">' +
        escapeHtml(activeView.note) +
        "</div>"
      : '<div style="margin-top:0.7rem;font-size:0.84rem;color:#333">No reviewer note yet.</div>') +
    '<div class="queue-actions" style="margin-top:0.8rem">' +
    '<button class="btn-secondary" type="button" id="reviewActivityEditViewNote">Edit note</button>' +
    '<button class="btn-secondary" type="button" id="reviewActivityToggleResolved">' +
    escapeHtml(activeView.status === "resolved" ? "Mark Open" : "Mark Resolved") +
    '</button><button class="btn-secondary" type="button" id="reviewActivityDeleteView">Delete View</button></div></div>';
}

function getRecordValue(record, keys) {
  if (!record || typeof record !== "object") {
    return "";
  }
  for (var index = 0; index < keys.length; index += 1) {
    var key = keys[index];
    if (record[key] !== undefined && record[key] !== null && String(record[key]).trim() !== "") {
      return record[key];
    }
  }
  return "";
}

function getBooleanRecordValue(record, keys) {
  if (!record || typeof record !== "object") {
    return null;
  }
  for (var index = 0; index < keys.length; index += 1) {
    var key = keys[index];
    if (record[key] === true || record[key] === false) {
      return record[key];
    }
  }
  return null;
}

function normalizeListValue(value) {
  if (Array.isArray(value)) {
    return value
      .map(function (item) {
        return String(item || "").trim();
      })
      .filter(Boolean)
      .sort()
      .join(", ");
  }
  return String(value || "").trim();
}

function formatLocationLine(record) {
  var city = getRecordValue(record, ["city"]);
  var state = getRecordValue(record, ["state"]);
  var zip = getRecordValue(record, ["zip"]);
  return [city, state ? (city ? state : state) : "", zip]
    .filter(Boolean)
    .join(city && state ? ", " : " ");
}

function formatDate(value) {
  return new Date(value).toLocaleString();
}

function formatFieldLabel(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, function (character) {
      return character.toUpperCase();
    });
}

const { buildActionStatCard, buildOperatorGuideCard, buildPriorityActionRow, wrapStatsGroup } =
  createAdminDashboardCardBuilders({
    escapeHtml: escapeHtml,
  });

const { getRouteHealthActionItems, queueRouteHealthFollowUp } = createAdminRouteHealthActions({
  isWebsiteRouteHealthy: isWebsiteRouteHealthy,
  isBookingRouteHealthy: isBookingRouteHealthy,
  getTherapistById: function (therapistId) {
    return (dataMode === "sanity" ? publishedTherapists : getTherapists()).find(function (item) {
      return String(item && item.id) === String(therapistId);
    });
  },
  reviewerWorkspace: reviewerWorkspace,
  renderListings: function () {
    renderListings();
  },
});

const FIELD_TRUST_META_KEYS = [
  "estimated_wait_time",
  "insurance_accepted",
  "telehealth_states",
  "bipolar_years_experience",
];

function getFieldTrustValue(entry, camelKey, snakeKey) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  if (entry[camelKey] !== undefined) {
    return entry[camelKey];
  }
  if (entry[snakeKey] !== undefined) {
    return entry[snakeKey];
  }
  return null;
}

function getFieldTrustEntries(item) {
  const fieldTrust = item && item.field_trust_meta ? item.field_trust_meta : {};
  return FIELD_TRUST_META_KEYS.map(function (key) {
    return {
      key: key,
      label: formatFieldLabel(key),
      meta: fieldTrust[key] || null,
    };
  });
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

function getFieldTrustChipClass(tier) {
  if (tier === "high") return "status approved";
  if (tier === "medium") return "status reviewing";
  if (tier === "watch" || tier === "stale") return "status rejected";
  return "status";
}

function getTherapistFieldTrustSummary(item) {
  const entries = getFieldTrustEntries(item);
  const strong = [];
  const attention = [];
  const stale = [];
  const unknown = [];

  entries.forEach(function (entry) {
    const tier = getFieldTrustTier(entry.meta);
    if (tier === "high") {
      strong.push(entry.label);
      return;
    }
    if (tier === "medium") {
      return;
    }
    if (tier === "stale") {
      stale.push(entry.label);
      return;
    }
    if (tier === "watch") {
      attention.push(entry.label);
      return;
    }
    unknown.push(entry.label);
  });

  const watchFields = stale.concat(attention).concat(unknown).slice(0, 3);
  const headline = watchFields.length
    ? "Watch " + watchFields.join(", ")
    : strong.length
      ? "High confidence on " + strong.slice(0, 2).join(", ")
      : "Trust signals still building";

  return {
    entries: entries,
    strong: strong,
    attention: attention,
    stale: stale,
    unknown: unknown,
    watchFields: watchFields,
    headline: headline,
  };
}

function getTherapistFieldTrustAttentionCount(item) {
  return getTherapistFieldTrustSummary(item).watchFields.length;
}

function getTherapistTrustRecommendation(item, freshness, trustSummary) {
  const summary = trustSummary || getTherapistFieldTrustSummary(item);
  const watchedEntries = (summary.entries || []).filter(function (entry) {
    const tier = getFieldTrustTier(entry.meta);
    return tier === "stale" || tier === "watch" || tier === "unknown";
  });
  const watchedKeys = watchedEntries.map(function (entry) {
    return entry.key;
  });

  if (item.source_health_status && !["healthy", "redirected"].includes(item.source_health_status)) {
    return "Check the source page first, then confirm any unsupported operational fields.";
  }
  if (watchedKeys.includes("insurance_accepted") && watchedKeys.includes("estimated_wait_time")) {
    return "Confirm insurance and wait time first. Those are the highest-value trust gaps.";
  }
  if (watchedKeys.includes("telehealth_states") && watchedKeys.includes("insurance_accepted")) {
    return "Reconfirm telehealth states and insurance before leaving the profile live as-is.";
  }
  if (watchedKeys.includes("estimated_wait_time")) {
    return "Update the wait-time signal before spending time on lower-value fields.";
  }
  if (watchedKeys.includes("insurance_accepted")) {
    return "Confirm insurance acceptance next so this profile stays decision-ready.";
  }
  if (watchedKeys.includes("telehealth_states")) {
    return "Recheck telehealth states next to keep location routing trustworthy.";
  }
  if (watchedKeys.includes("bipolar_years_experience")) {
    return "Reconfirm bipolar experience next so trust and ranking stay defensible.";
  }
  if (freshness && freshness.needs_reconfirmation_fields.length) {
    return (
      "Reconfirm " +
      freshness.needs_reconfirmation_fields.map(formatFieldLabel).slice(0, 2).join(", ") +
      " next."
    );
  }
  return "Refresh source review and keep the strongest operational fields current.";
}

function renderFieldTrustChips(summary, limit) {
  if (!summary || !Array.isArray(summary.entries)) {
    return "";
  }

  const ordered = []
    .concat(
      summary.entries.filter(function (entry) {
        return getFieldTrustTier(entry.meta) === "stale";
      }),
    )
    .concat(
      summary.entries.filter(function (entry) {
        return getFieldTrustTier(entry.meta) === "watch";
      }),
    )
    .concat(
      summary.entries.filter(function (entry) {
        return getFieldTrustTier(entry.meta) === "medium";
      }),
    )
    .concat(
      summary.entries.filter(function (entry) {
        return getFieldTrustTier(entry.meta) === "high";
      }),
    )
    .slice(0, limit || 4);

  if (!ordered.length) {
    return "";
  }

  return (
    '<div class="queue-filters" style="margin-top:0.7rem">' +
    ordered
      .map(function (entry) {
        const tier = getFieldTrustTier(entry.meta);
        const tierLabel =
          tier === "stale"
            ? "Needs refresh"
            : tier === "watch"
              ? "Watch"
              : tier === "medium"
                ? "Okay"
                : tier === "high"
                  ? "Strong"
                  : "Unknown";
        return (
          '<span class="' +
          getFieldTrustChipClass(tier) +
          '">' +
          escapeHtml(entry.label + ": " + tierLabel) +
          "</span>"
        );
      })
      .join("") +
    "</div>"
  );
}

function buildConfirmationChecklist(item, agenda, preferredPrimaryField) {
  var orderedFields = getPreferredFieldOrder(
    (agenda && agenda.unknown_fields) || [],
    preferredPrimaryField,
  );
  var primaryAskField = orderedFields[0] || "";
  var addOnAskFields = orderedFields.slice(1);
  return [
    "BipolarTherapyHub profile confirmation checklist",
    "",
    "Therapist: " + (item && item.name ? item.name : "Unknown therapist"),
    item && item.slug ? "Slug: " + item.slug : "",
    "Priority: " + formatStatusLabel(agenda.priority),
    "Needs confirmation: " +
      ((agenda && agenda.unknown_fields) || [])
        .map(function (field) {
          return formatFieldLabel(field);
        })
        .join(", "),
    primaryAskField ? "Primary ask: " + formatFieldLabel(primaryAskField) : "",
    addOnAskFields.length
      ? "Add-on asks: " +
        addOnAskFields
          .map(function (field) {
            return formatFieldLabel(field);
          })
          .join(", ")
      : "",
    orderedFields.length
      ? "Ordered ask flow: " +
        orderedFields
          .map(function (field) {
            return formatFieldLabel(field);
          })
          .join(" -> ")
      : "",
    "",
    "Exact asks:",
    orderedFields
      .map(function (field) {
        return getImportBlockerPromptMap()[field];
      })
      .filter(Boolean)
      .map(function (ask, index) {
        return index + 1 + ". " + ask;
      })
      .join("\n"),
  ]
    .filter(Boolean)
    .join("\n");
}

function buildConfirmationApplyBrief(item, agenda, workflow, preferredPrimaryField) {
  var orderedFields = getPreferredFieldOrder(
    (agenda && agenda.unknown_fields) || [],
    preferredPrimaryField,
  );
  var primaryAskField = orderedFields[0] || "";
  var addOnAskFields = orderedFields.slice(1);
  return [
    "BipolarTherapyHub live profile update brief",
    "",
    "Therapist: " + (item && item.name ? item.name : "Unknown therapist"),
    item && item.slug ? "Slug: " + item.slug : "",
    "Current confirmation status: " +
      formatStatusLabel((workflow && workflow.status) || "not_started"),
    workflow && workflow.last_updated_at
      ? "Last confirmed state update: " + formatDate(workflow.last_updated_at)
      : "",
    primaryAskField ? "Primary confirmed ask: " + formatFieldLabel(primaryAskField) : "",
    addOnAskFields.length
      ? "Secondary asks: " +
        addOnAskFields
          .map(function (field) {
            return formatFieldLabel(field);
          })
          .join(", ")
      : "",
    orderedFields.length
      ? "Ordered apply flow: " +
        orderedFields
          .map(function (field) {
            return formatFieldLabel(field);
          })
          .join(" -> ")
      : "",
    "",
    "Fields ready to apply or re-check:",
    (orderedFields.length
      ? orderedFields.map(function (field) {
          return "- " + formatFieldLabel(field);
        })
      : ["- No specific fields flagged."]
    ).join("\n"),
    "",
    "Apply steps:",
    "1. Review the therapist response or confirmation submission.",
    "2. Update the live profile fields that were confirmed.",
    "3. Tighten field review states where editorial verification is now appropriate.",
    "4. Re-run any needed trust or freshness review after the update.",
    "",
    "Profile URL:",
    item && item.slug
      ? new URL(
          "therapist.html?slug=" + encodeURIComponent(item.slug),
          window.location.href,
        ).toString()
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildConfirmationApplySummary(rows, heading) {
  return confirmationWorkspace.buildConfirmationApplySummary(rows, heading);
}

function buildConfirmationApplyOperatorChecklist(rows, heading) {
  return confirmationWorkspace.buildConfirmationApplyOperatorChecklist(rows, heading);
}

function buildConfirmationApplyPreviewHtml(item, slug, primaryAskField, addOnAskFields) {
  return confirmationWorkspace.buildConfirmationApplyPreviewHtml(
    item,
    slug,
    primaryAskField,
    addOnAskFields,
  );
}

function buildConfirmationResponseCaptureHtml(slug, primaryAskField, addOnAskFields) {
  return confirmationWorkspace.buildConfirmationResponseCaptureHtml(
    slug,
    primaryAskField,
    addOnAskFields,
  );
}

function buildConfirmationApplyCsvRows(rows) {
  return confirmationWorkspace.buildConfirmationApplyCsvRows(rows);
}

function buildConfirmationApplyCsv(rows) {
  return confirmationWorkspace.buildConfirmationApplyCsv(rows);
}

function buildConfirmationLink(slug) {
  return confirmationWorkspace.buildConfirmationLink(slug);
}

function setConfirmationActionStatus(root, id, message) {
  confirmationWorkspace.setConfirmationActionStatus(root, id, message);
}

function setPortalRequestActionStatus(root, id, message) {
  var status = root.querySelector('[data-portal-request-status-id="' + id + '"]');
  if (status) {
    status.textContent = message;
  }
}

function bindConfirmationResponseCapture(root) {
  confirmationWorkspace.bindConfirmationResponseCapture(root);
}

function isConfirmationRefreshApplication(item) {
  return Boolean(
    item &&
    (item.published_therapist_id ||
      String(item.notes || "")
        .toLowerCase()
        .includes("confirmation update submitted for live therapist slug")),
  );
}

function getPhotoSourceLabel(value) {
  if (value === "therapist_uploaded") {
    return "Therapist-uploaded photo";
  }
  if (value === "practice_uploaded") {
    return "Practice-uploaded photo";
  }
  if (value === "public_source") {
    return "Public-source photo";
  }
  return "No photo source set";
}

function hasPreferredPhotoSource(value) {
  return value === "therapist_uploaded" || value === "practice_uploaded";
}

function getAfterClaimReviewStall(item) {
  if (!item) {
    return { stalled: false, ageDays: 0, label: "", note: "" };
  }

  var portalState = String(item.portal_state || "");
  if (portalState !== "profile_in_review_after_claim") {
    return { stalled: false, ageDays: 0, label: "", note: "" };
  }

  var updatedAt = item.updated_at ? new Date(item.updated_at) : null;
  var ageDays =
    updatedAt && !Number.isNaN(updatedAt.getTime())
      ? Math.max(
          0,
          Math.floor((new Date().getTime() - updatedAt.getTime()) / (1000 * 60 * 60 * 24)),
        )
      : 0;

  if (ageDays >= 5) {
    return {
      stalled: true,
      ageDays: ageDays,
      label: "Review aging",
      note:
        "This after-claim profile has been sitting in review for " +
        ageDays +
        " days and is at risk of losing therapist momentum.",
    };
  }

  return { stalled: false, ageDays: ageDays, label: "", note: "" };
}

function formatPercent(value) {
  return Math.max(0, Math.round(Number(value || 0))) + "%";
}

function buildOverdueClaimFollowUpPacket(items) {
  var rows = (Array.isArray(items) ? items : []).filter(function (item) {
    return getClaimFollowUpUrgency(item).tone === "urgent";
  });

  if (!rows.length) {
    return "";
  }

  return [
    "# Overdue Claim Follow-Ups",
    "",
    "Approved claims that need immediate follow-up so the therapist does not cool off before finishing the fuller profile.",
    "",
  ]
    .concat(
      rows.map(function (item, index) {
        var urgency = getClaimFollowUpUrgency(item);
        var fullProfileLink = new URL(
          "signup.html?revise=" + encodeURIComponent(item.id),
          window.location.href,
        ).toString();
        return [
          index + 1 + ". " + (item.name || "Unknown therapist"),
          "- Portal status: " + (item.portal_state_label || "Claim approved"),
          "- Follow-up urgency: " + urgency.label,
          "- Why now: " + urgency.note,
          "- Email: " + (item.email || "Not provided"),
          "- Claim status: " + getClaimFollowUpLabel(item.claim_follow_up_status),
          "- Full profile link: " + fullProfileLink,
          "",
        ].join("\n");
      }),
    )
    .join("\n");
}

function getClaimLaunchCandidates(applications) {
  return (Array.isArray(applications) ? applications : [])
    .map(function (item) {
      var portalState = String(item.portal_state || "");
      var readiness = getTherapistMatchReadiness(item);
      var snapshot = reviewModels.getApplicationReviewSnapshot(item);
      var ageMs =
        new Date().getTime() - new Date(item.updated_at || item.created_at || 0).getTime();
      var ageDays = Number.isFinite(ageMs)
        ? Math.max(0, Math.floor(ageMs / (1000 * 60 * 60 * 24)))
        : 0;

      if (
        !["profile_submitted_after_claim", "profile_in_review_after_claim"].includes(portalState)
      ) {
        return null;
      }

      if (!["pending", "reviewing"].includes(String(item.status || ""))) {
        return null;
      }

      if (
        readiness.score < 80 ||
        readiness.completeness_score < 75 ||
        snapshot.missingCriticalFields.length > 1
      ) {
        return null;
      }

      return {
        id: item.id,
        name: item.name || "Unknown therapist",
        readiness: readiness,
        snapshot: snapshot,
        ageDays: ageDays,
        reason:
          readiness.score >= 90
            ? "Exceptionally strong after-claim profile with enough trust detail to be close to live."
            : "Strong after-claim profile with a realistic path to live after a focused review pass.",
        priority:
          readiness.score * 2 +
          readiness.completeness_score +
          (item.status === "reviewing" ? 8 : 0) -
          ageDays,
      };
    })
    .filter(Boolean)
    .sort(function (a, b) {
      return (
        b.priority - a.priority || b.readiness.score - a.readiness.score || a.ageDays - b.ageDays
      );
    })
    .slice(0, 4);
}

function getStalledAfterClaimReviews(applications) {
  return (Array.isArray(applications) ? applications : [])
    .map(function (item) {
      var stall = getAfterClaimReviewStall(item);
      if (!stall.stalled) {
        return null;
      }
      var readiness = getTherapistMatchReadiness(item);
      return {
        id: item.id,
        name: item.name || "Unknown therapist",
        stall: stall,
        readiness: readiness,
        nextMove: reviewModels.getApplicationReviewSnapshot(item).nextMove,
      };
    })
    .filter(Boolean)
    .sort(function (a, b) {
      return b.stall.ageDays - a.stall.ageDays || b.readiness.score - a.readiness.score;
    })
    .slice(0, 4);
}

function buildClaimLaunchPriorityPacket(items) {
  var rows = getClaimLaunchCandidates(items);

  if (!rows.length) {
    return "";
  }

  return [
    "# Fast-Track Live Supply Candidates",
    "",
    "After-claim profiles that are closest to becoming trustworthy live supply if reviewed decisively now.",
    "",
  ]
    .concat(
      rows.map(function (row, index) {
        return [
          index + 1 + ". " + row.name,
          "- Readiness: " + row.readiness.label + " (" + row.readiness.score + "/100)",
          "- Completeness: " + row.readiness.completeness_score + "/100",
          "- Review lane: " + row.snapshot.label,
          "- Why prioritize: " + row.reason,
          "- Next move: " + row.snapshot.nextMove,
          "- Missing critical fields: " +
            (row.snapshot.missingCriticalFields.length
              ? row.snapshot.missingCriticalFields.join(", ")
              : "None currently flagged"),
          "",
        ].join("\n");
      }),
    )
    .join("\n");
}

function buildStalledAfterClaimReviewPacket(items) {
  var rows = getStalledAfterClaimReviews(items);

  if (!rows.length) {
    return "";
  }

  return [
    "# Stalled After-Claim Reviews",
    "",
    "After-claim profiles already in review that need a decisive next call before therapist momentum cools further.",
    "",
  ]
    .concat(
      rows.map(function (row, index) {
        return [
          index + 1 + ". " + row.name,
          "- Review age: " + row.stall.ageDays + " days",
          "- Stall signal: " + row.stall.label,
          "- Why now: " + row.stall.note,
          "- Readiness: " + row.readiness.label + " (" + row.readiness.score + "/100)",
          "- Next move: " + row.nextMove,
          "",
        ].join("\n");
      }),
    )
    .join("\n");
}

function getClaimFunnelBottleneck(claimFunnel, rates) {
  if ((claimFunnel && claimFunnel.followUpDue) > 0) {
    return "Biggest leak: approved claims are sitting without timely follow-up. Clear that queue first.";
  }
  if ((claimFunnel && claimFunnel.stalledReviews) > 0) {
    return "Biggest leak: therapists already finished the fuller profile, but some after-claim reviews are aging too long.";
  }
  if ((rates && rates.followUpRate) < 60 && (claimFunnel && claimFunnel.approved) > 0) {
    return "Biggest leak: approved claims are not consistently getting follow-up sent.";
  }
  if ((rates && rates.conversionRate) < 35 && (claimFunnel && claimFunnel.approved) > 0) {
    return "Biggest leak: therapists are getting approved but too few are returning to finish the fuller profile.";
  }
  if ((claimFunnel && claimFunnel.approved) === 0 && (claimFunnel && claimFunnel.submitted) > 0) {
    return "Biggest bottleneck: claims are entering the funnel but not yet getting approved.";
  }
  return "The loop is moving. Keep approved-claim follow-up and after-claim reviews tight so momentum does not cool off.";
}

function getClaimActionQueue(applications) {
  return (Array.isArray(applications) ? applications : [])
    .map(function (item) {
      var urgency = getClaimFollowUpUrgency(item);
      var portalState = String(item.portal_state || "");
      var readiness = getTherapistMatchReadiness(item);
      var snapshot = reviewModels.getApplicationReviewSnapshot(item);
      var ageMs =
        new Date().getTime() - new Date(item.updated_at || item.created_at || 0).getTime();
      var ageDays = Number.isFinite(ageMs)
        ? Math.max(0, Math.floor(ageMs / (1000 * 60 * 60 * 24)))
        : 0;
      var action = null;

      if (urgency.tone === "urgent") {
        action = {
          id: item.id,
          title: item.name || "Unknown therapist",
          lane: "Overdue follow-up",
          note: urgency.note,
          priority: 300 + ageDays,
        };
      } else if (getAfterClaimReviewStall(item).stalled) {
        action = {
          id: item.id,
          title: item.name || "Unknown therapist",
          lane: "Stalled after-claim review",
          note: getAfterClaimReviewStall(item).note,
          priority: 285 + ageDays,
        };
      } else if (
        ["profile_submitted_after_claim", "profile_in_review_after_claim"].includes(portalState) &&
        readiness.score >= 85 &&
        readiness.completeness_score >= 80 &&
        snapshot.missingCriticalFields.length <= 1
      ) {
        action = {
          id: item.id,
          title: item.name || "Unknown therapist",
          lane: "Fast-track live supply",
          note: "This after-claim profile is strong enough that a decisive review could turn it into live supply quickly.",
          priority: 270 + readiness.score - ageDays,
        };
      } else if (portalState === "profile_submitted_after_claim") {
        action = {
          id: item.id,
          title: item.name || "Unknown therapist",
          lane: "Review after-claim profile",
          note: "The therapist completed the fuller profile. Review it before the follow-through momentum cools.",
          priority: 240 + ageDays,
        };
      } else if (
        portalState === "claimed_ready_for_profile" &&
        item.claim_follow_up_status === "responded"
      ) {
        action = {
          id: item.id,
          title: item.name || "Unknown therapist",
          lane: "Nudge full-profile completion",
          note: "The therapist has responded. The next leverage is getting the fuller profile finished.",
          priority: 220 + ageDays,
        };
      } else if (
        ["claim_pending_review", "claim_in_review"].includes(portalState) &&
        ageDays >= 3
      ) {
        action = {
          id: item.id,
          title: item.name || "Unknown therapist",
          lane: "Clear claim review",
          note: "This claim has been waiting " + ageDays + " days and should get a clear decision.",
          priority: 180 + ageDays,
        };
      }

      return action;
    })
    .filter(Boolean)
    .sort(function (a, b) {
      return b.priority - a.priority || a.title.localeCompare(b.title);
    })
    .slice(0, 3);
}

function buildRecommendedReviewBatchPacket(items, goal) {
  var rows = Array.isArray(items) ? items.slice(0, 3) : [];
  if (!rows.length) {
    return "";
  }
  var goalMeta = reviewModels.getApplicationReviewGoalMeta(goal);

  var lines = [
    goalMeta.packetHeading,
    "",
    "Top application review targets right now.",
    "Reviewer goal: " + goalMeta.label,
    "",
  ];

  rows.forEach(function (item, index) {
    var snapshot = reviewModels.getApplicationReviewSnapshot(item);
    var coaching = getTherapistReviewCoaching(item);
    var request = buildImprovementRequest(item, coaching);
    var batchReason = reviewModels.getApplicationBatchReason(item, goal);
    var revisionLink = new URL(
      "signup.html?revise=" + encodeURIComponent(item.id),
      window.location.href,
    ).toString();
    var confirmationLink = item.slug ? buildConfirmationLink(item.slug) : "";

    lines.push("## " + (index + 1) + ". " + item.name);
    lines.push("");
    lines.push("- Status: " + item.status);
    lines.push("- Review focus: " + snapshot.label);
    lines.push("- Recommended next move: " + snapshot.nextMove);
    lines.push("- Why this is in the batch: " + batchReason);
    lines.push("- Why it matters: " + snapshot.note);
    lines.push(
      "- Next link: " + (isConfirmationRefreshApplication(item) ? confirmationLink : revisionLink),
    );
    lines.push("- Improvement request:");
    lines.push(request || "No improvement request generated.");
    lines.push("");
  });

  return lines.join("\n");
}

function buildRecommendedReviewBatchRequests(items, goal) {
  var rows = Array.isArray(items) ? items.slice(0, 3) : [];
  if (!rows.length) {
    return "";
  }
  var goalMeta = reviewModels.getApplicationReviewGoalMeta(goal);

  return ["Reviewer goal: " + goalMeta.label, ""]
    .concat(
      rows.map(function (item, index) {
        var coaching = getTherapistReviewCoaching(item);
        return [
          index + 1 + ". " + item.name,
          buildImprovementRequest(item, coaching) || "No improvement request generated.",
        ].join("\n");
      }),
    )
    .join("\n\n");
}

function buildFieldReviewControls(item) {
  var states = item.field_review_states || {};
  var fields = [
    { key: "estimated_wait_time", label: "Wait time" },
    { key: "insurance_accepted", label: "Insurance" },
    { key: "telehealth_states", label: "Telehealth states" },
    { key: "bipolar_years_experience", label: "Bipolar experience" },
  ];

  return (
    '<div class="field-review-grid">' +
    fields
      .map(function (field) {
        return (
          '<label class="field-review-item"><span class="field-review-label">' +
          escapeHtml(field.label) +
          '</span><select class="queue-select field-review-select" data-review-field="' +
          escapeHtml(field.key) +
          '" data-id="' +
          escapeHtml(item.id) +
          '">' +
          [
            { value: "therapist_confirmed", label: "Therapist-confirmed only" },
            { value: "editorially_verified", label: "Editorially verified" },
            { value: "needs_reconfirmation", label: "Needs re-confirmation" },
          ]
            .map(function (option) {
              return (
                '<option value="' +
                option.value +
                '"' +
                (states[field.key] === option.value ||
                (!states[field.key] && option.value === "therapist_confirmed")
                  ? " selected"
                  : "") +
                ">" +
                escapeHtml(option.label) +
                "</option>"
              );
            })
            .join("") +
          "</select></label>"
        );
      })
      .join("") +
    "</div>"
  );
}

function readConciergeRequests() {
  try {
    return normalizeConciergeRequests(
      JSON.parse(window.localStorage.getItem(CONCIERGE_REQUESTS_KEY) || "[]"),
    );
  } catch (_error) {
    return [];
  }
}

function writeConciergeRequests(value) {
  try {
    window.localStorage.setItem(CONCIERGE_REQUESTS_KEY, JSON.stringify(value));
  } catch (_error) {
    return;
  }
}

function readOutreachOutcomes() {
  try {
    return JSON.parse(window.localStorage.getItem(OUTREACH_OUTCOMES_KEY) || "[]");
  } catch (_error) {
    return [];
  }
}

function readConfirmationQueueState() {
  return confirmationWorkspace.readConfirmationQueueState();
}

function getConfirmationQueueEntry(slug) {
  return confirmationWorkspace.getConfirmationQueueEntry(slug);
}

function updateConfirmationQueueEntry(slug, updates) {
  confirmationWorkspace.updateConfirmationQueueEntry(slug, updates);
}

function getPublishedTherapistConfirmationQueue() {
  return confirmationWorkspace.getPublishedTherapistConfirmationQueue();
}

function getConfirmationQueueFilter() {
  return confirmationWorkspace.getConfirmationQueueFilter();
}

function setConfirmationQueueFilter(value) {
  confirmationWorkspace.setConfirmationQueueFilter(value);
}

function renderCaliforniaPriorityConfirmationWave() {
  confirmationWorkspace.renderCaliforniaPriorityConfirmationWave();
}

function getConfirmationResultLabel(status) {
  return confirmationWorkspace.getConfirmationResultLabel(status);
}

function getConfirmationLastActionNote(workflow) {
  return confirmationWorkspace.getConfirmationLastActionNote(workflow);
}

function getConfirmationGraceWindowNote(item) {
  return confirmationWorkspace.getConfirmationGraceWindowNote(item);
}

function getConfirmationTarget(item) {
  return confirmationWorkspace.getConfirmationTarget(item);
}

function getImportBlockerFieldBuckets(fields) {
  return confirmationWorkspace.getImportBlockerFieldBuckets(fields);
}

function getPreferredFieldOrder(fields, preferredPrimaryField) {
  var ordered = (Array.isArray(fields) ? fields : []).slice();
  if (!preferredPrimaryField) {
    return ordered;
  }
  return ordered.sort(function (a, b) {
    if (a === preferredPrimaryField && b !== preferredPrimaryField) {
      return -1;
    }
    if (b === preferredPrimaryField && a !== preferredPrimaryField) {
      return 1;
    }
    return 0;
  });
}

function buildImportBlockerRequestSubject(item, fields, preferredPrimaryField) {
  var name = item && item.name ? item.name : "this profile";
  var orderedFields = getPreferredFieldOrder(fields, preferredPrimaryField);
  var labels = orderedFields.slice(0, 2).map(formatFieldLabel).join(" and ");
  return labels
    ? "Quick import-blocker confirmation for " + name + " (" + labels + ")"
    : "Quick import-blocker confirmation for " + name;
}

function buildImportBlockerRequestMessage(item, fields, preferredPrimaryField) {
  var orderedFields = getPreferredFieldOrder(fields, preferredPrimaryField);
  return buildTherapistFieldConfirmationPrompt(item, orderedFields, {
    intro:
      "We are clearing the final strict import blockers on your BipolarTherapyHub profile so the highest-trust operational details stay accurate.",
    close:
      "Once you confirm these specific details, we can clear this blocker and keep the live profile trustable.\n\nThank you,\nBipolarTherapyHub",
  });
}

function getPublishedTherapistImportBlockerQueue() {
  return confirmationWorkspace.getPublishedTherapistImportBlockerQueue();
}

function getImportBlockerSprintRows(limit) {
  return confirmationWorkspace.getImportBlockerSprintRows(limit);
}

function getImportBlockerSprintSummary(rows) {
  return confirmationWorkspace.getImportBlockerSprintSummary(rows);
}

function getImportBlockerSprintBottleneck(rows) {
  return confirmationWorkspace.getImportBlockerSprintBottleneck(rows);
}

function getImportBlockerSprintWaveShape(rows) {
  return confirmationWorkspace.getImportBlockerSprintWaveShape(rows);
}

function getImportBlockerSprintFieldPattern(rows) {
  return confirmationWorkspace.getImportBlockerSprintFieldPattern(rows);
}

function getImportBlockerPromptMap() {
  return confirmationWorkspace.getImportBlockerPromptMap();
}

function getImportBlockerSprintSharedAskDetails(rows) {
  return confirmationWorkspace.getImportBlockerSprintSharedAskDetails(rows);
}

function getImportBlockerSprintSharedAsk(rows) {
  return confirmationWorkspace.getImportBlockerSprintSharedAsk(rows);
}

function getImportBlockerSprintSharedAskText(rows) {
  return confirmationWorkspace.getImportBlockerSprintSharedAskText(rows);
}

function getImportBlockerSprintSharedAskStatus(rows) {
  return confirmationWorkspace.getImportBlockerSprintSharedAskStatus(rows);
}

function getImportBlockerSprintSharedAskImpact(rows) {
  return confirmationWorkspace.getImportBlockerSprintSharedAskImpact(rows);
}

function getConfirmationSprintThemeDetails(rows) {
  if (!rows.length) {
    return null;
  }

  var counts = {};
  rows.forEach(function (row) {
    String(row.warnings || "")
      .split("|")
      .map(function (field) {
        return field.trim();
      })
      .filter(Boolean)
      .forEach(function (field) {
        counts[field] = (counts[field] || 0) + 1;
      });
  });

  var topField = Object.keys(counts).sort(function (a, b) {
    var countDiff = counts[b] - counts[a];
    if (countDiff) {
      return countDiff;
    }
    return a.localeCompare(b);
  })[0];

  if (!topField) {
    return null;
  }

  return {
    field: topField,
    count: counts[topField] || 0,
  };
}

function getConfirmationSprintThemeSummary(rows) {
  var details = getConfirmationSprintThemeDetails(rows);
  if (!details) {
    return "";
  }

  return (
    "Top confirmation sprint theme: " +
    formatFieldLabel(details.field) +
    " (" +
    details.count +
    " of " +
    rows.length +
    " sprint profiles)."
  );
}

function getPrimaryAskHeaderLine(field) {
  if (!field) {
    return "";
  }
  return "Primary ask right now: " + formatFieldLabel(field) + ".";
}

function getBlockerConfirmationThemeBridge(blockerRows, confirmationRows) {
  var blockerSharedAsk = getImportBlockerSprintSharedAskDetails(blockerRows);
  var confirmationTheme = getConfirmationSprintThemeDetails(confirmationRows);
  if (!blockerSharedAsk || !confirmationTheme) {
    return "";
  }

  if (blockerSharedAsk.field === confirmationTheme.field) {
    return "Bridge: this same ask is also the top confirmation sprint theme, so clearing it strengthens both queues at once.";
  }

  return (
    "Bridge: the blocker sprint is led by " +
    formatFieldLabel(blockerSharedAsk.field) +
    ", while the confirmation sprint is led by " +
    formatFieldLabel(confirmationTheme.field) +
    "."
  );
}

function getOverlappingAskDetails(blockerRows, confirmationRows) {
  var blockerSharedAsk = getImportBlockerSprintSharedAskDetails(blockerRows);
  var confirmationTheme = getConfirmationSprintThemeDetails(confirmationRows);
  if (
    !blockerSharedAsk ||
    !confirmationTheme ||
    blockerSharedAsk.field !== confirmationTheme.field
  ) {
    return null;
  }

  var matchingBlockerRows = blockerRows.filter(function (row) {
    return String(row.blocker_fields || "")
      .split("|")
      .map(function (field) {
        return field.trim();
      })
      .filter(Boolean)
      .includes(blockerSharedAsk.field);
  });

  var matchingConfirmationRows = confirmationRows.filter(function (row) {
    return String(row.warnings || "")
      .split("|")
      .map(function (field) {
        return field.trim();
      })
      .filter(Boolean)
      .includes(blockerSharedAsk.field);
  });

  return {
    field: blockerSharedAsk.field,
    ask: blockerSharedAsk.ask,
    blocker_count: matchingBlockerRows.length,
    confirmation_count: matchingConfirmationRows.length,
    blocker_rows: matchingBlockerRows,
    confirmation_rows: matchingConfirmationRows,
  };
}

function getOverlappingAskExtraAsks(row, key, sharedField) {
  var promptMap = getImportBlockerPromptMap();
  return String(row[key] || "")
    .split("|")
    .map(function (field) {
      return field.trim();
    })
    .filter(Boolean)
    .filter(function (field) {
      return field !== sharedField;
    })
    .map(function (field) {
      return promptMap[field];
    })
    .filter(Boolean);
}

function getImportBlockerSprintSharedAskNextMove(rows) {
  return confirmationWorkspace.getImportBlockerSprintSharedAskNextMove(rows);
}

function getImportBlockerLeverageNote(rows, fields) {
  var details = getImportBlockerSprintSharedAskDetails(rows);
  if (!details || details.count <= 1) {
    return "";
  }
  var fieldList = Array.isArray(fields) ? fields : [];
  if (!fieldList.includes(details.field)) {
    return "";
  }
  return (
    "Leverage note: this same ask applies to " +
    details.count +
    " of the top " +
    rows.length +
    " strict-gate blockers right now."
  );
}

function buildImportBlockerSharedAskPacket(rows) {
  var details = getImportBlockerSprintSharedAskDetails(rows);
  if (!details) {
    return "";
  }

  var matchingRows = rows.filter(function (row) {
    return String(row.blocker_fields || "")
      .split("|")
      .map(function (field) {
        return field.trim();
      })
      .filter(Boolean)
      .includes(details.field);
  });

  if (!matchingRows.length) {
    return "";
  }

  var lines = [
    "# Shared Ask Packet",
    "",
    "Top strict-gate blockers currently sharing the same highest-leverage question.",
    "",
    getImportBlockerSprintSharedAsk(rows),
    getImportBlockerSprintSharedAskNextMove(rows),
    getImportBlockerSprintSharedAskStatus(rows),
    getImportBlockerSprintSharedAskImpact(rows),
    "",
  ];

  matchingRows.forEach(function (row) {
    lines.push("## " + row.priority_rank + ". " + row.name);
    lines.push("");
    lines.push("- Status: " + row.status);
    lines.push("- Channel: " + (row.recommended_channel || "manual review"));
    lines.push("- Blocking fields: " + row.blocker_fields);
    lines.push("- Contact target: " + row.contact_target);
    lines.push("- Send action: " + (row.send_action || "manual review"));
    lines.push("- Primary ask: " + formatFieldLabel(details.field));
    var sharedExtraAsks = getOverlappingAskExtraAsks(row, "blocker_fields", details.field);
    if (sharedExtraAsks.length) {
      lines.push("- Add-on asks: " + sharedExtraAsks.join(" "));
    }
    lines.push("- Subject: " + (row.request_subject || ""));
    lines.push("");
    lines.push("Shared ask:");
    lines.push("");
    lines.push("```text");
    lines.push(details.ask);
    lines.push("```");
    lines.push("");
    lines.push("Confirmation form:");
    lines.push(buildConfirmationLink(row.slug));
    lines.push("");
  });

  return lines.join("\n");
}

function buildOverlappingAskPacket(blockerRows, confirmationRows) {
  var overlap = getOverlappingAskDetails(blockerRows, confirmationRows);
  if (!overlap) {
    return "";
  }

  var unifiedRowsBySlug = {};
  overlap.blocker_rows.forEach(function (row) {
    var existing = unifiedRowsBySlug[row.slug] || {
      slug: row.slug,
      name: row.name,
      lanes: [],
      recommended_channel: row.recommended_channel || "",
      contact_target: row.contact_target || "",
      send_action: row.send_action || "",
      request_subject: row.request_subject || "",
      extraAsks: [],
    };
    existing.lanes.push("blocker");
    existing.extraAsks = existing.extraAsks.concat(
      getOverlappingAskExtraAsks(row, "blocker_fields", overlap.field),
    );
    unifiedRowsBySlug[row.slug] = existing;
  });
  overlap.confirmation_rows.forEach(function (row) {
    var existing = unifiedRowsBySlug[row.slug] || {
      slug: row.slug,
      name: row.name,
      lanes: [],
      recommended_channel: row.recommended_channel || "",
      contact_target: row.contact_target || "",
      send_action: row.send_action || "",
      request_subject: row.request_subject || "",
      extraAsks: [],
    };
    existing.lanes.push("confirmation");
    existing.extraAsks = existing.extraAsks.concat(
      getOverlappingAskExtraAsks(row, "warnings", overlap.field),
    );
    unifiedRowsBySlug[row.slug] = existing;
  });
  var unifiedRows = Object.keys(unifiedRowsBySlug).map(function (slug) {
    var row = unifiedRowsBySlug[slug];
    return {
      ...row,
      lanes: Array.from(new Set(row.lanes)),
      extraAsks: Array.from(new Set(row.extraAsks)),
    };
  });
  var channelMixSummary = getOutreachChannelMixSummary(unifiedRows);
  var channelNextMoveSummary = getOutreachChannelNextMoveSummary(unifiedRows);

  var lines = [
    "# Overlapping Ask Packet",
    "",
    "This ask is currently shared by the top strict-gate blocker wave and the top confirmation sprint theme.",
    "",
    "Shared ask: " + overlap.ask,
    "Overlap impact: " +
      overlap.blocker_count +
      " blocker profile" +
      (overlap.blocker_count === 1 ? "" : "s") +
      " and " +
      overlap.confirmation_count +
      " confirmation sprint profile" +
      (overlap.confirmation_count === 1 ? "" : "s") +
      " are aligned on this same question.",
    channelMixSummary ? channelMixSummary : "",
    channelNextMoveSummary ? channelNextMoveSummary : "",
    "",
    "## Unified Outreach Wave",
    "",
  ];

  unifiedRows.forEach(function (row) {
    lines.push("### " + row.name);
    lines.push("");
    lines.push("- Lanes: " + row.lanes.join(" + "));
    lines.push("- Channel: " + (row.recommended_channel || "manual review"));
    lines.push("- Target: " + (row.contact_target || "manual review"));
    lines.push("- Send action: " + (row.send_action || "manual review"));
    lines.push("- Primary ask: " + formatFieldLabel(overlap.field));
    if (row.extraAsks.length) {
      lines.push("- Add-on asks: " + row.extraAsks.join(" "));
    }
    lines.push("- Subject: " + (row.request_subject || "N/A"));
    lines.push("");
  });

  lines.push("", "Shared ask:", "", "```text", overlap.ask, "```", "");

  return lines.join("\n");
}

function buildTopOutreachWavePacket(blockerRows, confirmationRows, limit) {
  var overlap = getOverlappingAskDetails(blockerRows, confirmationRows);
  if (!overlap) {
    return "";
  }
  var unifiedRows = getTopOutreachWaveRows(blockerRows, confirmationRows, limit || 3);
  var channelMixSummary = getOutreachChannelMixSummary(unifiedRows);
  var channelNextMoveSummary = getOutreachChannelNextMoveSummary(unifiedRows);

  var lines = [
    "# Top Outreach Wave",
    "",
    "Top " + unifiedRows.length + " unified outreach targets for the current shared ask wave.",
    "",
    "Primary ask right now: " + formatFieldLabel(overlap.field) + ".",
    channelMixSummary ? channelMixSummary : "",
    channelNextMoveSummary ? channelNextMoveSummary : "",
    "",
  ];

  unifiedRows.forEach(function (row, index) {
    lines.push("## " + (index + 1) + ". " + row.name);
    lines.push("");
    lines.push("- Coverage: " + row.lanes.join("|"));
    lines.push("- Channel: " + (row.recommended_channel || "manual review"));
    lines.push("- Target: " + (row.contact_target || "manual review"));
    lines.push("- Send action: " + (row.send_action || "manual review"));
    lines.push("- Primary ask: " + formatFieldLabel(overlap.field));
    if (row.extraAsks.length) {
      lines.push("- Add-on asks: " + row.extraAsks.join(" "));
    }
    lines.push("- Subject: " + (row.request_subject || "N/A"));
    lines.push("");
  });

  return lines.join("\n");
}

function getTopOutreachWaveRows(blockerRows, confirmationRows, limit) {
  var overlap = getOverlappingAskDetails(blockerRows, confirmationRows);
  if (!overlap) {
    return [];
  }

  var unifiedRowsBySlug = {};
  overlap.blocker_rows.forEach(function (row) {
    var existing = unifiedRowsBySlug[row.slug] || {
      slug: row.slug,
      name: row.name,
      lanes: [],
      recommended_channel: row.recommended_channel || "",
      contact_target: row.contact_target || "",
      send_action: row.send_action || "",
      request_subject: row.request_subject || "",
      extraAsks: [],
    };
    existing.lanes.push("blocker");
    existing.extraAsks = existing.extraAsks.concat(
      getOverlappingAskExtraAsks(row, "blocker_fields", overlap.field),
    );
    unifiedRowsBySlug[row.slug] = existing;
  });
  overlap.confirmation_rows.forEach(function (row) {
    var existing = unifiedRowsBySlug[row.slug] || {
      slug: row.slug,
      name: row.name,
      lanes: [],
      recommended_channel: row.recommended_channel || "",
      contact_target: row.contact_target || "",
      send_action: row.send_action || "",
      request_subject: row.request_subject || "",
      extraAsks: [],
    };
    existing.lanes.push("confirmation");
    existing.extraAsks = existing.extraAsks.concat(
      getOverlappingAskExtraAsks(row, "warnings", overlap.field),
    );
    unifiedRowsBySlug[row.slug] = existing;
  });

  return Object.keys(unifiedRowsBySlug)
    .map(function (slug) {
      var row = unifiedRowsBySlug[slug];
      return {
        ...row,
        lanes: Array.from(new Set(row.lanes)),
        extraAsks: Array.from(new Set(row.extraAsks)),
      };
    })
    .slice(0, limit || 3);
}

function getOutreachChannelMixSummary(rows) {
  var normalizedRows = Array.isArray(rows) ? rows : [];
  if (!normalizedRows.length) {
    return "";
  }

  var counts = {
    email: 0,
    phone: 0,
    website: 0,
    manual_review: 0,
  };

  normalizedRows.forEach(function (row) {
    var channel = String((row && row.recommended_channel) || "manual_review")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_");

    if (!Object.prototype.hasOwnProperty.call(counts, channel)) {
      counts.manual_review += 1;
      return;
    }

    counts[channel] += 1;
  });

  var orderedChannels = ["email", "phone", "website", "manual_review"];
  var parts = orderedChannels
    .filter(function (channel) {
      return counts[channel] > 0;
    })
    .map(function (channel) {
      return counts[channel] + " " + formatFieldLabel(channel).toLowerCase().replace("_", " ");
    });

  return parts.length ? "Channel mix right now: " + parts.join(" · ") + "." : "";
}

function getOutreachChannelNextMoveSummary(rows) {
  var normalizedRows = Array.isArray(rows) ? rows : [];
  if (!normalizedRows.length) {
    return "";
  }

  var counts = {
    email: 0,
    phone: 0,
    website: 0,
    manual_review: 0,
  };

  normalizedRows.forEach(function (row) {
    var channel = String((row && row.recommended_channel) || "manual_review")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_");

    if (!Object.prototype.hasOwnProperty.call(counts, channel)) {
      counts.manual_review += 1;
      return;
    }

    counts[channel] += 1;
  });

  var dominantChannel = Object.keys(counts).sort(function (a, b) {
    var countDiff = counts[b] - counts[a];
    if (countDiff) {
      return countDiff;
    }
    return a.localeCompare(b);
  })[0];

  if (!dominantChannel || !counts[dominantChannel]) {
    return "";
  }

  if (counts[dominantChannel] === normalizedRows.length) {
    if (dominantChannel === "email") {
      return "Best outreach move right now: this wave is all email, so send the top requests directly first.";
    }
    if (dominantChannel === "phone") {
      return "Best outreach move right now: this wave is all phone-first, so call the top offices first.";
    }
    if (dominantChannel === "website") {
      return "Best outreach move right now: this wave is all website-first, so work the contact forms first.";
    }
    return "Best outreach move right now: this wave still needs manual channel review before sending.";
  }

  return "Best outreach move right now: this is a mixed-channel wave, so follow the top packet in priority order instead of batching by one channel.";
}

function buildImportBlockerSprintMarkdown(rows) {
  var lines = [
    "# Import Blocker Sprint",
    "",
    "Top strict safe-import blockers from the current live admin queue.",
    "",
  ];

  rows.forEach(function (row) {
    lines.push("## " + row.priority_rank + ". " + row.name);
    lines.push("");
    lines.push("- Status: " + row.status);
    lines.push("- Result: " + row.result);
    lines.push("- Blocking fields: " + row.blocker_fields);
    lines.push("- Source-first fields: " + (row.source_first_fields || "None"));
    lines.push("- Therapist-confirmation fields: " + (row.therapist_confirmation_fields || "None"));
    lines.push("- Source path status: " + (row.source_path_status || "Unknown"));
    lines.push("- Contact target: " + row.contact_target);
    lines.push("- Why this matters: " + row.why_it_matters);
    lines.push("- Next move: " + row.next_best_move);
    lines.push("");
  });

  return lines.join("\n");
}

function buildImportBlockerSprintCsv(rows) {
  var headers = [
    "priority_rank",
    "name",
    "slug",
    "status",
    "result",
    "blocker_count",
    "blocker_fields",
    "source_first_fields",
    "therapist_confirmation_fields",
    "source_path_status",
    "contact_target",
    "why_it_matters",
    "request_subject",
    "request_message",
    "next_best_move",
  ];
  var lines = [headers.join(",")];

  rows.forEach(function (row) {
    var values = headers.map(function (header) {
      return row[header] || "";
    });
    lines.push(
      values
        .map(function (value) {
          var stringValue = String(value);
          return /[",\n\r]/.test(stringValue)
            ? '"' + stringValue.replace(/"/g, '""') + '"'
            : stringValue;
        })
        .join(","),
    );
  });

  return lines.join("\n");
}

function buildImportBlockerPacket(rows) {
  var lines = [
    "# Top Import Blocker Packet",
    "",
    "Send-ready strict-gate blocker requests for the current top wave.",
    "",
  ];

  var sharedAsk = getImportBlockerSprintSharedAsk(rows);
  if (sharedAsk) {
    lines.push(sharedAsk);
    lines.push("");
  }

  rows.forEach(function (row) {
    lines.push("## " + row.priority_rank + ". " + row.name);
    lines.push("");
    lines.push("- Blocking fields: " + row.blocker_fields);
    lines.push("- Source path status: " + (row.source_path_status || "Unknown"));
    lines.push("- Contact target: " + row.contact_target);
    lines.push("- Why this matters: " + row.why_it_matters);
    lines.push("- Next move: " + row.next_best_move);
    lines.push("- Subject: " + (row.request_subject || ""));
    var leverageNote = getImportBlockerLeverageNote(
      rows,
      String(row.blocker_fields || "")
        .split("|")
        .map(function (field) {
          return field.trim();
        })
        .filter(Boolean),
    );
    if (leverageNote) {
      lines.push("- " + leverageNote);
    }
    lines.push("");
    lines.push("```text");
    lines.push(row.request_message || "");
    lines.push("```");
    lines.push("");
    lines.push("Confirmation form:");
    lines.push(buildConfirmationLink(row.slug));
    lines.push("");
  });

  return lines.join("\n");
}

function getConfirmationSprintRows(limit) {
  var queue = getPublishedTherapistConfirmationQueue();
  var activeRows = queue.filter(function (entry) {
    return entry.workflow.status !== "applied";
  });
  var prioritizedRows = activeRows.length ? activeRows : queue;
  var selectedEntries = prioritizedRows.slice(0, limit || 5);
  var fieldCounts = {};
  selectedEntries.forEach(function (entry) {
    (entry.agenda.unknown_fields || []).forEach(function (field) {
      fieldCounts[field] = (fieldCounts[field] || 0) + 1;
    });
  });
  var preferredPrimaryField = Object.keys(fieldCounts).sort(function (a, b) {
    var countDiff = fieldCounts[b] - fieldCounts[a];
    if (countDiff) {
      return countDiff;
    }
    return a.localeCompare(b);
  })[0];

  return selectedEntries.map(function (entry, index) {
    var item = entry.item;
    var workflow = entry.workflow || getConfirmationQueueEntry(item.slug);
    var warningFields = (entry.agenda.unknown_fields || []).slice();
    var orderedWarningFields = getPreferredFieldOrder(warningFields, preferredPrimaryField);
    var primaryAskField = orderedWarningFields[0] || "";
    var addOnAskFields = orderedWarningFields.slice(1);
    return {
      priority_rank: index + 1,
      name: item.name,
      slug: item.slug,
      status: formatStatusLabel(workflow.status),
      result: getConfirmationResultLabel(workflow.status),
      recommended_channel: item.preferred_contact_method || "manual_review",
      contact_target: getConfirmationTarget(item),
      why_it_matters: entry.agenda.summary,
      next_best_move: entry.agenda.needs_confirmation
        ? "Confirm " + orderedWarningFields.slice(0, 3).map(formatFieldLabel).join(", ")
        : "No next move needed",
      warnings: warningFields.join("|"),
      primary_ask_field: primaryAskField,
      add_on_ask_fields: addOnAskFields.join("|"),
      send_action:
        item.preferred_contact_method === "email"
          ? "Send a direct email request."
          : item.preferred_contact_method === "phone"
            ? "Call the office and use the request as a verbal or voicemail script."
            : "Use the website contact or scheduling path first.",
      request_subject: "Quick profile confirmation for " + item.name + " on BipolarTherapyHub",
      request_message: buildTherapistFieldConfirmationPrompt(item, orderedWarningFields),
    };
  });
}

function buildConfirmationSprintMarkdown(rows) {
  var lines = [
    "# Confirmation Sprint",
    "",
    "Top confirmation tasks from the current live admin queue.",
    "",
  ];

  rows.forEach(function (row) {
    lines.push("## " + row.priority_rank + ". " + row.name);
    lines.push("");
    lines.push("- Status: " + row.status);
    lines.push("- Result: " + row.result);
    lines.push("- Channel: " + row.recommended_channel);
    lines.push("- Target: " + row.contact_target);
    lines.push("- Why this matters: " + row.why_it_matters);
    lines.push("- Next move: " + row.next_best_move);
    lines.push("- Missing fields: " + row.warnings);
    if (row.primary_ask_field) {
      lines.push("- Primary ask: " + row.primary_ask_field);
    }
    if (row.add_on_ask_fields) {
      lines.push("- Add-on asks: " + row.add_on_ask_fields);
    }
    lines.push("");
    lines.push("```text");
    lines.push(row.request_message);
    lines.push("```");
    lines.push("");
  });

  return lines.join("\n");
}

function buildConfirmationSprintCsv(rows) {
  var headers = [
    "priority_rank",
    "name",
    "slug",
    "status",
    "result",
    "recommended_channel",
    "contact_target",
    "why_it_matters",
    "next_best_move",
    "warnings",
    "primary_ask_field",
    "add_on_ask_fields",
    "send_action",
    "request_subject",
    "request_message",
  ];
  var lines = [headers.join(",")];

  rows.forEach(function (row) {
    lines.push(
      headers
        .map(function (header) {
          return csvEscape(row[header] || "");
        })
        .join(","),
    );
  });

  return lines.join("\n");
}

function getConfirmationQueuePrimaryField(entries) {
  var counts = {};
  (Array.isArray(entries) ? entries : []).forEach(function (entry) {
    (entry.agenda?.unknown_fields || []).forEach(function (field) {
      counts[field] = (counts[field] || 0) + 1;
    });
  });

  return Object.keys(counts).sort(function (a, b) {
    var countDiff = counts[b] - counts[a];
    if (countDiff) {
      return countDiff;
    }
    return a.localeCompare(b);
  })[0];
}

function buildOrderedConfirmationRequestMessage(item, unknownFields, preferredPrimaryField) {
  return buildTherapistFieldConfirmationPrompt(
    item,
    getPreferredFieldOrder(unknownFields || [], preferredPrimaryField),
  );
}

function getConfirmationSprintHealthSummary(rows) {
  var counts = {
    not_started: 0,
    sent: 0,
    waiting_on_therapist: 0,
    confirmed: 0,
    applied: 0,
  };

  (rows || []).forEach(function (row) {
    var status = String((row && row.status) || "")
      .toLowerCase()
      .replace(/\s+/g, "_");
    if (Object.prototype.hasOwnProperty.call(counts, status)) {
      counts[status] += 1;
    }
  });

  var parts = [];
  if (counts.not_started) {
    parts.push(counts.not_started + " not started");
  }
  if (counts.sent) {
    parts.push(counts.sent + " sent");
  }
  if (counts.waiting_on_therapist) {
    parts.push(counts.waiting_on_therapist + " awaiting therapist reply");
  }
  if (counts.confirmed) {
    parts.push(counts.confirmed + " confirmed");
  }
  if (counts.applied) {
    parts.push(counts.applied + " applied");
  }

  return parts.length
    ? "Current sprint health: " + parts.join(" · ") + "."
    : "Current sprint health: no active confirmation work.";
}

function getConfirmationSprintBottleneckSummary(rows) {
  var counts = {
    not_started: 0,
    sent: 0,
    waiting_on_therapist: 0,
    confirmed: 0,
    applied: 0,
  };

  (rows || []).forEach(function (row) {
    var status = String((row && row.status) || "")
      .toLowerCase()
      .replace(/\s+/g, "_");
    if (Object.prototype.hasOwnProperty.call(counts, status)) {
      counts[status] += 1;
    }
  });

  if (
    counts.not_started >=
    Math.max(counts.sent, counts.waiting_on_therapist, counts.confirmed, counts.applied)
  ) {
    return "Next bottleneck: this wave is still mostly blocked on initial outreach getting started.";
  }
  if (
    counts.waiting_on_therapist >=
    Math.max(counts.not_started, counts.sent, counts.confirmed, counts.applied)
  ) {
    return "Next bottleneck: the main blocker is waiting on therapist replies before profile updates can land.";
  }
  if (
    counts.sent >=
    Math.max(counts.not_started, counts.waiting_on_therapist, counts.confirmed, counts.applied)
  ) {
    return "Next bottleneck: requests are in flight, so the highest-value work is following up and moving more profiles into reply state.";
  }
  if (counts.confirmed > 0) {
    return "Next bottleneck: some confirmations are ready, so the highest-value work is applying those answers back to live profiles.";
  }
  if (counts.applied > 0) {
    return "Next bottleneck: some confirmation work is already applied, so the next leverage is refreshing trust signals and continuing the next outreach wave.";
  }
  return "Next bottleneck: no active blocker yet.";
}

function getConfirmationSprintRecommendation(rows) {
  var byStatus = {
    not_started: [],
    sent: [],
    waiting_on_therapist: [],
    confirmed: [],
    applied: [],
  };

  (rows || []).forEach(function (row) {
    var status = String((row && row.status) || "")
      .toLowerCase()
      .replace(/\s+/g, "_");
    if (Object.prototype.hasOwnProperty.call(byStatus, status)) {
      byStatus[status].push(row);
    }
  });

  if (byStatus.not_started.length) {
    return {
      label: "Start outreach now",
      note: "Best next move: send the highest-priority unsent therapist request.",
      mode: "copy_request",
      slug: byStatus.not_started[0].slug,
    };
  }

  if (byStatus.waiting_on_therapist.length) {
    return {
      label: "Follow up on replies",
      note: "Best next move: review the waiting profiles and move any therapist replies forward.",
      mode: "scroll",
      targetId: "confirmationQueue",
    };
  }

  if (byStatus.sent.length) {
    return {
      label: "Review in-flight requests",
      note: "Best next move: move sent requests into waiting or confirmed as responses arrive.",
      mode: "scroll",
      targetId: "confirmationQueue",
    };
  }

  if (byStatus.confirmed.length) {
    return {
      label: "Apply confirmed updates",
      note: "Best next move: process the confirmed therapist answers and update the live listings.",
      mode: "copy_apply_brief",
      slug: byStatus.confirmed[0].slug,
    };
  }

  if (byStatus.applied.length) {
    return {
      label: "Continue next outreach wave",
      note: "Best next move: move from already-applied profiles back into the next highest-priority confirmations.",
      mode: "scroll",
      targetId: "confirmationQueue",
    };
  }

  return {
    label: "Review confirmation queue",
    note: "Best next move: inspect the full queue for the next trust update.",
    mode: "scroll",
    targetId: "confirmationQueue",
  };
}

function applyOverlapRecommendationContext(recommendation, blockerRows, confirmationRows) {
  var overlap = getOverlappingAskDetails(blockerRows, confirmationRows);
  if (!overlap || !recommendation) {
    return recommendation;
  }

  var next = {
    ...recommendation,
  };

  if (next.mode === "copy_request" || next.mode === "scroll") {
    next.note =
      "Best next move: work the shared ask wave first, since " +
      formatFieldLabel(overlap.field) +
      " is currently driving both the strict-gate blockers and the confirmation sprint.";
  } else if (next.mode === "copy_apply_brief") {
    next.note =
      "Best next move: apply the shared ask answers first, since " +
      formatFieldLabel(overlap.field) +
      " is currently driving both the strict-gate blockers and the confirmation sprint.";
  }

  return next;
}

function getImportBlockerRecommendationNote(blockerRows, confirmationRows) {
  var overlap = getOverlappingAskDetails(blockerRows, confirmationRows);
  if (overlap) {
    return (
      "Best next move: work the shared ask wave first, since " +
      formatFieldLabel(overlap.field) +
      " is currently driving both the strict-gate blockers and the confirmation sprint."
    );
  }

  return getImportBlockerSprintSharedAskNextMove(blockerRows);
}

function getConfirmationSprintMiniLanes(rows) {
  var waiting = [];
  var confirmed = [];
  var applied = [];

  (rows || []).forEach(function (row) {
    var status = String((row && row.status) || "")
      .toLowerCase()
      .replace(/\s+/g, "_");
    if (status === "waiting_on_therapist") {
      waiting.push(row);
    } else if (status === "confirmed") {
      confirmed.push(row);
    } else if (status === "applied") {
      applied.push(row);
    }
  });

  var lanes = [];

  if (waiting.length) {
    lanes.push({
      title: "Top waiting profiles",
      note: "These are the sprint items currently waiting on therapist replies.",
      filter: "waiting_on_therapist",
      rows: waiting.slice(0, 3),
    });
  }

  if (confirmed.length) {
    lanes.push({
      title: "Ready to apply now",
      note: "These sprint items are already confirmed and ready for live profile updates.",
      filter: "confirmed",
      rows: confirmed.slice(0, 3),
    });
  }

  if (applied.length) {
    lanes.push({
      title: "Recently applied",
      note: "These sprint items have already been reflected in the live profile and can move out of the active handoff path.",
      filter: "applied",
      rows: applied.slice(0, 3),
    });
  }

  return lanes;
}

function csvEscape(value) {
  var stringValue = String(value || "");
  if (/[",\n\r]/.test(stringValue)) {
    return '"' + stringValue.replace(/"/g, '""') + '"';
  }
  return stringValue;
}

function normalizeConciergeRequests(value) {
  return (Array.isArray(value) ? value : []).map(function (request) {
    var shortlist = Array.isArray(request && request.shortlist) ? request.shortlist : [];
    return {
      created_at: request && request.created_at ? request.created_at : new Date().toISOString(),
      share_link: request && request.share_link ? request.share_link : "",
      request_summary: request && request.request_summary ? request.request_summary : "",
      requester_name: request && request.requester_name ? request.requester_name : "",
      follow_up_preference:
        request && request.follow_up_preference ? request.follow_up_preference : "",
      help_topic: request && request.help_topic ? request.help_topic : "",
      request_note: request && request.request_note ? request.request_note : "",
      request_status:
        request && REQUEST_STATUS_OPTIONS.includes(request.request_status)
          ? request.request_status
          : "new",
      shortlist: shortlist.map(function (item) {
        return {
          slug: item && item.slug ? item.slug : "",
          name: item && item.name ? item.name : "Unknown therapist",
          priority: item && item.priority ? item.priority : "",
          note: item && item.note ? item.note : "",
          outreach: item && item.outreach ? item.outreach : "",
          follow_up_status:
            item && THERAPIST_FOLLOW_UP_OPTIONS.includes(item.follow_up_status)
              ? item.follow_up_status
              : "unreviewed",
        };
      }),
    };
  });
}

function updateConciergeRequestStatus(index, status) {
  var requests = readConciergeRequests();
  if (!requests[index]) {
    return;
  }
  requests[index].request_status = status;
  writeConciergeRequests(requests);
}

function updateConciergeShortlistStatus(requestIndex, shortlistIndex, status) {
  var requests = readConciergeRequests();
  if (!requests[requestIndex] || !requests[requestIndex].shortlist[shortlistIndex]) {
    return;
  }
  requests[requestIndex].shortlist[shortlistIndex].follow_up_status = status;
  writeConciergeRequests(requests);
}

function formatStatusLabel(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, function (char) {
      return char.toUpperCase();
    });
}

function buildImprovementRequest(item, coaching) {
  var suggestions = Array.isArray(coaching) ? coaching.filter(Boolean) : [];
  var greeting = item && item.name ? "Hi " + item.name + "," : "Hi,";
  var intro =
    "Thanks for submitting your profile to BipolarTherapyHub. Your application is promising, and a few clarifications would make it much stronger for trust, matching, and outreach conversion.";
  var bullets = suggestions.length
    ? suggestions
        .map(function (suggestion) {
          return "- " + suggestion;
        })
        .join("\n")
    : "- Add a bit more clarity around trust, fit, and first-contact expectations.";
  var close =
    "Once these details are tightened, the profile should be much easier for users to evaluate and act on.\n\nThank you,\nBipolarTherapyHub Review";

  return [greeting, "", intro, "", bullets, "", close].join("\n");
}

function buildClaimReviewRequest(item) {
  var greeting = item && item.name ? "Hi " + item.name + "," : "Hi,";
  var close =
    "Once those basics are confirmed, we can move your claim forward.\n\nThank you,\nBipolarTherapyHub Review";
  return [
    greeting,
    "",
    "Thanks for claiming your profile on BipolarTherapyHub. Before we can verify ownership, we need a few core details tightened.",
    "",
    "- Confirm the license state and license number exactly as they should appear for review.",
    "- Double-check your contact email and any practice basics that identify the listing.",
    "- If this claim is tied to an existing live profile, clarify any mismatch between the current listing and your submitted details.",
    "",
    close,
  ].join("\n");
}

function getClaimFollowUpLabel(value) {
  if (value === "sent") return "Follow-up sent";
  if (value === "responded") return "Therapist responded";
  if (value === "full_profile_started") return "Full profile started";
  return "Not started";
}

function getClaimFollowUpUrgency(application) {
  if (!application || application.portal_state !== "claimed_ready_for_profile") {
    return {
      tone: "steady",
      label: "Not in approved-claim follow-up",
      note: "",
    };
  }

  var followUpStatus = String(application.claim_follow_up_status || "not_started");
  var sentAt = application.claim_follow_up_sent_at
    ? new Date(application.claim_follow_up_sent_at)
    : null;
  var approvedAt = application.updated_at ? new Date(application.updated_at) : null;
  var now = new Date();
  var msPerDay = 1000 * 60 * 60 * 24;
  var ageFromApproval =
    approvedAt && !Number.isNaN(approvedAt.getTime())
      ? Math.floor((now.getTime() - approvedAt.getTime()) / msPerDay)
      : 0;
  var ageFromSend =
    sentAt && !Number.isNaN(sentAt.getTime())
      ? Math.floor((now.getTime() - sentAt.getTime()) / msPerDay)
      : 0;

  if (followUpStatus === "not_started" && ageFromApproval >= 3) {
    return {
      tone: "urgent",
      label: "Follow-up overdue",
      note: "Claim was approved " + ageFromApproval + " days ago and no follow-up has been sent.",
    };
  }
  if (followUpStatus === "sent" && ageFromSend >= 5) {
    return {
      tone: "watch",
      label: "Reply check due",
      note: "Follow-up went out " + ageFromSend + " days ago and still needs a response check.",
    };
  }
  if (followUpStatus === "responded") {
    return {
      tone: "steady",
      label: "Waiting on full profile",
      note: "Therapist has responded. The next leverage is nudging completion of the fuller profile.",
    };
  }
  return {
    tone: "steady",
    label: "On track",
    note:
      followUpStatus === "sent"
        ? "Follow-up is in flight."
        : "Approved claim is still within the normal follow-up window.",
  };
}

function buildClaimFollowUpMessage(item) {
  var revisionLink = new URL(
    "signup.html?revise=" + encodeURIComponent(item.id),
    window.location.href,
  ).toString();
  return [
    "Subject: Finish your BipolarTherapyHub profile",
    "",
    "Hi " + (item && item.name ? item.name : "") + ",",
    "",
    "Your profile claim has been approved on BipolarTherapyHub.",
    "",
    "The next step is to complete your fuller profile so we can review your trust details, care fit, and public listing readiness.",
    "",
    "Complete your profile here:",
    revisionLink,
    "",
    "Once you submit the fuller profile, we can move it through review.",
    "",
    "Thank you,",
    "BipolarTherapyHub Review",
  ].join("\n");
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_error) {
    return false;
  }
}

function downloadText(filename, text, mimeType) {
  try {
    const blob = new window.Blob([text], { type: mimeType || "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 0);
    return true;
  } catch (_error) {
    return false;
  }
}

function appendImprovementRequestToNotes(root, id, requestText) {
  var field = root.querySelector('[data-notes-id="' + id + '"]');
  if (!field) {
    return false;
  }

  var current = field.value.trim();
  field.value = current ? current + "\n\n" + requestText : requestText;
  return true;
}

function setCoachActionStatus(root, id, message) {
  var status = root.querySelector('[data-coach-status-id="' + id + '"]');
  if (status) {
    status.textContent = message;
  }
}

function setApplyLiveFieldsStatus(root, id, message) {
  var status = root.querySelector('[data-apply-live-fields-status="' + id + '"]');
  if (status) {
    status.textContent = message;
  }
}

function buildRevisionHistoryHtml(item) {
  var history = Array.isArray(item.revision_history) ? item.revision_history : [];
  if (!history.length) {
    return "";
  }

  return (
    '<div class="notes-box"><label><strong>Revision history</strong></label><div class="review-history-list">' +
    history
      .slice()
      .reverse()
      .map(function (entry) {
        return (
          '<div class="review-history-item"><strong>' +
          escapeHtml(formatStatusLabel(entry.type || "update")) +
          "</strong> · " +
          escapeHtml(formatDate(entry.at)) +
          (entry.message
            ? '<div class="mini-status">' + escapeHtml(entry.message) + "</div>"
            : "") +
          "</div>"
        );
      })
      .join("") +
    "</div></div>"
  );
}

function analyzeConciergePatterns(requests) {
  var entries = Array.isArray(requests) ? requests : [];
  var totals = {
    insurance: 0,
    availability: 0,
    medication: 0,
    contact_first: 0,
    fit_uncertainty: 0,
  };

  entries.forEach(function (request) {
    var haystack = [
      request.help_topic || "",
      request.request_note || "",
      request.request_summary || "",
    ]
      .join(" ")
      .toLowerCase();

    if (
      haystack.includes("insurance") ||
      haystack.includes("cost") ||
      haystack.includes("coverage")
    ) {
      totals.insurance += 1;
    }
    if (
      haystack.includes("availability") ||
      haystack.includes("wait") ||
      haystack.includes("timing") ||
      haystack.includes("schedule")
    ) {
      totals.availability += 1;
    }
    if (
      haystack.includes("medication") ||
      haystack.includes("psychiatry") ||
      haystack.includes("med support")
    ) {
      totals.medication += 1;
    }
    if (
      haystack.includes("who should i contact first") ||
      haystack.includes("contact first") ||
      haystack.includes("one person first")
    ) {
      totals.contact_first += 1;
    }
    if (
      haystack.includes("best fit") ||
      haystack.includes("fit") ||
      haystack.includes("not sure") ||
      haystack.includes("uncertain")
    ) {
      totals.fit_uncertainty += 1;
    }
  });

  return Object.keys(totals)
    .map(function (key) {
      return {
        key: key,
        label:
          key === "insurance"
            ? "Insurance or cost confusion"
            : key === "availability"
              ? "Availability or timing friction"
              : key === "medication"
                ? "Medication or psychiatry uncertainty"
                : key === "contact_first"
                  ? "Unsure who to contact first"
                  : "General fit uncertainty",
        count: totals[key],
      };
    })
    .filter(function (item) {
      return item.count > 0;
    })
    .sort(function (a, b) {
      return b.count - a.count || a.label.localeCompare(b.label);
    });
}

function analyzeOutreachOutcomes(outcomes) {
  var entries = Array.isArray(outcomes) ? outcomes : [];
  return {
    reached_out: entries.filter(function (item) {
      return item.outcome === "reached_out";
    }).length,
    heard_back: entries.filter(function (item) {
      return item.outcome === "heard_back";
    }).length,
    booked_consult: entries.filter(function (item) {
      return item.outcome === "booked_consult";
    }).length,
    good_fit_call: entries.filter(function (item) {
      return item.outcome === "good_fit_call";
    }).length,
    insurance_mismatch: entries.filter(function (item) {
      return item.outcome === "insurance_mismatch";
    }).length,
    waitlist: entries.filter(function (item) {
      return item.outcome === "waitlist";
    }).length,
    no_response: entries.filter(function (item) {
      return item.outcome === "no_response";
    }).length,
  };
}

function analyzeOutreachJourneys(outcomes) {
  const entries = Array.isArray(outcomes) ? outcomes : [];
  const byJourney = entries.reduce(function (accumulator, item) {
    if (!item || !item.journey_id) {
      return accumulator;
    }
    if (!accumulator[item.journey_id]) {
      accumulator[item.journey_id] = [];
    }
    accumulator[item.journey_id].push(item);
    return accumulator;
  }, {});

  const totals = {
    fallback_after_no_response: 0,
    fallback_after_waitlist: 0,
    fallback_after_insurance_mismatch: 0,
    second_choice_success: 0,
  };

  Object.keys(byJourney).forEach(function (journeyId) {
    const journey = byJourney[journeyId].slice().sort(function (a, b) {
      return new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime();
    });
    const byRank = {};

    journey.forEach(function (item) {
      if (!byRank[item.rank_position]) {
        byRank[item.rank_position] = [];
      }
      byRank[item.rank_position].push(item.outcome);
    });

    const first = byRank[1] || [];
    const second = byRank[2] || [];

    if (first.includes("no_response") && second.length) {
      totals.fallback_after_no_response += 1;
    }
    if (first.includes("waitlist") && second.length) {
      totals.fallback_after_waitlist += 1;
    }
    if (first.includes("insurance_mismatch") && second.length) {
      totals.fallback_after_insurance_mismatch += 1;
    }
    if (
      second.some(function (outcome) {
        return outcome === "booked_consult" || outcome === "good_fit_call";
      })
    ) {
      totals.second_choice_success += 1;
    }
  });

  return totals;
}

function analyzePivotTiming(outcomes) {
  const entries = Array.isArray(outcomes) ? outcomes : [];
  const byJourney = entries.reduce(function (accumulator, item) {
    if (!item || !item.journey_id) {
      return accumulator;
    }
    if (!accumulator[item.journey_id]) {
      accumulator[item.journey_id] = [];
    }
    accumulator[item.journey_id].push(item);
    return accumulator;
  }, {});

  const totals = {
    on_time_pivots: 0,
    early_pivots: 0,
    late_pivots: 0,
  };

  Object.keys(byJourney).forEach(function (journeyId) {
    const journey = byJourney[journeyId].slice().sort(function (a, b) {
      return new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime();
    });
    const firstNegative = journey.find(function (item) {
      return (
        item.rank_position === 1 &&
        ["no_response", "waitlist", "insurance_mismatch"].includes(item.outcome)
      );
    });
    const fallbackAttempt = journey.find(function (item) {
      return item.rank_position > 1;
    });

    if (!firstNegative || !fallbackAttempt || !firstNegative.pivot_at) {
      return;
    }

    const pivotAt = new Date(firstNegative.pivot_at).getTime();
    const fallbackAt = new Date(fallbackAttempt.recorded_at).getTime();
    const delta = fallbackAt - pivotAt;
    const tolerance = 12 * 60 * 60 * 1000;

    if (Math.abs(delta) <= tolerance) {
      totals.on_time_pivots += 1;
    } else if (delta < -tolerance) {
      totals.early_pivots += 1;
    } else {
      totals.late_pivots += 1;
    }
  });

  return totals;
}

function formatAdaptiveLabel(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, function (char) {
      return char.toUpperCase();
    });
}

function buildStrategyHealthSummary(outcomes) {
  var summary = analyzeOutreachOutcomes(outcomes);
  var strong = summary.booked_consult + summary.good_fit_call + summary.heard_back;
  var friction = summary.no_response + summary.waitlist + summary.insurance_mismatch;

  if (!strong && !friction) {
    return {
      label: "Too little outcome data yet",
      note: "As outreach outcomes accumulate, this will show whether the current strategy lean is producing stronger follow-through.",
    };
  }

  if (strong >= friction + 2) {
    return {
      label: "Current strategy lean looks healthy",
      note: "Strong downstream outcomes are outpacing friction outcomes in the local dataset.",
    };
  }

  if (friction >= strong + 2) {
    return {
      label: "Current strategy lean needs tuning",
      note: "Friction outcomes are outpacing strong outcomes, so the product may be nudging the wrong next move too often.",
    };
  }

  return {
    label: "Current strategy lean is mixed",
    note: "The local data shows both traction and friction, so this is a good moment to keep watching before over-correcting.",
  };
}

function analyzeStrategyPerformance(events, outcomes) {
  var buckets = {
    outreach: { matches: 0, saves: 0, help: 0, outreach_starts: 0, strong: 0, friction: 0 },
    save: { matches: 0, saves: 0, help: 0, outreach_starts: 0, strong: 0, friction: 0 },
    help: { matches: 0, saves: 0, help: 0, outreach_starts: 0, strong: 0, friction: 0 },
  };

  (Array.isArray(events) ? events : []).forEach(function (item) {
    var strategy =
      item &&
      item.payload &&
      item.payload.strategy &&
      item.payload.strategy.match_action &&
      buckets[item.payload.strategy.match_action]
        ? item.payload.strategy.match_action
        : "";
    if (!strategy) {
      return;
    }
    if (item.type === "match_submitted") {
      buckets[strategy].matches += 1;
    } else if (item.type === "match_shortlist_saved" || item.type === "match_share_link_copied") {
      buckets[strategy].saves += 1;
    } else if (item.type === "match_help_requested") {
      buckets[strategy].help += 1;
    } else if (item.type === "match_recommended_outreach_started") {
      buckets[strategy].outreach_starts += 1;
    }
  });

  (Array.isArray(outcomes) ? outcomes : []).forEach(function (item) {
    var strategy =
      item &&
      item.context &&
      item.context.strategy &&
      item.context.strategy.match_action &&
      buckets[item.context.strategy.match_action]
        ? item.context.strategy.match_action
        : "";
    if (!strategy) {
      return;
    }

    if (["heard_back", "booked_consult", "good_fit_call"].includes(item.outcome)) {
      buckets[strategy].strong += 1;
    } else if (["no_response", "waitlist", "insurance_mismatch"].includes(item.outcome)) {
      buckets[strategy].friction += 1;
    }
  });

  return Object.keys(buckets)
    .map(function (key) {
      return {
        key: key,
        label: formatAdaptiveLabel(key),
        metrics: buckets[key],
      };
    })
    .filter(function (item) {
      return (
        item.metrics.matches ||
        item.metrics.saves ||
        item.metrics.help ||
        item.metrics.outreach_starts ||
        item.metrics.strong ||
        item.metrics.friction
      );
    })
    .sort(function (a, b) {
      return (
        b.metrics.strong - a.metrics.strong ||
        b.metrics.outreach_starts - a.metrics.outreach_starts ||
        b.metrics.matches - a.metrics.matches ||
        a.label.localeCompare(b.label)
      );
    });
}

function buildSegmentStrategySnapshots(events, outcomes) {
  var segments = [
    { label: "Urgent users", keys: ["urgency:asap", "urgency:within-2-weeks"] },
    { label: "Insurance-led users", keys: ["insurance:user"] },
    { label: "Psychiatry / medication users", keys: ["intent:psychiatry", "medication:yes"] },
  ];

  return segments
    .map(function (segment) {
      var adaptive = summarizeAdaptiveSignals(events, outcomes, segment.keys);
      var signalCount =
        adaptive.action_counts.outreach + adaptive.action_counts.help + adaptive.action_counts.save;
      return {
        label: segment.label,
        preferred_match_action: adaptive.preferred_match_action,
        basis: adaptive.match_action_basis,
        signal_count: signalCount,
      };
    })
    .filter(function (item) {
      return item.signal_count > 0;
    });
}

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

function renderExecutiveCommandDeck(context) {
  var mandateRoot = document.getElementById("executiveMandateBoard");
  var workflowRoot = document.getElementById("bestPathWorkflowBoard");
  var intelligenceRoot = document.getElementById("businessIntelligenceBoard");
  var guideRoot = document.getElementById("firstRunGuideBoard");
  if (!mandateRoot || !workflowRoot || !intelligenceRoot || !guideRoot) {
    return;
  }

  if (authRequired) {
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
    title: "Turn today’s most leveraged operational bottleneck into movement.",
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

function renderAdminWorkflowGuidance(context) {
  var candidateReviewCount = Number((context && context.candidateReviewCount) || 0);
  var candidateReadyCount = Number((context && context.candidateReadyCount) || 0);
  var candidateDuplicateCount = Number((context && context.candidateDuplicateCount) || 0);
  var candidateConfirmationCount = Number((context && context.candidateConfirmationCount) || 0);
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

function renderInspectorKpi(label, value) {
  return (
    '<div class="inspector-kpi"><div class="inspector-kpi-label">' +
    escapeHtml(label || "") +
    '</div><div class="inspector-kpi-value">' +
    escapeHtml(value || "Not set") +
    "</div></div>"
  );
}

function getSelectedInspectorRecord() {
  if (!adminInspectorSelection.kind || !adminInspectorSelection.id) {
    return null;
  }
  if (adminInspectorSelection.kind === "candidate") {
    var candidateList = dataMode === "sanity" ? remoteCandidates : [];
    var candidate = candidateList.find(function (item) {
      return String(item.id) === String(adminInspectorSelection.id);
    });
    return candidate ? { kind: "candidate", item: candidate } : null;
  }
  if (adminInspectorSelection.kind === "application") {
    var applicationList = dataMode === "sanity" ? remoteApplications : getApplications();
    var application = applicationList.find(function (item) {
      return String(item.id) === String(adminInspectorSelection.id);
    });
    return application ? { kind: "application", item: application } : null;
  }
  return null;
}

function getInspectorVisibleSequence() {
  if (typeof document === "undefined") {
    return [];
  }
  var entries = [];
  document.querySelectorAll("#candidateQueue [data-candidate-card-id]").forEach(function (node) {
    entries.push({
      kind: "candidate",
      id: String(node.getAttribute("data-candidate-card-id") || ""),
      node: node,
    });
  });
  document
    .querySelectorAll("#applicationsList [data-application-card-id]")
    .forEach(function (node) {
      entries.push({
        kind: "application",
        id: String(node.getAttribute("data-application-card-id") || ""),
        node: node,
      });
    });
  return entries.filter(function (entry) {
    return Boolean(entry.id);
  });
}

function getInspectorSequenceMeta() {
  var sequence = getInspectorVisibleSequence();
  var currentIndex = sequence.findIndex(function (entry) {
    return (
      entry.kind === adminInspectorSelection.kind &&
      String(entry.id) === String(adminInspectorSelection.id)
    );
  });
  return {
    sequence: sequence,
    currentIndex: currentIndex,
    previous: currentIndex > 0 ? sequence[currentIndex - 1] : null,
    next:
      currentIndex >= 0 && currentIndex < sequence.length - 1 ? sequence[currentIndex + 1] : null,
    positionLabel:
      currentIndex >= 0 && sequence.length
        ? String(currentIndex + 1) + " of " + String(sequence.length) + " visible records"
        : sequence.length
          ? "Showing visible records"
          : "No visible records",
  };
}

function setAdminInspectorSelection(kind, id) {
  adminInspectorSelection = {
    kind: String(kind || ""),
    id: String(id || ""),
  };
  adminInspectorActionStatus = "";
  syncAdminInspectorUrl();
}

function ensureAdminInspectorSelection() {
  var selected = getSelectedInspectorRecord();
  if (selected) {
    return selected;
  }
  var candidates = dataMode === "sanity" ? remoteCandidates : [];
  var applications = dataMode === "sanity" ? remoteApplications : getApplications();
  var firstCandidate = Array.isArray(candidates)
    ? candidates.find(function (item) {
        return item.review_status !== "published" && item.review_status !== "archived";
      })
    : null;
  if (firstCandidate) {
    adminInspectorSelection = { kind: "candidate", id: String(firstCandidate.id) };
    syncAdminInspectorUrl();
    return { kind: "candidate", item: firstCandidate };
  }
  if (Array.isArray(applications) && applications.length) {
    adminInspectorSelection = { kind: "application", id: String(applications[0].id) };
    syncAdminInspectorUrl();
    return { kind: "application", item: applications[0] };
  }
  return null;
}

function renderInspectorActionStatusHtml() {
  return adminInspectorActionStatus
    ? '<div class="mini-status" style="margin-top:0.85rem"><strong>Inspector update:</strong> ' +
        escapeHtml(adminInspectorActionStatus) +
        "</div>"
    : "";
}

async function executeInspectorAction(inspectorAction, inspectorId) {
  if (!inspectorId || !inspectorAction) {
    return;
  }
  if (inspectorAction.indexOf("candidate_") === 0) {
    if (inspectorAction === "candidate_publish") {
      await decideTherapistCandidate(inspectorId, { decision: "publish" });
      adminInspectorActionStatus = "Candidate published from the inspector.";
    } else if (inspectorAction === "candidate_review") {
      await decideTherapistCandidate(inspectorId, { decision: "needs_review" });
      adminInspectorActionStatus = "Candidate sent to review.";
    } else if (inspectorAction === "candidate_delete") {
      const deletePicker = await promptForRejectionReason({
        headline: "Why archive this candidate?",
        confirmLabel: "Archive",
      });
      if (!deletePicker) {
        return;
      }
      await decideTherapistCandidate(inspectorId, {
        decision: "archive",
        rejection_reason: deletePicker.reason,
        rejection_notes: deletePicker.notes,
        notes: deletePicker.notes,
      });
      adminInspectorActionStatus = "Candidate deleted.";
    } else if (inspectorAction === "candidate_duplicate") {
      const dupPicker = await promptForRejectionReason({
        headline: "Why mark this as a duplicate?",
        confirmLabel: "Mark duplicate",
      });
      if (!dupPicker) {
        return;
      }
      await decideTherapistCandidate(inspectorId, {
        decision: "reject_duplicate",
        rejection_reason: dupPicker.reason,
        rejection_notes: dupPicker.notes,
        notes: dupPicker.notes,
      });
      adminInspectorActionStatus = "Candidate marked as duplicate.";
    }
    await loadData();
    renderAll();
    return;
  }

  var application = (dataMode === "sanity" ? remoteApplications : getApplications()).find(
    function (item) {
      return String(item.id) === inspectorId;
    },
  );
  if (!application) {
    adminInspectorActionStatus = "The selected application is no longer available.";
    renderAdminRecordInspector();
    return;
  }
  if (inspectorAction === "application_reviewing") {
    if (dataMode === "sanity") {
      await updateTherapistApplication(inspectorId, { status: "reviewing" });
    } else {
      updateApplicationReviewMetadata(inspectorId, { status: "reviewing" });
    }
    adminInspectorActionStatus = "Application moved into active review.";
  } else if (inspectorAction === "application_approve") {
    if (dataMode === "sanity") {
      if (application.submission_intent === "claim") {
        await updateTherapistApplication(inspectorId, { status: "approved" });
      } else {
        await approveTherapistApplication(inspectorId);
      }
    } else if (application.submission_intent === "claim") {
      updateApplicationReviewMetadata(inspectorId, { status: "approved" });
    } else {
      approveApplication(inspectorId);
    }
    adminInspectorActionStatus =
      application.submission_intent === "claim"
        ? "Claim approved from the inspector."
        : "Application approved for publish from the inspector.";
  } else if (inspectorAction === "application_reject") {
    if (dataMode === "sanity") {
      await rejectTherapistApplicationRemote(inspectorId);
    } else {
      rejectApplication(inspectorId);
    }
    adminInspectorActionStatus = "Application rejected from the inspector.";
  } else if (inspectorAction === "application_request_changes") {
    var coaching = getTherapistReviewCoaching(application);
    var requestText =
      application.submission_intent === "claim"
        ? buildClaimReviewRequest(application)
        : buildImprovementRequest(application, coaching);
    if (dataMode === "sanity") {
      await updateTherapistApplication(inspectorId, {
        status: "requested_changes",
        review_request_message: requestText,
        revision_history_entry: {
          type: "requested_changes",
          message: requestText,
        },
      });
    } else {
      updateApplicationReviewMetadata(inspectorId, {
        status: "requested_changes",
        review_request_message: requestText,
      });
    }
    adminInspectorActionStatus = "Requested fixes from the inspector.";
  }
  await loadData();
  renderAll();
}

function getCommandPaletteCommands() {
  var commands = [
    {
      id: "goto-control",
      key: "goto-control",
      title: "Open Workflow Inbox",
      kicker: "Jump",
      copy: "Jump back to the main ticket inbox and profile workspace.",
      priority: 12,
      run: function () {
        focusAdminAnchorTarget("supplyReviewRegion", { useWorkflowMode: true });
      },
    },
    {
      id: "goto-supply",
      key: "goto-supply",
      title: "Open Supply Review",
      kicker: "Jump",
      copy: "Go straight to candidate and application review.",
      priority: 10,
      run: function () {
        focusAdminAnchorTarget("supplyReviewRegion", { useWorkflowMode: true });
      },
    },
    {
      id: "goto-confirmation",
      key: "goto-confirmation",
      title: "Open Confirmation",
      kicker: "Jump",
      copy: "Move into trust, confirmation, and missing-detail work.",
      priority: 14,
      run: function () {
        focusAdminAnchorTarget("confirmationRegion");
      },
    },
    {
      id: "goto-requests",
      key: "goto-requests",
      title: "Open Requests",
      kicker: "Jump",
      copy: "See ops inbox, attention queue, workload, and portal requests.",
      priority: 11,
      run: function () {
        focusAdminAnchorTarget("requestsRegion");
      },
    },
    {
      id: "goto-intelligence",
      key: "goto-intelligence",
      title: "Open Intelligence",
      kicker: "Jump",
      copy: "See sourcing, coverage, ingestion, and funnel intelligence.",
      priority: 16,
      run: function () {
        focusAdminAnchorTarget("intelligenceRegion");
      },
    },
  ];

  var selected = getSelectedInspectorRecord();
  if (selected && selected.item) {
    commands.push({
      id: "jump-active",
      key: "jump-active",
      title: "Jump To Active Record",
      kicker: "Current record",
      copy: "Scroll back to the pinned record in the queue.",
      priority: 6,
      run: function () {
        var selector =
          selected.kind === "candidate"
            ? '[data-candidate-card-id="' + String(selected.item.id).replace(/"/g, '\\"') + '"]'
            : '[data-application-card-id="' + String(selected.item.id).replace(/"/g, '\\"') + '"]';
        var target = document.querySelector(selector);
        if (target) {
          spotlightSection(target);
          scrollToElementWithOffset(target, "start");
        }
      },
    });
    if (selected.kind === "candidate") {
      commands.push(
        {
          id: "active-candidate-publish",
          key: "active-candidate-publish",
          title: "Publish Active Candidate",
          kicker: "Current record",
          copy: "Run the publish decision for the pinned candidate.",
          priority: 5,
          run: function () {
            return executeInspectorAction("candidate_publish", String(selected.item.id));
          },
        },
        {
          id: "active-candidate-confirm",
          key: "active-candidate-confirm",
          title: "Send Active Candidate To Confirmation",
          kicker: "Current record",
          copy: "Move the pinned candidate into confirmation work.",
          priority: 7,
          run: function () {
            return executeInspectorAction("candidate_confirmation", String(selected.item.id));
          },
        },
      );
    } else {
      commands.push(
        {
          id: "active-application-approve",
          key: "active-application-approve",
          title: "Approve Active Application",
          kicker: "Current record",
          copy: "Approve or publish the pinned application from the palette.",
          priority: 5,
          run: function () {
            return executeInspectorAction("application_approve", String(selected.item.id));
          },
        },
        {
          id: "active-application-fixes",
          key: "active-application-fixes",
          title: "Request Fixes For Active Application",
          kicker: "Current record",
          copy: "Send the pinned application into requested changes.",
          priority: 7,
          run: function () {
            return executeInspectorAction("application_request_changes", String(selected.item.id));
          },
        },
      );
    }
  }

  getInspectorVisibleSequence()
    .slice(0, 16)
    .forEach(function (entry, index) {
      var label =
        entry.kind === "candidate"
          ? entry.node.querySelector("h3")?.textContent || "Candidate"
          : entry.node.querySelector("h3")?.textContent || "Application";
      commands.push({
        id: "record-" + entry.kind + "-" + entry.id,
        key: "record-" + entry.kind + "-" + entry.id,
        title: label,
        kicker: entry.kind === "candidate" ? "Visible candidate" : "Visible application",
        copy: "Open and pin this record from the currently visible queue.",
        priority: 20,
        run: function () {
          setAdminInspectorSelection(entry.kind, entry.id);
          renderAdminRecordInspector();
          if (entry.node) {
            spotlightSection(entry.node);
            scrollToElementWithOffset(entry.node, "start");
          }
        },
        order: index,
      });
    });

  return commands;
}

function getFilteredCommandPaletteCommands() {
  var query = String(commandPaletteQuery || "")
    .trim()
    .toLowerCase();
  var commands = rankCommandPaletteCommands(getCommandPaletteCommands(), query);
  if (!query) {
    return commands;
  }
  return commands.filter(function (command) {
    var haystack = [command.title, command.kicker, command.copy].join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

function readStoredCommandPaletteKeys(storageKey) {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return [];
    }
    var stored = JSON.parse(window.localStorage.getItem(storageKey) || "[]");
    return Array.isArray(stored)
      ? stored
          .map(function (value) {
            return String(value || "").trim();
          })
          .filter(Boolean)
      : [];
  } catch (_error) {
    return [];
  }
}

function writeStoredCommandPaletteKeys(storageKey, values) {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }
    window.localStorage.setItem(storageKey, JSON.stringify(Array.isArray(values) ? values : []));
  } catch (_error) {
    // Ignore storage failures to keep the command surface usable.
  }
}

function readCommandPaletteRecents() {
  return readStoredCommandPaletteKeys(COMMAND_PALETTE_RECENTS_KEY);
}

function readCommandPaletteFavorites() {
  return readStoredCommandPaletteKeys(COMMAND_PALETTE_FAVORITES_KEY);
}

function recordCommandPaletteRecent(commandId) {
  var nextId = String(commandId || "").trim();
  if (!nextId) {
    return;
  }
  var nextValues = [nextId].concat(
    readCommandPaletteRecents().filter(function (value) {
      return value !== nextId;
    }),
  );
  writeStoredCommandPaletteKeys(COMMAND_PALETTE_RECENTS_KEY, nextValues.slice(0, 8));
}

function toggleCommandPaletteFavorite(commandId) {
  var nextId = String(commandId || "").trim();
  if (!nextId) {
    return;
  }
  var favorites = readCommandPaletteFavorites();
  var nextValues = favorites.includes(nextId)
    ? favorites.filter(function (value) {
        return value !== nextId;
      })
    : [nextId].concat(favorites);
  writeStoredCommandPaletteKeys(COMMAND_PALETTE_FAVORITES_KEY, nextValues.slice(0, 12));
}

function getCommandPaletteMemorySets() {
  return {
    favorites: new Set(readCommandPaletteFavorites()),
    recents: new Set(readCommandPaletteRecents()),
  };
}

function rankCommandPaletteCommands(commands) {
  var memory = getCommandPaletteMemorySets();
  return (Array.isArray(commands) ? commands.slice() : []).sort(function (left, right) {
    var leftFavorite = memory.favorites.has(left.id) ? 1 : 0;
    var rightFavorite = memory.favorites.has(right.id) ? 1 : 0;
    if (leftFavorite !== rightFavorite) {
      return rightFavorite - leftFavorite;
    }
    var leftRecent = memory.recents.has(left.id) ? 1 : 0;
    var rightRecent = memory.recents.has(right.id) ? 1 : 0;
    if (leftRecent !== rightRecent) {
      return rightRecent - leftRecent;
    }
    var leftPriority = Number.isFinite(left.priority) ? left.priority : 100;
    var rightPriority = Number.isFinite(right.priority) ? right.priority : 100;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }
    var leftOrder = Number.isFinite(left.order) ? left.order : 1000;
    var rightOrder = Number.isFinite(right.order) ? right.order : 1000;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return String(left.title || "").localeCompare(String(right.title || ""));
  });
}

function buildCommandPaletteSections(commands, query) {
  var list = Array.isArray(commands) ? commands : [];
  var memory = getCommandPaletteMemorySets();
  if (query) {
    return [{ label: "Matching commands", commands: list }];
  }
  var favoriteCommands = list.filter(function (command) {
    return memory.favorites.has(command.id);
  });
  var recentCommands = list.filter(function (command) {
    return !memory.favorites.has(command.id) && memory.recents.has(command.id);
  });
  var allOtherCommands = list.filter(function (command) {
    return !memory.favorites.has(command.id) && !memory.recents.has(command.id);
  });
  return [
    {
      label: "Pinned favorites",
      commands: favoriteCommands,
    },
    {
      label: "Recent moves",
      commands: recentCommands,
    },
    {
      label: "All commands",
      commands: allOtherCommands,
    },
  ].filter(function (section) {
    return section.commands.length;
  });
}

function renderCommandPalette() {
  var shell = document.getElementById("commandPaletteShell");
  var list = document.getElementById("commandPaletteList");
  var input = document.getElementById("commandPaletteInput");
  if (!shell || !list || !input) {
    return;
  }
  shell.classList.toggle("is-open", commandPaletteOpen);
  shell.setAttribute("aria-hidden", commandPaletteOpen ? "false" : "true");
  if (!commandPaletteOpen) {
    return;
  }
  input.value = commandPaletteQuery;
  var query = String(commandPaletteQuery || "")
    .trim()
    .toLowerCase();
  var commands = getFilteredCommandPaletteCommands();
  if (commandPaletteActiveIndex >= commands.length) {
    commandPaletteActiveIndex = Math.max(0, commands.length - 1);
  }
  var memory = getCommandPaletteMemorySets();
  var flattenedIndex = 0;
  list.innerHTML = commands.length
    ? buildCommandPaletteSections(commands, query)
        .map(function (section) {
          var sectionHtml =
            '<div class="command-palette-section"><div class="command-palette-section-title">' +
            escapeHtml(section.label || "Commands") +
            "</div>" +
            section.commands
              .map(function (command) {
                var index = flattenedIndex;
                flattenedIndex += 1;
                var badges = [];
                if (memory.favorites.has(command.id)) {
                  badges.push('<span class="tag is-highlight">Pinned</span>');
                }
                if (memory.recents.has(command.id)) {
                  badges.push('<span class="tag is-neutral">Recent</span>');
                }
                badges.push(
                  '<span class="tag is-neutral">' +
                    escapeHtml(index === commandPaletteActiveIndex ? "Selected" : "Ready") +
                    "</span>",
                );
                return (
                  '<button class="command-palette-item' +
                  (index === commandPaletteActiveIndex ? " is-active" : "") +
                  '" type="button" data-command-palette-index="' +
                  index +
                  '"><div class="command-palette-item-head"><div><div class="command-palette-item-kicker">' +
                  escapeHtml(command.kicker || "Command") +
                  '</div><div class="command-palette-item-title-row"><div class="command-palette-item-title">' +
                  escapeHtml(command.title || "") +
                  '</div><button class="command-palette-favorite' +
                  (memory.favorites.has(command.id) ? " is-active" : "") +
                  '" type="button" data-command-palette-favorite="' +
                  index +
                  '" aria-label="' +
                  escapeHtml(
                    memory.favorites.has(command.id)
                      ? "Remove from pinned commands"
                      : "Pin this command",
                  ) +
                  '">' +
                  escapeHtml(memory.favorites.has(command.id) ? "Pinned" : "Pin") +
                  '</button></div></div><div class="command-palette-item-tags">' +
                  badges.join("") +
                  '</div></div><div class="command-palette-item-copy">' +
                  escapeHtml(command.copy || "") +
                  "</div></button>"
                );
              })
              .join("") +
            "</div>";
          return sectionHtml;
        })
        .join("")
    : '<div class="command-palette-empty">No commands match that search yet. Try a lane name, record name, or action word like publish or confirm.</div>';
  window.setTimeout(function () {
    if (document.activeElement !== input) {
      input.focus();
      input.select();
    }
  }, 0);
}

function openCommandPalette() {
  commandPaletteOpen = true;
  commandPaletteQuery = "";
  commandPaletteActiveIndex = 0;
  renderCommandPalette();
}

function closeCommandPalette() {
  commandPaletteOpen = false;
  renderCommandPalette();
}

function runCommandPaletteSelection(index) {
  var commands = getFilteredCommandPaletteCommands();
  var command = commands[index];
  if (!command || typeof command.run !== "function") {
    return;
  }
  recordCommandPaletteRecent(command.id || command.key || "");
  closeCommandPalette();
  Promise.resolve(command.run()).catch(function (error) {
    console.error("Command palette action failed:", error);
  });
}

function renderAdminRecordInspector() {
  var root = document.getElementById("adminRecordInspectorContent");
  if (!root || authRequired) {
    if (root) {
      root.innerHTML = "";
    }
    return;
  }
  var selected = ensureAdminInspectorSelection();
  if (!selected || !selected.item) {
    root.innerHTML = "Select a listing or application ticket to load its profile workspace here.";
    return;
  }
  if (selected.kind === "candidate") {
    var candidate = selected.item;
    var candidateSequence = getInspectorSequenceMeta();
    var trustSummary = reviewModels.getCandidateTrustSummary(candidate);
    var trustRecommendation = reviewModels.getCandidateTrustRecommendation(candidate, trustSummary);
    var laneLabel = reviewModels.getCandidateReviewLaneLabel(candidate);
    var sourceMeta = getSourceReferenceMeta(candidate);
    root.innerHTML =
      '<div class="inspector-kicker">Listing ticket workspace</div><div class="inspector-title">' +
      escapeHtml(candidate.name || "Unnamed listing") +
      '</div><div class="inspector-copy">' +
      escapeHtml(
        "This control panel stays focused on the selected listing ticket so you can review the profile, make a decision, and move it to the right next state.",
      ) +
      '</div><div class="inspector-meta"><span class="tag is-neutral">' +
      escapeHtml(laneLabel || "Candidate queue") +
      '</span><span class="tag is-neutral">' +
      escapeHtml(String(candidate.review_status || "needs_review").replace(/_/g, " ")) +
      '</span><span class="tag is-neutral">' +
      escapeHtml(String(candidate.dedupe_status || "unreviewed").replace(/_/g, " ")) +
      '</span><span class="tag is-neutral">' +
      escapeHtml(candidateSequence.positionLabel) +
      '</span></div><div class="inspector-section"><div class="inspector-section-title">Decision view</div><div class="inspector-grid">' +
      renderInspectorKpi("Trust", trustSummary.headline) +
      renderInspectorKpi(
        "Priority",
        candidate.review_priority == null
          ? "Not scored"
          : String(candidate.review_priority) + "/100",
      ) +
      renderInspectorKpi(
        "Readiness",
        candidate.readiness_score == null
          ? "Not scored"
          : String(candidate.readiness_score) + "/100",
      ) +
      renderInspectorKpi(
        "Next review",
        candidate.next_review_due_at ? formatDate(candidate.next_review_due_at) : "Now",
      ) +
      '</div></div><div class="inspector-section"><div class="inspector-section-title">Best next move</div><ul class="inspector-list"><li>' +
      escapeHtml(trustRecommendation) +
      "</li><li>" +
      escapeHtml(
        candidate.dedupe_status === "definite_duplicate"
          ? "License and name match an existing record. Mark as duplicate or merge before any publish work."
          : candidate.dedupe_status === "possible_duplicate"
            ? "Compare with the possible match before publishing so the provider graph stays clean."
            : "Move this listing into publish, confirmation, merge, or archive so it does not remain ambiguous.",
      ) +
      '</li></ul></div><div class="inspector-actions"><button class="btn-primary" type="button" data-inspector-focus-kind="candidate" data-inspector-focus-id="' +
      escapeHtml(candidate.id) +
      '">Jump to card</button>' +
      '<button class="btn-primary" type="button" data-inspector-action="candidate_publish" data-inspector-id="' +
      escapeHtml(candidate.id) +
      '">Publish</button>' +
      '<button class="btn-secondary" type="button" data-inspector-action="candidate_review" data-inspector-id="' +
      escapeHtml(candidate.id) +
      '">Send to Review</button>' +
      '<button class="btn-danger-quiet" type="button" data-inspector-action="candidate_delete" data-inspector-id="' +
      escapeHtml(candidate.id) +
      '">Delete</button>' +
      (candidate.dedupe_status === "possible_duplicate"
        ? '<button class="btn-secondary" type="button" data-inspector-action="candidate_duplicate" data-inspector-id="' +
          escapeHtml(candidate.id) +
          '">Mark duplicate</button>'
        : "") +
      '<button class="btn-secondary" type="button" data-inspector-nav-direction="prev"' +
      (candidateSequence.previous ? "" : " disabled") +
      ">Previous</button>" +
      '<button class="btn-secondary" type="button" data-inspector-nav-direction="next"' +
      (candidateSequence.next ? "" : " disabled") +
      ">Next</button>" +
      (sourceMeta && sourceMeta.href
        ? '<a class="btn-secondary btn-inline" href="' +
          escapeHtml(sourceMeta.href) +
          '" target="_blank" rel="noopener">' +
          escapeHtml(sourceMeta.shortLabel || "Open source") +
          "</a>"
        : "") +
      "</div>" +
      renderInspectorActionStatusHtml();
    return;
  }

  var application = selected.item;
  var applicationSequence = getInspectorSequenceMeta();
  var snapshot = reviewModels.getApplicationReviewSnapshot(application);
  var readiness = getTherapistMatchReadiness(application);
  var urgency = getClaimFollowUpUrgency(application);
  var isClaim = application.submission_intent === "claim";
  root.innerHTML =
    '<div class="inspector-kicker">Application ticket workspace</div><div class="inspector-title">' +
    escapeHtml(application.name || "Unnamed application") +
    '</div><div class="inspector-copy">' +
    escapeHtml(
      "This control panel stays focused on the selected application ticket so you can review the profile, make a clean decision, and manage follow-up without leaving the workspace.",
    ) +
    '</div><div class="inspector-meta"><span class="tag is-neutral">' +
    escapeHtml(isClaim ? "Profile claim" : "Full profile") +
    '</span><span class="tag is-neutral">' +
    escapeHtml(snapshot.label || "Balanced review") +
    '</span><span class="tag is-neutral">' +
    escapeHtml(String(application.status || "pending").replace(/_/g, " ")) +
    '</span><span class="tag is-neutral">' +
    escapeHtml(applicationSequence.positionLabel) +
    '</span></div><div class="inspector-section"><div class="inspector-section-title">Decision view</div><div class="inspector-grid">' +
    renderInspectorKpi("Readiness", readiness.label + " · " + readiness.score + "/100") +
    renderInspectorKpi(
      "Portal state",
      application.portal_state_label || formatStatusLabel(application.status || "pending"),
    ) +
    renderInspectorKpi("Next move", snapshot.nextMove) +
    renderInspectorKpi("Follow-up urgency", isClaim ? urgency.label : "Not claim-driven") +
    '</div></div><div class="inspector-section"><div class="inspector-section-title">Best next move</div><ul class="inspector-list"><li>' +
    escapeHtml(snapshot.note || snapshot.nextMove) +
    "</li><li>" +
    escapeHtml(
      isClaim
        ? "Keep the therapist moving toward a fuller profile or a clear no, without letting the claim cool off."
        : "Choose the cleanest publish, fixes, or rejection path so the application leaves review with momentum.",
    ) +
    '</li></ul></div><div class="inspector-actions"><button class="btn-primary" type="button" data-inspector-focus-kind="application" data-inspector-focus-id="' +
    escapeHtml(application.id) +
    '">Jump to card</button>' +
    (application.status === "pending" || application.status === "reviewing"
      ? '<button class="btn-primary" type="button" data-inspector-action="application_approve" data-inspector-id="' +
        escapeHtml(application.id) +
        '">Approve / publish</button>'
      : "") +
    (application.status === "pending"
      ? '<button class="btn-secondary" type="button" data-inspector-action="application_reviewing" data-inspector-id="' +
        escapeHtml(application.id) +
        '">Start review</button>'
      : "") +
    (application.status === "pending" || application.status === "reviewing"
      ? '<button class="btn-secondary" type="button" data-inspector-action="application_request_changes" data-inspector-id="' +
        escapeHtml(application.id) +
        '">Request fixes</button>'
      : "") +
    (application.status === "pending" || application.status === "reviewing"
      ? '<button class="btn-secondary" type="button" data-inspector-action="application_reject" data-inspector-id="' +
        escapeHtml(application.id) +
        '">Reject</button>'
      : "") +
    '<button class="btn-secondary" type="button" data-inspector-nav-direction="prev"' +
    (applicationSequence.previous ? "" : " disabled") +
    ">Previous</button>" +
    '<button class="btn-secondary" type="button" data-inspector-nav-direction="next"' +
    (applicationSequence.next ? "" : " disabled") +
    ">Next</button>" +
    (application.email
      ? '<a class="btn-secondary btn-inline" href="mailto:' +
        escapeHtml(application.email) +
        '">Email therapist</a>'
      : "") +
    "</div>" +
    renderInspectorActionStatusHtml();
}

function updateHeroStatus(context) {
  var heroStatus = document.getElementById("adminHeroStatus");
  if (!heroStatus) return;
  var ctx = context || {};
  var parts = [];
  if (ctx.priorityCount) {
    parts.push(
      ctx.priorityCount + " thing" + (ctx.priorityCount === 1 ? "" : "s") + " need you now",
    );
  } else {
    parts.push("No urgent actions");
  }
  if (ctx.candidateReviewCount) {
    parts.push(
      ctx.candidateReviewCount +
        " new listing" +
        (ctx.candidateReviewCount === 1 ? "" : "s") +
        " to triage",
    );
  }
  if (ctx.pendingApplicationsCount) {
    parts.push(
      ctx.pendingApplicationsCount +
        " pending application" +
        (ctx.pendingApplicationsCount === 1 ? "" : "s"),
    );
  }
  heroStatus.textContent = parts.join(" · ");
}

function updateNavCounts(counts) {
  var mapping = {
    navCountCandidates: counts.candidates,
    navCountReview: counts.review,
    navCountConfirmations: counts.confirmations,
    navCountRequests: counts.requests,
    navCountLive: counts.live,
  };
  Object.keys(mapping).forEach(function (id) {
    var node = document.getElementById(id);
    if (!node) return;
    var value = Number(mapping[id]) || 0;
    node.textContent = value > 0 ? String(value) : "";
  });
}

function updateSignupsPill(pendingCount) {
  var pill = document.getElementById("adminSignupsPill");
  var countNode = document.getElementById("adminSignupsPillCount");
  if (!pill || !countNode) return;
  var count = Number(pendingCount) || 0;
  countNode.textContent = String(count);
  pill.classList.toggle("is-active", count > 0);
  pill.classList.toggle("is-empty", count === 0);
  pill.setAttribute(
    "title",
    count > 0
      ? count +
          " therapist" +
          (count === 1 ? "" : "s") +
          " submitted a signup and is waiting on review"
      : "No live signups pending. This updates when a therapist submits through the signup form.",
  );
}

var sopNotesCollapsed = false;
function collapseRegionSopNotes() {
  if (sopNotesCollapsed) return;
  var sopNotes = document.querySelectorAll(".sop-note");
  if (!sopNotes.length) return;
  sopNotes.forEach(function (note, index) {
    if (note.dataset.playbookWired === "1") return;
    note.dataset.playbookWired = "1";
    note.classList.add("is-collapsed");
    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "region-playbook-toggle";
    toggle.setAttribute("aria-expanded", "false");
    var panelId = "regionPlaybookPanel" + index;
    note.id = panelId;
    toggle.setAttribute("aria-controls", panelId);
    toggle.innerHTML =
      'Operator playbook <span class="region-playbook-toggle-caret" aria-hidden="true">▾</span>';
    toggle.addEventListener("click", function () {
      var isOpen = note.classList.toggle("is-collapsed") === false;
      toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });
    note.parentNode.insertBefore(toggle, note);
  });
  sopNotesCollapsed = true;
}

function renderStats() {
  var statsRoot = document.getElementById("adminStats");
  if (!statsRoot) {
    return;
  }
  if (authRequired) {
    statsRoot.innerHTML = "";
    renderExecutiveCommandDeck({});
    renderAdminWorkflowGuidance({});
    return;
  }
  try {
    const therapists = dataMode === "sanity" ? publishedTherapists : getTherapists();
    const applications = dataMode === "sanity" ? remoteApplications : getApplications();
    const conciergeRequests = readConciergeRequests();
    const portalRequests = dataMode === "sanity" ? remotePortalRequests : [];
    const outreachOutcomes = readOutreachOutcomes();
    const funnelSummary = summarizeFunnelEvents(readFunnelEvents());
    const matchReadyCount = therapists.filter(function (item) {
      return getTherapistMatchReadiness(item).score >= 85;
    }).length;
    const openConciergeCount = conciergeRequests.filter(function (item) {
      return item.request_status !== "resolved";
    }).length;
    const openPortalRequestCount = portalRequests.filter(function (item) {
      return item.status !== "resolved";
    }).length;
    const heardBackCount = outreachOutcomes.filter(function (item) {
      return item.outcome === "heard_back";
    }).length;
    const bookedConsultCount = outreachOutcomes.filter(function (item) {
      return item.outcome === "booked_consult";
    }).length;
    const profilesNeedingRefresh = therapists.filter(function (item) {
      return (
        getDataFreshnessSummary(item).status !== "fresh" ||
        getTherapistFieldTrustAttentionCount(item)
      );
    }).length;
    const profilesNeedingConfirmation = therapists.filter(function (item) {
      return getTherapistConfirmationAgenda(item).needs_confirmation;
    }).length;
    const strictImportBlockers = getPublishedTherapistImportBlockerQueue();
    const strictImportBlockerCount = strictImportBlockers.length;
    const confirmationQueue = getPublishedTherapistConfirmationQueue();
    const refreshQueue = therapists
      .map(function (item) {
        return {
          item: item,
          freshness: getDataFreshnessSummary(item),
          trustAttentionCount: getTherapistFieldTrustAttentionCount(item),
        };
      })
      .filter(function (entry) {
        return entry.freshness.status !== "fresh" || entry.trustAttentionCount > 0;
      })
      .sort(function (a, b) {
        const weight = {
          aging: 0,
          watch: 1,
          fresh: 2,
        };
        const statusDiff = (weight[a.freshness.status] || 9) - (weight[b.freshness.status] || 9);
        if (statusDiff) {
          return statusDiff;
        }
        const trustDiff = (b.trustAttentionCount || 0) - (a.trustAttentionCount || 0);
        if (trustDiff) {
          return trustDiff;
        }
        return (
          (b.freshness.needs_reconfirmation_fields || []).length -
          (a.freshness.needs_reconfirmation_fields || []).length
        );
      });
    const confirmationQueueState = readConfirmationQueueState();
    const awaitingConfirmationCount = Object.keys(confirmationQueueState).filter(function (slug) {
      var entry = confirmationQueueState[slug];
      return entry && (entry.status === "sent" || entry.status === "waiting_on_therapist");
    }).length;
    const pendingApplicationsCount = applications.filter(function (item) {
      return item.status === "pending";
    }).length;
    updateSignupsPill(pendingApplicationsCount);
    const candidateQueueItems = dataMode === "sanity" ? remoteCandidates : [];
    const candidateReviewCount = candidateQueueItems.filter(function (item) {
      return (
        item.review_status !== "published" &&
        item.review_status !== "archived" &&
        item.review_status !== "needs_review"
      );
    }).length;
    const candidateParkedReviewCount = candidateQueueItems.filter(function (item) {
      return item.review_status === "needs_review";
    }).length;
    const candidateReadyCount = candidateQueueItems.filter(function (item) {
      return item.review_status === "ready_to_publish";
    }).length;
    const candidateDuplicateCount = candidateQueueItems.filter(function (item) {
      return (
        item.dedupe_status === "definite_duplicate" ||
        item.dedupe_status === "possible_duplicate" ||
        item.dedupe_status === "unreviewed"
      );
    }).length;
    const candidateConfirmationCount = candidateQueueItems.filter(function (item) {
      return item.review_status === "needs_confirmation";
    }).length;
    const reviewingApplicationsCount = applications.filter(function (item) {
      return item.status === "reviewing";
    }).length;
    const claimFollowUpCount = applications.filter(function (item) {
      return getClaimFollowUpUrgency(item).level === "due_now";
    }).length;
    const publishReadyApplicationsCount = applications.filter(function (item) {
      return reviewModels.getApplicationReviewSnapshot(item).focus === "publish_ready";
    }).length;
    const readyToApplyCount = confirmationQueue.filter(function (entry) {
      var status = entry && entry.workflow ? entry.workflow.status : "not_started";
      return status === "confirmed";
    }).length;
    const listingPromotionCount = therapists.filter(function (item) {
      return (
        getTherapistMatchReadiness(item).score >= 90 &&
        getTherapistMerchandisingQuality(item).score >= 85 &&
        getDataFreshnessSummary(item).status !== "aging" &&
        !getTherapistConfirmationAgenda(item).needs_confirmation &&
        getTherapistFieldTrustAttentionCount(item) === 0
      );
    }).length;
    let nextBestActions = [];
    try {
      nextBestActions = getNextBestAdminActions({
        applications: applications,
        getClaimActionQueue: getClaimActionQueue,
        getDataFreshnessSummary: getDataFreshnessSummary,
        getPublishedTherapistConfirmationQueue: getPublishedTherapistConfirmationQueue,
        getPublishedTherapistImportBlockerQueue: getPublishedTherapistImportBlockerQueue,
        getTherapistConfirmationAgenda: getTherapistConfirmationAgenda,
        getTherapistFieldTrustAttentionCount: getTherapistFieldTrustAttentionCount,
        getTherapistMatchReadiness: getTherapistMatchReadiness,
        getTherapistMerchandisingQuality: getTherapistMerchandisingQuality,
        therapists: therapists,
      });
    } catch (error) {
      console.error("Admin next-best actions failed to render:", error);
      nextBestActions = [];
    }
    renderExecutiveCommandDeck({
      candidateReviewCount: candidateReviewCount,
      funnelSummary: funnelSummary,
      heardBackCount: heardBackCount,
      listingPromotionCount: listingPromotionCount,
      matchReadyCount: matchReadyCount,
      openConciergeCount: openConciergeCount,
      openPortalRequestCount: openPortalRequestCount,
      pendingApplicationsCount: pendingApplicationsCount,
      profilesNeedingConfirmation: profilesNeedingConfirmation,
      profilesNeedingRefresh: profilesNeedingRefresh,
      strictImportBlockerCount: strictImportBlockerCount,
      bookedConsultCount: bookedConsultCount,
    });
    renderAdminWorkflowGuidance({
      candidateConfirmationCount: candidateConfirmationCount,
      candidateDuplicateCount: candidateDuplicateCount,
      candidateReadyCount: candidateReadyCount,
      candidateReviewCount: candidateReviewCount,
      claimFollowUpCount: claimFollowUpCount,
      openConciergeCount: openConciergeCount,
      openPortalRequestCount: openPortalRequestCount,
      pendingApplicationsCount: pendingApplicationsCount,
      profilesNeedingRefresh: profilesNeedingRefresh,
      publishReadyApplicationsCount: publishReadyApplicationsCount,
      reviewingApplicationsCount: reviewingApplicationsCount,
      strictImportBlockerCount: strictImportBlockerCount,
    });

    var topActions = nextBestActions.slice(0, 3);
    var nowSectionHtml = topActions.length
      ? '<div><div class="admin-now-title">What needs you now</div>' +
        '<div class="priority-rows">' +
        topActions
          .map(function (action, index) {
            return buildPriorityActionRow(action, index);
          })
          .join("") +
        "</div></div>"
      : '<div><div class="admin-now-title">What needs you now</div>' +
        '<div class="admin-now-empty">Nothing urgent. Queues are clear or actions are in-flight.</div></div>';

    var scorecardCards = [
      buildActionStatCard(candidateReviewCount, "New listings to triage", "supplyReviewRegion", {
        meta: candidateReadyCount
          ? candidateReadyCount + " ready to publish"
          : candidateDuplicateCount
            ? candidateDuplicateCount + " possible duplicates"
            : "",
        actionLabel: "Open triage lane",
      }),
      buildActionStatCard(
        profilesNeedingConfirmation + awaitingConfirmationCount + readyToApplyCount,
        "Confirmations in flight",
        "confirmationRegion",
        {
          meta: readyToApplyCount
            ? readyToApplyCount + " ready to apply"
            : awaitingConfirmationCount
              ? awaitingConfirmationCount + " waiting on reply"
              : "",
          actionLabel: "Open confirmations",
        },
      ),
      buildActionStatCard(
        pendingApplicationsCount + openConciergeCount + openPortalRequestCount,
        "Requests to handle",
        "requestsRegion",
        {
          meta: pendingApplicationsCount
            ? pendingApplicationsCount + " pending applications"
            : openPortalRequestCount
              ? openPortalRequestCount + " portal requests"
              : "",
          actionLabel: "Open ops inbox",
        },
      ),
      buildActionStatCard(
        profilesNeedingRefresh + strictImportBlockerCount,
        "Live listings to maintain",
        "liveListingsRegion",
        {
          meta: strictImportBlockerCount ? strictImportBlockerCount + " blocked on details" : "",
          actionLabel: "Open maintenance",
        },
      ),
    ];

    document.getElementById("adminStats").innerHTML =
      nowSectionHtml +
      '<div><div class="admin-now-title">At a glance</div>' +
      '<div class="admin-now-scorecard">' +
      scorecardCards.join("") +
      "</div></div>";

    var statsContainer = document.getElementById("adminStats");
    if (statsContainer) {
      statsContainer.style.display = "";
    }

    updateHeroStatus({
      priorityCount: topActions.length,
      candidateReviewCount: candidateReviewCount,
      pendingApplicationsCount: pendingApplicationsCount,
    });
    updateNavCounts({
      candidates: candidateReviewCount,
      review: candidateParkedReviewCount,
      confirmations: profilesNeedingConfirmation + awaitingConfirmationCount + readyToApplyCount,
      requests: pendingApplicationsCount + openConciergeCount + openPortalRequestCount,
      live: profilesNeedingRefresh + strictImportBlockerCount,
    });
    collapseRegionSopNotes();

    document.querySelectorAll("[data-admin-scroll-target]").forEach(function (button) {
      button.addEventListener("click", function () {
        var targetId = button.getAttribute("data-admin-scroll-target");
        var confirmationFilter = button.getAttribute("data-admin-confirmation-filter");
        var applicationStatus = button.getAttribute("data-admin-application-status");
        var conciergeStatus = button.getAttribute("data-admin-concierge-status");
        var portalRequestStatus = button.getAttribute("data-admin-portal-request-status");
        var focusSelector = button.getAttribute("data-admin-focus-selector");
        var focusTargetId = button.getAttribute("data-admin-focus-target-id");
        var workflowTitle = button.getAttribute("data-admin-workflow-title");
        var workflowDestination = button.getAttribute("data-admin-workflow-destination");
        var workflowFirstStep = button.getAttribute("data-admin-workflow-first-step");
        var workflowNextStep = button.getAttribute("data-admin-workflow-next-step");
        var workflowDone = button.getAttribute("data-admin-workflow-done");
        var workflowPrimaryActionLabel = button.getAttribute(
          "data-admin-workflow-primary-action-label",
        );
        var workflowPrimaryActionTargetId = button.getAttribute(
          "data-admin-workflow-primary-target-id",
        );
        if (confirmationFilter) {
          setConfirmationQueueFilter(confirmationFilter);
          renderConfirmationQueue();
        }
        if (applicationStatus !== null) {
          applicationFilters.status = applicationStatus || "";
          var applicationStatusFilter = document.getElementById("applicationStatusFilter");
          if (applicationStatusFilter) {
            applicationStatusFilter.value = applicationFilters.status;
          }
          renderApplications();
        }
        if (conciergeStatus !== null) {
          conciergeFilters.status = conciergeStatus || "";
          var conciergeStatusFilter = document.getElementById("conciergeStatusFilter");
          if (conciergeStatusFilter) {
            conciergeStatusFilter.value = conciergeFilters.status;
          }
          renderConciergeQueue();
        }
        if (portalRequestStatus !== null) {
          portalRequestFilters.status = portalRequestStatus || "";
          var portalRequestStatusFilter = document.getElementById("portalRequestStatusFilter");
          if (portalRequestStatusFilter) {
            portalRequestStatusFilter.value = portalRequestFilters.status;
          }
          renderPortalRequestsQueue();
        }
        var target = targetId ? document.getElementById(targetId) : null;
        if (target) {
          focusAdminWorkflowTarget({
            sectionTarget: target,
            focusTargetId: focusTargetId,
            focusSelector: focusSelector,
            workflowTitle: workflowTitle,
            workflowDestination: workflowDestination,
            workflowFirstStep: workflowFirstStep,
            workflowNextStep: workflowNextStep,
            workflowDone: workflowDone,
            workflowPrimaryActionLabel: workflowPrimaryActionLabel,
            workflowPrimaryActionTargetId: workflowPrimaryActionTargetId,
          });
        }
      });
    });
  } catch (error) {
    console.error("Admin stats failed to render:", error);
    statsRoot.innerHTML =
      '<div class="empty">The admin dashboard hit a rendering issue. Refresh the page to retry.</div>';
  }
}

function inferCoverageRole(item) {
  const title = String(item.title || "").toLowerCase();
  const credentials = String(item.credentials || "").toLowerCase();
  if (item.medication_management || title.includes("psychiatrist") || credentials.includes("md")) {
    return "psychiatry";
  }
  return "therapy";
}

function renderCoverageIntelligence() {
  withLazyAdminModule("./admin-sourcing-intelligence.js", function (module) {
    module.renderCoverageIntelligencePanel({
      root: document.getElementById("coverageIntelligence"),
      authRequired: authRequired,
      therapists: dataMode === "sanity" ? publishedTherapists : getTherapists(),
      inferCoverageRole: inferCoverageRole,
      getTherapistFieldTrustAttentionCount: getTherapistFieldTrustAttentionCount,
      escapeHtml: escapeHtml,
      csvEscape: csvEscape,
      copyText: copyText,
      downloadText: downloadText,
    });
  });
}

function renderIngestionScorecard() {
  var latestAutomationRun = ingestionAutomationHistory.length
    ? ingestionAutomationHistory[ingestionAutomationHistory.length - 1]
    : null;
  Promise.all([
    loadAdminLazyModule("./admin-ingestion-scorecard.js"),
    loadAdminLazyModule("./admin-sourcing-intelligence.js"),
  ]).then(function (loadedModules) {
    var module = loadedModules[0];
    var sourcingIntelligenceModule = loadedModules[1];
    module.renderIngestionScorecardPanel({
      root: document.getElementById("ingestionScorecard"),
      authRequired: authRequired,
      therapists: dataMode === "sanity" ? publishedTherapists : getTherapists(),
      candidates: dataMode === "sanity" ? remoteCandidates : [],
      applications: dataMode === "sanity" ? remoteApplications : getApplications(),
      ingestionAutomationHistory: ingestionAutomationHistory,
      latestAutomationRun: latestAutomationRun,
      licensureRefreshQueue: licensureRefreshQueue,
      licensureActivityFeed: licensureActivityFeed,
      buildCoverageInsights: function (therapists) {
        return sourcingIntelligenceModule.buildCoverageInsights(therapists, {
          inferCoverageRole: inferCoverageRole,
          getTherapistFieldTrustAttentionCount: getTherapistFieldTrustAttentionCount,
        });
      },
      getDataFreshnessSummary: getDataFreshnessSummary,
      getTherapistFieldTrustSummary: getTherapistFieldTrustSummary,
      escapeHtml: escapeHtml,
      formatDate: formatDate,
    });
  });
}

function renderSourcePerformance() {
  withLazyAdminModule("./admin-sourcing-intelligence.js", function (module) {
    module.renderSourcePerformancePanel({
      root: document.getElementById("sourcePerformance"),
      authRequired: authRequired,
      candidates: dataMode === "sanity" ? remoteCandidates : [],
      therapists: dataMode === "sanity" ? publishedTherapists : getTherapists(),
      inferCoverageRole: inferCoverageRole,
      getTherapistFieldTrustAttentionCount: getTherapistFieldTrustAttentionCount,
      escapeHtml: escapeHtml,
    });
  });
}

function renderFunnelInsights() {
  const root = document.getElementById("funnelInsights");
  if (!root) {
    return;
  }

  if (authRequired) {
    root.innerHTML = "";
    return;
  }

  const events = readFunnelEvents();
  const summary = summarizeFunnelEvents(events);
  const patientJourney = summarizePatientJourney(events);
  const profileContactSignals = summarizeProfileContactSignals(events);
  const profileQueueProgress = summarizeProfileQueueProgress(events);
  const directoryProfileOpenQuality = summarizeDirectoryProfileOpenQuality(events);
  const outcomes = readOutreachOutcomes();
  const profileContactOutcomeValidation = summarizeProfileContactOutcomeValidation(
    events,
    outcomes,
  );
  const routeOutcomePerformance = summarizeContactRouteOutcomePerformance(outcomes);
  const profileContactExperimentDecision = summarizeProfileContactExperimentDecision(
    events,
    outcomes,
  );
  const experimentPerformance = summarizeExperimentPerformance(events);
  const experimentDecisions = summarizeExperimentDecisions(events);
  const adaptive = summarizeAdaptiveSignals(events, outcomes);
  const strategyHealth = buildStrategyHealthSummary(outcomes);
  const strategyPerformance = analyzeStrategyPerformance(events, outcomes);
  const segmentSnapshots = buildSegmentStrategySnapshots(events, outcomes);
  if (!summary.total) {
    root.innerHTML =
      '<div class="empty">No funnel analytics captured yet. Once users browse, save, match, and reach out, the local event rollup will appear here.</div>';
    return;
  }

  root.innerHTML =
    '<div class="queue-insights"><div class="queue-insights-title">Funnel signals we are seeing</div><div class="queue-insights-grid">' +
    [
      { label: "Searches tracked", count: summary.searches },
      { label: "Matches run", count: summary.matches },
      { label: "Shortlist saves", count: summary.shortlist_saves },
      { label: "Help requests", count: summary.help_requests },
      { label: "Contact intents", count: summary.contact_intents || 0 },
      { label: "Outreach starts", count: summary.outreach_starts },
    ]
      .map(function (item) {
        return (
          '<div class="queue-insight-card"><div class="queue-insight-value">' +
          escapeHtml(item.count) +
          '</div><div class="queue-insight-label">' +
          escapeHtml(item.label) +
          "</div></div>"
        );
      })
      .join("") +
    "</div></div>" +
    '<div class="queue-insights"><div class="queue-insights-title">Patient journey checkpoints</div><div class="queue-insights-grid">' +
    patientJourney.stages
      .map(function (item) {
        return (
          '<div class="queue-insight-card"><div class="queue-insight-value">' +
          escapeHtml(item.count) +
          '</div><div class="queue-insight-label">' +
          escapeHtml(item.label) +
          '</div><div class="queue-insight-note">' +
          escapeHtml(item.note) +
          "</div></div>"
        );
      })
      .join("") +
    '</div><div class="mini-status" style="margin-top:0.75rem"><strong>' +
    escapeHtml(
      patientJourney.biggest_dropoff ? "Biggest patient drop-off" : "Patient journey note",
    ) +
    ":</strong> " +
    escapeHtml(
      patientJourney.biggest_dropoff
        ? patientJourney.biggest_dropoff.from_label +
            " -> " +
            patientJourney.biggest_dropoff.to_label +
            " is currently the steepest falloff."
        : "We need more patient journey data before a clear drop-off is visible.",
    ) +
    "</div></div>" +
    (directoryProfileOpenQuality.rows.length
      ? '<div class="queue-insights"><div class="queue-insights-title">Directory-to-profile quality</div><div class="queue-insights-grid">' +
        directoryProfileOpenQuality.rows
          .map(function (item) {
            return (
              '<div class="queue-insight-card"><div class="queue-insight-value">' +
              escapeHtml(item.source) +
              '</div><div class="queue-insight-label">' +
              escapeHtml(
                item.opens +
                  " opens · " +
                  item.high_readiness +
                  " high-readiness · " +
                  item.fresh_profiles +
                  " fresh",
              ) +
              '</div><div class="queue-insight-note">' +
              escapeHtml(
                "High-readiness " +
                  Math.round(item.high_readiness_rate * 100) +
                  "% · Accepting " +
                  Math.round(item.accepting_rate * 100) +
                  "% · Bipolar detail " +
                  Math.round(item.bipolar_rate * 100) +
                  "%",
              ) +
              "</div></div>"
            );
          })
          .join("") +
        '</div><div class="mini-status" style="margin-top:0.75rem"><strong>Interpretation:</strong> ' +
        escapeHtml(directoryProfileOpenQuality.interpretation) +
        "</div></div>"
      : "") +
    '<div class="queue-insights"><div class="queue-insights-title">Recovery and friction signals</div><div class="queue-insights-grid">' +
    [
      {
        label: "Recovery clicks",
        count: patientJourney.recovery_moves,
      },
      {
        label: "Refinement opens",
        count: patientJourney.refinement_opens,
      },
      {
        label: "Direct outreach actions",
        count: patientJourney.direct_outreach_actions,
      },
    ]
      .map(function (item) {
        return (
          '<div class="queue-insight-card"><div class="queue-insight-value">' +
          escapeHtml(item.count) +
          '</div><div class="queue-insight-label">' +
          escapeHtml(item.label) +
          "</div></div>"
        );
      })
      .join("") +
    "</div></div>" +
    (profileContactSignals.total_route_clicks ||
    profileContactSignals.section_views ||
    profileContactSignals.script_engagements ||
    profileContactSignals.question_engagements
      ? '<div class="queue-insights"><div class="queue-insights-title">Profile contact conversion signals</div><div class="queue-insights-grid">' +
        [
          {
            label: "Contact section views",
            count: profileContactSignals.section_views,
          },
          {
            label: "Route clicks",
            count: profileContactSignals.total_route_clicks,
          },
          {
            label: "Script engagements",
            count: profileContactSignals.script_engagements,
          },
          {
            label: "Question-list engagements",
            count: profileContactSignals.question_engagements,
          },
        ]
          .map(function (item) {
            return (
              '<div class="queue-insight-card"><div class="queue-insight-value">' +
              escapeHtml(item.count) +
              '</div><div class="queue-insight-label">' +
              escapeHtml(item.label) +
              "</div></div>"
            );
          })
          .join("") +
        "</div>" +
        '<div class="mini-status" style="margin-top:0.75rem"><strong>Interpretation:</strong> ' +
        escapeHtml(profileContactSignals.interpretation) +
        "</div>" +
        (profileContactSignals.top_route
          ? '<div class="mini-status" style="margin-top:0.45rem"><strong>Current leading route:</strong> ' +
            escapeHtml(
              profileContactSignals.top_route.route +
                " with " +
                profileContactSignals.top_route.count +
                " click" +
                (profileContactSignals.top_route.count === 1 ? "" : "s"),
            ) +
            "</div>"
          : "") +
        (profileContactSignals.route_rows.length
          ? '<div class="mini-status" style="margin-top:0.75rem"><strong>Most-used contact routes:</strong> ' +
            escapeHtml(
              profileContactSignals.route_rows
                .slice(0, 4)
                .map(function (item) {
                  return item.route + " " + item.count;
                })
                .join(" · "),
            ) +
            "</div>"
          : "") +
        (profileContactSignals.weak_guidance_profiles.length
          ? '<div class="mini-status" style="margin-top:0.45rem"><strong>Watchlist:</strong> ' +
            escapeHtml(
              profileContactSignals.weak_guidance_profiles
                .slice(0, 3)
                .map(function (item) {
                  return item.slug + " (" + item.clicks + " clicks)";
                })
                .join(" · "),
            ) +
            "</div>"
          : "") +
        (profileContactSignals.top_profiles.length
          ? '<div class="queue-insights-grid" style="margin-top:0.75rem">' +
            profileContactSignals.top_profiles
              .map(function (item) {
                return (
                  '<div class="queue-insight-card"><div class="queue-insight-value">' +
                  escapeHtml(item.slug) +
                  '</div><div class="queue-insight-label">' +
                  escapeHtml(
                    item.clicks +
                      " route click" +
                      (item.clicks === 1 ? "" : "s") +
                      " · " +
                      item.primary +
                      " primary · " +
                      item.secondary +
                      " secondary",
                  ) +
                  "</div></div>"
                );
              })
              .join("") +
            "</div>"
          : "") +
        (profileContactSignals.variant_rows.length
          ? '<div class="queue-insights-grid" style="margin-top:0.75rem">' +
            profileContactSignals.variant_rows
              .map(function (item) {
                return (
                  '<div class="queue-insight-card"><div class="queue-insight-value">' +
                  escapeHtml(item.variant) +
                  '</div><div class="queue-insight-label">' +
                  escapeHtml(
                    item.exposures +
                      " exposures · " +
                      item.route_clicks +
                      " route clicks · " +
                      item.guidance_engagements +
                      " guidance engagements",
                  ) +
                  '</div><div class="queue-insight-note">' +
                  escapeHtml(
                    "Route click rate " +
                      Math.round(item.route_click_rate * 100) +
                      "% · Guidance rate " +
                      Math.round(item.guidance_rate * 100) +
                      "% of clicks",
                  ) +
                  "</div></div>"
                );
              })
              .join("") +
            "</div>"
          : "") +
        (profileQueueProgress.updates
          ? '<div class="queue-insights-grid" style="margin-top:0.75rem">' +
            [
              {
                label: "Profile updates saved",
                count: profileQueueProgress.updates,
              },
              {
                label: "Therapists updated",
                count: profileQueueProgress.therapist_count,
              },
              {
                label: "Reached out",
                count: profileQueueProgress.reached_out,
              },
              {
                label: "Reply progress",
                count: profileQueueProgress.heard_back + profileQueueProgress.good_fit_call,
              },
              {
                label: "Friction saved",
                count:
                  profileQueueProgress.no_response +
                  profileQueueProgress.waitlist +
                  profileQueueProgress.insurance_mismatch,
              },
            ]
              .map(function (item) {
                return (
                  '<div class="queue-insight-card"><div class="queue-insight-value">' +
                  escapeHtml(item.count) +
                  '</div><div class="queue-insight-label">' +
                  escapeHtml(item.label) +
                  "</div></div>"
                );
              })
              .join("") +
            '</div><div class="mini-status" style="margin-top:0.45rem"><strong>Profile queue readout:</strong> ' +
            escapeHtml(profileQueueProgress.interpretation) +
            "</div>"
          : "") +
        (profileContactOutcomeValidation.length
          ? '<div class="queue-insights-grid" style="margin-top:0.75rem">' +
            profileContactOutcomeValidation
              .map(function (item) {
                return (
                  '<div class="queue-insight-card"><div class="queue-insight-value">' +
                  escapeHtml(item.variant) +
                  '</div><div class="queue-insight-label">' +
                  escapeHtml(
                    item.therapist_count +
                      " therapists touched · " +
                      item.strong_outcomes +
                      " strong outcomes · " +
                      item.friction_outcomes +
                      " friction outcomes",
                  ) +
                  '</div><div class="queue-insight-note">' +
                  escapeHtml("Downstream validation score " + item.downstream_score) +
                  "</div></div>"
                );
              })
              .join("") +
            "</div>"
          : "") +
        (routeOutcomePerformance.rows.length
          ? '<div class="queue-insights-grid" style="margin-top:0.75rem">' +
            routeOutcomePerformance.rows
              .slice(0, 4)
              .map(function (item) {
                return (
                  '<div class="queue-insight-card"><div class="queue-insight-value">' +
                  escapeHtml(item.route) +
                  '</div><div class="queue-insight-label">' +
                  escapeHtml(
                    item.total +
                      " route-linked outcomes · " +
                      item.strong +
                      " strong · " +
                      item.friction +
                      " friction",
                  ) +
                  '</div><div class="queue-insight-note">' +
                  escapeHtml(
                    "Strong rate " + Math.round(item.strong_rate * 100) + "% · Net " + item.net,
                  ) +
                  "</div></div>"
                );
              })
              .join("") +
            '</div><div class="mini-status" style="margin-top:0.45rem"><strong>Route outcome readout:</strong> ' +
            escapeHtml(routeOutcomePerformance.interpretation) +
            "</div>"
          : "") +
        (profileContactExperimentDecision && profileContactExperimentDecision.winner
          ? '<div class="queue-insight-card" style="margin-top:0.75rem"><div class="queue-insight-value">' +
            escapeHtml(profileContactExperimentDecision.experiment_name) +
            '</div><div class="queue-insight-label">' +
            escapeHtml(
              profileContactExperimentDecision.winner.variant +
                " · " +
                profileContactExperimentDecision.recommendation,
            ) +
            '</div><div class="queue-insight-note">' +
            escapeHtml(
              profileContactExperimentDecision.note +
                " Confidence gap: " +
                Math.round(profileContactExperimentDecision.confidence_gap * 100) / 100,
            ) +
            '</div><div class="queue-insight-action">' +
            (profileContactExperimentDecision.recommendation === "Promising winner"
              ? '<button type="button" class="btn-secondary btn-inline" data-promote-experiment="' +
                escapeHtml(profileContactExperimentDecision.experiment_name) +
                '" data-promote-variant="' +
                escapeHtml(profileContactExperimentDecision.winner.variant) +
                '">Promote ' +
                escapeHtml(profileContactExperimentDecision.winner.variant) +
                "</button>"
              : "") +
            (profileContactExperimentDecision.promoted_variant
              ? ' <button type="button" class="btn-secondary btn-inline" data-clear-experiment-promotion="' +
                escapeHtml(profileContactExperimentDecision.experiment_name) +
                '">Clear promoted default</button><div class="queue-insight-note">Promoted now: ' +
                escapeHtml(profileContactExperimentDecision.promoted_variant) +
                "</div>"
              : "") +
            "</div></div>"
          : "") +
        "</div>"
      : "") +
    (experimentPerformance.length
      ? '<div class="queue-insights"><div class="queue-insights-title">Experiment variants in the wild</div><div class="queue-insights-grid">' +
        experimentPerformance
          .map(function (item) {
            return (
              '<div class="queue-insight-card"><div class="queue-insight-value">' +
              escapeHtml(item.experiment_name + " · " + item.variant) +
              '</div><div class="queue-insight-label">' +
              escapeHtml(
                item.exposures +
                  " exposures · " +
                  item.matches +
                  " matches · " +
                  item.shortlist_actions +
                  " shortlist actions · " +
                  item.outreach_starts +
                  " outreach starts",
              ) +
              '</div><div class="queue-insight-note">' +
              escapeHtml(
                "Match rate " +
                  Math.round(item.match_rate * 100) +
                  "% · Outreach rate " +
                  Math.round(item.outreach_rate * 100) +
                  "% from matches",
              ) +
              "</div></div>"
            );
          })
          .join("") +
        "</div></div>"
      : "") +
    (experimentDecisions.length
      ? '<div class="queue-insights"><div class="queue-insights-title">Experiment recommendations</div><div class="queue-insights-grid">' +
        experimentDecisions
          .map(function (item) {
            return (
              '<div class="queue-insight-card"><div class="queue-insight-value">' +
              escapeHtml(item.experiment_name) +
              '</div><div class="queue-insight-label">' +
              escapeHtml(
                item.winner
                  ? item.winner.variant + " · " + item.recommendation
                  : "No clear recommendation yet",
              ) +
              '</div><div class="queue-insight-note">' +
              escapeHtml(
                item.winner
                  ? "Current leader: " +
                      item.winner.variant +
                      ". Composite gap: " +
                      Math.round(item.confidence_gap * 100) / 100
                  : "We need more traffic before recommending a variant.",
              ) +
              '</div><div class="queue-insight-action">' +
              (item.winner
                ? '<button type="button" class="btn-secondary btn-inline" data-promote-experiment="' +
                  escapeHtml(item.experiment_name) +
                  '" data-promote-variant="' +
                  escapeHtml(item.winner.variant) +
                  '">Promote ' +
                  escapeHtml(item.winner.variant) +
                  "</button>"
                : "") +
              (item.promoted_variant
                ? ' <button type="button" class="btn-secondary btn-inline" data-clear-experiment-promotion="' +
                  escapeHtml(item.experiment_name) +
                  '">Clear promoted default</button><div class="queue-insight-note">Promoted now: ' +
                  escapeHtml(item.promoted_variant) +
                  "</div>"
                : "") +
              "</div></div>"
            );
          })
          .join("") +
        "</div></div>"
      : "") +
    '<div class="queue-insights"><div class="queue-insights-title">Current adaptive strategy</div><div class="queue-insights-grid">' +
    [
      {
        label: "Match flow leaning toward",
        count:
          formatAdaptiveLabel(adaptive.preferred_match_action) +
          " (" +
          formatAdaptiveLabel(adaptive.match_action_basis) +
          "-led)",
      },
      {
        label: "Homepage teaser default",
        count: formatAdaptiveLabel(adaptive.preferred_home_mode),
      },
      {
        label: "Directory default sort",
        count: formatAdaptiveLabel(adaptive.preferred_directory_sort),
      },
      {
        label: "Outreach-first signals",
        count: adaptive.action_counts.outreach,
      },
      {
        label: "Help-first signals",
        count: adaptive.action_counts.help,
      },
      {
        label: "Save-first signals",
        count: adaptive.action_counts.save,
      },
    ]
      .map(function (item) {
        return (
          '<div class="queue-insight-card"><div class="queue-insight-value">' +
          escapeHtml(item.count) +
          '</div><div class="queue-insight-label">' +
          escapeHtml(item.label) +
          "</div></div>"
        );
      })
      .join("") +
    '</div><div class="mini-status" style="margin-top:0.75rem"><strong>' +
    escapeHtml(strategyHealth.label) +
    ":</strong> " +
    escapeHtml(strategyHealth.note) +
    "</div></div>" +
    (segmentSnapshots.length
      ? '<div class="queue-insights"><div class="queue-insights-title">Segment-aware strategy snapshots</div><div class="queue-insights-grid">' +
        segmentSnapshots
          .map(function (item) {
            return (
              '<div class="queue-insight-card"><div class="queue-insight-value">' +
              escapeHtml(item.label) +
              '</div><div class="queue-insight-label">' +
              escapeHtml(
                formatAdaptiveLabel(item.preferred_match_action) +
                  " (" +
                  formatAdaptiveLabel(item.basis) +
                  "-led)",
              ) +
              "</div></div>"
            );
          })
          .join("") +
        "</div></div>"
      : "") +
    (strategyPerformance.length
      ? '<div class="queue-insights"><div class="queue-insights-title">Strategy performance by active match lean</div><div class="queue-insights-grid">' +
        strategyPerformance
          .map(function (item) {
            return (
              '<div class="queue-insight-card"><div class="queue-insight-value">' +
              escapeHtml(item.label) +
              '</div><div class="queue-insight-label">' +
              escapeHtml(
                item.metrics.matches +
                  " matches · " +
                  item.metrics.outreach_starts +
                  " outreach starts · " +
                  item.metrics.strong +
                  " strong outcomes · " +
                  item.metrics.friction +
                  " friction outcomes",
              ) +
              "</div></div>"
            );
          })
          .join("") +
        "</div></div>"
      : "") +
    (summary.top_types.length
      ? '<div class="queue-insights"><div class="queue-insights-title">Most common tracked actions</div><div class="queue-insights-grid">' +
        summary.top_types
          .map(function (item) {
            return (
              '<div class="queue-insight-card"><div class="queue-insight-value">' +
              escapeHtml(item.count) +
              '</div><div class="queue-insight-label">' +
              escapeHtml(String(item.type).replace(/_/g, " ")) +
              "</div></div>"
            );
          })
          .join("") +
        "</div></div>"
      : "");

  root.querySelectorAll("[data-promote-experiment]").forEach(function (button) {
    button.addEventListener("click", function () {
      var experimentName = button.getAttribute("data-promote-experiment") || "";
      var variant = button.getAttribute("data-promote-variant") || "";
      if (!experimentName || !variant) {
        return;
      }
      setPromotedExperimentVariant(experimentName, variant);
      renderFunnelInsights();
    });
  });

  root.querySelectorAll("[data-clear-experiment-promotion]").forEach(function (button) {
    button.addEventListener("click", function () {
      var experimentName = button.getAttribute("data-clear-experiment-promotion") || "";
      if (!experimentName) {
        return;
      }
      setPromotedExperimentVariant(experimentName, "");
      renderFunnelInsights();
    });
  });
}

function renderListings() {
  listingsWorkspace.renderListings();
}

function renderLicensureQueue() {
  withLazyAdminModule("./admin-licensure-queue.js", function (module) {
    module.renderLicensureQueuePanel({
      root: document.getElementById("licensureQueue"),
      countEl: document.getElementById("licensureQueueCount"),
      authRequired: authRequired,
      rows: licensureRefreshQueue,
      activityFeed: licensureActivityFeed,
      activeFilter: licensureQueueFilter,
      onFilterChange: function (nextFilter) {
        licensureQueueFilter = nextFilter;
        renderLicensureQueue();
      },
      decideLicensureOps: decideLicensureOps,
      loadData: loadData,
      escapeHtml: escapeHtml,
      copyText: copyText,
    });
  });
}

function renderLicensureSprint() {
  var latestAutomationRun = ingestionAutomationHistory.length
    ? ingestionAutomationHistory[ingestionAutomationHistory.length - 1]
    : null;
  withLazyAdminModule("./admin-licensure-sprint.js", function (module) {
    module.renderLicensureSprintPanel({
      root: document.getElementById("licensureSprint"),
      authRequired: authRequired,
      rows: licensureRefreshQueue,
      activityFeed: licensureActivityFeed,
      latestAutomationRun: latestAutomationRun,
      decideLicensureOps: decideLicensureOps,
      loadData: loadData,
      escapeHtml: escapeHtml,
      copyText: copyText,
    });
  });
}

function renderDeferredLicensureQueue() {
  withLazyAdminModule("./admin-licensure-deferred-queue.js", function (module) {
    module.renderDeferredLicensureQueuePanel({
      root: document.getElementById("deferredLicensureQueue"),
      countEl: document.getElementById("deferredLicensureQueueCount"),
      authRequired: authRequired,
      rows: deferredLicensureQueue,
      activityFeed: licensureActivityFeed,
      decideLicensureOps: decideLicensureOps,
      loadData: loadData,
      escapeHtml: escapeHtml,
    });
  });
}

function renderLicensureActivity() {
  withLazyAdminModule("./admin-licensure-activity.js", function (module) {
    module.renderLicensureActivityPanel({
      root: document.getElementById("licensureActivity"),
      countEl: document.getElementById("licensureActivityCount"),
      authRequired: authRequired,
      rows: licensureActivityFeed,
      activeFilter: licensureActivityFilter,
      onFilterChange: function (nextFilter) {
        licensureActivityFilter = nextFilter;
        renderLicensureActivity();
      },
      escapeHtml: escapeHtml,
    });
  });
}

function renderImportBlockerSprint() {
  withLazyAdminModule("./admin-import-blocker-sprint.js", function (module) {
    module.renderImportBlockerSprintPanel({
      authRequired: authRequired,
      getPublishedTherapistImportBlockerQueue: getPublishedTherapistImportBlockerQueue,
      getImportBlockerSprintRows: getImportBlockerSprintRows,
      getConfirmationSprintRows: getConfirmationSprintRows,
      getOverlappingAskDetails: getOverlappingAskDetails,
      escapeHtml: escapeHtml,
      getImportBlockerSprintSummary: getImportBlockerSprintSummary,
      getImportBlockerSprintBottleneck: getImportBlockerSprintBottleneck,
      getPrimaryAskHeaderLine: getPrimaryAskHeaderLine,
      getImportBlockerSprintSharedAskDetails: getImportBlockerSprintSharedAskDetails,
      getImportBlockerSprintWaveShape: getImportBlockerSprintWaveShape,
      getImportBlockerSprintFieldPattern: getImportBlockerSprintFieldPattern,
      getImportBlockerSprintSharedAsk: getImportBlockerSprintSharedAsk,
      getImportBlockerSprintSharedAskStatus: getImportBlockerSprintSharedAskStatus,
      getImportBlockerSprintSharedAskImpact: getImportBlockerSprintSharedAskImpact,
      getBlockerConfirmationThemeBridge: getBlockerConfirmationThemeBridge,
      getImportBlockerRecommendationNote: getImportBlockerRecommendationNote,
      getOutreachChannelMixSummary: getOutreachChannelMixSummary,
      getTopOutreachWaveRows: getTopOutreachWaveRows,
      getOutreachChannelNextMoveSummary: getOutreachChannelNextMoveSummary,
      formatFieldLabel: formatFieldLabel,
      getConfirmationQueueEntry: getConfirmationQueueEntry,
      getImportBlockerFieldBuckets: getImportBlockerFieldBuckets,
      formatStatusLabel: formatStatusLabel,
      getConfirmationTarget: getConfirmationTarget,
      getConfirmationLastActionNote: getConfirmationLastActionNote,
      renderReviewEntityTaskHtml: reviewerWorkspace.renderReviewEntityTaskHtml,
      getImportBlockerLeverageNote: getImportBlockerLeverageNote,
      buildImportBlockerRequestSubject: buildImportBlockerRequestSubject,
      buildImportBlockerRequestMessage: buildImportBlockerRequestMessage,
      buildConfirmationLink: buildConfirmationLink,
      copyText: copyText,
      updateConfirmationQueueEntry: updateConfirmationQueueEntry,
      renderStats: renderStats,
      renderImportBlockerSprint: renderImportBlockerSprint,
      renderCaliforniaPriorityConfirmationWave: renderCaliforniaPriorityConfirmationWave,
      renderConfirmationSprint: renderConfirmationSprint,
      renderConfirmationQueue: renderConfirmationQueue,
      setConfirmationQueueFilter: function (value) {
        setConfirmationQueueFilter(value);
      },
      buildImportBlockerPacket: buildImportBlockerPacket,
      getImportBlockerSprintSharedAskText: getImportBlockerSprintSharedAskText,
      buildImportBlockerSharedAskPacket: buildImportBlockerSharedAskPacket,
      buildOverlappingAskPacket: buildOverlappingAskPacket,
      buildTopOutreachWavePacket: buildTopOutreachWavePacket,
      buildImportBlockerSprintCsv: buildImportBlockerSprintCsv,
      buildImportBlockerSprintMarkdown: buildImportBlockerSprintMarkdown,
    });
  });
}

function renderConfirmationSprint() {
  withLazyAdminModule("./admin-confirmation-sprint.js", function (module) {
    module.renderConfirmationSprintPanel({
      authRequired: authRequired,
      getPublishedTherapistConfirmationQueue: getPublishedTherapistConfirmationQueue,
      getConfirmationSprintRows: getConfirmationSprintRows,
      getImportBlockerSprintRows: getImportBlockerSprintRows,
      getOverlappingAskDetails: getOverlappingAskDetails,
      buildConfirmationApplyCsvRows: buildConfirmationApplyCsvRows,
      applyOverlapRecommendationContext: applyOverlapRecommendationContext,
      getConfirmationSprintRecommendation: getConfirmationSprintRecommendation,
      getConfirmationSprintMiniLanes: getConfirmationSprintMiniLanes,
      escapeHtml: escapeHtml,
      getConfirmationSprintHealthSummary: getConfirmationSprintHealthSummary,
      getConfirmationSprintBottleneckSummary: getConfirmationSprintBottleneckSummary,
      getPrimaryAskHeaderLine: getPrimaryAskHeaderLine,
      getConfirmationSprintThemeDetails: getConfirmationSprintThemeDetails,
      getConfirmationSprintThemeSummary: getConfirmationSprintThemeSummary,
      getBlockerConfirmationThemeBridge: getBlockerConfirmationThemeBridge,
      getOutreachChannelMixSummary: getOutreachChannelMixSummary,
      getTopOutreachWaveRows: getTopOutreachWaveRows,
      getOutreachChannelNextMoveSummary: getOutreachChannelNextMoveSummary,
      formatFieldLabel: formatFieldLabel,
      formatStatusLabel: formatStatusLabel,
      getConfirmationQueueEntry: getConfirmationQueueEntry,
      getConfirmationGraceWindowNote: getConfirmationGraceWindowNote,
      buildConfirmationLink: buildConfirmationLink,
      getPreferredFieldOrder: getPreferredFieldOrder,
      getConfirmationResultLabel: getConfirmationResultLabel,
      getConfirmationTarget: getConfirmationTarget,
      getConfirmationLastActionNote: getConfirmationLastActionNote,
      renderReviewEntityTaskHtml: reviewerWorkspace.renderReviewEntityTaskHtml,
      buildConfirmationResponseCaptureHtml: buildConfirmationResponseCaptureHtml,
      buildConfirmationApplyPreviewHtml: buildConfirmationApplyPreviewHtml,
      buildConfirmationApplyCsv: buildConfirmationApplyCsv,
      buildConfirmationApplySummary: buildConfirmationApplySummary,
      buildConfirmationApplyOperatorChecklist: buildConfirmationApplyOperatorChecklist,
      buildConfirmationSprintCsv: buildConfirmationSprintCsv,
      buildConfirmationSprintMarkdown: buildConfirmationSprintMarkdown,
      copyText: copyText,
      buildOverlappingAskPacket: buildOverlappingAskPacket,
      buildTopOutreachWavePacket: buildTopOutreachWavePacket,
      updateConfirmationQueueEntry: updateConfirmationQueueEntry,
      renderStats: renderStats,
      renderImportBlockerSprint: renderImportBlockerSprint,
      renderCaliforniaPriorityConfirmationWave: renderCaliforniaPriorityConfirmationWave,
      renderConfirmationSprint: renderConfirmationSprint,
      renderConfirmationQueue: renderConfirmationQueue,
      buildConfirmationApplyBrief: buildConfirmationApplyBrief,
      setConfirmationQueueFilter: function (value) {
        setConfirmationQueueFilter(value);
      },
    });
  });
}

function renderConfirmationQueue() {
  withLazyAdminModule("./admin-confirmation-queue.js", function (module) {
    module.renderConfirmationQueuePanel({
      root: document.getElementById("confirmationQueue"),
      statusFilter: document.getElementById("confirmationQueueStatusFilter"),
      countLabel: document.getElementById("confirmationQueueCount"),
      authRequired: authRequired,
      confirmationQueueFilter: getConfirmationQueueFilter(),
      confirmationStatusOptions: CONFIRMATION_STATUS_OPTIONS,
      getPublishedTherapistConfirmationQueue: getPublishedTherapistConfirmationQueue,
      getConfirmationQueuePrimaryField: getConfirmationQueuePrimaryField,
      getConfirmationQueueEntry: getConfirmationQueueEntry,
      buildConfirmationApplyCsvRows: buildConfirmationApplyCsvRows,
      buildConfirmationLink: buildConfirmationLink,
      getPreferredFieldOrder: getPreferredFieldOrder,
      formatStatusLabel: formatStatusLabel,
      formatFieldLabel: formatFieldLabel,
      buildConfirmationResponseCaptureHtml: buildConfirmationResponseCaptureHtml,
      buildConfirmationApplyPreviewHtml: buildConfirmationApplyPreviewHtml,
      formatDate: formatDate,
      escapeHtml: escapeHtml,
      buildConfirmationApplyCsv: buildConfirmationApplyCsv,
      buildConfirmationApplySummary: buildConfirmationApplySummary,
      buildConfirmationApplyOperatorChecklist: buildConfirmationApplyOperatorChecklist,
      copyText: copyText,
      buildOrderedConfirmationRequestMessage: buildOrderedConfirmationRequestMessage,
      setConfirmationActionStatus: setConfirmationActionStatus,
      updateConfirmationQueueEntry: updateConfirmationQueueEntry,
      renderStats: renderStats,
      renderImportBlockerSprint: renderImportBlockerSprint,
      renderCaliforniaPriorityConfirmationWave: renderCaliforniaPriorityConfirmationWave,
      renderConfirmationSprint: renderConfirmationSprint,
      renderConfirmationQueue: renderConfirmationQueue,
      buildConfirmationChecklist: buildConfirmationChecklist,
      buildConfirmationApplyBrief: buildConfirmationApplyBrief,
      bindConfirmationResponseCapture: bindConfirmationResponseCapture,
      renderReviewEntityTaskHtml: reviewerWorkspace.renderReviewEntityTaskHtml,
    });
  });
}

function renderApplications() {
  withLazyAdminModule("./admin-application-review.js", function (module) {
    module.renderApplicationsPanel({
      dataMode: dataMode,
      remoteApplications: remoteApplications,
      getApplications: getApplications,
      applicationFilters: applicationFilters,
      getApplicationReviewGoalMeta: reviewModels.getApplicationReviewGoalMeta,
      getApplicationReviewSnapshot: reviewModels.getApplicationReviewSnapshot,
      getGoalAdjustedApplicationPriorityScore: reviewModels.getGoalAdjustedApplicationPriorityScore,
      authRequired: authRequired,
      escapeHtml: escapeHtml,
      getApplicationEmptyStateCopy: reviewModels.getApplicationEmptyStateCopy,
      getApplicationFilterChips: reviewModels.getApplicationFilterChips,
      getClaimFollowUpUrgency: getClaimFollowUpUrgency,
      getAfterClaimReviewStall: getAfterClaimReviewStall,
      formatPercent: formatPercent,
      getClaimFunnelBottleneck: getClaimFunnelBottleneck,
      getClaimActionQueue: getClaimActionQueue,
      getClaimLaunchCandidates: getClaimLaunchCandidates,
      getStalledAfterClaimReviews: getStalledAfterClaimReviews,
      isGoalMatchedReviewCard: reviewModels.isGoalMatchedReviewCard,
      getApplicationBatchReason: reviewModels.getApplicationBatchReason,
      getTherapistMatchReadiness: getTherapistMatchReadiness,
      getDataFreshnessSummary: getDataFreshnessSummary,
      getTherapistReviewCoaching: getTherapistReviewCoaching,
      formatStatusLabel: formatStatusLabel,
      getClaimFollowUpLabel: getClaimFollowUpLabel,
      isConfirmationRefreshApplication: isConfirmationRefreshApplication,
      buildImprovementRequest: buildImprovementRequest,
      buildClaimReviewRequest: buildClaimReviewRequest,
      buildClaimFollowUpMessage: buildClaimFollowUpMessage,
      buildConfirmationLink: buildConfirmationLink,
      getApplicationLinkedTherapist: reviewModels.getApplicationLinkedTherapist,
      getApplicationLiveSyncSnapshot: reviewModels.getApplicationLiveSyncSnapshot,
      renderApplicationDiffHtml: reviewModels.renderApplicationDiffHtml,
      formatDate: formatDate,
      formatFieldLabel: formatFieldLabel,
      buildFieldReviewControls: buildFieldReviewControls,
      buildRevisionHistoryHtml: buildRevisionHistoryHtml,
      applicationFilters: applicationFilters,
      buildRecommendedReviewBatchRequests: buildRecommendedReviewBatchRequests,
      buildRecommendedReviewBatchPacket: buildRecommendedReviewBatchPacket,
      buildClaimLaunchPriorityPacket: buildClaimLaunchPriorityPacket,
      buildStalledAfterClaimReviewPacket: buildStalledAfterClaimReviewPacket,
      buildOverdueClaimFollowUpPacket: buildOverdueClaimFollowUpPacket,
      getReviewEventsForApplication: getReviewEventsForApplication,
      renderReviewEventSnippetHtml: renderReviewEventSnippetHtml,
      renderReviewEventTimelineHtml: renderReviewEventTimelineHtml,
      renderReviewEntityTaskHtml: reviewerWorkspace.renderReviewEntityTaskHtml,
      copyText: copyText,
      spotlightSection: spotlightSection,
      renderApplications: renderApplications,
      renderAll: renderAll,
      setCoachActionStatus: setCoachActionStatus,
      appendImprovementRequestToNotes: appendImprovementRequestToNotes,
      updateTherapistApplication: updateTherapistApplication,
      approveTherapistApplication: approveTherapistApplication,
      rejectTherapistApplicationRemote: rejectTherapistApplicationRemote,
      requestApplicationChanges: requestApplicationChanges,
      approveApplication: approveApplication,
      publishApplication: publishApplication,
      rejectApplication: rejectApplication,
      updateApplicationReviewMetadata: updateApplicationReviewMetadata,
      setApplyLiveFieldsStatus: setApplyLiveFieldsStatus,
      applyTherapistApplicationFields: applyTherapistApplicationFields,
      buildApplicationApplySummary: reviewModels.buildApplicationApplySummary,
      applicationLiveApplySummaries: applicationLiveApplySummaries,
      loadData: loadData,
    });
  });
}

function buildCandidateDecisionActions(item) {
  if (item.review_status === "published") {
    return '<span class="status approved">published</span>';
  }

  if (item.review_status === "archived") {
    return (
      '<button class="btn-secondary" data-candidate-decision="' +
      escapeHtml(item.id) +
      '" data-candidate-next="needs_review">Reopen review</button>'
    );
  }

  var actions = [
    '<button class="btn-primary" data-candidate-decision="' +
      escapeHtml(item.id) +
      '" data-candidate-next="publish">Publish</button>',
    '<button class="btn-secondary" data-candidate-decision="' +
      escapeHtml(item.id) +
      '" data-candidate-next="needs_review">Send to Review</button>',
    '<button class="btn-danger-quiet" data-candidate-decision="' +
      escapeHtml(item.id) +
      '" data-candidate-confirm="Delete this listing? This archives it and removes it from the queue." data-candidate-next="archive">Delete</button>',
  ];
  if (item.dedupe_status === "possible_duplicate") {
    actions.push(
      '<button class="btn-secondary" data-candidate-decision="' +
        escapeHtml(item.id) +
        '" data-candidate-next="reject_duplicate">Mark as duplicate</button>',
    );
  }
  return actions.join("");
}

function renderOpsInbox() {
  withLazyAdminModule("./admin-ops-inbox.js", function (module) {
    module.renderOpsInboxPanel({
      root: document.getElementById("opsInbox"),
      authRequired: authRequired,
      candidates: dataMode === "sanity" ? remoteCandidates : [],
      therapists: dataMode === "sanity" ? publishedTherapists : getTherapists(),
      applications: dataMode === "sanity" ? remoteApplications : getApplications(),
      licensureRefreshQueue: licensureRefreshQueue,
      profileConversionFreshnessQueue: profileConversionFreshnessQueue,
      getDataFreshnessSummary: getDataFreshnessSummary,
      getTherapistFieldTrustAttentionCount: getTherapistFieldTrustAttentionCount,
      getCandidateOpsEvidence: reviewModels.getCandidateOpsEvidence,
      getCandidateTrustSummary: reviewModels.getCandidateTrustSummary,
      getCandidateTrustRecommendation: reviewModels.getCandidateTrustRecommendation,
      getCandidatePublishPacket: reviewModels.getCandidatePublishPacket,
      getCandidateReviewLaneLabel: reviewModels.getCandidateReviewLaneLabel,
      getCandidateOpsReason: reviewModels.getCandidateOpsReason,
      buildCandidateDecisionActions: buildCandidateDecisionActions,
      getTherapistFieldTrustSummary: getTherapistFieldTrustSummary,
      getTherapistTrustRecommendation: getTherapistTrustRecommendation,
      renderFieldTrustChips: renderFieldTrustChips,
      getVerificationLaneLabel: reviewModels.getVerificationLaneLabel,
      buildTherapistFieldConfirmationPrompt: buildTherapistFieldConfirmationPrompt,
      buildConfirmationApplyBrief: buildConfirmationApplyBrief,
      buildConfirmationApplyCsv: buildConfirmationApplyCsv,
      buildConfirmationApplySummary: buildConfirmationApplySummary,
      buildConfirmationApplyOperatorChecklist: buildConfirmationApplyOperatorChecklist,
      getPreferredFieldOrder: getPreferredFieldOrder,
      getConfirmationQueueEntry: getConfirmationQueueEntry,
      getConfirmationResponseEntry: confirmationWorkspace.getConfirmationResponseEntry,
      getReviewEntityTask: reviewerWorkspace.getReviewEntityTask,
      assignReviewWorkItem: reviewerWorkspace.assignWorkItem,
      getTherapistConfirmationAgenda: getTherapistConfirmationAgenda,
      formatFieldLabel: formatFieldLabel,
      formatStatusLabel: formatStatusLabel,
      formatDate: formatDate,
      escapeHtml: escapeHtml,
      copyText: copyText,
      updateConfirmationResponseEntry: confirmationWorkspace.updateConfirmationResponseEntry,
      clearConfirmationResponseEntry: confirmationWorkspace.clearConfirmationResponseEntry,
      updateConfirmationQueueEntry: updateConfirmationQueueEntry,
      renderStats: renderStats,
      renderImportBlockerSprint: renderImportBlockerSprint,
      renderCaliforniaPriorityConfirmationWave: renderCaliforniaPriorityConfirmationWave,
      renderConfirmationSprint: renderConfirmationSprint,
      renderConfirmationQueue: renderConfirmationQueue,
      renderOpsInbox: renderOpsInbox,
      decideTherapistCandidate: decideTherapistCandidate,
      decideTherapistOps: decideTherapistOps,
      loadData: loadData,
    });
  });
}

function renderCandidateQueue() {
  withLazyAdminModule("./admin-candidate-queue.js", function (module) {
    module.renderCandidateQueuePanel({
      root: document.getElementById("candidateQueue"),
      countEl: document.getElementById("candidateQueueCount"),
      authRequired: authRequired,
      candidates: dataMode === "sanity" ? remoteCandidates : [],
      therapists: dataMode === "sanity" ? publishedTherapists : getTherapists(),
      applications: dataMode === "sanity" ? remoteApplications : getApplications(),
      filters: candidateFilters,
      getCandidateTrustSummary: reviewModels.getCandidateTrustSummary,
      getCandidateTrustRecommendation: reviewModels.getCandidateTrustRecommendation,
      getCandidatePublishPacket: reviewModels.getCandidatePublishPacket,
      getCandidateReviewChipLabel: reviewModels.getCandidateReviewChipLabel,
      getCandidateDedupeChipLabel: reviewModels.getCandidateDedupeChipLabel,
      getSourceReferenceMeta: getSourceReferenceMeta,
      buildCandidateDecisionActions: buildCandidateDecisionActions,
      getReviewEventsForCandidate: getReviewEventsForCandidate,
      renderReviewEventSnippetHtml: renderReviewEventSnippetHtml,
      renderReviewEventTimelineHtml: renderReviewEventTimelineHtml,
      renderReviewEntityTaskHtml: reviewerWorkspace.renderReviewEntityTaskHtml,
      escapeHtml: escapeHtml,
      formatDate: formatDate,
      decideTherapistCandidate: decideTherapistCandidate,
      loadData: loadData,
    });
  });
}

function renderReviewQueue() {
  withLazyAdminModule("./admin-candidate-queue.js", function (module) {
    module.renderCandidateQueuePanel({
      mode: "review",
      root: document.getElementById("reviewQueue"),
      countEl: document.getElementById("reviewQueueCount"),
      authRequired: authRequired,
      candidates: dataMode === "sanity" ? remoteCandidates : [],
      therapists: dataMode === "sanity" ? publishedTherapists : getTherapists(),
      applications: dataMode === "sanity" ? remoteApplications : getApplications(),
      filters: reviewFilters,
      getCandidateTrustSummary: reviewModels.getCandidateTrustSummary,
      getCandidateTrustRecommendation: reviewModels.getCandidateTrustRecommendation,
      getCandidatePublishPacket: reviewModels.getCandidatePublishPacket,
      getCandidateReviewChipLabel: reviewModels.getCandidateReviewChipLabel,
      getCandidateDedupeChipLabel: reviewModels.getCandidateDedupeChipLabel,
      getSourceReferenceMeta: getSourceReferenceMeta,
      buildCandidateDecisionActions: buildCandidateDecisionActions,
      getReviewEventsForCandidate: getReviewEventsForCandidate,
      renderReviewEventSnippetHtml: renderReviewEventSnippetHtml,
      renderReviewEventTimelineHtml: renderReviewEventTimelineHtml,
      renderReviewEntityTaskHtml: reviewerWorkspace.renderReviewEntityTaskHtml,
      escapeHtml: escapeHtml,
      formatDate: formatDate,
      decideTherapistCandidate: decideTherapistCandidate,
      loadData: loadData,
    });
  });
}

function renderConciergeQueue() {
  withLazyAdminModule("./admin-concierge-queue.js", function (module) {
    module.renderConciergeQueuePanel({
      root: document.getElementById("conciergeQueue"),
      countLabel: document.getElementById("conciergeQueueCount"),
      authRequired: authRequired,
      conciergeStatusFilter: conciergeFilters.status,
      readConciergeRequests: readConciergeRequests,
      readOutreachOutcomes: readOutreachOutcomes,
      analyzeConciergePatterns: analyzeConciergePatterns,
      analyzeOutreachOutcomes: analyzeOutreachOutcomes,
      analyzeOutreachJourneys: analyzeOutreachJourneys,
      analyzePivotTiming: analyzePivotTiming,
      requestStatusOptions: REQUEST_STATUS_OPTIONS,
      therapistFollowUpOptions: THERAPIST_FOLLOW_UP_OPTIONS,
      escapeHtml: escapeHtml,
      formatDate: formatDate,
      formatStatusLabel: formatStatusLabel,
      updateConciergeRequestStatus: updateConciergeRequestStatus,
      updateConciergeShortlistStatus: updateConciergeShortlistStatus,
      renderAll: renderAll,
    });
  });
}

function formatPortalRequestType(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, function (letter) {
      return letter.toUpperCase();
    });
}

function formatReviewEventType(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, function (letter) {
      return letter.toUpperCase();
    });
}

function getReviewEventLane(item) {
  const eventType = String((item && item.event_type) || "");
  if (
    eventType.startsWith("licensure_") ||
    eventType === "therapist_review_completed" ||
    eventType === "therapist_review_deferred"
  ) {
    return "ops";
  }
  if (item && item.application_id) {
    return "application";
  }
  if (item && (item.candidate_id || item.candidate_document_id)) {
    return "candidate";
  }
  if (item && item.therapist_id) {
    return "therapist";
  }
  return "ops";
}

function getReviewEventLaneLabel(item) {
  const lane = getReviewEventLane(item);
  if (lane === "application") {
    return "Application review";
  }
  if (lane === "candidate") {
    return "Candidate queue";
  }
  if (lane === "therapist") {
    return "Therapist record";
  }
  return "Ops workflow";
}

function getReviewActivityFilterLabel(value) {
  if (value === "application") {
    return "application events";
  }
  if (value === "candidate") {
    return "candidate events";
  }
  if (value === "therapist") {
    return "therapist events";
  }
  if (value === "ops") {
    return "ops events";
  }
  return "events";
}

function getReviewEventActionLabel(item) {
  const eventType = String((item && item.event_type) || "");
  const actionMap = {
    application_approved: "Approved application",
    application_rejected: "Rejected application",
    application_requested_changes: "Requested changes",
    candidate_reviewed: "Reviewed candidate",
    candidate_archived: "Archived candidate",
    candidate_marked_duplicate: "Marked duplicate",
    candidate_merged: "Merged candidate",
    candidate_published: "Published candidate",
    candidate_follow_up_updated: "Updated candidate follow-up",
    application_follow_up_updated: "Updated application follow-up",
    therapist_live_fields_applied: "Applied live updates",
    therapist_review_completed: "Completed therapist review",
    therapist_review_deferred: "Deferred therapist review",
    licensure_refresh_deferred: "Deferred licensure refresh",
  };
  return actionMap[eventType] || formatReviewEventType(eventType) || "Review activity";
}

function getReviewEventTargetLabel(item) {
  if (item && item.application_id) {
    return "Application " + item.application_id;
  }
  if (item && item.candidate_document_id) {
    return "Candidate " + item.candidate_document_id;
  }
  if (item && item.candidate_id) {
    return "Candidate " + item.candidate_id;
  }
  if (item && item.therapist_id) {
    return "Therapist " + item.therapist_id;
  }
  if (item && item.provider_id) {
    return "Provider " + item.provider_id;
  }
  return "Review event";
}

function buildReviewEventSummary(item) {
  const fragments = [];
  if (item.actor_name) {
    fragments.push("By: " + item.actor_name);
  }
  if (item.decision) {
    fragments.push("Decision: " + item.decision);
  }
  if (item.review_status) {
    fragments.push("Status: " + item.review_status.replace(/_/g, " "));
  }
  if (item.publish_recommendation) {
    fragments.push("Recommendation: " + item.publish_recommendation.replace(/_/g, " "));
  }
  if (Array.isArray(item.changed_fields) && item.changed_fields.length) {
    fragments.push("Changed: " + item.changed_fields.slice(0, 3).join(", "));
  }
  return fragments.join(" · ");
}

function getRecentReviewEvents(limit) {
  return (Array.isArray(remoteReviewEvents) ? remoteReviewEvents : []).slice(0, limit || 12);
}

async function exportReviewActivity(format) {
  if (authRequired || dataMode !== "sanity") {
    return false;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  const suffix = reviewActivityFilter || "all";
  const text = await exportReviewEvents(format, {
    lane: reviewActivityFilter,
    limit: 500,
  });
  return downloadText(
    "review-activity-" + suffix + "-" + stamp + "." + (format === "csv" ? "csv" : "json"),
    text,
    format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8",
  );
}

async function loadReviewActivityFeed(options) {
  const config = options || {};
  if (authRequired || dataMode !== "sanity") {
    reviewActivityItems = [];
    reviewActivityNextCursor = "";
    reviewActivityLoading = false;
    return;
  }

  reviewActivityLoading = true;
  renderReviewActivity();

  try {
    const response = await fetchReviewEvents({
      lane: reviewActivityFilter,
      limit: config.limit || 12,
      before: config.reset ? "" : reviewActivityNextCursor,
    });
    const items = response && Array.isArray(response.items) ? response.items : [];
    reviewActivityItems = config.reset ? items : reviewActivityItems.concat(items);
    reviewActivityNextCursor = response && response.next_cursor ? response.next_cursor : "";
  } catch (_error) {
    if (config.reset) {
      reviewActivityItems = [];
      reviewActivityNextCursor = "";
    }
  } finally {
    reviewActivityLoading = false;
    renderReviewActivity();
  }
}

function getReviewEventsForApplication(application) {
  const applicationId = application && application.id ? application.id : "";
  const therapistId =
    application && application.published_therapist_id ? application.published_therapist_id : "";
  const providerId = application && application.provider_id ? application.provider_id : "";
  return getRecentReviewEvents(50).filter(function (item) {
    return (
      (applicationId && item.application_id === applicationId) ||
      (therapistId && item.therapist_id === therapistId) ||
      (providerId && item.provider_id === providerId)
    );
  });
}

function getReviewEventsForCandidate(candidate) {
  const candidateId = candidate && candidate.id ? candidate.id : "";
  const candidateDocumentId = candidateId;
  const providerId = candidate && candidate.provider_id ? candidate.provider_id : "";
  const therapistId =
    candidate && candidate.published_therapist_id ? candidate.published_therapist_id : "";
  return getRecentReviewEvents(50).filter(function (item) {
    return (
      (candidateId && item.candidate_id === candidateId) ||
      (candidateDocumentId && item.candidate_document_id === candidateDocumentId) ||
      (providerId && item.provider_id === providerId) ||
      (therapistId && item.therapist_id === therapistId)
    );
  });
}

function renderReviewEventSnippetHtml(events, options) {
  const items = Array.isArray(events) ? events.slice(0, 3) : [];
  if (!items.length) {
    return "";
  }

  return (
    '<div class="queue-summary" style="margin-bottom:0.35rem"><strong>Recent activity</strong></div>' +
    '<div style="margin-bottom:0.75rem">' +
    items
      .map(function (item) {
        const summary = buildReviewEventSummary(item);
        const showRationale = item.rationale && item.rationale !== item.notes;
        return (
          '<div style="display:flex;justify-content:space-between;gap:0.75rem;font-size:0.82rem;padding:0.3rem 0;border-bottom:1px solid rgba(0,0,0,0.06)">' +
          '<div style="min-width:0">' +
          '<span style="font-weight:600;color:var(--navy)">' +
          options.escapeHtml(getReviewEventActionLabel(item)) +
          "</span>" +
          '<span class="tag" style="margin-left:0.4rem;font-size:0.7rem;padding:0.1rem 0.4rem">' +
          options.escapeHtml(getReviewEventLaneLabel(item)) +
          "</span>" +
          (summary
            ? '<div style="color:var(--slate);margin-top:0.1rem">' +
              options.escapeHtml(summary) +
              "</div>"
            : "") +
          (showRationale
            ? '<div style="margin-top:0.2rem;font-size:0.78rem;color:#333">' +
              options.escapeHtml(item.rationale) +
              "</div>"
            : "") +
          "</div>" +
          '<div class="subtle" style="white-space:nowrap;font-size:0.76rem;padding-top:0.1rem">' +
          options.escapeHtml(options.formatDate(item.created_at)) +
          "</div>" +
          "</div>"
        );
      })
      .join("") +
    "</div>"
  );
}

function renderReviewEventTimelineHtml(events, options) {
  const items = Array.isArray(events) ? events : [];
  if (!items.length) {
    return "";
  }

  return (
    '<details class="review-details" style="margin-top:0.4rem"><summary class="review-details-summary">Full activity history (' +
    options.escapeHtml(String(items.length)) +
    ')</summary><div class="review-details-body" style="padding-top:0.85rem">' +
    items
      .map(function (item) {
        const summary = buildReviewEventSummary(item);
        const showRationale = item.rationale && item.rationale !== item.notes;
        return (
          '<div class="mini-card" style="padding:0.75rem 0.85rem;margin-bottom:0.65rem">' +
          '<div style="display:flex;justify-content:space-between;gap:0.75rem;align-items:flex-start">' +
          '<div style="min-width:0">' +
          '<div style="display:flex;flex-wrap:wrap;gap:0.4rem;align-items:center">' +
          '<div style="font-size:0.88rem;font-weight:700;color:var(--navy)">' +
          options.escapeHtml(getReviewEventActionLabel(item)) +
          '</div><span class="tag">' +
          options.escapeHtml(getReviewEventLaneLabel(item)) +
          "</span></div>" +
          '<div class="subtle" style="margin-top:0.15rem">' +
          options.escapeHtml(getReviewEventTargetLabel(item)) +
          "</div>" +
          (summary
            ? '<div style="margin-top:0.35rem;font-size:0.82rem;color:var(--slate)">' +
              options.escapeHtml(summary) +
              "</div>"
            : "") +
          (showRationale
            ? '<div style="margin-top:0.35rem;font-size:0.82rem;color:#333">' +
              options.escapeHtml(item.rationale) +
              "</div>"
            : "") +
          (item.notes
            ? '<div style="margin-top:0.35rem;font-size:0.82rem;color:#333">' +
              options.escapeHtml(item.notes) +
              "</div>"
            : "") +
          "</div>" +
          '<div class="subtle" style="white-space:nowrap;font-size:0.78rem">' +
          options.escapeHtml(options.formatDate(item.created_at)) +
          "</div>" +
          "</div></div>"
        );
      })
      .join("") +
    "</div></details>"
  );
}

function renderReviewActivity() {
  const root = document.getElementById("reviewActivityFeed");
  const countEl = document.getElementById("reviewActivityCount");
  const filterEl = document.getElementById("reviewActivityFilter");
  if (!root) {
    return;
  }

  if (filterEl) {
    filterEl.value = reviewActivityFilter;
  }
  renderReviewActivitySavedViews();
  renderReviewActivitySavedViewMeta();

  if (authRequired || dataMode !== "sanity") {
    if (countEl) {
      countEl.textContent = authRequired ? "Sign in to load review activity." : "Remote only";
    }
    root.innerHTML =
      '<div class="empty">Recent review activity appears here when the review API is connected.</div>';
    return;
  }

  const items = Array.isArray(reviewActivityItems) ? reviewActivityItems : [];
  if (countEl) {
    countEl.textContent = items.length
      ? items.length +
        " recent " +
        getReviewActivityFilterLabel(reviewActivityFilter) +
        (reviewActivityNextCursor ? " loaded so far" : "")
      : reviewActivityLoading
        ? "Loading review activity..."
        : "No recent events";
  }

  if (!items.length) {
    root.innerHTML =
      '<div class="empty">' +
      escapeHtml(
        reviewActivityLoading
          ? "Loading review activity..."
          : reviewActivityFilter
            ? "No review activity matches this filter yet."
            : "No review events yet. Decisions, publishes, and ops actions will appear here.",
      ) +
      "</div>";
    return;
  }

  root.innerHTML =
    items
      .map(function (item) {
        const summary = buildReviewEventSummary(item);
        const showRationale = item.rationale && item.rationale !== item.notes;
        return (
          '<div class="mini-card" style="padding:0.9rem 1rem;margin-bottom:0.75rem">' +
          '<div style="display:flex;justify-content:space-between;gap:0.75rem;align-items:flex-start">' +
          "<div>" +
          '<div style="display:flex;flex-wrap:wrap;gap:0.45rem;align-items:center">' +
          '<div style="font-weight:700;color:var(--navy)">' +
          escapeHtml(getReviewEventActionLabel(item)) +
          '</div><span class="tag">' +
          escapeHtml(getReviewEventLaneLabel(item)) +
          "</span></div>" +
          '<div class="subtle" style="margin-top:0.15rem">' +
          escapeHtml(getReviewEventTargetLabel(item)) +
          "</div>" +
          (summary
            ? '<div style="margin-top:0.45rem;font-size:0.88rem;color:var(--slate)">' +
              escapeHtml(summary) +
              "</div>"
            : "") +
          (showRationale
            ? '<div style="margin-top:0.45rem;font-size:0.84rem;color:#333">' +
              escapeHtml(item.rationale) +
              "</div>"
            : "") +
          (item.notes
            ? '<div style="margin-top:0.45rem;font-size:0.84rem;color:#333">' +
              escapeHtml(item.notes) +
              "</div>"
            : "") +
          "</div>" +
          '<div class="subtle" style="white-space:nowrap">' +
          escapeHtml(formatDate(item.created_at)) +
          "</div>" +
          "</div>" +
          "</div>"
        );
      })
      .join("") +
    (reviewActivityNextCursor || reviewActivityLoading
      ? '<div style="margin-top:0.9rem;display:flex;justify-content:center"><button class="btn-secondary" type="button" id="reviewActivityLoadMore"' +
        (reviewActivityLoading ? " disabled" : "") +
        ">" +
        escapeHtml(reviewActivityLoading ? "Loading..." : "Load more activity") +
        "</button></div>"
      : "");
}

function renderPortalRequestsQueue() {
  withLazyAdminModule("./admin-portal-requests.js", function (module) {
    module.renderPortalRequestsQueuePanel({
      authRequired: authRequired,
      dataMode: dataMode,
      remotePortalRequests: remotePortalRequests,
      portalRequestFilters: portalRequestFilters,
      escapeHtml: escapeHtml,
      formatPortalRequestType: formatPortalRequestType,
      formatDate: formatDate,
      updateTherapistPortalRequest: updateTherapistPortalRequest,
      setRemotePortalRequests: function (nextRequests) {
        remotePortalRequests = nextRequests;
      },
      renderStats: renderStats,
      renderPortalRequestsQueue: renderPortalRequestsQueue,
      setPortalRequestActionStatus: setPortalRequestActionStatus,
    });
  });
}

function renderAdminSection(label, renderFn) {
  if (typeof renderFn !== "function") {
    return;
  }
  try {
    renderFn();
  } catch (error) {
    console.error("Admin section failed to render:", label, error);
  }
}

function renderAll() {
  renderAdminSection("stats", renderStats);
  if (!authRequired) {
    var statsRoot = document.getElementById("adminStats");
    if (statsRoot && !statsRoot.innerHTML.trim()) {
      renderFallbackStats();
    }
  }
  renderAdminSection("ingestion scorecard", renderIngestionScorecard);
  renderAdminSection("ops inbox", renderOpsInbox);
  renderAdminSection("coverage intelligence", renderCoverageIntelligence);
  renderAdminSection("source performance", renderSourcePerformance);
  renderAdminSection("funnel insights", renderFunnelInsights);
  renderAdminSection("listings", renderListings);
  renderAdminSection("licensure queue", renderLicensureQueue);
  renderAdminSection("licensure sprint", renderLicensureSprint);
  renderAdminSection("deferred licensure queue", renderDeferredLicensureQueue);
  renderAdminSection("licensure activity", renderLicensureActivity);
  renderAdminSection("missing-details lane", renderImportBlockerSprint);
  renderAdminSection(
    "california priority confirmation wave",
    renderCaliforniaPriorityConfirmationWave,
  );
  renderAdminSection("confirmation sprint", renderConfirmationSprint);
  renderAdminSection("confirmation queue", renderConfirmationQueue);
  renderAdminSection("concierge queue", renderConciergeQueue);
  renderAdminSection("portal requests queue", renderPortalRequestsQueue);
  renderAdminSection("review activity", renderReviewActivity);
  renderAdminSection("add new listings", renderCandidateQueue);
  renderAdminSection("review parked listings", renderReviewQueue);
  renderAdminSection("review applications", renderApplications);
  renderAdminSection("record inspector", renderAdminRecordInspector);
}

function setAuthUiState() {
  const gate = document.getElementById("adminAuthGate");
  const app = document.getElementById("adminApp");
  const quickNav = document.getElementById("adminQuickNav");
  const authError = document.getElementById("authError");
  const usernameField = document.getElementById("adminUsername");

  if (authRequired) {
    if (typeof document !== "undefined" && document.body) {
      document.body.classList.add("auth-locked");
    }
    gate.style.display = "block";
    app.style.display = "none";
    if (quickNav) {
      quickNav.style.display = "none";
    }
    const todayRegionHidden = document.getElementById("todayRegion");
    if (todayRegionHidden) {
      todayRegionHidden.style.display = "none";
    }
    const navLogout = document.getElementById("navLogout");
    if (navLogout) navLogout.style.display = "none";
    if (authError) {
      authError.style.display = authErrorVisible ? "block" : "none";
    }
    if (usernameField) {
      if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(function () {
          usernameField.focus();
        });
      } else {
        usernameField.focus();
      }
    }
    return;
  }

  var confirmationQueueStatusFilter = document.getElementById("confirmationQueueStatusFilter");
  if (confirmationQueueStatusFilter) {
    confirmationQueueStatusFilter.value = getConfirmationQueueFilter();
    confirmationQueueStatusFilter.onchange = function () {
      setConfirmationQueueFilter(confirmationQueueStatusFilter.value);
      renderCaliforniaPriorityConfirmationWave();
      renderConfirmationQueue();
    };
  }

  gate.style.display = "none";
  app.style.display = "block";
  if (typeof document !== "undefined" && document.body) {
    document.body.classList.remove("auth-locked");
  }
  if (quickNav) {
    quickNav.style.display = "";
  }
  const todayRegion = document.getElementById("todayRegion");
  if (todayRegion) {
    todayRegion.style.display = "";
  }
  syncAdminQuickNavFromViewport();
  const navLogout = document.getElementById("navLogout");
  if (navLogout) navLogout.style.display = "inline-block";
  if (authError) {
    authError.style.display = "none";
  }
  authErrorVisible = false;
}

async function loadData() {
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.setAttribute("data-admin-boot", "loadData-start");
  }
  const generatedArtifacts = await loadGeneratedAdminArtifacts();
  applyAdminRuntimeState(generatedArtifacts);

  const reviewApiAvailable = await checkAdminReviewApiAvailability(checkReviewApiHealth);

  if (reviewApiAvailable && !getAdminSessionToken()) {
    applyAdminRuntimeState(
      createRemoteAuthRequiredState({
        ingestionAutomationHistory: generatedArtifacts.ingestionAutomationHistory,
        licensureRefreshQueue: generatedArtifacts.licensureRefreshQueue,
        profileConversionFreshnessQueue: generatedArtifacts.profileConversionFreshnessQueue,
      }),
    );
    setAuthUiState();
    renderAll();
    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.setAttribute("data-admin-boot", "rendered-auth-required");
    }
    return;
  }

  try {
    const remoteSnapshot = await loadRemoteAdminSnapshot({
      fetchTherapistApplications,
      fetchTherapistCandidates,
      fetchTherapistPortalRequests,
      fetchReviewEvents,
      fetchTherapistReviewers,
      fetchAdminSession,
      fetchPublicTherapists,
    });
    applyAdminRuntimeState(
      createRemoteSignedInState({
        remoteApplications: remoteSnapshot.applications,
        remoteCandidates: remoteSnapshot.candidates,
        remotePortalRequests: Array.isArray(remoteSnapshot.portalRequests)
          ? remoteSnapshot.portalRequests
          : [],
        remoteReviewEvents: remoteSnapshot.reviewEvents,
        reviewActivityItems: [],
        reviewActivityNextCursor: "",
        publishedTherapists: remoteSnapshot.therapists,
        ingestionAutomationHistory: generatedArtifacts.ingestionAutomationHistory,
        licensureRefreshQueue: generatedArtifacts.licensureRefreshQueue,
        deferredLicensureQueue: generatedArtifacts.deferredLicensureQueue,
        licensureActivityFeed: generatedArtifacts.licensureActivityFeed,
        profileConversionFreshnessQueue: generatedArtifacts.profileConversionFreshnessQueue,
      }),
    );
    await loadReviewActivityFeed({ reset: true, limit: 12 });
    // Clear the stale-chunk reload flag on a successful snapshot so a
    // future genuine stale-chunk situation can still prompt.
    try {
      window.sessionStorage.removeItem("bth_admin_chunk_reload_v1");
    } catch (_storageError) {
      /* noop */
    }
  } catch (error) {
    const message = error && error.message ? String(error.message) : "";
    const isStaleChunk =
      /dynamically imported module|Failed to fetch dynamically|Importing a module script failed|ChunkLoadError/i.test(
        message,
      );
    if (isStaleChunk) {
      // One-shot reload with cache-busting query param. Plain
      // location.reload() does not bypass the browser's HTML cache,
      // so on a deploy the browser can keep serving stale admin.html
      // with references to chunk files that no longer exist, causing
      // the prompt to loop on every reload. We set a session flag
      // before reloading — if the error recurs after we already
      // tried, we stop prompting and tell the reviewer to clear
      // site data manually.
      const RELOAD_FLAG = "bth_admin_chunk_reload_v1";
      let alreadyReloaded = false;
      try {
        alreadyReloaded = Boolean(window.sessionStorage.getItem(RELOAD_FLAG));
      } catch (_storageError) {
        alreadyReloaded = false;
      }

      if (!alreadyReloaded && typeof window !== "undefined" && window.confirm) {
        const reload = window.confirm(
          "Admin assets are out of date (a cached chunk is pointing at a file that no longer exists). Reload now to pick up the current build?",
        );
        if (reload) {
          try {
            window.sessionStorage.setItem(RELOAD_FLAG, "1");
          } catch (_storageError) {
            /* noop */
          }
          const url = new URL(window.location.href);
          url.searchParams.set("_cb", String(Date.now()));
          window.location.replace(url.toString());
          return;
        }
      }
      console.error(
        alreadyReloaded
          ? "Admin assets are still stale after a reload. Hard-reload (Cmd+Shift+R) or clear site data for this domain."
          : "Admin snapshot failed to load because of a stale cached chunk. Hard-reload (Cmd+Shift+R) to fix.",
        error,
      );
    }
    // Only bounce to the login gate if the server actually rejected our
    // session (401). Non-auth errors — stale chunk, network blip, Sanity
    // CDN hiccup — must not flip authRequired to true, otherwise a user
    // who just signed in successfully gets booted back to the login
    // screen with a misleading "credentials not accepted" banner.
    const status = error && typeof error.status === "number" ? error.status : 0;
    const isAuthError = status === 401;
    const hasSessionToken = Boolean(getAdminSessionToken());

    if (isAuthError || (reviewApiAvailable && !hasSessionToken)) {
      applyAdminRuntimeState(
        createRemoteAuthRequiredState({
          ingestionAutomationHistory: generatedArtifacts.ingestionAutomationHistory,
          licensureRefreshQueue: generatedArtifacts.licensureRefreshQueue,
          profileConversionFreshnessQueue: generatedArtifacts.profileConversionFreshnessQueue,
        }),
      );
    } else if (hasSessionToken) {
      // Signed in but the dashboard data load failed for a non-auth
      // reason. Keep the reviewer logged in with empty remote lists —
      // they can retry via a hard refresh without re-typing credentials.
      applyAdminRuntimeState(
        createRemoteSignedInState({
          remoteApplications: [],
          remoteCandidates: [],
          remotePortalRequests: [],
          remoteReviewEvents: [],
          remoteReviewerRoster: [],
          reviewActivityItems: [],
          reviewActivityNextCursor: "",
          publishedTherapists: [],
          ingestionAutomationHistory: generatedArtifacts.ingestionAutomationHistory,
          licensureRefreshQueue: generatedArtifacts.licensureRefreshQueue,
          deferredLicensureQueue: generatedArtifacts.deferredLicensureQueue,
          licensureActivityFeed: generatedArtifacts.licensureActivityFeed,
          profileConversionFreshnessQueue: generatedArtifacts.profileConversionFreshnessQueue,
        }),
      );
    } else {
      applyAdminRuntimeState(
        createAdminRuntimeState({
          ingestionAutomationHistory: generatedArtifacts.ingestionAutomationHistory,
          licensureRefreshQueue: generatedArtifacts.licensureRefreshQueue,
          deferredLicensureQueue: generatedArtifacts.deferredLicensureQueue,
          licensureActivityFeed: generatedArtifacts.licensureActivityFeed,
          profileConversionFreshnessQueue: generatedArtifacts.profileConversionFreshnessQueue,
        }),
      );
    }
  }

  setAuthUiState();
  renderAll();
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.setAttribute("data-admin-boot", "rendered");
  }
}

const adminPasswordField = document.getElementById("adminKey");
const adminPasswordToggle = document.getElementById("adminPasswordToggle");
const adminUsernameField = document.getElementById("adminUsername");
const adminAuthError = document.getElementById("authError");

function clearAdminAuthError() {
  if (adminAuthError) {
    adminAuthError.style.display = "none";
  }
  authErrorVisible = false;
}

if (adminPasswordToggle && adminPasswordField) {
  adminPasswordToggle.addEventListener("click", function () {
    const nextType = adminPasswordField.type === "password" ? "text" : "password";
    adminPasswordField.type = nextType;
    const isVisible = nextType === "text";
    adminPasswordToggle.textContent = isVisible ? "Hide" : "Show";
    adminPasswordToggle.setAttribute("aria-pressed", isVisible ? "true" : "false");
    adminPasswordToggle.setAttribute("aria-label", isVisible ? "Hide password" : "Show password");
    adminPasswordField.focus();
  });
}

if (adminPasswordField) {
  adminPasswordField.addEventListener("input", clearAdminAuthError);
}

if (adminUsernameField) {
  adminUsernameField.addEventListener("input", clearAdminAuthError);
}

document.getElementById("adminAuthForm").addEventListener("submit", async function (event) {
  event.preventDefault();
  const field = adminPasswordField;
  const usernameField = adminUsernameField;
  const error = adminAuthError;
  const value = field.value.trim();
  const username = usernameField.value.trim();

  if (!value) {
    error.textContent = "Enter your operator password.";
    error.style.display = "block";
    authErrorVisible = true;
    return;
  }

  try {
    const result = await signInAdmin({
      username: username,
      password: value,
    });
    setAdminSessionToken(result.sessionToken);
    authRequired = false;
    error.style.display = "none";
    authErrorVisible = false;
    await loadData();

    if (authRequired) {
      // signInAdmin just returned a valid session token. If loadData
      // still flipped us to auth-required, it's a real 401 on a
      // downstream call (token rejected by the session check). Don't
      // claim the typed credentials were wrong — the password already
      // passed the login endpoint.
      error.textContent = "Signed in, but the session was rejected. Try again.";
      error.style.display = "block";
      authErrorVisible = true;
    } else {
      field.value = "";
    }
  } catch (_error) {
    authRequired = true;
    error.textContent = "Those operator credentials were not accepted.";
    error.style.display = "block";
    authErrorVisible = true;
  }
});

document.getElementById("navLogout").addEventListener("click", async function () {
  await signOutAdmin();
  window.location.href = "admin.html";
});

document.getElementById("applicationSearch").addEventListener("input", function (event) {
  applicationFilters.q = event.target.value.trim();
  renderApplications();
});

document.getElementById("applicationStatusFilter").addEventListener("change", function (event) {
  applicationFilters.status = event.target.value;
  renderApplications();
});

document.getElementById("applicationFocusFilter").addEventListener("change", function (event) {
  applicationFilters.focus = event.target.value;
  renderApplications();
});

document.getElementById("applicationReviewGoal").addEventListener("change", function (event) {
  applicationFilters.goal = event.target.value || "balanced";
  renderApplications();
});

document.getElementById("applicationClearFilters").addEventListener("click", function () {
  applicationFilters.q = "";
  applicationFilters.status = "";
  applicationFilters.focus = "";
  applicationFilters.goal = "balanced";
  var searchInput = document.getElementById("applicationSearch");
  if (searchInput) {
    searchInput.value = "";
  }
  var statusFilter = document.getElementById("applicationStatusFilter");
  if (statusFilter) {
    statusFilter.value = "";
  }
  var focusFilter = document.getElementById("applicationFocusFilter");
  if (focusFilter) {
    focusFilter.value = "";
  }
  var goalFilter = document.getElementById("applicationReviewGoal");
  if (goalFilter) {
    goalFilter.value = "balanced";
  }
  renderApplications();
});

(function wireApplicationsFocusMode() {
  const toggleBtn = document.getElementById("applicationsFocusToggle");
  const listRoot = document.getElementById("applicationsList");
  if (!toggleBtn || !listRoot) return;

  function toggle() {
    import("./admin-triage-focus.js").then(function (mod) {
      mod.toggleFocusMode(listRoot, mod.SIGNUPS_CONFIG);
      toggleBtn.classList.toggle("is-active", listRoot.classList.contains("is-focus-mode-active"));
    });
  }

  toggleBtn.addEventListener("click", toggle);

  document.addEventListener("keydown", function (event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key !== "f" && event.key !== "F") return;
    const target = event.target;
    if (target && target.tagName) {
      const tag = target.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (target.isContentEditable) return;
    }
    const rect = listRoot.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    // Only handle F here if the candidate queue isn't currently visible, so the
    // two panels don't fight for the same shortcut.
    const candidateQueue = document.getElementById("candidateQueue");
    if (candidateQueue) {
      const cqRect = candidateQueue.getBoundingClientRect();
      const cqVisible = cqRect.width > 0 && cqRect.height > 0;
      // If both are visible in viewport, prefer the one closer to the top of the screen.
      if (cqVisible && Math.abs(cqRect.top) < Math.abs(rect.top)) {
        return;
      }
    }
    event.preventDefault();
    toggle();
  });
})();

var conciergeStatusFilterEl = document.getElementById("conciergeStatusFilter");
if (conciergeStatusFilterEl) {
  conciergeStatusFilterEl.addEventListener("change", function (event) {
    conciergeFilters.status = event.target.value || "";
    renderConciergeQueue();
  });
}

document.getElementById("portalRequestStatusFilter").addEventListener("change", function (event) {
  portalRequestFilters.status = event.target.value || "";
  renderPortalRequestsQueue();
});

document.getElementById("reviewActivityFilter").addEventListener("change", async function (event) {
  reviewActivityFilter = event.target.value || "";
  reviewActivitySavedViewId = "";
  writeReviewActivityView({
    filter: reviewActivityFilter,
  });
  syncReviewActivityDeepLink();
  await loadReviewActivityFeed({ reset: true, limit: 12 });
});

document
  .getElementById("reviewActivitySavedView")
  .addEventListener("change", async function (event) {
    var selectedId = event.target.value || "";
    if (!selectedId) {
      return;
    }
    var nextView = readReviewActivitySavedViews().find(function (item) {
      return item.id === selectedId;
    });
    if (!nextView) {
      return;
    }
    reviewActivitySavedViewId = nextView.id || "";
    reviewActivityFilter = nextView.filter || "";
    writeReviewActivityView({
      filter: reviewActivityFilter,
    });
    syncReviewActivityDeepLink();
    await loadReviewActivityFeed({ reset: true, limit: 12 });
  });

document.getElementById("reviewActivitySaveView").addEventListener("click", function () {
  var name = window.prompt("Name this review activity view:", "");
  if (!name) {
    return;
  }
  var trimmedName = name.trim();
  if (!trimmedName) {
    return;
  }
  var views = readReviewActivitySavedViews();
  var nextId = "review-view-" + Date.now();
  var nextViews = views
    .filter(function (item) {
      return item.name !== trimmedName;
    })
    .concat([
      {
        id: nextId,
        name: trimmedName,
        filter: reviewActivityFilter,
        status: "open",
        note: "",
      },
    ]);
  writeReviewActivitySavedViews(nextViews);
  reviewActivitySavedViewId = nextId;
  renderReviewActivitySavedViews();
  renderReviewActivitySavedViewMeta();
});

document.getElementById("reviewActivityCopyLink").addEventListener("click", async function () {
  try {
    await copyText(buildReviewActivityDeepLink());
  } catch (_error) {
    // Keep the panel usable even if copying fails.
  }
});

document.getElementById("reviewActivityExportJson").addEventListener("click", async function () {
  try {
    await exportReviewActivity("json");
  } catch (_error) {
    // Keep the panel usable even if export fails.
  }
});

document.getElementById("reviewActivityExportCsv").addEventListener("click", async function () {
  try {
    await exportReviewActivity("csv");
  } catch (_error) {
    // Keep the panel usable even if export fails.
  }
});

document.getElementById("reviewActivityFeed").addEventListener("click", async function (event) {
  var button = event.target.closest("#reviewActivityLoadMore");
  if (!button || reviewActivityLoading || !reviewActivityNextCursor) {
    return;
  }
  await loadReviewActivityFeed({ reset: false, limit: 12 });
});

document.getElementById("reviewActivitySavedViewMeta").addEventListener("click", function (event) {
  var activeView = getActiveReviewActivitySavedView();
  if (!activeView) {
    return;
  }

  if (event.target.closest("#reviewActivityEditViewNote")) {
    var nextNote = window.prompt("Reviewer note for this saved view:", activeView.note || "");
    if (nextNote === null) {
      return;
    }
    var updatedViews = readReviewActivitySavedViews().map(function (item) {
      if (item.id !== activeView.id) {
        return item;
      }
      return {
        ...item,
        note: String(nextNote || "").trim(),
      };
    });
    writeReviewActivitySavedViews(updatedViews);
    renderReviewActivitySavedViewMeta();
    return;
  }

  if (event.target.closest("#reviewActivityToggleResolved")) {
    var updatedViews = readReviewActivitySavedViews().map(function (item) {
      if (item.id !== activeView.id) {
        return item;
      }
      return {
        ...item,
        status: item.status === "resolved" ? "open" : "resolved",
      };
    });
    writeReviewActivitySavedViews(updatedViews);
    renderReviewActivitySavedViewMeta();
    return;
  }

  if (event.target.closest("#reviewActivityDeleteView")) {
    var shouldDelete = window.confirm("Delete this saved review activity view?");
    if (!shouldDelete) {
      return;
    }
    writeReviewActivitySavedViews(
      readReviewActivitySavedViews().filter(function (item) {
        return item.id !== activeView.id;
      }),
    );
    reviewActivitySavedViewId = "";
    renderReviewActivitySavedViews();
    renderReviewActivitySavedViewMeta();
  }
});

document.addEventListener("click", function (event) {
  var primaryActionButton = event.target.closest("[data-workflow-primary-action]");
  if (primaryActionButton) {
    event.preventDefault();
    handleWorkflowPrimaryActionClick(primaryActionButton);
    return;
  }
  var button = event.target.closest("[data-clear-workflow-focus]");
  if (!button) {
    return;
  }
  event.preventDefault();
  clearWorkflowFocusMode();
  clearWorkflowHandoffs();
  if (typeof window !== "undefined") {
    var nextUrl = window.location.pathname + window.location.search;
    window.history.replaceState({}, "", nextUrl);
  }
});

bindCandidateEditDrawer();

document.addEventListener("click", function (event) {
  var editBtn = event.target.closest("[data-edit-candidate-id]");
  if (!editBtn) return;
  var candidateId = editBtn.dataset.editCandidateId;
  var candidate = (remoteCandidates || []).find(function (c) {
    return String(c.id || c._id) === String(candidateId);
  });
  if (candidate) openCandidateEditDrawer(candidate, loadData);
});

document.addEventListener("click", function (event) {
  var editBtn = event.target.closest("[data-edit-therapist-id]");
  if (!editBtn) return;
  var therapistId = editBtn.dataset.editTherapistId;
  var therapist = (publishedTherapists || []).find(function (t) {
    return String(t.id || t._id) === String(therapistId);
  });
  if (therapist) openTherapistEditDrawer(therapist, loadData);
});

document.getElementById("candidateSearch").addEventListener("input", function (event) {
  candidateFilters.q = event.target.value.trim();
  renderCandidateQueue();
});

document.getElementById("candidateReviewStatusFilter").addEventListener("change", function (event) {
  candidateFilters.review_status = event.target.value || "";
  renderCandidateQueue();
});

document.getElementById("candidateDedupeStatusFilter").addEventListener("change", function (event) {
  candidateFilters.dedupe_status = event.target.value || "";
  renderCandidateQueue();
});

(function wireCandidateQueueFocusMode() {
  const toggleBtn = document.getElementById("candidateQueueFocusToggle");
  const queueRoot = document.getElementById("candidateQueue");
  if (!toggleBtn || !queueRoot) return;

  function toggle() {
    withLazyAdminModule("./admin-candidate-queue.js", function (module) {
      module.toggleTriageFocusMode(queueRoot);
      toggleBtn.classList.toggle("is-active", queueRoot.classList.contains("is-focus-mode-active"));
    });
  }

  toggleBtn.addEventListener("click", toggle);

  document.addEventListener("keydown", function (event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key !== "f" && event.key !== "F") return;
    const target = event.target;
    if (target && target.tagName) {
      const tag = target.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (target.isContentEditable) return;
    }
    // Only trigger when the candidate queue is actually visible on screen.
    const rect = queueRoot.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    event.preventDefault();
    toggle();
  });
})();

document.getElementById("reviewSearch").addEventListener("input", function (event) {
  reviewFilters.q = event.target.value.trim();
  renderReviewQueue();
});

document.getElementById("reviewDedupeStatusFilter").addEventListener("change", function (event) {
  reviewFilters.dedupe_status = event.target.value || "";
  renderReviewQueue();
});

if (getAdminSessionToken()) {
  authRequired = false;
}

if (typeof document !== "undefined" && document.documentElement) {
  document.documentElement.setAttribute("data-admin-boot", "listeners-bound");
}

loadData().catch(function (error) {
  console.error("Admin boot failed:", error);
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.setAttribute("data-admin-boot", "boot-failed");
    document.documentElement.setAttribute(
      "data-admin-boot-error",
      String((error && error.message) || error || "unknown-error"),
    );
  }
  renderFallbackStats();
});
