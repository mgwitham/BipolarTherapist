import {
  approveApplication,
  getApplications,
  getStats,
  getTherapists,
  requestApplicationChanges,
  publishApplication,
  rejectApplication,
  resetDemoData,
  updateApplicationReviewMetadata,
} from "./store.js";
import { fetchPublicTherapists } from "./cms.js";
import {
  checkAdminReviewApiAvailability,
  loadGeneratedAdminArtifacts,
  loadRemoteAdminSnapshot,
} from "./admin-data.js";
import { createAdminReviewModels } from "./admin-review-models.js";
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
  updateTherapistReviewers,
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
  summarizeAdaptiveSignals,
  summarizeFunnelEvents,
} from "./funnel-analytics.js";
import { renderIngestionScorecardPanel } from "./admin-ingestion-scorecard.js";
import { renderOpsInboxPanel } from "./admin-ops-inbox.js";
import { renderCandidateQueuePanel } from "./admin-candidate-queue.js";
import { renderApplicationsPanel } from "./admin-application-review.js";
import { renderPortalRequestsQueuePanel } from "./admin-portal-requests.js";
import { renderRefreshQueuePanel } from "./admin-refresh-queue.js";
import { renderLicensureQueuePanel } from "./admin-licensure-queue.js";
import { renderLicensureSprintPanel } from "./admin-licensure-sprint.js";
import { renderDeferredLicensureQueuePanel } from "./admin-licensure-deferred-queue.js";
import { renderLicensureActivityPanel } from "./admin-licensure-activity.js";
import { renderImportBlockerSprintPanel } from "./admin-import-blocker-sprint.js";
import { renderConfirmationSprintPanel } from "./admin-confirmation-sprint.js";
import { renderConfirmationQueuePanel } from "./admin-confirmation-queue.js";
import { renderConciergeQueuePanel } from "./admin-concierge-queue.js";
import { createListingsWorkspace } from "./admin-listings-workspace.js";
import {
  createAdminRuntimeState,
  createRemoteAuthRequiredState,
  createRemoteSignedInState,
} from "./admin-state.js";
import {
  buildCoverageInsights,
  renderCoverageIntelligencePanel,
  renderSourcePerformancePanel,
} from "./admin-sourcing-intelligence.js";

let dataMode = "local";
let remoteApplications = [];
let remoteCandidates = [];
let remotePortalRequests = [];
let remoteReviewEvents = [];
let remoteReviewerRoster = [];
let reviewActivityItems = [];
let reviewActivityNextCursor = "";
let reviewActivityLoading = false;
let publishedTherapists = [];
let applicationLiveApplySummaries = {};
let ingestionAutomationHistory = [];
let licensureRefreshQueue = [];
let deferredLicensureQueue = [];
let licensureActivityFeed = [];
let authRequired = false;
let licensureQueueFilter = "";
let licensureActivityFilter = "";
let confirmationQueueFilter = "";
let reviewActivityFilter = "";
let reviewActivitySavedViewId = "";
const reviewerWorkspaceUi = {
  workloadFilter: "",
  workloadSlice: "all",
  myQueueMode: false,
};
let conciergeFilters = {
  status: "",
};
let portalRequestFilters = {
  status: "",
};
const CONCIERGE_REQUESTS_KEY = "bth_concierge_requests_v1";
const OUTREACH_OUTCOMES_KEY = "bth_outreach_outcomes_v1";
const CONFIRMATION_QUEUE_KEY = "bth_confirmation_queue_v1";
const CONFIRMATION_RESPONSE_VALUES_KEY = "bth_confirmation_response_values_v1";
const CONFIRMATION_RESPONSE_FIELDS = [
  "bipolarYearsExperience",
  "estimatedWaitTime",
  "insuranceAccepted",
  "yearsExperience",
  "telehealthStates",
];
const REVIEW_ACTIVITY_VIEW_KEY = "bth_review_activity_view_v1";
const REVIEW_ACTIVITY_SAVED_VIEWS_KEY = "bth_review_activity_saved_views_v1";
const CONFIRMATION_RESPONSE_ITEM_FIELD_MAP = {
  bipolarYearsExperience: ["bipolarYearsExperience", "bipolar_years_experience"],
  estimatedWaitTime: ["estimatedWaitTime", "estimated_wait_time"],
  insuranceAccepted: ["insuranceAccepted", "insurance_accepted"],
  yearsExperience: ["yearsExperience", "years_experience"],
  telehealthStates: ["telehealthStates", "telehealth_states"],
};
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
const CALIFORNIA_PRIORITY_CONFIRMATION_SLUGS = [
  "maya-smolarek-pasadena-ca",
  "dr-stacia-mills-pasadena-ca",
  "dr-sylvia-cartwright-la-jolla-ca",
  "dr-je-ko-los-angeles-ca",
  "dr-daniel-kaushansky-los-angeles-ca",
];
const CALIFORNIA_PRIORITY_CONFIRMATION_META = {
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
};
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
const reviewerWorkspace = createReviewerWorkspace({
  applicationFilters: applicationFilters,
  candidateFilters: candidateFilters,
  escapeHtml: escapeHtml,
  formatDate: formatDate,
  getAdminActorId: getAdminActorId,
  getAdminActorName: getAdminActorName,
  getApplications: getApplications,
  getRuntimeState: function () {
    return {
      authRequired: authRequired,
      dataMode: dataMode,
      remoteApplications: remoteApplications,
      remoteCandidates: remoteCandidates,
      remoteReviewerRoster: remoteReviewerRoster,
    };
  },
  loadData: loadData,
  renderApplications: function () {
    renderApplications();
  },
  renderCandidateQueue: function () {
    renderCandidateQueue();
  },
  setRemoteReviewerRoster: function (nextRoster) {
    remoteReviewerRoster = nextRoster;
  },
  uiState: reviewerWorkspaceUi,
  updateTherapistApplication: updateTherapistApplication,
  updateTherapistCandidate: updateTherapistCandidate,
  updateTherapistReviewers: updateTherapistReviewers,
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
const listingsWorkspace = createListingsWorkspace({
  copyText: copyText,
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
  getTherapists: getTherapists,
  homepageFeaturedFallbackSlugs: [
    "dr-stacia-mills-pasadena-ca",
    "dr-sylvia-cartwright-la-jolla-ca",
    "dr-kalen-flynn-los-angeles-ca",
    "dr-mike-mah-los-angeles-ca",
    "dr-daniel-kaushansky-los-angeles-ca",
    "dr-je-ko-los-angeles-ca",
  ],
  launchProfileControlsKey: "bth_launch_profile_controls_v1",
  launchStateOptions: ["standard", "launch_ready", "featured"],
  readFunnelEvents: readFunnelEvents,
  spotlightSection: spotlightSection,
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
var savedReviewerPreference = reviewerWorkspace.getSavedPreference();
if (savedReviewerPreference && typeof savedReviewerPreference.my_queue_mode === "boolean") {
  reviewerWorkspaceUi.myQueueMode = savedReviewerPreference.my_queue_mode;
}

function spotlightSection(target) {
  if (!target) {
    return;
  }
  target.classList.add("section-spotlight");
  window.setTimeout(function () {
    target.classList.remove("section-spotlight");
  }, 1800);
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
  if (Object.prototype.hasOwnProperty.call(nextState, "remoteReviewerRoster")) {
    remoteReviewerRoster = nextState.remoteReviewerRoster;
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
  if (Object.prototype.hasOwnProperty.call(nextState, "authRequired")) {
    authRequired = nextState.authRequired;
  }
}

function buildPassiveStatCard(value, label, meta) {
  return (
    '<div class="stat-card is-passive"><div class="stat-value">' +
    escapeHtml(value) +
    '</div><div class="stat-label">' +
    escapeHtml(label) +
    "</div>" +
    (meta ? '<div class="stat-meta">' + escapeHtml(meta) + "</div>" : "") +
    "</div>"
  );
}

function buildActionStatCard(value, label, targetId, options) {
  var config = options || {};
  var attrs = [
    'type="button"',
    'class="stat-card is-actionable"',
    'data-admin-scroll-target="' + escapeHtml(targetId) + '"',
    'style="text-align:left;cursor:pointer"',
  ];
  if (config.confirmationFilter !== undefined) {
    attrs.push('data-admin-confirmation-filter="' + escapeHtml(config.confirmationFilter) + '"');
  }
  if (config.applicationStatus !== undefined) {
    attrs.push('data-admin-application-status="' + escapeHtml(config.applicationStatus) + '"');
  }
  if (config.conciergeStatus !== undefined) {
    attrs.push('data-admin-concierge-status="' + escapeHtml(config.conciergeStatus) + '"');
  }
  if (config.portalRequestStatus !== undefined) {
    attrs.push('data-admin-portal-request-status="' + escapeHtml(config.portalRequestStatus) + '"');
  }

  return (
    "<button " +
    attrs.join(" ") +
    '><div class="stat-value">' +
    escapeHtml(value) +
    '</div><div class="stat-label">' +
    escapeHtml(label) +
    "</div>" +
    (config.meta ? '<div class="stat-meta">' + escapeHtml(config.meta) + "</div>" : "") +
    '<div class="stat-action-note">' +
    escapeHtml(config.actionLabel || "Open workflow") +
    "</div></button>"
  );
}

function wrapStatsGroup(title, cards, extraClass) {
  return (
    '<div class="stats-group"><div class="stats-group-title">' +
    escapeHtml(title) +
    '</div><div class="stats-grid' +
    (extraClass ? " " + escapeHtml(extraClass) : "") +
    '">' +
    cards.join("") +
    "</div></div>"
  );
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
      : '<div style="margin-top:0.7rem;font-size:0.84rem;color:var(--muted)">No reviewer note yet.</div>') +
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
  var readyRows = buildConfirmationApplyCsvRows(rows);
  if (!readyRows.length) {
    return "";
  }

  var lines = [
    heading || "# Confirmation Apply Summary",
    "",
    "Therapist-confirmed values captured in admin and ready to apply back into live profiles.",
    "",
  ];

  readyRows.forEach(function (row) {
    var orderedFields = getPreferredFieldOrder(
      (row.agenda && row.agenda.unknown_fields) || [],
      row.primaryAskField || row.primary_ask_field || "",
    );
    var response = getConfirmationResponseEntry(row.item.slug);
    var confirmedLines = orderedFields
      .filter(function (field) {
        return response[field];
      })
      .map(function (field) {
        return "- " + formatFieldLabel(field) + ": " + response[field];
      });

    lines.push("## " + row.item.name);
    lines.push("");
    lines.push("- Slug: " + row.item.slug);
    lines.push("- Status: " + formatStatusLabel(row.workflow.status));
    if (row.workflow.last_updated_at) {
      lines.push("- Confirmed in admin: " + formatDate(row.workflow.last_updated_at));
    }
    if (confirmedLines.length) {
      lines.push("- Captured values:");
      confirmedLines.forEach(function (line) {
        lines.push("  " + line);
      });
    } else {
      lines.push("- Captured values: none entered yet");
    }
    lines.push(
      "- Profile URL: " +
        new URL(
          "therapist.html?slug=" + encodeURIComponent(row.item.slug),
          window.location.href,
        ).toString(),
    );
    lines.push("");
  });

  return lines.join("\n");
}

function buildConfirmationApplyOperatorChecklist(rows, heading) {
  var readyRows = buildConfirmationApplyCsvRows(rows);
  if (!readyRows.length) {
    return "";
  }

  return [
    heading || "# Confirmation Apply Operator Checklist",
    "",
    "Use this when therapist-confirmed values are ready to move from admin into the import CSV.",
    "",
    "Files involved:",
    "- data/import/california-priority-confirmation-responses.csv",
    "- data/import/therapists.csv",
    "",
    "Steps:",
    "1. Copy the apply CSV from admin and paste the confirmed values into data/import/california-priority-confirmation-responses.csv.",
    "2. Optionally copy the apply summary too so the human context stays with the values.",
    "3. Run: npm run cms:check:confirmation-responses",
    "4. Review the printed field diffs carefully.",
    "5. Run: npm run cms:apply:confirmation-responses",
    "6. Run: npm run lint",
    "7. Run: npm run build",
    "8. If the changes should go live, run: npm run cms:import:therapists",
    "",
    "Profiles currently ready to apply:",
  ]
    .concat(
      readyRows.map(function (row) {
        return (
          "- " +
          row.item.name +
          " (" +
          row.item.slug +
          ")" +
          (row.workflow.last_updated_at
            ? " — confirmed in admin " + formatDate(row.workflow.last_updated_at)
            : "")
        );
      }),
    )
    .join("\n");
}

function readConfirmationResponseState() {
  try {
    return JSON.parse(window.localStorage.getItem(CONFIRMATION_RESPONSE_VALUES_KEY) || "{}");
  } catch (_error) {
    return {};
  }
}

function writeConfirmationResponseState(value) {
  try {
    window.localStorage.setItem(CONFIRMATION_RESPONSE_VALUES_KEY, JSON.stringify(value));
  } catch (_error) {
    return;
  }
}

function getConfirmationResponseEntry(slug) {
  var all = readConfirmationResponseState();
  var entry = all && slug ? all[slug] : null;
  var normalized = {
    updated_at: entry && entry.updated_at ? entry.updated_at : "",
  };
  CONFIRMATION_RESPONSE_FIELDS.forEach(function (field) {
    normalized[field] = entry && entry[field] ? String(entry[field]) : "";
  });
  return normalized;
}

function updateConfirmationResponseEntry(slug, updates) {
  if (!slug) {
    return;
  }
  var all = readConfirmationResponseState();
  var current = getConfirmationResponseEntry(slug);
  var next = {
    ...current,
    ...updates,
    updated_at: new Date().toISOString(),
  };
  all[slug] = next;
  writeConfirmationResponseState(all);
}

function clearConfirmationResponseEntry(slug) {
  if (!slug) {
    return;
  }
  var all = readConfirmationResponseState();
  delete all[slug];
  writeConfirmationResponseState(all);
}

function getConfirmationResponseCaptureFields(primaryAskField, addOnAskFields, slug) {
  var ordered = [];
  var seen = new Set();
  [primaryAskField]
    .concat(addOnAskFields || [])
    .concat(CONFIRMATION_RESPONSE_FIELDS)
    .forEach(function (field) {
      if (!field || !CONFIRMATION_RESPONSE_FIELDS.includes(field) || seen.has(field)) {
        return;
      }
      seen.add(field);
      ordered.push(field);
    });

  var stored = getConfirmationResponseEntry(slug);
  CONFIRMATION_RESPONSE_FIELDS.forEach(function (field) {
    if (stored[field] && !seen.has(field)) {
      seen.add(field);
      ordered.push(field);
    }
  });

  return ordered;
}

function getConfirmationResponseFieldPlaceholder(field) {
  if (field === "bipolarYearsExperience" || field === "yearsExperience") {
    return "e.g. 8";
  }
  if (field === "estimatedWaitTime") {
    return "e.g. 2 to 3 weeks";
  }
  if (field === "insuranceAccepted") {
    return "Use | between multiple values";
  }
  if (field === "telehealthStates") {
    return "e.g. CA|NY";
  }
  return "Enter confirmed value";
}

function getTherapistFieldCurrentValue(item, field) {
  var candidates = CONFIRMATION_RESPONSE_ITEM_FIELD_MAP[field] || [field];
  for (var index = 0; index < candidates.length; index += 1) {
    var key = candidates[index];
    var value = item ? item[key] : "";
    if (Array.isArray(value)) {
      if (value.length) {
        return value.join("|");
      }
      continue;
    }
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

function buildConfirmationApplyPreviewHtml(item, slug, primaryAskField, addOnAskFields) {
  var response = getConfirmationResponseEntry(slug);
  var fields = getConfirmationResponseCaptureFields(primaryAskField, addOnAskFields, slug).filter(
    function (field) {
      return response[field];
    },
  );

  if (!fields.length) {
    return "";
  }

  return (
    '<div class="queue-summary"><strong>Apply preview:</strong> These are the field-level changes that would flow into the next apply CSV export.</div><div class="queue-shortlist">' +
    fields
      .map(function (field) {
        var currentValue = getTherapistFieldCurrentValue(item, field) || "Not set";
        return (
          '<div class="queue-shortlist-item"><strong>' +
          escapeHtml(formatFieldLabel(field)) +
          ":</strong> " +
          escapeHtml(currentValue) +
          " → " +
          escapeHtml(response[field]) +
          "</div>"
        );
      })
      .join("") +
    "</div>"
  );
}

function buildConfirmationResponseCaptureHtml(slug, primaryAskField, addOnAskFields) {
  var response = getConfirmationResponseEntry(slug);
  var fields = getConfirmationResponseCaptureFields(primaryAskField, addOnAskFields, slug);

  return (
    '<div class="queue-summary"><strong>Captured response values:</strong> Save therapist-confirmed answers here so apply CSV exports can prefill them.' +
    (response.updated_at
      ? " Last updated " + escapeHtml(formatDate(response.updated_at)) + "."
      : "") +
    '</div><div class="queue-shortlist" data-confirmation-response-form="' +
    escapeHtml(slug) +
    '">' +
    fields
      .map(function (field) {
        return (
          '<label class="queue-select-label" for="confirmation-response-' +
          escapeHtml(slug) +
          "-" +
          escapeHtml(field) +
          '">' +
          escapeHtml(formatFieldLabel(field)) +
          '</label><input class="queue-select" id="confirmation-response-' +
          escapeHtml(slug) +
          "-" +
          escapeHtml(field) +
          '" data-confirmation-response-field="' +
          escapeHtml(field) +
          '" value="' +
          escapeHtml(response[field] || "") +
          '" placeholder="' +
          escapeHtml(getConfirmationResponseFieldPlaceholder(field)) +
          '" />'
        );
      })
      .join("") +
    '</div><div class="queue-actions"><button class="btn-secondary" data-confirmation-response-save="' +
    escapeHtml(slug) +
    '">Save confirmed values</button><button class="btn-secondary" data-confirmation-response-clear="' +
    escapeHtml(slug) +
    '">Clear confirmed values</button></div>'
  );
}

function buildConfirmationApplyCsvRows(rows) {
  return (rows || []).filter(function (row) {
    var status = row && row.workflow ? row.workflow.status : "not_started";
    return status === "confirmed" || status === "applied";
  });
}

function buildConfirmationApplyCsv(rows) {
  var readyRows = buildConfirmationApplyCsvRows(rows);
  var headers = [
    "slug",
    "confirmedAt",
    "bipolarYearsExperience",
    "estimatedWaitTime",
    "insuranceAccepted",
    "yearsExperience",
    "telehealthStates",
  ];
  var lines = [headers.join(",")];

  readyRows.forEach(function (row) {
    var response = getConfirmationResponseEntry(row.item.slug);
    lines.push(
      [
        row.item.slug,
        row.workflow && row.workflow.last_updated_at
          ? new Date(row.workflow.last_updated_at).toISOString().slice(0, 10)
          : "",
        response.bipolarYearsExperience || "",
        response.estimatedWaitTime || "",
        response.insuranceAccepted || "",
        response.yearsExperience || "",
        response.telehealthStates || "",
      ]
        .map(csvEscape)
        .join(","),
    );
  });

  return lines.join("\n");
}

function buildConfirmationLink(slug) {
  return new URL(
    "signup.html?confirm=" + encodeURIComponent(slug),
    window.location.href,
  ).toString();
}

function setConfirmationActionStatus(root, id, message) {
  var status = root.querySelector('[data-confirmation-status-id="' + id + '"]');
  if (status) {
    status.textContent = message;
  }
}

function setPortalRequestActionStatus(root, id, message) {
  var status = root.querySelector('[data-portal-request-status-id="' + id + '"]');
  if (status) {
    status.textContent = message;
  }
}

function bindConfirmationResponseCapture(root) {
  if (!root) {
    return;
  }

  root.querySelectorAll("[data-confirmation-response-save]").forEach(function (button) {
    button.addEventListener("click", function () {
      var slug = button.getAttribute("data-confirmation-response-save");
      var form = root.querySelector('[data-confirmation-response-form="' + slug + '"]');
      if (!slug || !form) {
        return;
      }

      var values = {};
      form.querySelectorAll("[data-confirmation-response-field]").forEach(function (input) {
        var field = input.getAttribute("data-confirmation-response-field");
        if (!field) {
          return;
        }
        values[field] = String(input.value || "").trim();
      });

      updateConfirmationResponseEntry(slug, values);
      renderCaliforniaPriorityConfirmationWave();
      renderConfirmationSprint();
      renderConfirmationQueue();
    });
  });

  root.querySelectorAll("[data-confirmation-response-clear]").forEach(function (button) {
    button.addEventListener("click", function () {
      var slug = button.getAttribute("data-confirmation-response-clear");
      if (!slug) {
        return;
      }
      clearConfirmationResponseEntry(slug);
      renderCaliforniaPriorityConfirmationWave();
      renderConfirmationSprint();
      renderConfirmationQueue();
    });
  });
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
  try {
    return JSON.parse(window.localStorage.getItem(CONFIRMATION_QUEUE_KEY) || "{}");
  } catch (_error) {
    return {};
  }
}

function writeConfirmationQueueState(value) {
  try {
    window.localStorage.setItem(CONFIRMATION_QUEUE_KEY, JSON.stringify(value));
  } catch (_error) {
    return;
  }
}

function getConfirmationQueueEntry(slug) {
  var all = readConfirmationQueueState();
  var entry = all && slug ? all[slug] : null;
  return {
    status:
      entry && CONFIRMATION_STATUS_OPTIONS.includes(entry.status) ? entry.status : "not_started",
    last_sent_at: entry && entry.last_sent_at ? entry.last_sent_at : "",
    last_updated_at: entry && entry.last_updated_at ? entry.last_updated_at : "",
    confirmation_applied_at:
      entry && entry.confirmation_applied_at ? entry.confirmation_applied_at : "",
  };
}

function updateConfirmationQueueEntry(slug, updates) {
  if (!slug) {
    return;
  }
  var all = readConfirmationQueueState();
  var current = getConfirmationQueueEntry(slug);
  var next = {
    ...current,
    ...updates,
    last_updated_at: new Date().toISOString(),
  };
  all[slug] = next;
  writeConfirmationQueueState(all);
}

function getPublishedTherapistConfirmationQueue() {
  var therapists = dataMode === "sanity" ? publishedTherapists : getTherapists();
  return therapists
    .map(function (item) {
      var workflow = getConfirmationQueueEntry(item.slug);
      return {
        item: {
          ...item,
          confirmation_applied_at: workflow.confirmation_applied_at,
        },
        agenda: getTherapistConfirmationAgenda(item),
        workflow: workflow,
      };
    })
    .filter(function (entry) {
      return entry.agenda.needs_confirmation;
    })
    .sort(function (a, b) {
      var statusWeight = {
        not_started: 0,
        sent: 1,
        waiting_on_therapist: 2,
        confirmed: 3,
        applied: 4,
      };
      var statusDiff =
        (statusWeight[a.workflow.status] || 9) - (statusWeight[b.workflow.status] || 9);
      if (statusDiff) {
        return statusDiff;
      }
      var weight = { high: 0, medium: 1, low: 2 };
      var priorityDiff = (weight[a.agenda.priority] || 9) - (weight[b.agenda.priority] || 9);
      if (priorityDiff) {
        return priorityDiff;
      }
      return b.agenda.unknown_fields.length - a.agenda.unknown_fields.length;
    });
}

function getCaliforniaPriorityConfirmationQueue() {
  var queue = getPublishedTherapistConfirmationQueue();
  return CALIFORNIA_PRIORITY_CONFIRMATION_SLUGS.map(function (slug) {
    return queue.find(function (entry) {
      return entry.item && entry.item.slug === slug;
    });
  }).filter(Boolean);
}

function getCaliforniaPriorityConfirmationRows() {
  return getCaliforniaPriorityConfirmationQueue().map(function (entry, index) {
    var item = entry.item;
    var agenda = entry.agenda;
    var workflow = getConfirmationQueueEntry(item.slug);
    var meta = CALIFORNIA_PRIORITY_CONFIRMATION_META[item.slug] || {};
    var orderedUnknownFields = getPreferredFieldOrder(agenda.unknown_fields || []);
    return {
      priority_rank: index + 1,
      item: item,
      agenda: agenda,
      workflow: workflow,
      primaryAskField: orderedUnknownFields[0] || "",
      addOnAskFields: orderedUnknownFields.slice(1),
      firstAction: meta.first_action || "Use the preferred contact path first.",
      followUpRule:
        meta.follow_up_rule ||
        "Follow up once if needed, then leave the field unchanged until confirmed.",
      followUpBusinessDays: Number(meta.follow_up_business_days) || 0,
    };
  });
}

function addBusinessDays(startDate, businessDays) {
  if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime()) || businessDays <= 0) {
    return null;
  }
  var next = new Date(startDate.getTime());
  var remaining = businessDays;
  while (remaining > 0) {
    next.setDate(next.getDate() + 1);
    var day = next.getDay();
    if (day !== 0 && day !== 6) {
      remaining -= 1;
    }
  }
  return next;
}

function getCaliforniaPriorityFollowUpNote(row) {
  if (!row || !row.workflow) {
    return "";
  }
  var status = row.workflow.status;
  if (status !== "sent" && status !== "waiting_on_therapist") {
    return "";
  }
  if (!row.followUpBusinessDays || !row.workflow.last_sent_at) {
    return "Follow-up timing starts once the request is sent.";
  }
  var sentAt = new Date(row.workflow.last_sent_at);
  if (Number.isNaN(sentAt.getTime())) {
    return "Follow-up timing is not available yet.";
  }
  var dueDate = addBusinessDays(sentAt, row.followUpBusinessDays);
  if (!dueDate) {
    return "Follow-up timing is not available yet.";
  }
  var now = new Date();
  var msPerDay = 24 * 60 * 60 * 1000;
  var daysUntilDue = Math.ceil((dueDate.getTime() - now.getTime()) / msPerDay);
  if (daysUntilDue <= 0) {
    return (
      "Follow-up due now. Original outreach went out on " +
      formatDate(row.workflow.last_sent_at) +
      "."
    );
  }
  if (daysUntilDue === 1) {
    return (
      "Follow-up due within 1 day. Original outreach went out on " +
      formatDate(row.workflow.last_sent_at) +
      "."
    );
  }
  return (
    "Follow-up due in " +
    daysUntilDue +
    " days. Original outreach went out on " +
    formatDate(row.workflow.last_sent_at) +
    "."
  );
}

function getCaliforniaPriorityFollowUpSummary(rows) {
  var dueNow = 0;
  var dueSoon = 0;
  (rows || []).forEach(function (row) {
    var note = getCaliforniaPriorityFollowUpNote(row);
    if (!note) {
      return;
    }
    if (note.indexOf("Follow-up due now") === 0) {
      dueNow += 1;
      return;
    }
    if (note.indexOf("Follow-up due within 1 day") === 0) {
      dueSoon += 1;
    }
  });
  if (!dueNow && !dueSoon) {
    return "";
  }
  if (dueNow && dueSoon) {
    return (
      "Follow-up urgency: " +
      dueNow +
      " due now and " +
      dueSoon +
      " due within 1 day across the California wave."
    );
  }
  if (dueNow) {
    return (
      "Follow-up urgency: " +
      dueNow +
      " California-wave follow-up" +
      (dueNow === 1 ? " is" : "s are") +
      " due now."
    );
  }
  return (
    "Follow-up urgency: " +
    dueSoon +
    " California-wave follow-up" +
    (dueSoon === 1 ? " is" : "s are") +
    " due within 1 day."
  );
}

function getCaliforniaPriorityWaveHealth(rows) {
  var counts = { not_started: 0, sent: 0, waiting_on_therapist: 0, confirmed: 0, applied: 0 };
  (rows || []).forEach(function (row) {
    var status = row && row.workflow ? row.workflow.status : "not_started";
    if (Object.prototype.hasOwnProperty.call(counts, status)) {
      counts[status] += 1;
    }
  });
  var parts = [];
  if (counts.not_started) parts.push(counts.not_started + " not started");
  if (counts.sent) parts.push(counts.sent + " sent");
  if (counts.waiting_on_therapist) parts.push(counts.waiting_on_therapist + " waiting");
  if (counts.confirmed) parts.push(counts.confirmed + " confirmed");
  if (counts.applied) parts.push(counts.applied + " applied");
  return parts.length
    ? "Current California wave: " + parts.join(" · ") + "."
    : "Current California wave: no active work.";
}

function getCaliforniaPriorityWaveBottleneck(rows) {
  var counts = { not_started: 0, sent: 0, waiting_on_therapist: 0, confirmed: 0, applied: 0 };
  (rows || []).forEach(function (row) {
    var status = row && row.workflow ? row.workflow.status : "not_started";
    if (Object.prototype.hasOwnProperty.call(counts, status)) {
      counts[status] += 1;
    }
  });
  if (
    counts.not_started >=
    Math.max(counts.sent, counts.waiting_on_therapist, counts.confirmed, counts.applied)
  ) {
    return "Next bottleneck: the highest-value California confirmations still need first outreach.";
  }
  if (
    counts.waiting_on_therapist >=
    Math.max(counts.not_started, counts.sent, counts.confirmed, counts.applied)
  ) {
    return "Next bottleneck: this wave is mostly blocked on therapist replies.";
  }
  if (
    counts.sent >=
    Math.max(counts.not_started, counts.waiting_on_therapist, counts.confirmed, counts.applied)
  ) {
    return "Next bottleneck: requests are in flight, so follow-up discipline matters most.";
  }
  if (counts.confirmed > 0) {
    return "Next bottleneck: confirmed answers are ready to apply back into live profiles.";
  }
  if (counts.applied > 0) {
    return "Next bottleneck: move from recently applied profiles back into the next confirmation target.";
  }
  return "Next bottleneck: no active blocker yet.";
}

function getCaliforniaPrioritySharedAsk(rows) {
  var counts = {};
  (rows || []).forEach(function (row) {
    var field = row && row.primaryAskField ? row.primaryAskField : "";
    if (!field) {
      return;
    }
    if (!counts[field]) {
      counts[field] = { field: field, count: 0, rows: [] };
    }
    counts[field].count += 1;
    counts[field].rows.push(row);
  });
  return (
    Object.keys(counts)
      .map(function (key) {
        return counts[key];
      })
      .sort(function (a, b) {
        return b.count - a.count || a.field.localeCompare(b.field);
      })[0] || null
  );
}

function buildCaliforniaPriorityWavePacket(rows) {
  var lines = [
    "# California Priority Confirmation Wave",
    "",
    "Top live California confirmation targets to work first.",
    "",
  ];

  (rows || []).forEach(function (row) {
    lines.push("## " + row.priority_rank + ". " + row.item.name);
    lines.push("");
    lines.push("- Status: " + formatStatusLabel(row.workflow.status));
    lines.push("- Result: " + getConfirmationResultLabel(row.workflow.status));
    lines.push("- Target: " + getConfirmationTarget(row.item));
    lines.push("- Primary ask: " + formatFieldLabel(row.primaryAskField));
    if (row.addOnAskFields.length) {
      lines.push("- Add-on asks: " + row.addOnAskFields.map(formatFieldLabel).join(", "));
    }
    lines.push("- First action: " + row.firstAction);
    lines.push("- Follow-up rule: " + row.followUpRule);
    if (getCaliforniaPriorityFollowUpNote(row)) {
      lines.push("- Follow-up timing: " + getCaliforniaPriorityFollowUpNote(row));
    }
    lines.push("");
  });

  return lines.join("\n");
}

function buildCaliforniaPrioritySharedAskPacket(rows) {
  var sharedAsk = getCaliforniaPrioritySharedAsk(rows);
  if (!sharedAsk || !sharedAsk.rows.length) {
    return "";
  }

  var lines = [
    "# California Priority Shared Ask",
    "",
    "Best shared ask across the current California confirmation wave.",
    "",
    "Shared ask: " + formatFieldLabel(sharedAsk.field),
    "Coverage: " + sharedAsk.count + " of " + (rows || []).length + " California-wave profiles",
    "",
  ];

  sharedAsk.rows.forEach(function (row) {
    lines.push("## " + row.priority_rank + ". " + row.item.name);
    lines.push("");
    lines.push("- Status: " + formatStatusLabel(row.workflow.status));
    lines.push("- Target: " + getConfirmationTarget(row.item));
    lines.push("- Primary ask: " + formatFieldLabel(row.primaryAskField));
    if (row.addOnAskFields.length) {
      lines.push("- Add-on asks: " + row.addOnAskFields.map(formatFieldLabel).join(", "));
    }
    lines.push("- First action: " + row.firstAction);
    lines.push("- Follow-up rule: " + row.followUpRule);
    lines.push("");
  });

  return lines.join("\n");
}

function buildCaliforniaPriorityWaveTrackerCsv(rows) {
  var headers = [
    "priority_rank",
    "name",
    "slug",
    "status",
    "result",
    "target",
    "primary_ask_field",
    "add_on_ask_fields",
    "first_action",
    "follow_up_rule",
    "follow_up_timing",
    "last_action",
  ];
  var lines = [headers.join(",")];

  (rows || []).forEach(function (row) {
    lines.push(
      [
        row.priority_rank,
        row.item.name,
        row.item.slug,
        row.workflow.status,
        getConfirmationResultLabel(row.workflow.status),
        getConfirmationTarget(row.item),
        row.primaryAskField,
        row.addOnAskFields.join("|"),
        row.firstAction,
        row.followUpRule,
        getCaliforniaPriorityFollowUpNote(row),
        getConfirmationLastActionNote(row.workflow).replace(/^Last action:\s*/, ""),
      ]
        .map(csvEscape)
        .join(","),
    );
  });

  return lines.join("\n");
}

function buildCaliforniaPriorityWaveApplyPacket(rows) {
  var readyRows = (rows || []).filter(function (row) {
    var status = row && row.workflow ? row.workflow.status : "not_started";
    return status === "confirmed" || status === "applied";
  });

  if (!readyRows.length) {
    return "";
  }

  var lines = [
    "# California Priority Apply Queue",
    "",
    "Confirmed California-wave answers ready to apply back into live profiles.",
    "",
  ];

  readyRows.forEach(function (row) {
    lines.push("## " + row.priority_rank + ". " + row.item.name);
    lines.push("");
    lines.push("- Status: " + formatStatusLabel(row.workflow.status));
    lines.push("- Result: " + getConfirmationResultLabel(row.workflow.status));
    lines.push(
      "- Primary confirmed ask: " +
        (row.primaryAskField ? formatFieldLabel(row.primaryAskField) : "None"),
    );
    if (row.addOnAskFields.length) {
      lines.push("- Secondary asks: " + row.addOnAskFields.map(formatFieldLabel).join(", "));
    }
    lines.push(
      "- Ordered apply flow: " +
        [row.primaryAskField]
          .concat(row.addOnAskFields)
          .filter(Boolean)
          .map(formatFieldLabel)
          .join(" -> "),
    );
    lines.push(
      "- Last action: " +
        getConfirmationLastActionNote(row.workflow).replace(/^Last action:\s*/, ""),
    );
    lines.push(
      "- Profile URL: " +
        new URL(
          "therapist.html?slug=" + encodeURIComponent(row.item.slug),
          window.location.href,
        ).toString(),
    );
    lines.push("");
  });

  return lines.join("\n");
}

function buildCaliforniaPriorityWaveApplyCsv(rows) {
  return buildConfirmationApplyCsv(rows);
}

function renderCaliforniaPriorityConfirmationWave() {
  var root = document.getElementById("californiaPriorityConfirmationWave");
  if (!root) {
    return;
  }

  if (authRequired) {
    root.innerHTML = "";
    return;
  }

  var rows = getCaliforniaPriorityConfirmationRows();
  var readyToApplyRows = rows.filter(function (row) {
    var status = row && row.workflow ? row.workflow.status : "not_started";
    return status === "confirmed" || status === "applied";
  });
  var followUpSummary = getCaliforniaPriorityFollowUpSummary(rows);
  var sharedAsk = getCaliforniaPrioritySharedAsk(rows);
  if (!rows.length) {
    root.innerHTML =
      '<div class="subtle">No California priority confirmations are currently active.</div>';
    return;
  }

  root.innerHTML =
    '<div class="queue-summary"><strong>This is the current highest-leverage California confirmation wave.</strong></div><div class="queue-summary subtle">These profiles are visible, strategically important, and now mostly blocked on therapist-confirmed operational truth, not more source work.</div><div class="queue-summary"><strong>' +
    escapeHtml(getCaliforniaPriorityWaveHealth(rows)) +
    '</strong></div><div class="queue-summary subtle">' +
    escapeHtml(getCaliforniaPriorityWaveBottleneck(rows)) +
    "</div>" +
    (followUpSummary
      ? '<div class="queue-summary"><strong>' + escapeHtml(followUpSummary) + "</strong></div>"
      : "") +
    (sharedAsk
      ? '<div class="queue-summary"><strong>Best shared ask to send next:</strong> ' +
        escapeHtml(formatFieldLabel(sharedAsk.field)) +
        " (" +
        escapeHtml(String(sharedAsk.count)) +
        " of " +
        escapeHtml(String(rows.length)) +
        " profiles).</div>"
      : "") +
    (readyToApplyRows.length
      ? '<div class="queue-summary"><strong>Ready to apply now:</strong> ' +
        escapeHtml(
          readyToApplyRows.length === 1
            ? readyToApplyRows[0].item.name + " is ready to apply back into the live profile."
            : readyToApplyRows.length +
                " California-wave profiles are ready to apply back into live profiles.",
        ) +
        '</div><div class="queue-insights"><div class="queue-insights-title">Ready to apply now</div><div class="subtle" style="margin-bottom:0.7rem">Use this lane once therapist-confirmed answers come back and you are ready to update the live profile.</div><div class="queue-insights-grid">' +
        readyToApplyRows
          .map(function (row) {
            return (
              '<div class="queue-insight-card"><div class="queue-insight-label"><strong>' +
              escapeHtml(row.item.name) +
              '</strong></div><div class="queue-insight-note">' +
              escapeHtml(getConfirmationResultLabel(row.workflow.status)) +
              '</div><div class="queue-insight-action"><button class="btn-secondary" data-california-priority-apply-brief="' +
              escapeHtml(row.item.slug) +
              '">Copy apply brief</button></div></div>'
            );
          })
          .join("") +
        "</div></div>"
      : "") +
    '<div class="queue-actions" style="margin-bottom:0.8rem"><button class="btn-secondary" data-california-priority-export="packet">Copy wave packet</button><button class="btn-secondary" data-california-priority-export="tracker">Copy wave tracker CSV</button>' +
    (sharedAsk
      ? '<button class="btn-secondary" data-california-priority-export="shared-ask">Copy shared ask packet</button>'
      : "") +
    (readyToApplyRows.length
      ? '<button class="btn-secondary" data-california-priority-export="apply-packet">Copy apply packet</button><button class="btn-secondary" data-california-priority-export="apply-csv">Copy apply CSV</button><button class="btn-secondary" data-california-priority-export="apply-summary">Copy apply summary</button><button class="btn-secondary" data-california-priority-export="apply-checklist">Copy apply checklist</button>'
      : "") +
    '</div><div class="review-coach-status" id="californiaPriorityWaveStatus"></div>' +
    rows
      .map(function (row) {
        var item = row.item;
        var workflow = row.workflow;
        return (
          '<article class="queue-card"><div class="queue-head"><div><h3>' +
          escapeHtml(String(row.priority_rank) + ". " + item.name) +
          '</h3><div class="subtle">' +
          escapeHtml(row.agenda.summary) +
          '</div></div><div class="queue-head-actions"><span class="tag">' +
          escapeHtml(formatStatusLabel(workflow.status)) +
          '</span><span class="tag">' +
          escapeHtml(getConfirmationResultLabel(workflow.status)) +
          '</span></div></div><div class="queue-summary"><strong>Primary ask:</strong> ' +
          escapeHtml(formatFieldLabel(row.primaryAskField)) +
          "</div>" +
          (row.addOnAskFields.length
            ? '<div class="queue-summary"><strong>Add-on asks:</strong> ' +
              escapeHtml(row.addOnAskFields.map(formatFieldLabel).join(", ")) +
              "</div>"
            : "") +
          '<div class="queue-summary"><strong>Target:</strong> ' +
          escapeHtml(getConfirmationTarget(item)) +
          '</div><div class="queue-summary"><strong>Last action:</strong> ' +
          escapeHtml(getConfirmationLastActionNote(workflow).replace(/^Last action:\s*/, "")) +
          '</div><div class="queue-summary"><strong>First action:</strong> ' +
          escapeHtml(row.firstAction) +
          '</div><div class="queue-summary"><strong>Follow-up rule:</strong> ' +
          escapeHtml(row.followUpRule) +
          (getCaliforniaPriorityFollowUpNote(row)
            ? '</div><div class="queue-summary"><strong>Follow-up timing:</strong> ' +
              escapeHtml(getCaliforniaPriorityFollowUpNote(row))
            : "") +
          "</div>" +
          (workflow.status === "confirmed" || workflow.status === "applied"
            ? buildConfirmationResponseCaptureHtml(
                item.slug,
                row.primaryAskField,
                row.addOnAskFields,
              )
            : "") +
          (workflow.status === "confirmed" || workflow.status === "applied"
            ? buildConfirmationApplyPreviewHtml(
                item,
                item.slug,
                row.primaryAskField,
                row.addOnAskFields,
              )
            : "") +
          '<div class="queue-actions"><button class="btn-secondary" data-california-priority-copy="' +
          escapeHtml(item.slug) +
          '">Copy request</button><button class="btn-secondary" data-california-priority-link="' +
          escapeHtml(item.slug) +
          '">Copy confirmation link</button><button class="btn-secondary" data-california-priority-status="' +
          escapeHtml(item.slug) +
          '" data-next-status="sent">Mark sent</button><button class="btn-secondary" data-california-priority-status="' +
          escapeHtml(item.slug) +
          '" data-next-status="waiting_on_therapist">Mark waiting</button><button class="btn-secondary" data-california-priority-status="' +
          escapeHtml(item.slug) +
          '" data-next-status="confirmed">Mark confirmed</button>' +
          (workflow.status === "confirmed" || workflow.status === "applied"
            ? '<button class="btn-secondary" data-california-priority-apply-brief="' +
              escapeHtml(item.slug) +
              '">Copy apply brief</button><button class="btn-secondary" data-california-priority-status="' +
              escapeHtml(item.slug) +
              '" data-next-status="applied">Mark applied</button>'
            : "") +
          '<button class="btn-secondary" data-california-priority-queue="' +
          escapeHtml(item.slug) +
          '">Show in queue</button></div><div class="review-coach-status" data-california-priority-status-id="' +
          escapeHtml(item.slug) +
          '"></div></article>'
        );
      })
      .join("");

  root.querySelectorAll("[data-california-priority-copy]").forEach(function (button) {
    button.addEventListener("click", async function () {
      var slug = button.getAttribute("data-california-priority-copy");
      var row = rows.find(function (item) {
        return item.item && item.item.slug === slug;
      });
      if (!row) {
        return;
      }
      var text = [
        buildOrderedConfirmationRequestMessage(
          row.item,
          row.agenda.unknown_fields || [],
          row.primaryAskField,
        ),
        "",
        "Confirmation form:",
        buildConfirmationLink(slug),
      ]
        .filter(Boolean)
        .join("\n");
      var success = await copyText(text);
      setConfirmationActionStatus(
        root,
        slug,
        success ? "California priority request copied." : "Could not copy confirmation request.",
      );
      if (success) {
        updateConfirmationQueueEntry(slug, {
          status: "sent",
          last_sent_at: new Date().toISOString(),
        });
        renderStats();
        renderCaliforniaPriorityConfirmationWave();
        renderImportBlockerSprint();
        renderConfirmationSprint();
        renderConfirmationQueue();
      }
    });
  });

  root.querySelectorAll("[data-california-priority-export]").forEach(function (button) {
    button.addEventListener("click", async function () {
      var mode = button.getAttribute("data-california-priority-export");
      var text =
        mode === "tracker"
          ? buildCaliforniaPriorityWaveTrackerCsv(rows)
          : mode === "shared-ask"
            ? buildCaliforniaPrioritySharedAskPacket(rows)
            : mode === "apply-csv"
              ? buildCaliforniaPriorityWaveApplyCsv(rows)
              : mode === "apply-summary"
                ? buildConfirmationApplySummary(rows, "# California Priority Apply Summary")
                : mode === "apply-checklist"
                  ? buildConfirmationApplyOperatorChecklist(
                      rows,
                      "# California Priority Apply Checklist",
                    )
                  : mode === "apply-packet"
                    ? buildCaliforniaPriorityWaveApplyPacket(rows)
                    : buildCaliforniaPriorityWavePacket(rows);
      var success = await copyText(text);
      var status = root.querySelector("#californiaPriorityWaveStatus");
      if (status) {
        status.textContent = success
          ? mode === "tracker"
            ? "California wave tracker CSV copied."
            : mode === "shared-ask"
              ? "California shared ask packet copied."
              : mode === "apply-csv"
                ? "California apply CSV copied."
                : mode === "apply-summary"
                  ? "California apply summary copied."
                  : mode === "apply-checklist"
                    ? "California apply checklist copied."
                    : mode === "apply-packet"
                      ? "California wave apply packet copied."
                      : "California wave packet copied."
          : "Could not copy the California wave export.";
      }
    });
  });

  root.querySelectorAll("[data-california-priority-link]").forEach(function (button) {
    button.addEventListener("click", async function () {
      var slug = button.getAttribute("data-california-priority-link");
      var success = await copyText(buildConfirmationLink(slug));
      setConfirmationActionStatus(
        root,
        slug,
        success ? "Confirmation link copied." : "Could not copy confirmation link.",
      );
      if (success) {
        updateConfirmationQueueEntry(slug, {
          status: "sent",
          last_sent_at: new Date().toISOString(),
        });
        renderStats();
        renderCaliforniaPriorityConfirmationWave();
        renderImportBlockerSprint();
        renderConfirmationSprint();
        renderConfirmationQueue();
      }
    });
  });

  root.querySelectorAll("[data-california-priority-status]").forEach(function (button) {
    button.addEventListener("click", function () {
      var slug = button.getAttribute("data-california-priority-status");
      var nextStatus = button.getAttribute("data-next-status");
      if (!slug || !nextStatus) {
        return;
      }
      updateConfirmationQueueEntry(slug, {
        status: nextStatus,
        last_sent_at:
          nextStatus === "sent"
            ? new Date().toISOString()
            : getConfirmationQueueEntry(slug).last_sent_at,
        confirmation_applied_at:
          nextStatus === "applied"
            ? new Date().toISOString()
            : nextStatus === "confirmed" ||
                nextStatus === "waiting_on_therapist" ||
                nextStatus === "sent"
              ? ""
              : getConfirmationQueueEntry(slug).confirmation_applied_at,
      });
      renderStats();
      renderCaliforniaPriorityConfirmationWave();
      renderImportBlockerSprint();
      renderConfirmationSprint();
      renderConfirmationQueue();
    });
  });

  root.querySelectorAll("[data-california-priority-apply-brief]").forEach(function (button) {
    button.addEventListener("click", async function () {
      var slug = button.getAttribute("data-california-priority-apply-brief");
      var row = rows.find(function (item) {
        return item.item && item.item.slug === slug;
      });
      if (!row) {
        return;
      }
      var text = buildConfirmationApplyBrief(
        row.item,
        row.agenda,
        getConfirmationQueueEntry(slug),
        row.primaryAskField,
      );
      var success = await copyText(text);
      setConfirmationActionStatus(
        root,
        slug,
        success ? "Apply brief copied." : "Could not copy apply brief.",
      );
    });
  });

  root.querySelectorAll("[data-california-priority-queue]").forEach(function (button) {
    button.addEventListener("click", function () {
      confirmationQueueFilter = "";
      renderCaliforniaPriorityConfirmationWave();
      renderConfirmationQueue();
      var queueRoot = document.getElementById("confirmationQueue");
      if (queueRoot) {
        queueRoot.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });

  bindConfirmationResponseCapture(root);
}

function getConfirmationResultLabel(status) {
  if (status === "applied") {
    return "Applied to live profile";
  }
  if (status === "confirmed") {
    return "Confirmed by therapist";
  }
  if (status === "waiting_on_therapist") {
    return "Waiting on therapist";
  }
  if (status === "sent") {
    return "Request sent";
  }
  return "Not started";
}

function getConfirmationLastActionNote(workflow) {
  var entry = workflow || {};
  if (entry.status === "applied" && entry.last_updated_at) {
    return "Last action: marked applied on " + formatDate(entry.last_updated_at) + ".";
  }
  if (entry.status === "confirmed" && entry.last_updated_at) {
    return "Last action: marked confirmed on " + formatDate(entry.last_updated_at) + ".";
  }
  if (entry.status === "waiting_on_therapist" && entry.last_updated_at) {
    return "Last action: marked waiting on " + formatDate(entry.last_updated_at) + ".";
  }
  if (entry.status === "sent" && entry.last_sent_at) {
    return "Last action: request sent on " + formatDate(entry.last_sent_at) + ".";
  }
  if (entry.last_updated_at) {
    return "Last action: updated on " + formatDate(entry.last_updated_at) + ".";
  }
  return "Last action: not started yet.";
}

function getConfirmationGraceWindowNote(item) {
  var appliedAt =
    item && item.confirmation_applied_at ? new Date(item.confirmation_applied_at) : null;
  if (!appliedAt || Number.isNaN(appliedAt.getTime())) {
    return "";
  }
  var now = new Date();
  var diffDays = Math.max(0, Math.round((now.getTime() - appliedAt.getTime()) / 86400000));
  if (diffDays > 21) {
    return "";
  }
  return "Grace window active after recent applied updates.";
}

function getConfirmationTarget(item) {
  var therapist = item || {};
  if (therapist.preferred_contact_method === "email" && therapist.email) {
    return therapist.email;
  }
  if (therapist.preferred_contact_method === "phone" && therapist.phone) {
    return therapist.phone;
  }
  if (
    (therapist.preferred_contact_method === "website" ||
      therapist.preferred_contact_method === "booking") &&
    (therapist.booking_url || therapist.website)
  ) {
    return therapist.booking_url || therapist.website;
  }
  return (
    therapist.booking_url ||
    therapist.website ||
    therapist.email ||
    therapist.phone ||
    "Manual review"
  );
}

function getImportBlockerFields() {
  return [
    "license_number",
    "insurance_accepted",
    "estimated_wait_time",
    "bipolar_years_experience",
  ];
}

function getImportBlockerFieldBuckets(fields) {
  var sourceFirst = [];
  var therapistConfirmation = [];

  (Array.isArray(fields) ? fields : []).forEach(function (field) {
    if (field === "license_number" || field === "insurance_accepted") {
      sourceFirst.push(field);
    } else {
      therapistConfirmation.push(field);
    }
  });

  return {
    source_first: sourceFirst,
    therapist_confirmation: therapistConfirmation,
  };
}

function getImportBlockerSourcePathStatus(buckets) {
  var sourceFirstFields = Array.isArray(buckets?.source_first) ? buckets.source_first : [];
  var confirmationFields = Array.isArray(buckets?.therapist_confirmation)
    ? buckets.therapist_confirmation
    : [];

  if (sourceFirstFields.length && confirmationFields.length) {
    return "Still worth one more public-source pass before therapist confirmation.";
  }
  if (sourceFirstFields.length) {
    return "Public-source path still open.";
  }
  return "Public-source path exhausted. Therapist confirmation is the honest next move.";
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
  var blockerFields = getImportBlockerFields();
  return getPublishedTherapistConfirmationQueue()
    .map(function (entry) {
      var blockerUnknownFields = (entry.agenda.unknown_fields || []).filter(function (field) {
        return blockerFields.includes(field);
      });
      return {
        ...entry,
        blocker_unknown_fields: blockerUnknownFields,
      };
    })
    .filter(function (entry) {
      return entry.blocker_unknown_fields.length > 0;
    })
    .sort(function (a, b) {
      var blockerDiff = b.blocker_unknown_fields.length - a.blocker_unknown_fields.length;
      if (blockerDiff) {
        return blockerDiff;
      }
      var statusWeight = {
        not_started: 0,
        sent: 1,
        waiting_on_therapist: 2,
        confirmed: 3,
        applied: 4,
      };
      var statusDiff =
        (statusWeight[a.workflow.status] || 9) - (statusWeight[b.workflow.status] || 9);
      if (statusDiff) {
        return statusDiff;
      }
      return a.item.name.localeCompare(b.item.name);
    });
}

function getImportBlockerSprintRows(limit) {
  var selectedEntries = getPublishedTherapistImportBlockerQueue().slice(0, limit || 3);
  var fieldCounts = {};
  selectedEntries.forEach(function (entry) {
    entry.blocker_unknown_fields.forEach(function (field) {
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
    var buckets = getImportBlockerFieldBuckets(entry.blocker_unknown_fields);
    var sourcePathStatus = getImportBlockerSourcePathStatus(buckets);
    var nextMove = "";
    if (buckets.source_first.length && buckets.therapist_confirmation.length) {
      nextMove =
        "Try one more public-source pass for " +
        buckets.source_first.map(formatFieldLabel).join(", ") +
        ", then use therapist confirmation for " +
        buckets.therapist_confirmation.map(formatFieldLabel).join(", ") +
        ".";
    } else if (buckets.source_first.length) {
      nextMove =
        "Try one more public-source pass for " +
        buckets.source_first.map(formatFieldLabel).join(", ") +
        " before treating this blocker as confirmation-only.";
    } else {
      nextMove =
        "Use therapist confirmation to clear " +
        buckets.therapist_confirmation.map(formatFieldLabel).join(", ") +
        ".";
    }
    var blockerMode = buckets.source_first.length
      ? buckets.therapist_confirmation.length
        ? "Mixed blocker"
        : "Source-first blocker"
      : "Therapist-confirmation blocker";
    return {
      priority_rank: index + 1,
      name: item.name,
      slug: item.slug,
      status: formatStatusLabel(workflow.status),
      result: getConfirmationResultLabel(workflow.status),
      blocker_mode: blockerMode,
      blocker_count: entry.blocker_unknown_fields.length,
      blocker_fields: entry.blocker_unknown_fields.join("|"),
      source_first_fields: buckets.source_first.join("|"),
      therapist_confirmation_fields: buckets.therapist_confirmation.join("|"),
      source_path_status: sourcePathStatus,
      contact_target: getConfirmationTarget(item),
      why_it_matters: buckets.source_first.length
        ? item.name +
          " is still blocking the strict safe-import gate because " +
          entry.blocker_unknown_fields.map(formatFieldLabel).join(", ") +
          " remain unresolved."
        : item.name +
          " is still blocking the strict safe-import gate because " +
          entry.blocker_unknown_fields.map(formatFieldLabel).join(", ") +
          " still need therapist-confirmed truth, not more guessing.",
      request_subject: buildImportBlockerRequestSubject(
        item,
        entry.blocker_unknown_fields,
        preferredPrimaryField,
      ),
      request_message: buildImportBlockerRequestMessage(
        item,
        entry.blocker_unknown_fields,
        preferredPrimaryField,
      ),
      next_best_move: nextMove,
    };
  });
}

function getImportBlockerSprintSummary(rows) {
  if (!rows.length) {
    return "No strong-warning profiles are currently blocking the strict safe-import gate.";
  }

  return (
    rows.length +
    " profile" +
    (rows.length === 1 ? "" : "s") +
    " currently sit at the top of the strict safe-import blocker queue."
  );
}

function getImportBlockerSprintBottleneck(rows) {
  if (!rows.length) {
    return "";
  }

  var notStarted = rows.filter(function (row) {
    return row.status === "Not started";
  }).length;
  var waiting = rows.filter(function (row) {
    return row.status === "Waiting on therapist";
  }).length;
  var confirmed = rows.filter(function (row) {
    return row.status === "Confirmed by therapist";
  }).length;

  if (notStarted >= 2) {
    return "The strict gate is still mostly blocked on first outreach to unresolved high-trust profiles.";
  }
  if (waiting >= 1) {
    return "The strict gate is now mostly waiting on therapist replies for the top blocker profiles.";
  }
  if (confirmed >= 1) {
    return "Some strict-gate blockers look ready to apply back into the live profile data.";
  }
  return "The strict gate backlog is active, but the top blockers are already moving.";
}

function getImportBlockerSprintWaveShape(rows) {
  if (!rows.length) {
    return "";
  }

  var sourceFirstCount = rows.filter(function (row) {
    return row.blocker_mode === "Source-first blocker";
  }).length;
  var mixedCount = rows.filter(function (row) {
    return row.blocker_mode === "Mixed blocker";
  }).length;
  var confirmationOnlyCount = rows.filter(function (row) {
    return row.blocker_mode === "Therapist-confirmation blocker";
  }).length;

  if (confirmationOnlyCount === rows.length) {
    return "Wave shape: all top blockers are now confirmation-only.";
  }
  if (sourceFirstCount === rows.length) {
    return "Wave shape: all top blockers still have a public-source path open.";
  }
  if (mixedCount === rows.length) {
    return "Wave shape: the whole top wave is mixed, with both source and therapist-confirmation work.";
  }
  if (confirmationOnlyCount > 0 && !sourceFirstCount) {
    return (
      "Wave shape: mostly confirmation-only, with " +
      mixedCount +
      " mixed blocker" +
      (mixedCount === 1 ? "" : "s") +
      " still needing a last source pass."
    );
  }
  if (sourceFirstCount > 0 && !confirmationOnlyCount) {
    return (
      "Wave shape: mostly source-first, with " +
      mixedCount +
      " mixed blocker" +
      (mixedCount === 1 ? "" : "s") +
      " also needing therapist confirmation."
    );
  }
  return "Wave shape: mixed blocker work across the top wave, combining source checks and therapist confirmation.";
}

function getImportBlockerSprintFieldPattern(rows) {
  if (!rows.length) {
    return "";
  }

  var counts = {};
  rows.forEach(function (row) {
    String(row.blocker_fields || "")
      .split("|")
      .map(function (field) {
        return field.trim();
      })
      .filter(Boolean)
      .forEach(function (field) {
        counts[field] = (counts[field] || 0) + 1;
      });
  });

  var ranked = Object.keys(counts)
    .sort(function (a, b) {
      var countDiff = counts[b] - counts[a];
      if (countDiff) {
        return countDiff;
      }
      return a.localeCompare(b);
    })
    .slice(0, 3)
    .map(function (field) {
      return formatFieldLabel(field);
    });

  if (!ranked.length) {
    return "";
  }

  return "Most common blockers right now: " + ranked.join(", ") + ".";
}

function getImportBlockerPromptMap() {
  return {
    estimated_wait_time:
      "What is your current typical wait time for a new bipolar-related therapy or psychiatry intake?",
    bipolar_years_experience:
      "About how many years have you been treating bipolar-spectrum conditions specifically?",
    insurance_accepted:
      "Which insurance plans do you currently accept, and if you are out of network, do you provide superbills?",
    telehealth_states: "Which states are you currently able to see patients in by telehealth?",
    license_number:
      "What is your current license number for the license you want displayed on your profile?",
  };
}

function getImportBlockerSprintSharedAskDetails(rows) {
  if (!rows.length) {
    return null;
  }

  var counts = {};
  rows.forEach(function (row) {
    String(row.blocker_fields || "")
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

  var ask = getImportBlockerPromptMap()[topField];
  if (!ask) {
    return null;
  }

  return {
    field: topField,
    ask: ask,
    count: counts[topField] || 0,
  };
}

function getImportBlockerSprintSharedAsk(rows) {
  var details = getImportBlockerSprintSharedAskDetails(rows);
  if (!details) {
    return "";
  }

  return (
    "Best shared ask to send next (" +
    details.count +
    " of " +
    rows.length +
    " top blockers): " +
    details.ask
  );
}

function getImportBlockerSprintSharedAskText(rows) {
  var details = getImportBlockerSprintSharedAskDetails(rows);
  return details ? details.ask : "";
}

function getImportBlockerSprintSharedAskStatus(rows) {
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

  var unsent = matchingRows.filter(function (row) {
    return row.status === "Not started";
  }).length;
  var inFlight = matchingRows.filter(function (row) {
    return row.status === "Request sent" || row.status === "Waiting on therapist";
  }).length;
  var confirmed = matchingRows.filter(function (row) {
    return row.status === "Confirmed by therapist" || row.status === "Applied to live profile";
  }).length;

  if (unsent === matchingRows.length) {
    return (
      "Shared ask status: not started yet across all " +
      matchingRows.length +
      " matching top blockers."
    );
  }
  if (inFlight === matchingRows.length) {
    return (
      "Shared ask status: already in flight across all " +
      matchingRows.length +
      " matching top blockers."
    );
  }
  if (confirmed === matchingRows.length) {
    return (
      "Shared ask status: already confirmed or applied across all " +
      matchingRows.length +
      " matching top blockers."
    );
  }

  var parts = [];
  if (unsent) {
    parts.push(unsent + " unsent");
  }
  if (inFlight) {
    parts.push(inFlight + " in flight");
  }
  if (confirmed) {
    parts.push(confirmed + " confirmed/applied");
  }

  return "Shared ask status: " + parts.join(", ") + ".";
}

function getImportBlockerSprintSharedAskImpact(rows) {
  var details = getImportBlockerSprintSharedAskDetails(rows);
  if (!details) {
    return "";
  }

  var matchingCount = rows.filter(function (row) {
    return String(row.blocker_fields || "")
      .split("|")
      .map(function (field) {
        return field.trim();
      })
      .filter(Boolean)
      .includes(details.field);
  }).length;

  if (!matchingCount) {
    return "";
  }

  return (
    "Shared ask impact: clearing this answer would likely move " +
    matchingCount +
    " of the top " +
    rows.length +
    " strict-gate blockers."
  );
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

  var unsent = matchingRows.filter(function (row) {
    return row.status === "Not started";
  }).length;
  var inFlight = matchingRows.filter(function (row) {
    return row.status === "Request sent" || row.status === "Waiting on therapist";
  }).length;
  var confirmed = matchingRows.filter(function (row) {
    return row.status === "Confirmed by therapist" || row.status === "Applied to live profile";
  }).length;

  if (unsent >= inFlight && unsent >= confirmed) {
    return "Best next move: start outreach on this shared ask across the top matching blockers.";
  }
  if (inFlight >= unsent && inFlight >= confirmed) {
    return "Best next move: follow up on replies for this shared ask before widening the wave.";
  }
  return "Best next move: apply confirmed answers from this shared ask back into the live profiles.";
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

function renderStats() {
  if (authRequired) {
    document.getElementById("adminStats").innerHTML = "";
    return;
  }

  const stats =
    dataMode === "sanity"
      ? {
          total_therapists: publishedTherapists.length,
          states_covered: new Set(
            publishedTherapists.map(function (item) {
              return item.state;
            }),
          ).size,
          accepting_count: publishedTherapists.filter(function (item) {
            return item.accepting_new_patients;
          }).length,
        }
      : getStats();
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
      getDataFreshnessSummary(item).status !== "fresh" || getTherapistFieldTrustAttentionCount(item)
    );
  }).length;
  const profilesWithFieldTrustAttention = therapists.filter(function (item) {
    return getTherapistFieldTrustAttentionCount(item) > 0;
  }).length;
  const recentlyMaintainedCount = therapists.filter(function (item) {
    return Boolean(getConfirmationGraceWindowNote(item));
  }).length;
  const profilesNeedingConfirmation = therapists.filter(function (item) {
    return getTherapistConfirmationAgenda(item).needs_confirmation;
  }).length;
  const strictImportBlockers = getPublishedTherapistImportBlockerQueue();
  const strictImportBlockerCount = strictImportBlockers.length;
  const topStrictImportBlocker = strictImportBlockers.length
    ? strictImportBlockers[0].item.name
    : "";
  const strictImportBlockerHealth =
    strictImportBlockerCount === 0
      ? "Safe import gate clear"
      : strictImportBlockerCount <= 3
        ? "Safe import gate blocked by a small top wave"
        : "Safe import gate still blocked by a broader backlog";
  const confirmationQueue = getPublishedTherapistConfirmationQueue();
  const topConfirmationProfile = confirmationQueue.length ? confirmationQueue[0].item.name : "";
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
  const topRefreshProfile = refreshQueue.length ? refreshQueue[0].item.name : "";
  const recentlyMaintainedProfiles = therapists.filter(function (item) {
    return Boolean(getConfirmationGraceWindowNote(item));
  });
  const topRecentlyMaintainedProfile = recentlyMaintainedProfiles.length
    ? recentlyMaintainedProfiles[0].name
    : "";
  const confirmationQueueState = readConfirmationQueueState();
  const awaitingConfirmationCount = Object.keys(confirmationQueueState).filter(function (slug) {
    var entry = confirmationQueueState[slug];
    return entry && (entry.status === "sent" || entry.status === "waiting_on_therapist");
  }).length;
  const pendingApplicationsCount = applications.filter(function (item) {
    return item.status === "pending";
  }).length;

  const primaryOpsCards = [
    buildActionStatCard(pendingApplicationsCount, "Pending applications", "applicationsPanel", {
      applicationStatus: "pending",
      actionLabel: "Open review queue",
    }),
    buildActionStatCard(openConciergeCount, "Open concierge items", "conciergePanel", {
      conciergeStatus: "open",
      actionLabel: "Open active items",
    }),
    buildActionStatCard(openPortalRequestCount, "Portal requests open", "portalRequestsPanel", {
      portalRequestStatus: "open",
      actionLabel: "Open portal queue",
    }),
    buildActionStatCard(profilesNeedingRefresh, "Profiles needing refresh", "refreshQueue", {
      meta: topRefreshProfile
        ? "Top: " +
          topRefreshProfile +
          (profilesWithFieldTrustAttention
            ? " · " + profilesWithFieldTrustAttention + " with trust risk"
            : "")
        : profilesWithFieldTrustAttention
          ? profilesWithFieldTrustAttention + " with trust risk"
          : "",
      actionLabel: "Open refresh queue",
    }),
    buildActionStatCard(strictImportBlockerCount, "Strict import blockers", "importBlockerSprint", {
      meta:
        strictImportBlockerHealth +
        (topStrictImportBlocker ? " · Top: " + topStrictImportBlocker : ""),
      actionLabel: "Open blocker sprint",
    }),
    buildActionStatCard(
      profilesNeedingConfirmation,
      "Profiles needing confirmation",
      "confirmationQueue",
      {
        meta: topConfirmationProfile ? "Top: " + topConfirmationProfile : "",
        actionLabel: "Open confirmation queue",
      },
    ),
    buildActionStatCard(
      awaitingConfirmationCount,
      "Confirmation follow-ups open",
      "confirmationQueue",
      {
        confirmationFilter: "waiting_on_therapist",
        actionLabel: "Open follow-ups",
      },
    ),
  ];

  const secondaryContextCards = [
    buildPassiveStatCard(therapists.length, "Published listings"),
    buildPassiveStatCard(stats.states_covered, "States covered"),
    buildPassiveStatCard(stats.accepting_count, "Accepting patients"),
    buildPassiveStatCard(matchReadyCount, "Match-ready profiles"),
    buildActionStatCard(conciergeRequests.length, "Concierge requests", "conciergePanel", {
      actionLabel: "Open concierge queue",
    }),
    buildPassiveStatCard(heardBackCount, "Heard-back outcomes"),
    buildPassiveStatCard(bookedConsultCount, "Booked consults"),
    buildActionStatCard(
      recentlyMaintainedCount,
      "Recently maintained",
      "recentlyMaintainedRefresh",
      {
        meta: topRecentlyMaintainedProfile ? "Latest: " + topRecentlyMaintainedProfile : "",
        actionLabel: "Open maintained list",
      },
    ),
    buildActionStatCard(funnelSummary.searches, "Searches tracked", "funnelAnalyticsPanel", {
      actionLabel: "Open analytics",
    }),
    buildPassiveStatCard(funnelSummary.matches, "Matches run"),
    buildPassiveStatCard(funnelSummary.shortlist_saves, "Shortlist saves"),
    buildPassiveStatCard(funnelSummary.help_requests, "Help requests"),
  ];

  document.getElementById("adminStats").innerHTML =
    wrapStatsGroup("Operator workflows", primaryOpsCards, "ops-grid") +
    wrapStatsGroup("Reference metrics", secondaryContextCards, "");

  document.querySelectorAll("[data-admin-scroll-target]").forEach(function (button) {
    button.addEventListener("click", function () {
      var targetId = button.getAttribute("data-admin-scroll-target");
      var confirmationFilter = button.getAttribute("data-admin-confirmation-filter");
      var applicationStatus = button.getAttribute("data-admin-application-status");
      var conciergeStatus = button.getAttribute("data-admin-concierge-status");
      var portalRequestStatus = button.getAttribute("data-admin-portal-request-status");
      if (confirmationFilter) {
        confirmationQueueFilter = confirmationFilter;
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
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        spotlightSection(target);
      }
    });
  });
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
  renderCoverageIntelligencePanel({
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
}

function renderIngestionScorecard() {
  var latestAutomationRun = ingestionAutomationHistory.length
    ? ingestionAutomationHistory[ingestionAutomationHistory.length - 1]
    : null;
  renderIngestionScorecardPanel({
    root: document.getElementById("ingestionScorecard"),
    authRequired: authRequired,
    therapists: dataMode === "sanity" ? publishedTherapists : getTherapists(),
    candidates: dataMode === "sanity" ? remoteCandidates : [],
    applications: dataMode === "sanity" ? remoteApplications : getApplications(),
    ingestionAutomationHistory: ingestionAutomationHistory,
    latestAutomationRun: latestAutomationRun,
    licensureRefreshQueue: licensureRefreshQueue,
    licensureActivityFeed: licensureActivityFeed,
    buildCoverageInsights: buildCoverageInsights,
    getDataFreshnessSummary: getDataFreshnessSummary,
    getTherapistFieldTrustSummary: getTherapistFieldTrustSummary,
    escapeHtml: escapeHtml,
    formatDate: formatDate,
  });
}

function renderSourcePerformance() {
  renderSourcePerformancePanel({
    root: document.getElementById("sourcePerformance"),
    authRequired: authRequired,
    candidates: dataMode === "sanity" ? remoteCandidates : [],
    therapists: dataMode === "sanity" ? publishedTherapists : getTherapists(),
    inferCoverageRole: inferCoverageRole,
    getTherapistFieldTrustAttentionCount: getTherapistFieldTrustAttentionCount,
    escapeHtml: escapeHtml,
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
  const outcomes = readOutreachOutcomes();
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
}

function renderListings() {
  listingsWorkspace.renderListings();
}

function renderRefreshQueue() {
  renderRefreshQueuePanel({
    authRequired: authRequired,
    dataMode: dataMode,
    publishedTherapists: publishedTherapists,
    getTherapists: getTherapists,
    getConfirmationGraceWindowNote: getConfirmationGraceWindowNote,
    getDataFreshnessSummary: getDataFreshnessSummary,
    getTherapistFieldTrustAttentionCount: getTherapistFieldTrustAttentionCount,
    getTherapistFieldTrustSummary: getTherapistFieldTrustSummary,
    getTherapistTrustRecommendation: getTherapistTrustRecommendation,
    escapeHtml: escapeHtml,
  });
}

function renderLicensureQueue() {
  renderLicensureQueuePanel({
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
}

function renderLicensureSprint() {
  var latestAutomationRun = ingestionAutomationHistory.length
    ? ingestionAutomationHistory[ingestionAutomationHistory.length - 1]
    : null;
  renderLicensureSprintPanel({
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
}

function renderDeferredLicensureQueue() {
  renderDeferredLicensureQueuePanel({
    root: document.getElementById("deferredLicensureQueue"),
    countEl: document.getElementById("deferredLicensureQueueCount"),
    authRequired: authRequired,
    rows: deferredLicensureQueue,
    activityFeed: licensureActivityFeed,
    decideLicensureOps: decideLicensureOps,
    loadData: loadData,
    escapeHtml: escapeHtml,
  });
}

function renderLicensureActivity() {
  renderLicensureActivityPanel({
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
}

function renderImportBlockerSprint() {
  renderImportBlockerSprintPanel({
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
      confirmationQueueFilter = value;
    },
    buildImportBlockerPacket: buildImportBlockerPacket,
    getImportBlockerSprintSharedAskText: getImportBlockerSprintSharedAskText,
    buildImportBlockerSharedAskPacket: buildImportBlockerSharedAskPacket,
    buildOverlappingAskPacket: buildOverlappingAskPacket,
    buildTopOutreachWavePacket: buildTopOutreachWavePacket,
    buildImportBlockerSprintCsv: buildImportBlockerSprintCsv,
    buildImportBlockerSprintMarkdown: buildImportBlockerSprintMarkdown,
  });
}

function renderConfirmationSprint() {
  renderConfirmationSprintPanel({
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
      confirmationQueueFilter = value;
    },
  });
}

function renderConfirmationQueue() {
  renderConfirmationQueuePanel({
    root: document.getElementById("confirmationQueue"),
    statusFilter: document.getElementById("confirmationQueueStatusFilter"),
    countLabel: document.getElementById("confirmationQueueCount"),
    authRequired: authRequired,
    confirmationQueueFilter: confirmationQueueFilter,
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
  });
}

function renderApplications() {
  renderApplicationsPanel({
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

  var actions = [];
  if (item.review_status !== "ready_to_publish") {
    actions.push(
      '<button class="btn-secondary" data-candidate-decision="' +
        escapeHtml(item.id) +
        '" data-candidate-next="mark_ready">Mark ready</button>',
    );
  }
  if (item.review_status !== "needs_confirmation") {
    actions.push(
      '<button class="btn-secondary" data-candidate-decision="' +
        escapeHtml(item.id) +
        '" data-candidate-next="needs_confirmation">Needs confirmation</button>',
    );
  }
  if (item.dedupe_status !== "rejected_duplicate") {
    actions.push(
      '<button class="btn-secondary" data-candidate-decision="' +
        escapeHtml(item.id) +
        '" data-candidate-next="reject_duplicate">Mark duplicate</button>',
    );
  }
  if (item.matched_therapist_id) {
    actions.push(
      '<button class="btn-secondary" data-candidate-decision="' +
        escapeHtml(item.id) +
        '" data-candidate-next="merge_to_therapist">Merge into therapist</button>',
    );
  }
  if (item.matched_application_id) {
    actions.push(
      '<button class="btn-secondary" data-candidate-decision="' +
        escapeHtml(item.id) +
        '" data-candidate-next="merge_to_application">Merge into application</button>',
    );
  }
  actions.push(
    '<button class="btn-primary" data-candidate-decision="' +
      escapeHtml(item.id) +
      '" data-candidate-next="publish">Publish therapist</button>',
  );
  return actions.join("");
}

function renderOpsInbox() {
  renderOpsInboxPanel({
    root: document.getElementById("opsInbox"),
    authRequired: authRequired,
    candidates: dataMode === "sanity" ? remoteCandidates : [],
    therapists: dataMode === "sanity" ? publishedTherapists : getTherapists(),
    applications: dataMode === "sanity" ? remoteApplications : getApplications(),
    licensureRefreshQueue: licensureRefreshQueue,
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
    formatFieldLabel: formatFieldLabel,
    formatDate: formatDate,
    escapeHtml: escapeHtml,
    copyText: copyText,
    decideTherapistCandidate: decideTherapistCandidate,
    decideTherapistOps: decideTherapistOps,
    loadData: loadData,
  });
}

function renderCandidateQueue() {
  renderCandidateQueuePanel({
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
}

function renderConciergeQueue() {
  renderConciergeQueuePanel({
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
    '<div class="queue-summary"><strong>Recent activity:</strong></div>' +
    '<div style="display:grid;gap:0.45rem;margin:0.5rem 0 0.75rem">' +
    items
      .map(function (item) {
        const summary = buildReviewEventSummary(item);
        const showRationale = item.rationale && item.rationale !== item.notes;
        return (
          '<div class="mini-card" style="padding:0.6rem 0.75rem;border-radius:12px">' +
          '<div style="display:flex;justify-content:space-between;gap:0.75rem;align-items:flex-start">' +
          '<div style="min-width:0">' +
          '<div style="display:flex;flex-wrap:wrap;gap:0.4rem;align-items:center">' +
          '<div style="font-size:0.84rem;font-weight:700;color:var(--navy)">' +
          options.escapeHtml(getReviewEventActionLabel(item)) +
          "</div>" +
          '<span class="tag" style="font-size:0.72rem;padding:0.12rem 0.45rem">' +
          options.escapeHtml(getReviewEventLaneLabel(item)) +
          "</span></div>" +
          (summary
            ? '<div style="margin-top:0.2rem;font-size:0.8rem;color:var(--slate)">' +
              options.escapeHtml(summary) +
              "</div>"
            : "") +
          (showRationale
            ? '<div style="margin-top:0.2rem;font-size:0.78rem;color:var(--muted)">' +
              options.escapeHtml(item.rationale) +
              "</div>"
            : "") +
          "</div>" +
          '<div class="subtle" style="white-space:nowrap;font-size:0.78rem">' +
          options.escapeHtml(options.formatDate(item.created_at)) +
          "</div>" +
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
            ? '<div style="margin-top:0.35rem;font-size:0.82rem;color:var(--muted)">' +
              options.escapeHtml(item.rationale) +
              "</div>"
            : "") +
          (item.notes
            ? '<div style="margin-top:0.35rem;font-size:0.82rem;color:var(--muted)">' +
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
            ? '<div style="margin-top:0.45rem;font-size:0.84rem;color:var(--muted)">' +
              escapeHtml(item.rationale) +
              "</div>"
            : "") +
          (item.notes
            ? '<div style="margin-top:0.45rem;font-size:0.84rem;color:var(--muted)">' +
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
  renderPortalRequestsQueuePanel({
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
}

function renderAll() {
  renderStats();
  renderIngestionScorecard();
  renderOpsInbox();
  renderCoverageIntelligence();
  renderSourcePerformance();
  renderFunnelInsights();
  renderListings();
  renderRefreshQueue();
  renderLicensureQueue();
  renderLicensureSprint();
  renderDeferredLicensureQueue();
  renderLicensureActivity();
  renderImportBlockerSprint();
  renderCaliforniaPriorityConfirmationWave();
  renderConfirmationSprint();
  renderConfirmationQueue();
  renderConciergeQueue();
  renderPortalRequestsQueue();
  renderReviewActivity();
  reviewerWorkspace.renderAttentionQueue();
  reviewerWorkspace.renderReviewerWorkload();
  renderCandidateQueue();
  renderApplications();
}

function setAuthUiState() {
  const gate = document.getElementById("adminAuthGate");
  const app = document.getElementById("adminApp");
  const resetButton = document.getElementById("resetDemo");
  const signOutButton = document.getElementById("signOutAdmin");
  const authError = document.getElementById("authError");

  if (authRequired) {
    gate.style.display = "block";
    app.style.display = "none";
    resetButton.style.display = "none";
    signOutButton.style.display = "none";
    if (authError) {
      authError.style.display = "block";
    }
    return;
  }

  var confirmationQueueStatusFilter = document.getElementById("confirmationQueueStatusFilter");
  if (confirmationQueueStatusFilter) {
    confirmationQueueStatusFilter.value = confirmationQueueFilter;
    confirmationQueueStatusFilter.onchange = function () {
      confirmationQueueFilter = confirmationQueueStatusFilter.value;
      renderCaliforniaPriorityConfirmationWave();
      renderConfirmationQueue();
    };
  }

  gate.style.display = "none";
  app.style.display = "block";
  resetButton.style.display = dataMode === "local" ? "inline-flex" : "none";
  signOutButton.style.display = dataMode === "sanity" ? "inline-flex" : "none";
  if (authError) {
    authError.style.display = "none";
  }
}

async function loadData() {
  const generatedArtifacts = await loadGeneratedAdminArtifacts();
  applyAdminRuntimeState(generatedArtifacts);

  const reviewApiAvailable = await checkAdminReviewApiAvailability(checkReviewApiHealth);

  if (reviewApiAvailable && !getAdminSessionToken()) {
    applyAdminRuntimeState(
      createRemoteAuthRequiredState({
        ingestionAutomationHistory: generatedArtifacts.ingestionAutomationHistory,
        licensureRefreshQueue: generatedArtifacts.licensureRefreshQueue,
      }),
    );
    setAuthUiState();
    renderAll();
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
        remoteReviewerRoster: remoteSnapshot.reviewers,
        reviewActivityItems: [],
        reviewActivityNextCursor: "",
        publishedTherapists: remoteSnapshot.therapists,
        ingestionAutomationHistory: generatedArtifacts.ingestionAutomationHistory,
        licensureRefreshQueue: generatedArtifacts.licensureRefreshQueue,
        deferredLicensureQueue: generatedArtifacts.deferredLicensureQueue,
        licensureActivityFeed: generatedArtifacts.licensureActivityFeed,
      }),
    );
    if (
      remoteSnapshot.session &&
      remoteSnapshot.session.actorName &&
      !reviewerWorkspace.getSavedPreference().reviewer
    ) {
      reviewerWorkspace.setPreferredReviewer(
        remoteSnapshot.session.actorName,
        remoteSnapshot.session.actorId || "",
      );
    }
    await loadReviewActivityFeed({ reset: true, limit: 12 });
  } catch (_error) {
    if (reviewApiAvailable || getAdminSessionToken()) {
      applyAdminRuntimeState(
        createRemoteAuthRequiredState({
          ingestionAutomationHistory: generatedArtifacts.ingestionAutomationHistory,
          licensureRefreshQueue: generatedArtifacts.licensureRefreshQueue,
        }),
      );
    } else {
      applyAdminRuntimeState(
        createAdminRuntimeState({
          ingestionAutomationHistory: generatedArtifacts.ingestionAutomationHistory,
          licensureRefreshQueue: generatedArtifacts.licensureRefreshQueue,
          deferredLicensureQueue: generatedArtifacts.deferredLicensureQueue,
          licensureActivityFeed: generatedArtifacts.licensureActivityFeed,
        }),
      );
    }
  }

  setAuthUiState();
  renderAll();
}

document.getElementById("resetDemo").addEventListener("click", function () {
  resetDemoData();
  renderAll();
});

document.getElementById("adminAuthForm").addEventListener("submit", async function (event) {
  event.preventDefault();
  const field = document.getElementById("adminKey");
  const usernameField = document.getElementById("adminUsername");
  const error = document.getElementById("authError");
  const value = field.value.trim();
  const username = usernameField.value.trim();

  if (!value) {
    error.textContent = "Enter your admin password.";
    error.style.display = "block";
    return;
  }

  try {
    const result = await signInAdmin({
      username: username,
      password: value,
    });
    if (username) {
      reviewerWorkspace.setPreferredReviewer(username, result.actorId || username);
      reviewerWorkspace.writeReviewerDirectory(
        Array.from(new Set(reviewerWorkspace.getReviewerRoster().concat([username]))).sort(
          function (a, b) {
            return a.localeCompare(b);
          },
        ),
      );
      if (!reviewerWorkspaceUi.myQueueMode) {
        reviewerWorkspace.setReviewerMyQueueMode(true);
      }
    }
    setAdminSessionToken(result.sessionToken);
    authRequired = false;
    error.style.display = "none";
    await loadData();

    if (authRequired) {
      error.textContent = "Those admin credentials were not accepted.";
      error.style.display = "block";
    } else {
      field.value = "";
    }
  } catch (_error) {
    authRequired = true;
    error.textContent = "Those admin credentials were not accepted.";
    error.style.display = "block";
  }
});

document.getElementById("signOutAdmin").addEventListener("click", async function () {
  await signOutAdmin();
  applyAdminRuntimeState(createAdminRuntimeState());
  setAuthUiState();
  renderAll();
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

document.getElementById("conciergeStatusFilter").addEventListener("change", function (event) {
  conciergeFilters.status = event.target.value || "";
  renderConciergeQueue();
});

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

reviewerWorkspace.bindEventHandlers();

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

document.getElementById("candidateReviewLaneFilter").addEventListener("change", function (event) {
  candidateFilters.review_lane = event.target.value || "";
  renderCandidateQueue();
});

if (getAdminSessionToken()) {
  authRequired = false;
}

loadData();
