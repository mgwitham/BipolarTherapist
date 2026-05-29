import "./sentry-init.js";
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
import { escapeHtml } from "./escape-html.js";
import { showLazyLoadFailureBanner } from "./admin-lazy-load-banner.js";
import { renderAdminHome } from "./admin-home.js";
import { createAdminStore } from "./admin-store.js";
import { createControllerRegistry } from "./admin-controller-registry.js";
import reviewActivityController from "./admin-review-activity.js";

async function fetchMatchedTherapistForCandidate(candidate) {
  if (!candidate) return null;
  if (candidate.matched_therapist_id) {
    const byId = await fetchAdminTherapistById(candidate.matched_therapist_id);
    if (byId) return byId;
  }
  if (candidate.matched_therapist_slug) {
    const bySlug = await fetchAdminTherapistBySlug(candidate.matched_therapist_slug);
    if (bySlug) return bySlug;
  }
  return null;
}
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
  fetchAdminTherapistById,
  fetchAdminTherapistBySlug,
  exportReviewEvents,
  fetchAdminSession,
  fetchReviewEvents,
  fetchTherapistCandidates,
  fetchTherapistPortalRequests,
  fetchTherapistReviewers,
  getAdminSessionToken,
  fetchTherapistApplications,
  rejectTherapistApplication as rejectTherapistApplicationRemote,
  setAdminSessionToken,
  signInAdmin,
  signOutAdmin,
  updateTherapistApplication,
  updateTherapistPortalRequest,
} from "./review-api.js";
import {
  getDataFreshnessSummary,
  getTherapistMatchReadiness,
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
  summarizeProfileContactExperimentDecision,
  summarizeProfileContactOutcomeValidation,
  summarizeProfileContactSignals,
  summarizeProfileQueueProgress,
  summarizePatientJourney,
  trackFunnelEvent,
} from "./funnel-analytics.js";
import * as adminReviewActivity from "./admin-review-activity.js";
import { createAdminWorkflowNavigator } from "./admin-workflow-navigation.js";
import { getSourceReferenceMeta } from "./admin-source-reference.js";
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
import { mountEditDrawer } from "./edit-drawer-shell.js";
import { initAdminProfileSearch } from "./admin-profile-search.js";
import { bindResolveDuplicate, openResolveDuplicate } from "./admin-duplicate-resolve.js";
import { normalizeFieldReviewStates } from "../shared/therapist-domain.mjs";
import {
  formatFieldLabel,
  getFieldTrustValue,
  getFieldTrustEntries,
  getFieldTrustTier,
  getFieldTrustChipClass,
  getTherapistFieldTrustSummary,
  getTherapistFieldTrustAttentionCount,
} from "./admin-field-trust.js";
import { analyzeOutreachOutcomes } from "./admin-outreach-analysis.js";

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

// Observable store + controller registry. PR 1 of the admin.js refactor.
// Only the Licensure Activity tab is migrated, every other tab still uses
// the legacy renderXyz() + module-level let pattern. As tabs migrate, their
// data and filter state moves into the store and their `let` declarations
// below get deleted.
//
// `data.licensureActivityFeed` is the authoritative source for the migrated
// Licensure Activity controller. We dual-write the legacy `let
// licensureActivityFeed` (see applyRuntimeState) until its other readers
// are migrated in subsequent PRs.
const adminStore = createAdminStore({
  authRequired: false,
  dataMode: "local",
  data: {
    licensureActivityFeed: [],
    licensureRefreshQueue: [],
    deferredLicensureQueue: [],
    reviewActivityItems: [],
    reviewActivityNextCursor: "",
    reviewActivityLoading: false,
  },
  filters: {
    licensureActivity: "",
    licensureQueue: "",
    reviewActivity: "",
  },
});

// PR 3, declarative localStorage persistence. Source of truth is the
// store; reads on init, debounced writes on change. Legacy localStorage
// keys preserved verbatim so deployed users keep their saved filter.
adminStore.attachLocalStorage({
  "filters.reviewActivity": {
    key: "bth_review_activity_view_v1",
    deserialize(raw) {
      try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed.filter === "string" ? parsed.filter : "";
      } catch (_error) {
        return "";
      }
    },
    serialize(value) {
      return JSON.stringify({ filter: value || "" });
    },
  },
});

const adminRegistry = createControllerRegistry({
  store: adminStore,
  // loadData / copyText / formatDate are declared later as `function`s
  // but hoisted to the top of the module scope, so they're resolvable
  // here. Same for renderReviewActivitySavedViews / Meta and the
  // buildConfirmation*Options option-bag factories (PR 4).
  deps: {
    escapeHtml: escapeHtml,
    decideLicensureOps: decideLicensureOps,
    loadData: loadData,
    copyText: copyText,
    formatDate: formatDate,
    renderReviewActivitySavedViews: renderReviewActivitySavedViews,
    renderReviewActivitySavedViewMeta: renderReviewActivitySavedViewMeta,
    buildApplicationsOptions: buildApplicationsOptions,
  },
});
adminRegistry.register(
  createLazyAdminController({
    id: "licensureActivity",
    regionId: "licensureActivity",
    countElId: "licensureActivityCount",
    storeSlices: ["data.licensureActivityFeed", "filters.licensureActivity", "authRequired"],
    path: "./admin-licensure-activity.js",
  }),
);
adminRegistry.register(reviewActivityController);
adminRegistry.register(
  createLazyAdminController({
    id: "applications",
    regionId: "applicationsList",
    storeSlices: ["authRequired"],
    path: "./admin-application-review.js",
  }),
);

// Mirror the persisted filter into the legacy `let reviewActivityFilter`
// so non-controller code that reads it (deep-link builder, savedViews
// metadata, fetch payloads, etc.) keeps working without a rewrite. The
// controller reads from the store directly.
adminStore.subscribe(["filters.reviewActivity"], function () {
  reviewActivityFilter = adminStore.get("filters.reviewActivity") || "";
});

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
let licensureActivityFeed = [];
let authRequired = false;
let authErrorVisible = false;
let reviewActivityFilter = "";
let reviewActivitySavedViewId = "";
let adminWorkflowUrlParamsApplied = false;
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
const OUTREACH_OUTCOMES_KEY = "bth_outreach_outcomes_v1";
const REVIEW_ACTIVITY_SAVED_VIEWS_KEY = "bth_review_activity_saved_views_v1";
const COMMAND_PALETTE_RECENTS_KEY = "bth_admin_command_palette_recents_v1";
const COMMAND_PALETTE_FAVORITES_KEY = "bth_admin_command_palette_favorites_v1";
// Application filter state is persisted across sessions because the
// founder's daily flow involves filtering the list, clicking into a
// card to review, and returning to the list — without persistence
// the filter resets on every navigation, and the founder loses the
// context of "what queue was I working through?" The persistence
// pattern is a direct localStorage read/write rather than the
// adminStore.attachLocalStorage indirection because applicationFilters
// is captured by reference at module load by downstream callers
// (reviewModels), so we need to mutate the same object in place
// rather than re-assigning a new one on hydration.
const APPLICATION_FILTERS_STORAGE_KEY = "bth_admin_application_filters_v1";
let applicationFilters = {
  q: "",
  status: "",
  focus: "",
  goal: "balanced",
};
try {
  const raw = window.localStorage.getItem(APPLICATION_FILTERS_STORAGE_KEY);
  if (raw) {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      // In-place merge preserves the reference captured by reviewModels.
      Object.assign(applicationFilters, parsed);
    }
  }
} catch (_error) {
  // Corrupt JSON or storage disabled — fall through with defaults.
}
function persistApplicationFilters() {
  try {
    window.localStorage.setItem(
      APPLICATION_FILTERS_STORAGE_KEY,
      JSON.stringify(applicationFilters),
    );
  } catch (_error) {
    // Storage quota / private-mode — silent skip. Worst case the
    // founder loses persistence this session, not a functional break.
  }
}
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
// localStorage hydration handled by adminStore.attachLocalStorage above.
// URL ?reviewActivityLane= still wins over a persisted value, so check it
// after attach and overwrite. The store subscription above keeps the
// legacy `let reviewActivityFilter` in sync.
reviewActivityFilter = adminStore.get("filters.reviewActivity") || "";
if (typeof window !== "undefined") {
  var reviewActivityLaneParam = new URL(window.location.href).searchParams.get(
    "reviewActivityLane",
  );
  if (typeof reviewActivityLaneParam === "string") {
    adminStore.set("filters.reviewActivity", reviewActivityLaneParam);
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
  document.addEventListener("click", function (event) {
    var link = event.target.closest(".admin-mode-links a[href^='#']");
    if (!link) return;
    var targetHash = link.getAttribute("href");
    if (!targetHash || targetHash === "#") return;
    if (window.location.hash === targetHash) {
      syncWorkflowFocusFromHash();
    }
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
          // Surface the actual error reason so the founder can tell
          // a network timeout from a permission error from a Sanity
          // validation failure. The fallback "try the full card
          // controls" stays as suffix because it's still good advice
          // when the inspector itself is the broken path.
          var detail =
            (error && (error.message || error.error || error.detail)) ||
            (typeof error === "string" ? error : "");
          adminInspectorActionStatus = detail
            ? "Inspector action failed: " + detail + ". Try the full card controls."
            : "Inspector action failed. Try the full card controls.";
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
    adminStore.set("dataMode", nextState.dataMode || "local");
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
    adminStore.set("data.reviewActivityItems", nextState.reviewActivityItems || []);
  }
  if (Object.prototype.hasOwnProperty.call(nextState, "reviewActivityNextCursor")) {
    reviewActivityNextCursor = nextState.reviewActivityNextCursor;
    adminStore.set("data.reviewActivityNextCursor", nextState.reviewActivityNextCursor || "");
  }
  if (Object.prototype.hasOwnProperty.call(nextState, "reviewActivityLoading")) {
    reviewActivityLoading = nextState.reviewActivityLoading;
    adminStore.set("data.reviewActivityLoading", nextState.reviewActivityLoading === true);
  }
  if (Object.prototype.hasOwnProperty.call(nextState, "publishedTherapists")) {
    publishedTherapists = nextState.publishedTherapists;
  }
  if (Object.prototype.hasOwnProperty.call(nextState, "ingestionAutomationHistory")) {
    ingestionAutomationHistory = nextState.ingestionAutomationHistory;
  }
  if (Object.prototype.hasOwnProperty.call(nextState, "licensureRefreshQueue")) {
    licensureRefreshQueue = nextState.licensureRefreshQueue;
    adminStore.set("data.licensureRefreshQueue", nextState.licensureRefreshQueue || []);
  }
  if (Object.prototype.hasOwnProperty.call(nextState, "deferredLicensureQueue")) {
    adminStore.set("data.deferredLicensureQueue", nextState.deferredLicensureQueue || []);
  }
  if (Object.prototype.hasOwnProperty.call(nextState, "licensureActivityFeed")) {
    licensureActivityFeed = nextState.licensureActivityFeed;
    // Mirror into the controller store so migrated controllers re-render.
    // Other (still-unmigrated) tabs read the local `let` directly.
    adminStore.set("data.licensureActivityFeed", nextState.licensureActivityFeed || []);
  }
  if (Object.prototype.hasOwnProperty.call(nextState, "authRequired")) {
    authRequired = nextState.authRequired;
    adminStore.set("authRequired", nextState.authRequired === true);
  }
}

const adminLazyModuleLoaders = import.meta.glob([
  "./admin-candidate-queue.js",
  "./admin-application-review.js",
  "./admin-portal-requests.js",
  "./admin-sourcing-intelligence.js",
  "./admin-ingestion-scorecard.js",
  "./admin-licensure-activity.js",
  "./admin-needs-attention.js",
  "./admin-funnel-insights.js",
  "./admin-unmet-demand.js",
]);

function loadAdminLazyModule(path) {
  if (!adminLazyModuleCache.has(path)) {
    const loader = adminLazyModuleLoaders[path];
    adminLazyModuleCache.set(path, loader ? loader() : import(path));
  }
  return adminLazyModuleCache.get(path);
}

function createLazyAdminController(config) {
  return {
    id: config.id,
    regionId: config.regionId,
    countElId: config.countElId,
    storeSlices: config.storeSlices || [],
    render(ctx) {
      loadAdminLazyModule(config.path)
        .then(function (module) {
          const controller = module && module.default;
          if (!controller || typeof controller.render !== "function") {
            throw new Error("Lazy controller missing default render: " + config.path);
          }
          controller.render(ctx);
        })
        .catch(function (error) {
          console.error("Failed to render lazy admin controller:", config.id, error);
          showLazyLoadFailureBanner(config.path);
        });
    },
  };
}

function getAdminPrefetchModulesForTarget(targetId) {
  var map = {
    supplyReviewRegion: ["./admin-candidate-queue.js", "./admin-application-review.js"],
    candidateQueuePanel: ["./admin-candidate-queue.js"],
    applicationsPanel: ["./admin-application-review.js"],
    requestsRegion: ["./admin-portal-requests.js"],
    intelligenceRegion: [
      "./admin-sourcing-intelligence.js",
      "./admin-ingestion-scorecard.js",
      "./admin-unmet-demand.js",
    ],
  };
  return map[targetId] || [];
}

function prefetchAdminModulesForTarget(targetId) {
  getAdminPrefetchModulesForTarget(targetId).forEach(function (path) {
    loadAdminLazyModule(path);
  });
}

function warmAdminLikelyNextModules() {
  ["./admin-candidate-queue.js", "./admin-application-review.js"].forEach(function (path) {
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
      showLazyLoadFailureBanner(path);
      if (typeof onError === "function") {
        onError(error);
      }
    });
}

// Lazy-load failure banner extracted to assets/admin-lazy-load-banner.js
// so the controller registry (admin-controller-registry.js) can import it
// without round-tripping through admin.js.

// readReviewActivityView / writeReviewActivityView were inlined here in
// PR 3, adminStore.attachLocalStorage owns reading and writing
// bth_review_activity_view_v1 now. Saved-views (the multi-view dropdown
// surface) still uses the helpers below; a later PR can fold that into
// the store if the surface keeps growing.

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

function buildConfirmationLink(slug) {
  return new URL("claim.html?confirm=" + encodeURIComponent(slug), window.location.href).toString();
}

function setPortalRequestActionStatus(root, id, message) {
  var status = root.querySelector('[data-portal-request-status-id="' + id + '"]');
  if (status) {
    status.textContent = message;
  }
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

function readOutreachOutcomes() {
  try {
    return JSON.parse(window.localStorage.getItem(OUTREACH_OUTCOMES_KEY) || "[]");
  } catch (_error) {
    return [];
  }
}

function csvEscape(value) {
  var stringValue = String(value || "");
  if (/[",\n\r]/.test(stringValue)) {
    return '"' + stringValue.replace(/"/g, '""') + '"';
  }
  return stringValue;
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
        adminInspectorActionStatus = "Claim approved from the inspector.";
      } else {
        var approveResult = await approveTherapistApplication(inspectorId);
        adminInspectorActionStatus = "Application approved for publish from the inspector.";
        if (approveResult && approveResult.email_warning) {
          adminInspectorActionStatus +=
            " Warning: approval email failed to send. Send the therapist a manual portal link.";
        }
      }
    } else if (application.submission_intent === "claim") {
      updateApplicationReviewMetadata(inspectorId, { status: "approved" });
      adminInspectorActionStatus = "Claim approved from the inspector.";
    } else {
      approveApplication(inspectorId);
      adminInspectorActionStatus = "Application approved for publish from the inspector.";
    }
  } else if (inspectorAction === "application_reject") {
    if (dataMode === "sanity") {
      var rejectResult = await rejectTherapistApplicationRemote(inspectorId);
      adminInspectorActionStatus = "Application rejected from the inspector.";
      if (rejectResult && rejectResult.email_warning) {
        adminInspectorActionStatus += " Warning: rejection email failed to send.";
      }
    } else {
      rejectApplication(inspectorId);
      adminInspectorActionStatus = "Application rejected from the inspector.";
    }
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
  if (ctx.pendingApplicationsCount) {
    parts.push(
      ctx.pendingApplicationsCount +
        " signup" +
        (ctx.pendingApplicationsCount === 1 ? "" : "s") +
        " waiting for review",
    );
  } else {
    parts.push("No signups waiting right now");
  }
  if (ctx.candidateReviewCount) {
    // Newly discovered/sourced listings live in the candidate queue (a
    // separate panel from therapist-submitted signups). Surfacing the
    // count in the header so a fresh ingestion isn't invisible.
    parts.push(
      ctx.candidateReviewCount +
        " new listing" +
        (ctx.candidateReviewCount === 1 ? "" : "s") +
        " to review",
    );
  }
  if (ctx.publishReadyApplicationsCount) {
    parts.push(
      ctx.publishReadyApplicationsCount +
        " publish-ready" +
        (ctx.publishReadyApplicationsCount === 1 ? "" : " profiles"),
    );
  }
  if (ctx.needsFixesCount) {
    parts.push(ctx.needsFixesCount + " needing fixes");
  }
  heroStatus.textContent = parts.join(" · ");
}

function inferCoverageRole(item) {
  const title = String(item.title || "").toLowerCase();
  const credentials = String(item.credentials || "").toLowerCase();
  if (item.medication_management || title.includes("psychiatrist") || credentials.includes("md")) {
    return "psychiatry";
  }
  return "therapy";
}

function renderNeedsAttention() {
  // Lazy-loaded to keep the Needs Attention queue out of admin.js's main
  // bundle, the gates module ships in shared/ already, but the rendering
  // helpers are admin-only.
  withLazyAdminModule("./admin-needs-attention.js", function (module) {
    module.renderNeedsAttentionQueue({
      therapists: dataMode === "sanity" ? publishedTherapists : getTherapists(),
      candidates: dataMode === "sanity" ? remoteCandidates : [],
    });
  });
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

function renderUnmetDemand() {
  withLazyAdminModule("./admin-unmet-demand.js", function (module) {
    module.renderUnmetDemandPanel();
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

function renderFunnelInsights() {
  withLazyAdminModule("./admin-funnel-insights.js", function (module) {
    module.renderFunnelInsightsPanel({
      authRequired: authRequired,
      funnelEvents: readFunnelEvents(),
      outreachOutcomes: readOutreachOutcomes(),
      analyzeOutreachOutcomes: analyzeOutreachOutcomes,
      rerenderSelf: renderFunnelInsights,
    });
  });
}

function renderLicensureActivity() {
  // Migrated to the controller pattern. Everything (data, filter, auth
  // gating) flows through adminStore + adminRegistry; this orchestration
  // function just kicks the registry. Kept as a function for
  // compatibility with the renderAdminSection wrapper below.
  adminRegistry.render("licensureActivity");
}

// Option-bag factory for the Confirmation Sprint panel. Closes over
// admin.js helpers and getters. PR 4: lifted out of the inline
// renderConfirmationSprint() body so the controller can call it
// idempotently via ctx.deps.buildConfirmationSprintOptions(store).
//
// FOLLOW-UP, the ~40 helpers below are exactly the "helper sprawl"
// the refactor plan flagged. A future PR can split them by category
// (pure data helpers → shared module import; closures over admin.js
// state → store-backed slices) without touching the controller shape.
// Option-bag factory for the Confirmation Queue panel. Same shape and
// rationale as buildConfirmationSprintOptions above. PR 4.
// Option-bag factory for the Applications panel. Same pattern as the
// confirmation tabs in PR 4: the ~70-prop bag closures over admin.js
// helpers and getters; the controller is a passthrough.
//
// Hot path, the publish flow runs through here. Keep this factory
// pure (no side effects); state writes happen inside the panel's
// handlers via the injected callbacks (approveApplication etc.).
function buildApplicationsOptions(store) {
  return {
    dataMode: store.get("dataMode") || "local",
    remoteApplications: remoteApplications,
    getApplications: getApplications,
    applicationFilters: applicationFilters,
    getApplicationReviewGoalMeta: reviewModels.getApplicationReviewGoalMeta,
    getApplicationReviewSnapshot: reviewModels.getApplicationReviewSnapshot,
    getGoalAdjustedApplicationPriorityScore: reviewModels.getGoalAdjustedApplicationPriorityScore,
    authRequired: store.get("authRequired") === true,
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
  };
}

function renderApplications() {
  // Migrated to the controller pattern (PR 5). The publish flow runs
  // through this panel; semantics are preserved verbatim, same
  // option-bag contents, just routed via the registry.
  adminRegistry.render("applications");
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
      fetchMatchedTherapist: fetchMatchedTherapistForCandidate,
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
      fetchMatchedTherapist: fetchMatchedTherapistForCandidate,
      loadData: loadData,
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
    adminStore.set("data.reviewActivityItems", []);
    adminStore.set("data.reviewActivityNextCursor", "");
    adminStore.set("data.reviewActivityLoading", false);
    return;
  }

  reviewActivityLoading = true;
  adminStore.set("data.reviewActivityLoading", true);

  try {
    const response = await fetchReviewEvents({
      lane: reviewActivityFilter,
      limit: config.limit || 12,
      before: config.reset ? "" : reviewActivityNextCursor,
    });
    const items = response && Array.isArray(response.items) ? response.items : [];
    reviewActivityItems = config.reset ? items : reviewActivityItems.concat(items);
    reviewActivityNextCursor = response && response.next_cursor ? response.next_cursor : "";
    adminStore.set("data.reviewActivityItems", reviewActivityItems);
    adminStore.set("data.reviewActivityNextCursor", reviewActivityNextCursor);
  } catch (_error) {
    if (config.reset) {
      reviewActivityItems = [];
      reviewActivityNextCursor = "";
      adminStore.set("data.reviewActivityItems", []);
      adminStore.set("data.reviewActivityNextCursor", "");
    }
  } finally {
    reviewActivityLoading = false;
    adminStore.set("data.reviewActivityLoading", false);
  }
}

function getReviewEventsForApplication(application) {
  return adminReviewActivity.getReviewEventsForApplication(application, getRecentReviewEvents(50));
}

function getReviewEventsForCandidate(candidate) {
  return adminReviewActivity.getReviewEventsForCandidate(candidate, getRecentReviewEvents(50));
}

const renderReviewEventSnippetHtml = adminReviewActivity.renderReviewEventSnippetHtml;
const renderReviewEventTimelineHtml = adminReviewActivity.renderReviewEventTimelineHtml;

function renderReviewActivity() {
  // Migrated to the controller pattern (PR 3).
  adminRegistry.render("reviewActivity");
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

// The dashboard's tab panels all live in the DOM at once; switching tabs is
// pure CSS show/hide (see admin-view-tabs.js), so historically renderAll()
// built every panel up front — including ~9 hidden ones, each pulling in its
// own lazy module. That made first paint wait on work for tabs the reviewer
// may never open.
//
// Now renderAll() renders only the sections in the active view synchronously,
// then renders the rest during idle time after first paint. A section's view
// group is read from the live DOM (its anchor element's nearest
// [data-view-group]) so the mapping can never drift from the markup — a wrong
// or missing anchor only changes WHEN a section renders (it falls into the
// synchronous batch), never whether it renders. On a tab switch, any of that
// view's sections not yet rendered are flushed immediately (see
// onAdminViewChange) so switching never shows an empty panel.
function getAdminRenderSections() {
  return [
    {
      label: "home dashboard",
      anchor: "adminHomeQueueList",
      render: function () {
        renderAdminHome({
          applications: remoteApplications,
          candidates: remoteCandidates,
          portalRequests: remotePortalRequests,
        });
      },
    },
    {
      label: "ingestion scorecard",
      anchor: "ingestionScorecard",
      render: renderIngestionScorecard,
    },
    {
      label: "coverage intelligence",
      anchor: "coverageIntelligence",
      render: renderCoverageIntelligence,
    },
    { label: "unmet demand", anchor: "unmetDemand", render: renderUnmetDemand },
    { label: "funnel insights", anchor: "funnelInsights", render: renderFunnelInsights },
    { label: "needs attention", anchor: "needsAttentionSection", render: renderNeedsAttention },
    { label: "licensure activity", anchor: "licensureActivity", render: renderLicensureActivity },
    {
      label: "portal requests queue",
      anchor: "portalRequestsQueue",
      render: renderPortalRequestsQueue,
    },
    { label: "review activity", anchor: "reviewActivityFeed", render: renderReviewActivity },
    { label: "add new listings", anchor: "candidateQueue", render: renderCandidateQueue },
    { label: "review parked listings", anchor: "reviewQueue", render: renderReviewQueue },
    { label: "review applications", anchor: "applicationsList", render: renderApplications },
    {
      label: "record inspector",
      anchor: "adminRecordInspectorContent",
      render: renderAdminRecordInspector,
    },
  ];
}

function getAdminViewGroupForAnchor(anchorId) {
  if (typeof document === "undefined" || !anchorId) {
    return null;
  }
  var el = document.getElementById(anchorId);
  var host = el && typeof el.closest === "function" ? el.closest("[data-view-group]") : null;
  return host ? host.getAttribute("data-view-group") : null;
}

function getActiveAdminView() {
  if (typeof document !== "undefined" && document.body) {
    return document.body.getAttribute("data-admin-view") || "home";
  }
  return "home";
}

// Sections rendered since the current renderAll() pass, plus the queue still
// waiting on idle time. Used by the tab-switch fast-path to avoid empty panels.
var adminRenderedSectionLabels = new Set();
var adminDeferredRenderQueue = [];
var adminDeferredRenderHandle = null;

function cancelAdminDeferredRender() {
  if (!adminDeferredRenderHandle) {
    return;
  }
  try {
    if (adminDeferredRenderHandle.idle && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(adminDeferredRenderHandle.id);
    } else {
      clearTimeout(adminDeferredRenderHandle.id);
    }
  } catch (_error) {
    /* noop */
  }
  adminDeferredRenderHandle = null;
}

function scheduleAdminDeferredRenderStep() {
  var schedule =
    typeof window !== "undefined" && typeof window.requestIdleCallback === "function"
      ? function (fn) {
          return { idle: true, id: window.requestIdleCallback(fn, { timeout: 1000 }) };
        }
      : function (fn) {
          return { idle: false, id: setTimeout(fn, 0) };
        };
  adminDeferredRenderHandle = schedule(function step() {
    adminDeferredRenderHandle = null;
    var section = adminDeferredRenderQueue.shift();
    if (!section) {
      return;
    }
    renderAdminSection(section.label, section.render);
    adminRenderedSectionLabels.add(section.label);
    if (adminDeferredRenderQueue.length) {
      adminDeferredRenderHandle = schedule(step);
    }
  });
}

function renderAll() {
  var activeView = getActiveAdminView();
  cancelAdminDeferredRender();
  adminRenderedSectionLabels = new Set();
  adminDeferredRenderQueue = [];

  getAdminRenderSections().forEach(function (section) {
    var group = getAdminViewGroupForAnchor(section.anchor);
    // Render the active view now; also render now anything whose group can't
    // be resolved from the DOM (defensive — never leave a section unrendered).
    if (group === null || group === activeView) {
      renderAdminSection(section.label, section.render);
      adminRenderedSectionLabels.add(section.label);
    } else {
      adminDeferredRenderQueue.push(section);
    }
  });

  if (adminDeferredRenderQueue.length) {
    scheduleAdminDeferredRenderStep();
  }
}

// Tab-switch fast-path: when the reviewer opens a view whose sections haven't
// rendered yet (still in the idle queue), flush them synchronously so the
// panel is never momentarily empty.
function onAdminViewChange(event) {
  var nextView = event && event.detail ? event.detail.view : getActiveAdminView();
  if (!adminDeferredRenderQueue.length) {
    return;
  }
  var remaining = [];
  adminDeferredRenderQueue.forEach(function (section) {
    var group = getAdminViewGroupForAnchor(section.anchor);
    if (group === nextView) {
      renderAdminSection(section.label, section.render);
      adminRenderedSectionLabels.add(section.label);
    } else {
      remaining.push(section);
    }
  });
  adminDeferredRenderQueue = remaining;
}

if (typeof document !== "undefined") {
  document.addEventListener("admin:view-change", onAdminViewChange);
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
    const navLogout = document.getElementById("navLogout");
    if (navLogout) navLogout.style.display = "none";
    const navOutreach = document.getElementById("navOutreach");
    if (navOutreach) navOutreach.style.display = "none";
    if (authError) {
      authError.style.display = authErrorVisible ? "block" : "none";
    }
    updateHeroStatus({
      priorityCount: 0,
      candidateReviewCount: 0,
      pendingApplicationsCount: 0,
    });
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

  gate.style.display = "none";
  app.style.display = "block";
  if (typeof document !== "undefined" && document.body) {
    document.body.classList.remove("auth-locked");
  }
  if (quickNav) {
    quickNav.style.display = "";
  }
  syncAdminQuickNavFromViewport();
  const navLogout = document.getElementById("navLogout");
  if (navLogout) navLogout.style.display = "inline-block";
  const navOutreach = document.getElementById("navOutreach");
  if (navOutreach) navOutreach.style.display = "inline-block";
  if (authError) {
    authError.style.display = "none";
  }
  authErrorVisible = false;
  trackFunnelEvent("admin_review_view_loaded", {
    mode: document.body.getAttribute("data-admin-view") || "review",
  });
}

async function loadData() {
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.setAttribute("data-admin-boot", "loadData-start");
  }
  // Kick off the static generated-artifact fetches without awaiting them
  // here. They feed the reports/portal tabs (not the home dashboard), so
  // overlapping them with the health check + main snapshot — rather than
  // running serially before both — keeps them off the first-paint path.
  const generatedArtifactsPromise = loadGeneratedAdminArtifacts();
  let signedInSnapshotLoaded = false;

  const reviewApiAvailable = await checkAdminReviewApiAvailability(checkReviewApiHealth);

  if (reviewApiAvailable && !getAdminSessionToken()) {
    const generatedArtifacts = await generatedArtifactsPromise;
    // Seed all five artifact fields first; createRemoteAuthRequiredState
    // re-supplies only three, and applyAdminRuntimeState merges per-key.
    applyAdminRuntimeState(generatedArtifacts);
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
    // Artifacts were fetched in parallel with the snapshot above; this
    // await resolves immediately if they finished first.
    const generatedArtifacts = await generatedArtifactsPromise;
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
    // Review-activity feed is loaded after first paint (see end of
    // loadData) so it no longer blocks the dashboard from rendering.
    signedInSnapshotLoaded = true;
    // Clear the stale-chunk reload flag on a successful snapshot so a
    // future genuine stale-chunk situation can still prompt.
    try {
      window.sessionStorage.removeItem("bth_admin_chunk_reload_v1");
    } catch (_storageError) {
      /* noop */
    }
  } catch (error) {
    // Seed artifact state before the branch-specific applies below; some
    // branches re-supply only three of the five artifact fields and rely
    // on this merge for the rest (matches the original pre-try ordering).
    const generatedArtifacts = await generatedArtifactsPromise;
    applyAdminRuntimeState(generatedArtifacts);
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
      // before reloading, if the error recurs after we already
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
    // session (401). Non-auth errors, stale chunk, network blip, Sanity
    // CDN hiccup, must not flip authRequired to true, otherwise a user
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
      // reason. Keep the reviewer logged in with empty remote lists,
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

  // Load the review-activity feed after the dashboard has painted. It only
  // feeds the (initially hidden) Review Activity tab, so blocking first
  // paint on it was wasted latency. Re-render just that section when it
  // arrives. Only meaningful on the signed-in path; loadReviewActivityFeed
  // no-ops in auth-required / non-sanity modes.
  if (signedInSnapshotLoaded) {
    loadReviewActivityFeed({ reset: true, limit: 12 })
      .then(function () {
        renderAdminSection("review activity", renderReviewActivity);
      })
      .catch(function () {
        /* feed failure is non-fatal; the section stays in its empty state */
      });
  }
}

const adminPasswordField = document.getElementById("adminPassword");
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
    trackFunnelEvent("admin_login_attempt", {
      has_username: Boolean(username),
    });
    const result = await signInAdmin({
      username: username,
      password: value,
    });
    trackFunnelEvent("admin_login_success", {
      has_username: Boolean(username),
    });
    setAdminSessionToken(result && result.ok ? "cookie" : "");
    authRequired = false;
    error.style.display = "none";
    authErrorVisible = false;
    await loadData();

    if (authRequired) {
      // signInAdmin just returned a valid session token. If loadData
      // still flipped us to auth-required, it's a real 401 on a
      // downstream call (token rejected by the session check). Don't
      // claim the typed credentials were wrong, the password already
      // passed the login endpoint.
      error.textContent = "Signed in, but the session was rejected. Try again.";
      error.style.display = "block";
      authErrorVisible = true;
    } else {
      field.value = "";
    }
  } catch (_error) {
    authRequired = true;
    trackFunnelEvent("admin_login_failure", {
      has_username: Boolean(username),
    });
    error.textContent = "Those operator credentials were not accepted.";
    error.style.display = "block";
    authErrorVisible = true;
  }
});

document.getElementById("navLogout").addEventListener("click", async function () {
  await signOutAdmin();
  window.location.href = "/admin";
});

var applicationSearchEl = document.getElementById("applicationSearch");
if (applicationSearchEl) {
  // Restore persisted value on first paint so the input visibly
  // reflects the active filter that was already applied by hydration.
  if (applicationFilters.q) applicationSearchEl.value = applicationFilters.q;
  applicationSearchEl.addEventListener("input", function (event) {
    applicationFilters.q = event.target.value.trim();
    persistApplicationFilters();
    trackFunnelEvent("admin_review_filter_changed", {
      filter: "search",
      value_present: Boolean(applicationFilters.q),
    });
    renderApplications();
  });
}

var applicationStatusFilterEl = document.getElementById("applicationStatusFilter");
if (applicationStatusFilterEl) {
  if (applicationFilters.status) applicationStatusFilterEl.value = applicationFilters.status;
  applicationStatusFilterEl.addEventListener("change", function (event) {
    applicationFilters.status = event.target.value;
    applicationFilters.focus = event.target.value === "on_hold" ? "active_review" : "";
    persistApplicationFilters();
    trackFunnelEvent("admin_review_filter_changed", {
      filter: "status",
      value: applicationFilters.status || "all",
    });
    renderApplications();
  });
}

var applicationFocusFilterEl = document.getElementById("applicationFocusFilter");
if (applicationFocusFilterEl) {
  if (applicationFilters.focus) applicationFocusFilterEl.value = applicationFilters.focus;
  applicationFocusFilterEl.addEventListener("change", function (event) {
    applicationFilters.focus = event.target.value;
    persistApplicationFilters();
    renderApplications();
  });
}

var applicationReviewGoalEl = document.getElementById("applicationReviewGoal");
if (applicationReviewGoalEl) {
  if (applicationFilters.goal) applicationReviewGoalEl.value = applicationFilters.goal;
  applicationReviewGoalEl.addEventListener("change", function (event) {
    applicationFilters.goal = event.target.value || "balanced";
    persistApplicationFilters();
    renderApplications();
  });
}

var applicationClearFiltersEl = document.getElementById("applicationClearFilters");
if (applicationClearFiltersEl) {
  applicationClearFiltersEl.addEventListener("click", function () {
    applicationFilters.q = "";
    applicationFilters.status = "";
    applicationFilters.focus = "";
    applicationFilters.goal = "balanced";
    persistApplicationFilters();
    var searchInput = document.getElementById("applicationSearch");
    if (searchInput) {
      searchInput.value = "";
    }
    var statusFilter = document.getElementById("applicationStatusFilter");
    if (statusFilter) {
      statusFilter.value = "";
    }
    renderApplications();
  });
}

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

document.getElementById("portalRequestStatusFilter").addEventListener("change", function (event) {
  portalRequestFilters.status = event.target.value || "";
  renderPortalRequestsQueue();
});

document.getElementById("reviewActivityFilter").addEventListener("change", async function (event) {
  // Single source of truth, store.set fires the controller re-render
  // and the attachLocalStorage subscription, which persists the filter
  // to bth_review_activity_view_v1. The legacy `let reviewActivityFilter`
  // is mirrored by the subscription wired at module init.
  adminStore.set("filters.reviewActivity", event.target.value || "");
  reviewActivitySavedViewId = "";
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
    adminStore.set("filters.reviewActivity", nextView.filter || "");
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
    trackFunnelEvent("admin_export_used", {
      format: "json",
      source: "review_activity",
    });
    await exportReviewActivity("json");
  } catch (_error) {
    // Keep the panel usable even if export fails.
  }
});

document.getElementById("reviewActivityExportCsv").addEventListener("click", async function () {
  try {
    trackFunnelEvent("admin_export_used", {
      format: "csv",
      source: "review_activity",
    });
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
  var tab = event.target.closest("[data-admin-tab]");
  if (tab) {
    var nextView = tab.getAttribute("data-admin-tab") || "";
    trackFunnelEvent(
      nextView === "reports" ? "admin_report_view_opened" : "admin_review_view_opened",
      {
        view: nextView,
      },
    );
  }
  var primaryActionButton = event.target.closest("[data-workflow-primary-action]");
  if (primaryActionButton) {
    trackFunnelEvent("admin_queue_action_taken", {
      action: primaryActionButton.getAttribute("data-workflow-primary-action") || "",
    });
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

mountEditDrawer();
bindCandidateEditDrawer();
bindResolveDuplicate();

// Resolve Duplicate launcher. Wired here (not in the queue module) so the
// click handler always exists, regardless of whether the queue has been
// rendered yet. Pulls both records from the in-memory data caches and
// hands them to the modal.
document.addEventListener("click", function (event) {
  var btn = event.target.closest("[data-resolve-duplicate-therapist-id]");
  if (!btn) return;
  var therapistId = btn.dataset.resolveDuplicateTherapistId;
  var counterpartId = btn.dataset.resolveDuplicateCounterpartId;
  var counterpartKind = btn.dataset.resolveDuplicateCounterpartKind || "candidate";
  var therapist = (publishedTherapists || []).find(function (t) {
    return String(t.id || t._id) === String(therapistId);
  });
  var counterpart =
    counterpartKind === "therapist"
      ? (publishedTherapists || []).find(function (t) {
          return String(t.id || t._id) === String(counterpartId);
        })
      : (remoteCandidates || []).find(function (c) {
          return String(c.id || c._id) === String(counterpartId);
        });
  if (!therapist || !counterpart) return;
  openResolveDuplicate({
    therapist: therapist,
    counterpart: counterpart,
    counterpartKind: counterpartKind,
    onResolved: loadData,
  });
});

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
  if (therapist) {
    openTherapistEditDrawer(therapist, loadData, {
      enableDelete: true,
      onDeleted: loadData,
    });
  }
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

// Profile search, reads live data arrays via closures so results are always current.
let profileSearch = null;
profileSearch = initAdminProfileSearch({
  getCandidates: function () {
    return remoteCandidates;
  },
  getApplications: function () {
    return remoteApplications;
  },
  getTherapists: function () {
    return publishedTherapists;
  },
  onSelect: function (result) {
    function onSaved() {
      loadData();
      if (profileSearch) {
        profileSearch.showBanner("Profile updated", "success");
        profileSearch.focusInput();
      }
    }
    if (result.kind === "therapist") {
      openTherapistEditDrawer(result.record, onSaved, {
        enableDelete: true,
        onDeleted: loadData,
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (result.kind === "candidate") {
      openCandidateEditDrawer(result.record, onSaved);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      // Applications don't have a field-edit drawer; navigate to the review panel and pre-filter.
      setActiveAdminView("review");
      applicationFilters.q = result.record.name || result.record.email || "";
      persistApplicationFilters();
      var searchEl = document.getElementById("applicationSearch");
      if (searchEl) searchEl.value = applicationFilters.q;
      renderApplications();
      var panel = document.getElementById("applicationsPanel");
      if (panel)
        window.setTimeout(function () {
          panel.scrollIntoView({ behavior: "smooth" });
        }, 100);
    }
  },
});

loadData().catch(function (error) {
  console.error("Admin boot failed:", error);
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.setAttribute("data-admin-boot", "boot-failed");
    document.documentElement.setAttribute(
      "data-admin-boot-error",
      String((error && error.message) || error || "unknown-error"),
    );
  }
});
