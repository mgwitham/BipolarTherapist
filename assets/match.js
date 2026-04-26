import { fetchPublicTherapists } from "./cms.js";
import { renderTrustEvidenceStrip } from "./trust-evidence-strip.js";
import {
  clearRenderedMatchPanels,
  getMatchShellRefs,
  placeBuilderInResults,
  renderMatchLandingShell,
  scrollToTopMatches as scrollToTopMatchesBase,
  setActionState,
  setMatchJourneyMode as setMatchJourneyModeBase,
} from "./match-shell.js";
import {
  buildAppliedAnswerPills as buildAppliedAnswerPillsBase,
  buildRequestSummary as buildRequestSummaryBase,
  deriveStateFromLocation as deriveStateFromLocationBase,
  hasMeaningfulRefinements as hasMeaningfulRefinementsBase,
  hydrateForm as hydrateFormBase,
  normalizeLocationQuery as normalizeLocationQueryBase,
  readCurrentIntakeProfile as readCurrentIntakeProfileBase,
  restoreProfileFromUrl as restoreProfileFromUrlBase,
  restoreShortlistFromUrl as restoreShortlistFromUrlBase,
  serializeProfileToUrl as serializeProfileToUrlBase,
  splitCommaSeparated,
  syncMatchStartState as syncMatchStartStateBase,
  syncZipResolvedLabel as syncZipResolvedLabelBase,
} from "./match-intake.js";
import {
  renderAdaptiveGuidanceSection,
  renderNoResultsStateSection,
  renderShortlistQueueSection,
} from "./match-results.js";
import { buildContactOrderPlan as buildContactOrderPlanBase } from "./match-followthrough.js";
import {
  buildFallbackLearningMap as buildFallbackLearningMapBase,
  buildLearningSegments as buildLearningSegmentsBase,
  buildStarterProfile as buildStarterProfileBase,
  getPreferredOutreach as getPreferredOutreachBase,
  getPreferredRouteType as getPreferredRouteTypeBase,
  getResponsivenessScore as getResponsivenessScoreBase,
  getRouteLearningForProfile as getRouteLearningForProfileBase,
  getRoutePriority as getRoutePriorityBase,
  hasCostClarity as hasCostClarityBase,
  hasInsuranceClarity as hasInsuranceClarityBase,
  pickRecommendedFirstContact as pickRecommendedFirstContactBase,
  rankEntriesForProfile as rankEntriesForProfileBase,
} from "./match-ranking.js";
import {
  buildFallbackRecommendation as buildFallbackRecommendationBase,
  buildFirstContactRecommendation as buildFirstContactRecommendationBase,
  renderFallbackRecommendation as renderFallbackRecommendationBase,
  renderFirstContactRecommendation as renderFirstContactRecommendationBase,
  renderOutreachPanel as renderOutreachPanelBase,
} from "./match-outreach.js";
import {
  buildUserMatchProfile,
  getDataFreshnessSummary,
  getRecentAppliedSummary,
  getRecentConfirmationSummary,
  rankTherapistsForUser,
} from "./matching-model.js";
import { submitMatchOutcome, submitMatchRequest } from "./review-api.js";
import {
  getExperimentVariant,
  readFunnelEvents,
  readRememberedTherapistContactRoute,
  summarizeAdaptiveSignals,
  trackExperimentExposure,
  trackFunnelEvent,
} from "./funnel-analytics.js";
import { getPublicResponsivenessSignal } from "./responsiveness-signal.js";
import { getZipMarketStatus, getZipDistanceMiles, preloadZipcodes } from "./zip-lookup.js";
import { orderMatchEntries as orderMatchEntriesBase } from "./match-ordering.js";
import { initValuePillPopover } from "./therapist-pills.js";
import { isDatasetEmpty, renderDatasetEmptyStateMarkup } from "./empty-dataset-state.js";
import { buildContactModalContent } from "../shared/contact-modal-content.mjs";
import { INSURANCE_OPTIONS } from "../shared/therapist-picker-options.mjs";
import {
  MAX_ENTRIES as SAVED_LIST_MAX,
  readList as readSavedList,
  isSaved as isSavedSlug,
  toggleSaved as toggleSavedSlug,
  replaceList as replaceSavedList,
  subscribe as subscribeToSavedList,
} from "./saved-list.js";

var therapists = [];
var latestProfile = null;
var latestEntries = [];
var latestLearningSignals = null;
var currentJourneyId = null;
var persistedJourneyId = "";
var outreachFocusSlug = "";
var starterResultsMode = false;
var activeShortcutContext = null;

// Match-session conversion tracker. The single number that matters for
// the patient funnel is "of all sessions where matches were shown, what
// fraction ended with at least one contact CTA click?" — this state
// counts the in-session interactions, then emits one
// match_session_outcome event on pagehide. funnel-analytics already
// flushes its queue on pagehide via sendBeacon, so the event delivers
// even when the user just closes the tab.
var matchSessionStats = null;
var SHORTLIST_RESHAPE_HISTORY_KEY = "bth_shortlist_reshape_history_v1";
var MATCH_FEEDBACK_KEY = "bth_match_feedback_v1";
var CONCIERGE_REQUESTS_KEY = "bth_concierge_requests_v1";
var OUTREACH_OUTCOMES_KEY = "bth_outreach_outcomes_v1";
var zipcodesPreloadPromise = null;
var activeSecondPassMode = "balanced";
var activeMatchExperimentVariant = "control";
var OUTREACH_OUTCOME_OPTIONS = [
  { value: "reached_out", label: "Contacted", tone: "positive" },
  { value: "heard_back", label: "Heard back", tone: "positive" },
  { value: "booked_consult", label: "Booked", tone: "positive" },
  { value: "good_fit_call", label: "Good fit", tone: "positive" },
  { value: "insurance_mismatch", label: "Insurance issue", tone: "negative" },
  { value: "waitlist", label: "Waitlist", tone: "negative" },
  { value: "no_response", label: "No response", tone: "negative" },
];

function isLicenseVerified(therapist) {
  var lv = therapist && therapist.licensureVerification;
  return (
    lv &&
    lv.sourceSystem === "california_dca_search" &&
    (lv.primaryStatus === "active" || lv.statusStanding === "good_standing")
  );
}

function getActiveExperimentContext() {
  return {
    homepage_messaging: getExperimentVariant("homepage_messaging", ["control", "adaptive"]),
    match_ranking: activeMatchExperimentVariant,
  };
}
var FEEDBACK_REASON_OPTIONS = [
  "Insurance mismatch",
  "Availability mismatch",
  "Needs medication management",
  "Wrong care format",
  "Weak bipolar specialization",
  "Other",
];
var latestAdaptiveSignals = null;
var isInternalMode = new URLSearchParams(window.location.search).get("internal") === "1";
var directoryEntryMode = new URLSearchParams(window.location.search).get("entry") || "";
var queueFocusSlugFromUrl = new URLSearchParams(window.location.search).get("focus") || "";
var PRIMARY_SHORTLIST_LIMIT = 6;
var SHORTLIST_QUEUE_LIMIT = 24;
var US_STATE_MAP = {
  ALABAMA: "AL",
  ALASKA: "AK",
  ARIZONA: "AZ",
  ARKANSAS: "AR",
  CALIFORNIA: "CA",
  COLORADO: "CO",
  CONNECTICUT: "CT",
  DELAWARE: "DE",
  FLORIDA: "FL",
  GEORGIA: "GA",
  HAWAII: "HI",
  IDAHO: "ID",
  ILLINOIS: "IL",
  INDIANA: "IN",
  IOWA: "IA",
  KANSAS: "KS",
  KENTUCKY: "KY",
  LOUISIANA: "LA",
  MAINE: "ME",
  MARYLAND: "MD",
  MASSACHUSETTS: "MA",
  MICHIGAN: "MI",
  MINNESOTA: "MN",
  MISSISSIPPI: "MS",
  MISSOURI: "MO",
  MONTANA: "MT",
  NEBRASKA: "NE",
  NEVADA: "NV",
  "NEW HAMPSHIRE": "NH",
  "NEW JERSEY": "NJ",
  "NEW MEXICO": "NM",
  "NEW YORK": "NY",
  "NORTH CAROLINA": "NC",
  "NORTH DAKOTA": "ND",
  OHIO: "OH",
  OKLAHOMA: "OK",
  OREGON: "OR",
  PENNSYLVANIA: "PA",
  "RHODE ISLAND": "RI",
  "SOUTH CAROLINA": "SC",
  "SOUTH DAKOTA": "SD",
  TENNESSEE: "TN",
  TEXAS: "TX",
  UTAH: "UT",
  VERMONT: "VT",
  VIRGINIA: "VA",
  WASHINGTON: "WA",
  "WEST VIRGINIA": "WV",
  WISCONSIN: "WI",
  WYOMING: "WY",
  "DISTRICT OF COLUMBIA": "DC",
};

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildTherapistProfileHref(slug) {
  var cleanSlug = String(slug || "").trim();
  return cleanSlug ? "/therapists/" + encodeURIComponent(cleanSlug) + "/" : "/directory";
}

function startZipcodesPreload() {
  if (!zipcodesPreloadPromise) {
    zipcodesPreloadPromise = preloadZipcodes().catch(function () {
      return null;
    });
  }
  return zipcodesPreloadPromise;
}

function maybeWarmZipcodesForValue(value) {
  var normalizedZip = normalizeLocationQuery(value);
  if (!normalizedZip) {
    return;
  }

  startZipcodesPreload().then(function () {
    var form = document.getElementById("matchForm");
    if (!form || !form.elements || !form.elements.location_query) {
      return;
    }
    if (normalizeLocationQuery(form.elements.location_query.value) !== normalizedZip) {
      return;
    }
    refreshIntakeUiFromForm();
  });
}

function syncMirroredFieldValues(changedNode) {
  if (!changedNode) {
    return;
  }
  var syncKey = changedNode.getAttribute("data-sync-key") || changedNode.name;
  if (!syncKey) {
    return;
  }
  if (changedNode.type === "radio" || changedNode.type === "checkbox") {
    return;
  }
  var form = document.getElementById("matchForm");
  if (!form) {
    return;
  }
  var selector = '[data-sync-key="' + syncKey + '"], [name="' + syncKey + '"]';
  Array.from(form.querySelectorAll(selector)).forEach(function (node) {
    if (node === changedNode || node.type === "radio" || node.type === "checkbox") {
      return;
    }
    node.value = changedNode.value;
  });
}

async function ensureZipcodesReadyForProfile(profile) {
  if (!normalizeLocationQuery(profile && profile.location_query)) {
    return;
  }
  await startZipcodesPreload();
}

function readShortlistReshapeHistory() {
  try {
    return JSON.parse(window.localStorage.getItem(SHORTLIST_RESHAPE_HISTORY_KEY) || "null");
  } catch (_error) {
    return null;
  }
}

function normalizeLocationQuery(value) {
  return normalizeLocationQueryBase(value);
}

function deriveStateFromLocation(value) {
  return deriveStateFromLocationBase(value, {
    therapists: therapists,
    stateMap: US_STATE_MAP,
  });
}

function syncZipResolvedLabel(value) {
  return syncZipResolvedLabelBase(value);
}

function syncMatchStartState() {
  return syncMatchStartStateBase({
    form: getMatchShellRefs().form,
    button: null, // "More filters" toggle should not be dynamically relabeled
    helper: document.getElementById("matchStartHelper"),
    careField: document.querySelector("[data-match-care-field]"),
    escapeHtml: escapeHtml,
  });
}

function setMatchPreviewText(id, value) {
  var node = document.getElementById(id);
  if (node) {
    node.textContent = value;
  }
}

function countOptionalIntakeAnswers(profile) {
  if (!profile) {
    return 0;
  }

  var count = 0;
  if (profile.insurance) count += 1;
  if (profile.budget_max) count += 1;
  if (profile.care_format) count += 1;
  if (
    profile.needs_medication_management &&
    String(profile.needs_medication_management).trim() &&
    String(profile.needs_medication_management).trim() !== "No preference"
  ) {
    count += 1;
  }
  if (
    profile.priority_mode &&
    String(profile.priority_mode).trim() &&
    String(profile.priority_mode).trim() !== "Balanced"
  ) {
    count += 1;
  }
  count += (profile.bipolar_focus || []).length ? 1 : 0;
  count += (profile.preferred_modalities || []).length ? 1 : 0;
  count += (profile.population_fit || []).length ? 1 : 0;
  return count;
}

function renderMatchIntakePreview(profile) {
  var zipStatus = getZipMarketStatus(profile && profile.location_query);
  var hasCareIntent = Boolean(profile && profile.care_intent);
  var hasZip = Boolean(profile && profile.location_query);
  var optionalCount = countOptionalIntakeAnswers(profile);
  var nextRefinement =
    profile && !profile.insurance
      ? "Insurance or payment preference is usually the cleanest next tightening move."
      : profile && !profile.care_format
        ? "Care format is often the next easiest way to narrow without overcomplicating the search."
        : profile && !profile.priority_mode
          ? "Priority mode can sharpen whether the list leans toward speed or specialization."
          : "Your optional answers are already doing more of the narrowing work.";

  if (!hasCareIntent && !hasZip) {
    setMatchPreviewText("matchPreviewStateTitle", "Start with the two required answers.");
    setMatchPreviewText(
      "matchPreviewStateCopy",
      "Care type and ZIP do most of the early narrowing before you add preferences.",
    );
    setMatchPreviewText("matchPreviewConfidenceTitle", "Give yourself a calmer first pass.");
    setMatchPreviewText(
      "matchPreviewConfidenceCopy",
      "The first list should reduce noise quickly, not demand every answer up front.",
    );
    setMatchPreviewText("matchPreviewNextTitle", "Optional preferences can wait.");
    setMatchPreviewText(
      "matchPreviewNextCopy",
      "Insurance, format, and medication details can come after the first pass if you still want a tighter list.",
    );
    return;
  }

  if (hasCareIntent && !hasZip) {
    setMatchPreviewText("matchPreviewStateTitle", "The care lane is chosen.");
    setMatchPreviewText(
      "matchPreviewStateCopy",
      "ZIP is what makes the list feel local, usable, and worth comparing.",
    );
    setMatchPreviewText("matchPreviewConfidenceTitle", "You are still keeping this lightweight.");
    setMatchPreviewText(
      "matchPreviewConfidenceCopy",
      "Once location is in place, the first match can narrow fit without trapping you in a long intake.",
    );
    setMatchPreviewText("matchPreviewNextTitle", "What can still wait.");
    setMatchPreviewText("matchPreviewNextCopy", nextRefinement);
    return;
  }

  if (!hasCareIntent && hasZip) {
    setMatchPreviewText("matchPreviewStateTitle", "Location is ready.");
    setMatchPreviewText(
      "matchPreviewStateCopy",
      zipStatus.place
        ? "We can ground the list around " +
            zipStatus.place.label +
            " once you choose whether to start with therapy or psychiatry."
        : "The local context is there. One care choice will make the first list feel far more intentional.",
    );
    setMatchPreviewText(
      "matchPreviewConfidenceTitle",
      "One answer should change the feel quickly.",
    );
    setMatchPreviewText(
      "matchPreviewConfidenceCopy",
      "Choosing the type of care usually does more to calm the search than adding lots of optional details.",
    );
    setMatchPreviewText("matchPreviewNextTitle", "What can still wait.");
    setMatchPreviewText("matchPreviewNextCopy", nextRefinement);
    return;
  }

  if (zipStatus.status === "out_of_state") {
    setMatchPreviewText("matchPreviewStateTitle", "Outside the current match area.");
    setMatchPreviewText(
      "matchPreviewStateCopy",
      "We are currently matching California ZIP codes, so the list will feel strongest once location is in-range.",
    );
    setMatchPreviewText("matchPreviewConfidenceTitle", "Do not add more detail yet.");
    setMatchPreviewText(
      "matchPreviewConfidenceCopy",
      "The smartest next move is correcting location first, not layering on more optional preferences.",
    );
    setMatchPreviewText("matchPreviewNextTitle", "What to save for later.");
    setMatchPreviewText("matchPreviewNextCopy", nextRefinement);
    return;
  }

  setMatchPreviewText("matchPreviewStateTitle", "Core match is ready.");
  setMatchPreviewText(
    "matchPreviewStateCopy",
    zipStatus.place
      ? "Starting with " +
          profile.care_intent.toLowerCase() +
          " in " +
          zipStatus.place.label +
          " should already feel more focused than broad browsing."
      : "The two required answers are in place, so the first list should feel more guided than generic.",
  );
  setMatchPreviewText(
    "matchPreviewConfidenceTitle",
    optionalCount
      ? "This should feel more opinionated."
      : "Start broad, then tighten only if needed.",
  );
  setMatchPreviewText(
    "matchPreviewConfidenceCopy",
    optionalCount
      ? "You already have " +
          optionalCount +
          " optional signal" +
          (optionalCount === 1 ? "" : "s") +
          " shaping the list, so the first pass should lean harder on fit."
      : "Run the first match now if you want a calmer starting list. Add optional details only if the first pass still feels too broad.",
  );
  setMatchPreviewText(
    "matchPreviewNextTitle",
    optionalCount
      ? "Best next refinement if you still want more certainty."
      : "What can still wait.",
  );
  setMatchPreviewText("matchPreviewNextCopy", nextRefinement);
}

function setMatchJourneyMode(mode) {
  return setMatchJourneyModeBase(mode, starterResultsMode);
}

function buildRequestSummary(profile) {
  return buildRequestSummaryBase(profile, hasMeaningfulRefinements);
}

function buildAppliedAnswerPills(profile) {
  return buildAppliedAnswerPillsBase(profile);
}

function hasMeaningfulRefinements(profile) {
  return hasMeaningfulRefinementsBase(profile);
}

function readCurrentIntakeProfile() {
  return readCurrentIntakeProfileBase({
    form: getMatchShellRefs().form,
    buildUserMatchProfile: buildUserMatchProfile,
    deriveStateFromLocation: deriveStateFromLocation,
    collectCheckedValues: collectCheckedValues,
    splitCommaSeparated: splitCommaSeparated,
  });
}

function serializeProfileToUrl(profile) {
  return serializeProfileToUrlBase(profile);
}

function restoreProfileFromUrl() {
  return restoreProfileFromUrlBase({
    buildUserMatchProfile: buildUserMatchProfile,
    deriveStateFromLocation: deriveStateFromLocation,
    splitCommaSeparated: splitCommaSeparated,
  });
}

function restoreShortlistFromUrl() {
  return restoreShortlistFromUrlBase(splitCommaSeparated);
}

function hydrateForm(profile) {
  hydrateFormBase(profile, {
    form: getMatchShellRefs().form,
    syncZipResolvedLabel: syncZipResolvedLabel,
  });
  syncMatchStartState();
  renderMatchIntakePreview(readCurrentIntakeProfile());
  renderAdaptiveIntakeGuidance(readCurrentIntakeProfile());
  renderIntakeTradeoffPreview(readCurrentIntakeProfile());
}

function scrollToTopMatches() {
  return scrollToTopMatchesBase();
}

function getRequestedZip(profile) {
  var raw = normalizeLocationQuery((profile && profile.location_query) || "");
  return /^\d{5}$/.test(raw) ? raw : "";
}

function getTherapistZipValue(therapist) {
  var zip = String((therapist && therapist.zip) || "").trim();
  return /^\d{5}$/.test(zip) ? zip : "";
}

function getZipDistance(fromZip, toZip) {
  return getZipDistanceMiles(fromZip, toZip);
}

function orderMatchEntries(entries, profile) {
  return orderMatchEntriesBase(entries, {
    locationQuery: getRequestedZip(profile),
    careFormat: profile && profile.care_format,
  });
}

function getMatchAvailabilityBonus(therapist) {
  if (!therapist) {
    return 0;
  }
  var bonus = 0;
  if (therapist.accepting_new_patients) {
    bonus += 8;
  }
  if (therapist.estimated_wait_time && therapist.estimated_wait_time !== "Waitlist only") {
    bonus += 4;
  }
  return bonus;
}

function getMatchContactClarityBonus(entry) {
  var readiness = getContactReadiness(entry);
  if (!readiness) {
    return 0;
  }
  var bonus = readiness.tone === "high" ? 8 : readiness.tone === "medium" ? 5 : 2;
  if (readiness.guidance) {
    bonus += 2;
  }
  if (readiness.firstStep) {
    bonus += 2;
  }
  return bonus;
}

function getSecondPassScore(entry, profile, mode) {
  var evaluation = entry && entry.evaluation ? entry.evaluation : {};
  var breakdown = evaluation.score_breakdown || {};
  var therapist = entry && entry.therapist ? entry.therapist : {};
  var base = Number(evaluation.score || 0) || 0;
  var trust = Number(breakdown.trust || 0) || 0;
  var clinical = Number(breakdown.clinical || 0) || 0;
  var access = Number(breakdown.access || 0) || 0;
  var practical = Number(breakdown.practical || 0) || 0;
  var learned = Number(breakdown.learned || 0) || 0;
  var confidence = Number(evaluation.confidence_score || 0) || 0;
  var completeness = Number(evaluation.completeness_score || 0) || 0;
  var bipolarYears = Math.min(Number(therapist.bipolar_years_experience || 0) || 0, 15);
  var responsiveness = getPublicResponsivenessSignal(therapist) ? 3 : 0;
  var availability = getMatchAvailabilityBonus(therapist);
  var contactClarity = getMatchContactClarityBonus(entry);

  if (mode === "reviewed") {
    return (
      base * 0.62 +
      trust * 1.55 +
      completeness * 0.14 +
      confidence * 0.12 +
      practical * 0.24 +
      (therapist.verification_status === "editorially_verified" ? 8 : 0)
    );
  }

  if (mode === "speed") {
    return base * 0.58 + access * 1.5 + availability + contactClarity * 0.8 + responsiveness;
  }

  if (mode === "specialization") {
    return (
      base * 0.58 +
      clinical * 1.6 +
      bipolarYears * 1.2 +
      (profile && profile.needs_medication_management === "Yes" && therapist.medication_management
        ? 5
        : 0)
    );
  }

  if (mode === "followthrough") {
    return (
      base * 0.58 +
      access * 1.15 +
      learned * 0.8 +
      contactClarity +
      responsiveness +
      availability * 0.35
    );
  }

  return base;
}

function applySecondPassRefinement(entries, profile, mode) {
  // Adaptive ranking disabled: every code path resolves to "balanced"
  // and returns the base order untouched. The branch below is preserved
  // for future reactivation but is currently unreachable.
  if (!mode || mode === "balanced") {
    return (entries || []).slice();
  }

  return (entries || []).slice().sort(function (a, b) {
    var aScore = getSecondPassScore(a, profile, mode);
    var bScore = getSecondPassScore(b, profile, mode);

    return (
      bScore - aScore ||
      (Number(b?.evaluation?.score) || 0) - (Number(a?.evaluation?.score) || 0) ||
      String(a?.therapist?.name || "").localeCompare(String(b?.therapist?.name || "")) ||
      String(a?.therapist?.slug || "").localeCompare(String(b?.therapist?.slug || ""))
    );
  });
}

function rankEntriesForProfile(profile) {
  return rankEntriesForProfileBase(profile, {
    therapists: therapists,
    latestLearningSignals: latestLearningSignals,
    activeSecondPassMode: activeSecondPassMode,
    rankTherapistsForUser: rankTherapistsForUser,
    orderMatchEntries: orderMatchEntries,
    applySecondPassRefinement: applySecondPassRefinement,
  });
}

function buildStarterProfile() {
  return buildStarterProfileBase({
    buildUserMatchProfile: buildUserMatchProfile,
  });
}

function renderStarterResults() {
  var starterProfile = buildStarterProfile();
  var starterEntries = rankEntriesForProfile(starterProfile);
  if (!starterEntries.length) {
    setMatchJourneyMode("intake");
    setActionState(false, "Choose your care type and ZIP code to review the top options.");
    return false;
  }

  latestProfile = null;
  latestEntries = starterEntries;
  currentJourneyId = null;
  persistedJourneyId = "";
  starterResultsMode = true;
  setMatchJourneyMode("intake");
  safeRenderResults(starterEntries, null);
  setActionState(
    true,
    "Showing a strong California starter list. Add your ZIP code and care preferences to personalize it.",
  );
  return true;
}

function getClosestZipSuggestions(profile, sourceEntries) {
  var requestedZip = getRequestedZip(profile);
  if (!requestedZip) {
    return [];
  }

  var suggestions = [];
  var seen = new Set();

  (sourceEntries || []).forEach(function (entry) {
    var zip = getTherapistZipValue(entry && entry.therapist);
    if (!zip || zip === requestedZip || seen.has(zip)) {
      return;
    }
    seen.add(zip);
    suggestions.push({
      zip: zip,
      distance: getZipDistance(requestedZip, zip),
    });
  });

  return suggestions
    .sort(function (a, b) {
      return a.distance - b.distance || a.zip.localeCompare(b.zip);
    })
    .slice(0, 3);
}

function formatZipSuggestionList(items) {
  return (items || [])
    .map(function (item) {
      return item.zip;
    })
    .join(", ");
}

function clearOptionalRefinements() {
  var form = document.getElementById("matchForm");
  if (!form) {
    return;
  }

  form.elements.insurance.value = "";
  form.elements.language_preferences.value = "";
  form.elements.care_format.value = "In-Person";
  form.elements.needs_medication_management.value = "Open to either";
  form.elements.budget_max.value = "";
  form.elements.priority_mode.value = "Best overall fit";

  ["bipolar_focus", "preferred_modalities", "population_fit"].forEach(function (name) {
    form.querySelectorAll('input[name="' + name + '"]').forEach(function (input) {
      input.checked = false;
    });
  });

  var refinements = document.querySelector(".match-refinements");
  if (refinements) {
    refinements.open = false;
  }
}

function rerunMatchFromCurrentForm() {
  handleSubmit({
    preventDefault: function () {},
  });
}

function renderNoResultsState(profile, zipSuggestions, hasRefinements) {
  var root = getMatchShellRefs().resultsRoot;
  if (!root) {
    return;
  }

  renderNoResultsStateSection({
    root: root,
    zipSuggestions: zipSuggestions,
    hasRefinements: hasRefinements,
    escapeHtml: escapeHtml,
    formatZipSuggestionList: formatZipSuggestionList,
  });

  root.querySelectorAll("[data-empty-zip]").forEach(function (button) {
    button.addEventListener("click", function () {
      var zip = button.getAttribute("data-empty-zip") || "";
      var form = document.getElementById("matchForm");
      if (!form || !zip) {
        return;
      }
      form.elements.location_query.value = zip;
      syncZipResolvedLabel(zip);
      syncMatchStartState();
      trackFunnelEvent("match_recovery_clicked", {
        action: "nearby_zip",
        zip: zip,
      });
      rerunMatchFromCurrentForm();
    });
  });

  root.querySelectorAll("[data-empty-telehealth]").forEach(function (button) {
    button.addEventListener("click", function () {
      var form = document.getElementById("matchForm");
      if (!form) {
        return;
      }
      form.elements.care_format.value = "Telehealth";
      trackFunnelEvent("match_recovery_clicked", {
        action: "telehealth",
        zip: getRequestedZip(readCurrentIntakeProfile()),
      });
      rerunMatchFromCurrentForm();
    });
  });

  root.querySelectorAll("[data-empty-clear]").forEach(function (button) {
    button.addEventListener("click", function () {
      clearOptionalRefinements();
      syncZipResolvedLabel(readCurrentIntakeProfile().location_query);
      syncMatchStartState();
      renderAdaptiveIntakeGuidance(readCurrentIntakeProfile());
      renderIntakeTradeoffPreview(readCurrentIntakeProfile());
      trackFunnelEvent("match_recovery_clicked", {
        action: "clear_optional_filters",
        zip: getRequestedZip(readCurrentIntakeProfile()),
      });
      rerunMatchFromCurrentForm();
    });
  });
}

// Live filter: when the drawer is open and we already have a valid
// care-intent + ZIP, recompute results on every field change with a
// short debounce so the list reflects the current filter state as
// the user makes choices. Keeps the panel feeling "direct-manipulation"
// instead of the old form-submit-only flow.
var liveRecomputeTimer = null;
var lastLiveCount = null;
var lastLiveTopSlug = null;
function maybeLiveRecompute(event) {
  if (!document.body.classList.contains("match-refine-drawer-open")) return;
  var form = document.getElementById("matchForm");
  if (!form) return;
  var profile = readCurrentIntakeProfile();
  var careIntent = profile && profile.care_intent ? profile.care_intent : "";
  var zip = normalizeLocationQuery(profile && profile.location_query);
  if (!careIntent || !zip) {
    // Nothing to recompute yet — surface a gentle prompt instead.
    setLiveStatus("Pick care type and a ZIP code to see live matches.", false);
    return;
  }
  setLiveStatus("Updating matches...", true);
  if (liveRecomputeTimer) {
    window.clearTimeout(liveRecomputeTimer);
  }
  var changedField =
    event && event.target && event.target.name
      ? event.target.name
      : event && event.target && event.target.id
        ? event.target.id
        : "";
  liveRecomputeTimer = window.setTimeout(async function () {
    liveRecomputeTimer = null;
    // The drawer now lives at its original DOM position (inside
    // .match-layout), NOT inside #matchResults — so wiping
    // #matchResults.innerHTML during executeMatch no longer detaches
    // the drawer subtree. Live recompute is safe again: cards under
    // the dimmed backdrop animate as the user tweaks filters.
    await ensureZipcodesReadyForProfile(profile);
    executeMatch(profile, {
      scroll: false,
      source: "match_live_refine",
    });
    var count = Array.isArray(latestEntries) ? latestEntries.length : 0;
    var topSlug =
      count > 0 && latestEntries[0] && latestEntries[0].therapist
        ? latestEntries[0].therapist.slug
        : "";
    var countChanged = lastLiveCount !== null && lastLiveCount !== count;
    var rankChanged =
      lastLiveTopSlug !== null && lastLiveTopSlug !== "" && topSlug !== lastLiveTopSlug;
    var message;
    if (count === 0) {
      message = "No matches with these filters. Try easing one.";
    } else if (count === 1) {
      message = "1 match showing";
    } else if (!countChanged && rankChanged) {
      message = count + " matches · re-ranked to fit";
    } else {
      message = count + " matches showing";
    }
    setLiveStatus(message, false);
    pulseLiveStatus();
    lastLiveCount = count;
    lastLiveTopSlug = topSlug;
    trackFunnelEvent("match_live_filter_applied", {
      changed_field: changedField,
      result_count: count,
    });
  }, 120);
}

function setLiveStatus(message, isUpdating) {
  var node = document.getElementById("matchRefineLiveStatus");
  if (!node) return;
  node.textContent = message;
  node.classList.toggle("is-updating", Boolean(isUpdating));
}

function bindInsuranceAutocomplete() {
  var input = document.getElementById("insurance");
  var list = document.getElementById("insuranceSuggestions");
  var emptyHint = document.getElementById("insuranceNoMatchHint");
  if (!input || !list || !emptyHint) return;
  if (input.dataset.autocompleteBound === "true") return;
  input.dataset.autocompleteBound = "true";

  var highlightIndex = -1;
  var currentMatches = [];

  function setExpanded(open) {
    input.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function close() {
    list.hidden = true;
    list.innerHTML = "";
    highlightIndex = -1;
    currentMatches = [];
    setExpanded(false);
  }

  function applyHighlight() {
    var items = list.querySelectorAll(".refine-autocomplete-item");
    items.forEach(function (item, index) {
      item.classList.toggle("is-highlighted", index === highlightIndex);
      if (index === highlightIndex) {
        input.setAttribute("aria-activedescendant", item.id);
        item.scrollIntoView({ block: "nearest" });
      }
    });
    if (highlightIndex < 0) {
      input.removeAttribute("aria-activedescendant");
    }
  }

  function commit(value) {
    input.value = value;
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
    close();
  }

  function refresh() {
    var raw = input.value.trim();
    if (!raw) {
      emptyHint.hidden = true;
      close();
      return;
    }
    var lowered = raw.toLowerCase();
    currentMatches = INSURANCE_OPTIONS.filter(function (option) {
      return option.toLowerCase().indexOf(lowered) !== -1;
    }).slice(0, 6);

    if (!currentMatches.length) {
      emptyHint.hidden = raw.length < 2;
      close();
      return;
    }
    emptyHint.hidden = true;

    list.innerHTML = currentMatches
      .map(function (option, index) {
        return (
          '<li id="insuranceSuggestion-' +
          index +
          '" class="refine-autocomplete-item" role="option" data-value="' +
          escapeHtml(option) +
          '">' +
          escapeHtml(option) +
          "</li>"
        );
      })
      .join("");
    list.hidden = false;
    setExpanded(true);
    highlightIndex = -1;
    applyHighlight();
  }

  input.addEventListener("input", refresh);
  input.addEventListener("focus", refresh);

  input.addEventListener("keydown", function (event) {
    if (list.hidden) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      highlightIndex = Math.min(highlightIndex + 1, currentMatches.length - 1);
      applyHighlight();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      highlightIndex = Math.max(highlightIndex - 1, 0);
      applyHighlight();
    } else if (event.key === "Enter") {
      if (highlightIndex >= 0 && currentMatches[highlightIndex]) {
        event.preventDefault();
        commit(currentMatches[highlightIndex]);
      }
    } else if (event.key === "Escape") {
      close();
    }
  });

  // Use mousedown rather than click so the input's blur (which closes
  // the list on a short delay) doesn't beat the selection.
  list.addEventListener("mousedown", function (event) {
    var item = event.target.closest(".refine-autocomplete-item");
    if (!item) return;
    event.preventDefault();
    commit(item.dataset.value || item.textContent);
  });

  input.addEventListener("blur", function () {
    // Delay so list mousedown can fire first.
    window.setTimeout(close, 120);
  });
}

function pulseLiveStatus() {
  var node = document.getElementById("matchRefineLiveStatus");
  if (!node) return;
  node.classList.remove("is-pulsing");
  // Force reflow so the animation restarts even when the same class
  // toggles back on within a single frame.
  void node.offsetWidth;
  node.classList.add("is-pulsing");
}

// Drawer state + keyboard handling. The refine panel renders as a
// fixed right-side drawer when body.match-refine-drawer-open is set;
// these helpers keep the toggle button, ESC key, and backdrop in sync.
function setRefineDrawerOpen(open) {
  var refinements = document.querySelector(".match-refinements");
  var moreBtn = document.getElementById("openAdvancedFiltersButton");
  var bodyClass = "match-refine-drawer-open";
  // After a match runs, placeBuilderInResults wraps .match-builder in a
  // <details id="matchRefineSection"> that starts closed. Children of a
  // closed <details> are hidden by the UA stylesheet (content-visibility),
  // which collapses our position:fixed drawer to height 0 and pins it
  // ~2000px down the page. Opening the wrapper restores normal layout
  // for the descendants.
  var refineSection = document.getElementById("matchRefineSection");
  if (open) {
    document.body.classList.add(bodyClass);
    if (refineSection) {
      refineSection.open = true;
    }
    if (refinements) {
      refinements.open = true;
    }
    if (moreBtn) {
      moreBtn.setAttribute("aria-expanded", "true");
      moreBtn.classList.add("is-expanded");
    }
    // Focus the close button so keyboard users land in the drawer
    // instead of being stuck on the underlying toggle.
    window.requestAnimationFrame(function () {
      var close = document.getElementById("matchRefineDrawerClose");
      if (close) close.focus();
    });
    trackFunnelEvent("match_refine_drawer_opened", {
      care_intent: (document.getElementById("matchForm") || { elements: {} }).elements
        ? (document.getElementById("matchForm").elements.care_intent || { value: "" }).value || ""
        : "",
    });
    recordMatchSessionInteraction("refine_open");
    // Kick off an immediate recompute so results behind the drawer reflect
    // current filters before the user touches anything. Prevents the "empty
    // looking" feeling when opening Narrow results on a pre-search state.
    window.requestAnimationFrame(function () {
      maybeLiveRecompute(null);
    });
  } else {
    document.body.classList.remove(bodyClass);
    if (refinements) {
      refinements.open = false;
    }
    if (refineSection) {
      refineSection.open = false;
    }
    if (moreBtn) {
      moreBtn.setAttribute("aria-expanded", "false");
      moreBtn.classList.remove("is-expanded");
    }
    // Return focus to whichever Refine trigger the user actually clicked
    // from. The header Refine button (rendered into #matchResults after
    // a match runs) is the canonical entry point in results mode; only
    // fall back to the inline Customize button when there's no header
    // button (empty / pre-match state).
    window.requestAnimationFrame(function () {
      var headerRefine = document.querySelector('[data-mx-refine-open="header"]');
      if (headerRefine && typeof headerRefine.focus === "function") {
        headerRefine.focus();
        return;
      }
      if (moreBtn && typeof moreBtn.focus === "function") {
        moreBtn.focus();
      }
    });
  }
}

function bindRefineButtons() {
  // refineSearchButton: external trigger — always opens the drawer
  var externalBtn = document.getElementById("refineSearchButton");
  if (externalBtn && externalBtn.dataset.boundRefine !== "true") {
    externalBtn.dataset.boundRefine = "true";
    externalBtn.addEventListener("click", function () {
      setRefineDrawerOpen(true);
    });
  }

  // openAdvancedFiltersButton: inline toggle button → drawer toggle
  var moreBtn = document.getElementById("openAdvancedFiltersButton");
  if (moreBtn && moreBtn.dataset.boundRefine !== "true") {
    moreBtn.dataset.boundRefine = "true";
    moreBtn.addEventListener("click", function () {
      var isOpen = document.body.classList.contains("match-refine-drawer-open");
      setRefineDrawerOpen(!isOpen);
    });
  }

  // Backdrop click → close
  var backdrop = document.getElementById("matchRefineBackdrop");
  if (backdrop && backdrop.dataset.boundRefine !== "true") {
    backdrop.dataset.boundRefine = "true";
    backdrop.addEventListener("click", function () {
      setRefineDrawerOpen(false);
    });
  }

  // Explicit close button inside the drawer header
  var close = document.getElementById("matchRefineDrawerClose");
  if (close && close.dataset.boundRefine !== "true") {
    close.dataset.boundRefine = "true";
    close.addEventListener("click", function () {
      setRefineDrawerOpen(false);
    });
  }

  // ESC anywhere closes the drawer
  if (!document.body.dataset.boundRefineEsc) {
    document.body.dataset.boundRefineEsc = "true";
    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      if (!document.body.classList.contains("match-refine-drawer-open")) return;
      setRefineDrawerOpen(false);
    });
  }
}

function bindRefineTeaserShortcuts() {
  document.querySelectorAll("[data-refine-teaser]").forEach(function (teaser) {
    if (teaser.dataset.boundRefineTeaser === "true") {
      return;
    }
    teaser.dataset.boundRefineTeaser = "true";

    function activateTeaser(event) {
      if (event) {
        event.preventDefault();
      }

      var refinements = document.querySelector(".match-refinements");
      var builder = document.querySelector(".match-builder");
      var form = document.getElementById("matchForm");
      var targetName = teaser.getAttribute("data-refine-target") || "";
      var targetValue = teaser.getAttribute("data-refine-value") || "";
      if (!form || !targetName) {
        return;
      }

      if (refinements) {
        refinements.open = true;
      }
      if (builder) {
        builder.scrollIntoView({ behavior: "smooth", block: "start" });
      }

      var target = form.elements[targetName] || document.getElementById(targetName);
      if (!target) {
        return;
      }

      if (targetValue && "value" in target) {
        target.value = targetValue;
        target.dispatchEvent(new window.Event("input", { bubbles: true }));
        target.dispatchEvent(new window.Event("change", { bubbles: true }));
      }

      window.requestAnimationFrame(function () {
        if (typeof target.focus === "function") {
          target.focus({ preventScroll: true });
        }
        if (typeof target.select === "function" && !targetValue) {
          target.select();
        }
      });

      trackFunnelEvent("match_refine_teaser_clicked", {
        teaser: teaser.getAttribute("data-refine-teaser") || targetName,
        target: targetName,
        applied_value: targetValue || "",
      });
    }

    teaser.addEventListener("click", activateTeaser);
    teaser.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        activateTeaser(event);
      }
    });
  });
}

function bindPrimaryMatchSlider(root) {
  if (!root) {
    return;
  }

  var track = root.querySelector("[data-match-card-slider-track]");
  if (!track) {
    return;
  }

  var slides = Array.prototype.slice.call(track.querySelectorAll(".match-card-slide"));
  var prevButton = root.querySelector("[data-match-card-slider-prev]");
  var nextButton = root.querySelector("[data-match-card-slider-next]");
  var count = root.querySelector("[data-match-card-slider-count]");
  var dots = Array.prototype.slice.call(root.querySelectorAll("[data-match-card-slider-dot]"));
  if (!slides.length) {
    return;
  }

  function getCurrentIndex() {
    var width = track.clientWidth || 1;
    return Math.max(0, Math.min(slides.length - 1, Math.round(track.scrollLeft / width)));
  }

  function updateState() {
    var index = getCurrentIndex();
    if (prevButton) {
      prevButton.disabled = index <= 0;
    }
    if (nextButton) {
      nextButton.disabled = index >= slides.length - 1;
    }
    if (count) {
      count.textContent = String(index + 1) + " of " + String(slides.length);
    }
    dots.forEach(function (dot, dotIndex) {
      var isActive = dotIndex === index;
      dot.classList.toggle("is-active", isActive);
      dot.setAttribute("aria-current", isActive ? "true" : "false");
    });
  }

  function scrollToIndex(index) {
    var width = track.clientWidth || 1;
    track.scrollTo({
      left: Math.max(0, Math.min(slides.length - 1, index)) * width,
      behavior: "smooth",
    });
  }

  if (prevButton) {
    prevButton.addEventListener("click", function () {
      scrollToIndex(getCurrentIndex() - 1);
    });
  }
  if (nextButton) {
    nextButton.addEventListener("click", function () {
      scrollToIndex(getCurrentIndex() + 1);
    });
  }
  dots.forEach(function (dot, index) {
    dot.addEventListener("click", function () {
      scrollToIndex(index);
    });
  });

  track.addEventListener("scroll", updateState, { passive: true });
  window.addEventListener("resize", updateState);
  updateState();
}

function bindSummaryMatchSlider(root) {
  if (!root) {
    return;
  }

  var track = root.querySelector("[data-match-summary-slider-track]");
  if (!track) {
    return;
  }

  var slides = Array.prototype.slice.call(track.querySelectorAll(".match-summary-slide"));
  var prevButton = root.querySelector("[data-match-summary-slider-prev]");
  var nextButton = root.querySelector("[data-match-summary-slider-next]");
  var count = root.querySelector("[data-match-summary-slider-count]");
  var dots = Array.prototype.slice.call(root.querySelectorAll("[data-match-summary-slider-dot]"));
  if (!slides.length) {
    return;
  }

  function getCurrentIndex() {
    var width = track.clientWidth || 1;
    return Math.max(0, Math.min(slides.length - 1, Math.round(track.scrollLeft / width)));
  }

  function updateState() {
    var index = getCurrentIndex();
    if (prevButton) {
      prevButton.disabled = index <= 0;
    }
    if (nextButton) {
      nextButton.disabled = index >= slides.length - 1;
    }
    if (count) {
      count.textContent = String(index + 1) + " of " + String(slides.length);
    }
    dots.forEach(function (dot, dotIndex) {
      var isActive = dotIndex === index;
      dot.classList.toggle("is-active", isActive);
      dot.setAttribute("aria-current", isActive ? "true" : "false");
    });
  }

  function scrollToIndex(index) {
    var width = track.clientWidth || 1;
    track.scrollTo({
      left: Math.max(0, Math.min(slides.length - 1, index)) * width,
      behavior: "smooth",
    });
  }

  if (prevButton) {
    prevButton.addEventListener("click", function () {
      scrollToIndex(getCurrentIndex() - 1);
    });
  }
  if (nextButton) {
    nextButton.addEventListener("click", function () {
      scrollToIndex(getCurrentIndex() + 1);
    });
  }
  dots.forEach(function (dot, index) {
    dot.addEventListener("click", function () {
      scrollToIndex(index);
    });
  });

  track.addEventListener("scroll", updateState, { passive: true });
  window.addEventListener("resize", updateState);
  updateState();
}

function executeMatch(profile, options) {
  var settings = Object.assign({ scroll: false, source: "match_page" }, options || {});
  var zipStatus = getZipMarketStatus(profile && profile.location_query);
  starterResultsMode = false;

  if (zipStatus.status === "invalid") {
    setMatchJourneyMode("intake");
    setActionState(false, "Enter a valid 5-digit ZIP code to review your top options.");
    renderIntakeTradeoffPreview(profile);
    return false;
  }

  if (zipStatus.status === "out_of_state") {
    setMatchJourneyMode("intake");
    setActionState(false, zipStatus.message || "We are not currently live in that state yet.");
    renderIntakeTradeoffPreview(profile);
    return false;
  }

  if (zipStatus.status === "unknown") {
    setMatchJourneyMode("results");
    setActionState(
      false,
      "No exact reviewed profile is live in this ZIP code yet. Try a nearby ZIP or widen to telehealth.",
    );
    renderIntakeTradeoffPreview(profile);
    return false;
  }

  if (!profile.care_state || !profile.care_intent) {
    setMatchJourneyMode("intake");
    setActionState(false, "Choose your care type and ZIP code to review your top options.");
    renderIntakeTradeoffPreview(profile);
    return false;
  }

  // Adaptive ranking is disabled — every submit uses the deterministic
  // base + zip-aware pipeline. getAdaptiveSecondPassMode() and
  // getSecondPassScore() are intentionally left in place for future
  // reactivation; they are not consulted today.
  activeSecondPassMode = "balanced";
  var entries = rankEntriesForProfile(profile);
  // Flush any prior session's outcome before we overwrite stats — this
  // covers the in-tab refine flow where match_submitted fires multiple
  // times without a navigation.
  if (matchSessionStats && !matchSessionStats.outcome_emitted) {
    emitMatchSessionOutcome();
  }
  trackFunnelEvent("match_submitted", {
    care_state: profile.care_state,
    care_intent: profile.care_intent,
    urgency: profile.urgency,
    priority_mode: profile.priority_mode,
    result_count: entries.length,
    top_slug: entries[0] ? entries[0].therapist.slug : "",
    top_has_photo: Boolean(entries[0] && entries[0].therapist && entries[0].therapist.photo_url),
    strategy: buildAdaptiveStrategySnapshot(profile),
    experiments: getActiveExperimentContext(),
    source: settings.source,
  });
  startMatchSessionTracking(profile, entries);
  latestProfile = profile;
  latestEntries = entries;
  serializeProfileToUrl(profile);
  setMatchJourneyMode("results");
  safeRenderResults(entries, profile);
  if (settings.scroll) {
    scrollToTopMatches();
  }
  return true;
}

function collectCheckedValues(form, name) {
  return Array.from(form.querySelectorAll('input[name="' + name + '"]:checked')).map(
    function (input) {
      return input.value;
    },
  );
}

function getOutcomeOption(outcome) {
  return OUTREACH_OUTCOME_OPTIONS.find(function (item) {
    return item.value === outcome;
  });
}

function formatOutcomeLabel(outcome) {
  var option = getOutcomeOption(outcome);
  return option ? option.label : String(outcome || "").replace(/_/g, " ");
}

function shouldAdvanceOutreachFocus(outcome) {
  return ["no_response", "waitlist", "insurance_mismatch"].indexOf(String(outcome || "")) !== -1;
}

function getNextOutreachSlug(currentSlug) {
  var shortlist = Array.isArray(latestEntries)
    ? latestEntries.slice(0, PRIMARY_SHORTLIST_LIMIT)
    : [];
  var currentIndex = shortlist.findIndex(function (entry) {
    return entry && entry.therapist && entry.therapist.slug === currentSlug;
  });
  if (currentIndex === -1) {
    return "";
  }
  var nextEntry = shortlist[currentIndex + 1];
  return nextEntry && nextEntry.therapist ? nextEntry.therapist.slug : "";
}

function formatTherapistLocationLine(therapist) {
  var city = String((therapist && therapist.city) || "").trim();
  var state = String((therapist && therapist.state) || "").trim();
  var zip = String((therapist && therapist.zip) || "").trim();
  var cityState = [city, state].filter(Boolean).join(", ");
  if (cityState && /^\d{5}$/.test(zip)) {
    return cityState + " " + zip;
  }
  return cityState || zip;
}

function buildJourneyId(profile, entries) {
  return [
    Date.now(),
    (profile && profile.care_state) || "directory",
    (entries || [])
      .slice(0, PRIMARY_SHORTLIST_LIMIT)
      .map(function (entry) {
        return entry.therapist.slug;
      })
      .join("-"),
  ].join(":");
}

function readDirectoryShortlist() {
  return readSavedList();
}

function persistEntriesToDirectoryShortlist(entries) {
  var existing = readSavedList();
  var merged = (entries || [])
    .slice(0, SAVED_LIST_MAX)
    .map(function (entry) {
      var slug = (entry && entry.therapist && entry.therapist.slug) || "";
      if (!slug) return null;
      var saved = existing.find(function (item) {
        return item.slug === slug;
      });
      return {
        slug: slug,
        priority:
          String((entry && entry.evaluation && entry.evaluation.shortlist_priority) || "").trim() ||
          String((saved && saved.priority) || "").trim(),
        note:
          String((entry && entry.evaluation && entry.evaluation.shortlist_note) || "").trim() ||
          String((saved && saved.note) || "").trim(),
      };
    })
    .filter(Boolean);

  if (!merged.length) return readSavedList();
  return replaceSavedList(merged);
}

function buildShortlistComparePath(entries) {
  var slugs = (entries || [])
    .slice(0, PRIMARY_SHORTLIST_LIMIT)
    .map(function (entry) {
      return entry?.therapist?.slug || "";
    })
    .filter(Boolean);
  var params = new URLSearchParams();
  if (slugs.length) {
    params.set("shortlist", slugs.join(","));
  }
  if (directoryEntryMode) {
    params.set("entry", directoryEntryMode);
  }

  var query = params.toString();
  return query ? "match.html?" + query : "match.html";
}

function buildShortlistCompareUrl(entries) {
  var path = buildShortlistComparePath(entries);
  return new URL(path, window.location.href).toString();
}

function buildDirectoryBrowseUrl(profile) {
  var params = new URLSearchParams();

  if (profile && profile.care_state) {
    params.set("state", profile.care_state);
  }
  if (profile && profile.insurance) {
    params.set("insurance", profile.insurance);
  }
  if (profile && profile.care_format === "Telehealth") {
    params.set("telehealth", "true");
  }
  if (
    profile &&
    (profile.care_intent === "Psychiatry" || profile.needs_medication_management === "Yes")
  ) {
    params.set("medication_management", "true");
  }

  var query = params.toString();
  return "directory.html" + (query ? "?" + query : "");
}

function buildPrimaryResultAction(entry) {
  if (!entry || !entry.therapist) {
    return null;
  }

  var therapist = entry.therapist;
  var preferredRoute = getPreferredOutreach(entry);
  var routeType = getPreferredRouteType(entry);
  var label =
    routeType === "booking"
      ? "Start with " + therapist.name
      : routeType === "phone"
        ? "Call " + therapist.name
        : routeType === "email"
          ? "Email " + therapist.name
          : routeType === "website"
            ? "Visit " + therapist.name + "'s site"
            : "Open " + therapist.name + "'s profile";

  return {
    href: preferredRoute ? preferredRoute.href : buildTherapistProfileHref(therapist.slug),
    label: label,
    external: Boolean(preferredRoute && preferredRoute.external),
    therapistSlug: therapist.slug || "",
    therapistName: therapist.name || "",
  };
}

function renderTags(values) {
  return (values || [])
    .filter(Boolean)
    .map(function (value) {
      return '<span class="match-summary-pill">' + escapeHtml(value) + "</span>";
    })
    .join("");
}

function getResponsivenessScore(therapist) {
  return getResponsivenessScoreBase(therapist, {
    getPublicResponsivenessSignal: getPublicResponsivenessSignal,
  });
}

function formatSegmentLabel(segment) {
  return String(segment || "")
    .split(":")[1]
    .replace(/-/g, " ");
}

function initMatchCareDropdown() {
  var select = document.getElementById("care_intent_primary");

  if (!select) {
    return;
  }

  ["change", "input"].forEach(function (eventName) {
    select.addEventListener(eventName, function () {
      syncMatchStartState();
    });
  });

  syncMatchStartState();
}

function getSegmentLearningCopy(evaluation) {
  var segments =
    evaluation && Array.isArray(evaluation.active_segments) ? evaluation.active_segments : [];
  if (!segments.length) {
    return "";
  }

  return (
    "Reinforced by similar " +
    segments.slice(0, 2).map(formatSegmentLabel).join(" / ") +
    " searches."
  );
}

function getSegmentAwareRecommendationCue(profile, evaluation) {
  var segments =
    evaluation && Array.isArray(evaluation.active_segments) ? evaluation.active_segments : [];
  if ((profile && profile.insurance) || segments.includes("insurance:user")) {
    return "Confirm coverage and expected out-of-pocket cost early so you do not lose momentum on a practical mismatch.";
  }
  if (
    (profile && profile.care_intent === "Psychiatry") ||
    (profile && profile.needs_medication_management === "Yes") ||
    segments.some(function (segment) {
      return segment.indexOf("intent:psychiatry") === 0 || segment.indexOf("medication:yes") === 0;
    })
  ) {
    return "Be direct about medication or psychiatry needs so the therapist can tell you quickly whether this is the right clinical path.";
  }
  if (profile && profile.care_format) {
    return "Name your preferred format in the first outreach so you can avoid losing time on the wrong care setup.";
  }
  return "";
}

function getSegmentAwareDraftAsk(profile, recommendation) {
  var evaluation = recommendation && recommendation.entry ? recommendation.entry.evaluation : null;
  var segments =
    evaluation && Array.isArray(evaluation.active_segments) ? evaluation.active_segments : [];
  var questions = ["Are you currently accepting new clients for care like this?"];

  if ((profile && profile.insurance) || segments.includes("insurance:user")) {
    questions.push(
      "Do you take " +
        (profile && profile.insurance ? profile.insurance : "this insurance") +
        ", or what should I expect for out-of-pocket cost?",
    );
  } else if (
    (profile && profile.care_intent === "Psychiatry") ||
    (profile && profile.needs_medication_management === "Yes") ||
    segments.some(function (segment) {
      return segment.indexOf("intent:psychiatry") === 0 || segment.indexOf("medication:yes") === 0;
    })
  ) {
    questions.push("Do you support medication management or psychiatry needs like this?");
  } else if (profile && profile.care_format) {
    questions.push("Do you currently have " + profile.care_format.toLowerCase() + " availability?");
  }

  questions.push(
    "If it seems like a fit, is " + recommendation.route.toLowerCase() + " the best first step?",
  );

  return "A couple of quick questions before I go too far:\n- " + questions.join("\n- ");
}

function buildEntryOutreachDraft(entry, profile) {
  if (!entry || !entry.therapist) {
    return "";
  }

  var routeType = getPreferredRouteType(entry);
  var route =
    routeType === "booking"
      ? "Book a consultation"
      : routeType === "phone"
        ? "Call"
        : routeType === "email"
          ? "Email"
          : routeType === "website"
            ? "Visit the website"
            : "Review profile";
  var therapist = entry.therapist;
  var reasons = Array.isArray(entry?.evaluation?.reasons)
    ? entry.evaluation.reasons.filter(Boolean)
    : [];
  var fitSignal = reasons[0] || "";
  var careIntent = profile && profile.care_intent ? String(profile.care_intent).trim() : "";
  var careFormat = profile && profile.care_format ? String(profile.care_format).trim() : "";
  var insurance = profile && profile.insurance ? String(profile.insurance).trim() : "";
  var wantsMedication =
    profile && (profile.needs_medication_management === "Yes" || careIntent === "Psychiatry");
  var intent = careIntent
    ? "I am looking for " + careIntent.toLowerCase() + "."
    : "I am looking for bipolar-informed care.";
  var introLine =
    "Hi " +
    therapist.name +
    ",\n\nI found your profile on BipolarTherapyHub and wanted to reach out because your practice looks like a promising place to start.";
  var contextBits = [
    intent,
    profile && profile.care_state ? "I am hoping to find care in " + profile.care_state + "." : "",
    careFormat ? "My preferred format is " + careFormat.toLowerCase() + "." : "",
    wantsMedication
      ? "Medication support or coordination is part of what I am trying to confirm."
      : "",
    insurance
      ? "Cost fit matters on my side, so I am also trying to confirm insurance or fee fit early."
      : "",
  ].filter(Boolean);
  var context = contextBits.join(" ");
  var whyNow = fitSignal
    ? "One reason I paused on your profile is that it appears to " +
      fitSignal.charAt(0).toLowerCase() +
      fitSignal.slice(1) +
      "."
    : "I am trying to start with an option that looks both credible and realistic to contact.";
  var ask = getSegmentAwareDraftAsk(profile, {
    route: route,
    entry: entry,
  });
  var close =
    "If it looks like a fit, I would really appreciate a quick note on the best next step.\n\nThank you,\nA BipolarTherapyHub visitor";

  return [introLine, context, whyNow, ask, close].filter(Boolean).join("\n\n");
}

function buildEntryOutreachSubject(entry, profile) {
  var therapist = entry && entry.therapist ? entry.therapist : null;
  if (!therapist) {
    return "Question about care availability";
  }

  var intent = profile && profile.care_intent ? String(profile.care_intent).trim() : "";
  var insurance = profile && profile.insurance ? String(profile.insurance).trim() : "";
  if (intent === "Psychiatry") {
    return insurance
      ? "Quick question about bipolar-informed psychiatry and insurance fit"
      : "Quick question about bipolar-informed psychiatry availability";
  }
  if (intent) {
    return insurance
      ? "Quick question about bipolar-informed " + intent.toLowerCase() + " and insurance fit"
      : "Quick question about bipolar-informed " + intent.toLowerCase() + " availability";
  }
  return insurance
    ? "Quick question about bipolar-informed care and insurance fit"
    : "Quick question about bipolar-informed care availability";
}

function getShortlistSummary(entry) {
  var therapist = entry.therapist;
  var pills = [
    therapist.verification_status === "editorially_verified" ? "Verified" : "",
    therapist.accepting_new_patients ? "Accepting patients" : "",
    therapist.medication_management ? "Medication support" : "",
  ].filter(Boolean);

  return renderTags(pills);
}

// Engine reasons that every result on the page already passes — they
// describe being on the list at all, not why THIS one over the others.
// Suppressed in the supporting-card explanation so we don't dilute
// trust with commodity bullets like "Available by telehealth in
// California" (true of ~80% of CA listings).
var COMMODITY_REASON_RE =
  /^Sees patients in person|^Available by telehealth|^Matches the requested care type|^Matches at least one of the requested|^Offers telehealth/i;

function getMatchCardExplanation(entry) {
  // Prefer the specific/differentiating reasons we synthesize from the
  // therapist record. The engine's top reasons are often hard-constraint
  // matches (care type, format) that every result already passes, so they
  // don't tell the user *why this one*.
  var fit = getHeroFitReasons(entry, (entry && entry.therapist) || {}, latestProfile);
  if (fit.length) {
    return fit[0];
  }
  var reasons = Array.isArray(entry?.evaluation?.reasons)
    ? entry.evaluation.reasons.filter(Boolean)
    : [];
  // Drop commodity reasons before falling back. If none remain, return
  // empty so the card hides the "Why this may be a good fit" block
  // entirely — better than showing a non-differentiating bullet.
  var differentiating = reasons.filter(function (r) {
    return !COMMODITY_REASON_RE.test(String(r).replace(/\.$/, ""));
  });
  return differentiating[0] || "";
}

// Bipolar-specific modalities + how to describe them. IPSRT and FFT have
// the strongest evidence base for bipolar; CBT-BD is the bipolar-adapted
// CBT variant.
var BIPOLAR_RELEVANT_MODALITIES = {
  IPSRT: "Trained in IPSRT, a bipolar-specific therapy",
  FFT: "Family-focused therapy (proven for bipolar)",
  "CBT-BD": "CBT adapted for bipolar disorder",
  "Family therapy": "Family therapy — supports bipolar households",
  Psychoeducation: "Psychoeducation — core to bipolar self-management",
};

function reasonsInsuranceMatches(requestedRaw, acceptedList) {
  if (!requestedRaw || !Array.isArray(acceptedList) || !acceptedList.length) return false;
  var requested = String(requestedRaw)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!requested) return false;
  return acceptedList.some(function (item) {
    var n = String(item || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    return n && (n === requested || n.includes(requested) || requested.includes(n));
  });
}

// Build the hero card's "Why this may be a good fit" list. Prioritize
// concrete, differentiating signals over the engine's top-weighted
// reasons (which are usually hard-constraint matches every result
// already passes — "Sees patients in person nearby" / "Matches the
// requested care type"). Falls back to filtered engine reasons if the
// therapist record is too sparse to synthesize anything specific.
function getHeroFitReasons(entry, therapist, profileArg) {
  var profile = profileArg || {};
  var out = [];

  // 1. Concrete bipolar experience (years, when ≥ 3) — most specific
  //    signal a patient cares about. "8 years" beats "substantial".
  var years = Number(therapist.bipolar_years_experience || 0);
  if (years >= 3) {
    out.push(years + " " + (years === 1 ? "year" : "years") + " specializing in bipolar care");
  }

  // 2. Specific bipolar specialty overlap — prefer what the user asked
  //    for; otherwise surface bipolar-subtype specialties the therapist
  //    actually treats.
  var specialties = Array.isArray(therapist.specialties)
    ? therapist.specialties.filter(Boolean)
    : [];
  if (specialties.length) {
    var requestedFocus = Array.isArray(profile.bipolar_focus) ? profile.bipolar_focus : [];
    var matched = requestedFocus.length
      ? specialties.filter(function (s) {
          return requestedFocus.some(function (r) {
            return String(s).toLowerCase() === String(r).toLowerCase();
          });
        })
      : specialties.filter(function (s) {
          return /bipolar|cycl|mixed|psychos/i.test(s);
        });
    if (matched.length) {
      out.push("Treats " + matched.slice(0, 2).join(" + "));
    }
  }

  // 3. Bipolar-relevant modality (IPSRT, FFT, CBT-BD, etc.)
  var modalities = Array.isArray(therapist.treatment_modalities)
    ? therapist.treatment_modalities
    : [];
  for (var i = 0; i < modalities.length; i++) {
    var label = BIPOLAR_RELEVANT_MODALITIES[modalities[i]];
    if (label) {
      out.push(label);
      break;
    }
  }

  // 4. Insurance match named explicitly — high practical signal
  if (
    profile.insurance &&
    reasonsInsuranceMatches(profile.insurance, therapist.insurance_accepted)
  ) {
    out.push("In-network with " + profile.insurance);
  }

  // 5. Concrete timing — only when it's actually fast. Vague timing
  //    isn't worth a bullet.
  var wait = therapist.estimated_wait_time ? String(therapist.estimated_wait_time) : "";
  if (/within\s*1\s*week|same\s*week|days|immediate/i.test(wait)) {
    out.push("Openings " + wait.toLowerCase());
  }

  // 6. Medication management when the user asked for it
  if (profile.needs_medication_management === "Yes" && therapist.medication_management) {
    out.push("Provides medication management");
  }

  // 7. Editorial verification — trust signal
  if (therapist.verification_status === "editorially_verified" && out.length < 3) {
    out.push("Editor-verified profile");
  }

  // Backfill from engine reasons, but skip the table-stakes ones.
  if (out.length < 2) {
    var engineReasons = Array.isArray(entry && entry.evaluation && entry.evaluation.reasons)
      ? entry.evaluation.reasons.filter(Boolean)
      : [];
    var GENERIC =
      /^Sees patients in person|^Available by telehealth|^Matches the requested care type|^Matches at least one|^Offers telehealth/i;
    for (var j = 0; j < engineReasons.length && out.length < 3; j++) {
      var r = engineReasons[j].replace(/\.$/, "");
      if (!GENERIC.test(r)) out.push(r);
    }
  }

  return out.slice(0, 3);
}

function getMatchCardCaution(entry) {
  var cautions = Array.isArray(entry?.evaluation?.cautions)
    ? entry.evaluation.cautions.filter(Boolean)
    : [];
  return cautions[0] || "";
}

function getMatchCardActionCopy(entry) {
  var readiness = getContactReadiness(entry);
  if (readiness && readiness.guidance) {
    return readiness.guidance;
  }
  if (readiness && readiness.firstStep) {
    return readiness.firstStep;
  }
  return "Start with the clearest contact path here, then move to your backup if this option stalls.";
}

function getMatchCardRouteConfidence(entry) {
  var readiness = getContactReadiness(entry);
  if (!readiness) {
    return "Open profile before deciding on outreach";
  }
  if (readiness.tone === "high") {
    return "Ready for first outreach";
  }
  if (readiness.tone === "medium") {
    return "Open first, then likely reach out";
  }
  return "Save or review before outreach";
}

function getMatchCardActionTiming(entry) {
  var readiness = getContactReadiness(entry);
  if (!readiness) {
    return "Best used as a review-first option until the full profile makes the route feel clearer.";
  }
  if (readiness.tone === "high") {
    return "This looks strong enough to move toward first outreach after one quick profile review.";
  }
  if (readiness.tone === "medium") {
    return "Open the profile first, then decide whether this should become the lead contact or stay as backup.";
  }
  return "Keep this as a comparison or backup route unless the profile materially strengthens the case for contact.";
}

function getMatchCardReachOutPromise(entry) {
  var readiness = getContactReadiness(entry);
  if (!readiness) {
    return "Start with the profile, confirm whether the basics fit, and keep your list intact if you are not ready to reach out yet.";
  }
  if (readiness.wait) {
    return (
      "Go in expecting " +
      readiness.wait.toLowerCase() +
      ". If timing feels off, move to your backup before widening the search."
    );
  }
  if (readiness.tone === "high") {
    return "This looks like a lower-friction first contact. Use the outreach draft if you want a calmer, more confident first move.";
  }
  if (readiness.tone === "medium") {
    return "This route should work well if you want a direct first step without committing to a call or full intake right away.";
  }
  return "Start by reviewing the profile details, then use your saved list to decide whether to reach out or keep comparing.";
}

function getLeadMatchTrustSummary(entry) {
  var therapist = entry && entry.therapist ? entry.therapist : null;
  if (!therapist) {
    return "This provider rose because the fit and practical follow-through signals are stronger than the rest of the list.";
  }

  if (therapist.verification_status === "editorially_verified") {
    return "This profile has been editorially reviewed, so the public details are more trustworthy than a generic directory listing.";
  }

  if (therapist.bipolar_years_experience) {
    return (
      "This profile shows " +
      therapist.bipolar_years_experience +
      " years of bipolar-related care experience, which gives you a stronger signal before first outreach."
    );
  }

  return "This provider rose because the fit, trust, and practical next-step signals are stronger than the rest of the list.";
}

function renderLeadMatchSnapshot(entry) {
  var therapist = entry && entry.therapist ? entry.therapist : null;
  if (!therapist) {
    return "";
  }

  var trustLabel = getCompareTrustLabel(entry) || "Trust details still partial";
  var freshness = getCompareFreshness(entry);
  var timingLabel = getCompareTimingLabel(therapist) || "Timing not clearly listed yet";
  var snapshots = [
    {
      label: "Why trust this",
      copy: getLeadMatchTrustSummary(entry),
    },
    {
      label: "What supports it",
      copy: freshness ? trustLabel + " • " + freshness.label : trustLabel,
    },
    {
      label: "What to expect",
      copy: timingLabel,
    },
  ];

  return (
    '<div class="match-section"><h4>Why this may be a good fit</h4><div class="match-snapshot-grid">' +
    snapshots
      .map(function (item) {
        return (
          '<div class="match-snapshot-card"><div class="match-snapshot-label">' +
          escapeHtml(item.label) +
          '</div><div class="match-snapshot-copy">' +
          escapeHtml(item.copy) +
          "</div></div>"
        );
      })
      .join("") +
    "</div></div>"
  );
}

function renderCompareValue(value, kind) {
  if (kind === "order") {
    var tone = value === "#1 Best match" ? "positive" : "neutral";
    return (
      '<div class="compare-cell-center"><span class="compare-chip compare-chip-' +
      tone +
      '">' +
      escapeHtml(value) +
      "</span></div>"
    );
  }
  if (kind === "format") {
    if (Array.isArray(value)) {
      return value.length
        ? value
            .map(function (item) {
              return '<div class="compare-format-item">' + escapeHtml(item) + "</div>";
            })
            .join("")
        : '<span class="compare-sub">Not listed</span>';
    }
    return value
      ? '<div class="compare-format-item">' + escapeHtml(String(value)) + "</div>"
      : '<span class="compare-sub">Not listed</span>';
  }
  if (kind === "boolean") {
    if (value === true) {
      return "Available";
    }
    if (value === false) {
      return '<span class="compare-sub">Not listed</span>';
    }
  }
  if (Array.isArray(value)) {
    return value.length
      ? value
          .map(function (item) {
            return '<span class="compare-list-item">' + escapeHtml(item) + "</span>";
          })
          .join("")
      : '<span class="compare-sub">Not listed</span>';
  }
  if (value === true) {
    return "Yes";
  }
  if (value === false) {
    return "No";
  }
  if (value === null || value === undefined || value === "") {
    return '<span class="compare-sub">Not listed</span>';
  }
  return escapeHtml(String(value));
}

function getCompareCostLabel(therapist) {
  if (!therapist) {
    return "";
  }

  var min = therapist.session_fee_min;
  var max = therapist.session_fee_max;
  if (min && max && min !== max) {
    return "$" + min + "–$" + max;
  }
  if (min) {
    return "$" + min;
  }
  if (max) {
    return "Up to $" + max;
  }
  if (therapist.sliding_scale) {
    return "Sliding scale available";
  }
  return "";
}

function getCompareTimingLabel(therapist) {
  if (!therapist) {
    return "";
  }
  if (therapist.estimated_wait_time) {
    return therapist.estimated_wait_time;
  }
  if (therapist.accepting_new_patients) {
    return "Appears to be accepting new patients";
  }
  return "";
}

function getCompareTrustLabel(entry) {
  var therapist = entry && entry.therapist ? entry.therapist : null;
  if (!therapist) {
    return "";
  }
  if (therapist.bipolar_years_experience) {
    return therapist.bipolar_years_experience + " years with bipolar-related care";
  }
  if (therapist.verification_status === "editorially_verified") {
    return "Editorially verified profile";
  }
  return "Trust details still partial";
}

function getCompareFreshness(entry) {
  var therapist = entry && entry.therapist ? entry.therapist : null;
  if (!therapist) {
    return null;
  }

  var recentApplied = getRecentAppliedSummary(therapist);
  if (recentApplied) {
    return {
      label: recentApplied.short_label || recentApplied.label,
      note: recentApplied.note,
      tone: "fresh",
    };
  }

  var recentConfirmation = getRecentConfirmationSummary(therapist);
  if (recentConfirmation) {
    return {
      label: recentConfirmation.short_label || recentConfirmation.label,
      note: recentConfirmation.note,
      tone: recentConfirmation.tone === "fresh" ? "fresh" : "recent",
    };
  }

  var freshness = getDataFreshnessSummary(therapist);
  return freshness
    ? {
        label: freshness.label,
        note: freshness.note,
        tone: freshness.status === "fresh" ? "fresh" : "stale",
      }
    : null;
}

function getCompareRole(entry, index) {
  var rank = index + 1;
  if (index === 0) {
    return "#1 Best match";
  }
  return "#" + rank + " match";
}

function getCompareRoleReason(entry, profile, recommendation, role) {
  if (
    recommendation &&
    recommendation.therapist &&
    recommendation.therapist.slug === entry?.therapist?.slug &&
    recommendation.rationale
  ) {
    return recommendation.rationale;
  }

  var readiness = getContactReadiness(entry);
  var therapist = entry && entry.therapist ? entry.therapist : null;
  var reasons = [];

  if (therapist && therapist.accepting_new_patients) {
    reasons.push("appears open to new patients");
  }
  if (therapist && therapist.estimated_wait_time) {
    reasons.push("has clearer timing");
  }
  if (therapist && therapist.bipolar_years_experience) {
    reasons.push("shows bipolar-specific experience");
  }
  if (profile && hasInsuranceClarity(profile, therapist)) {
    reasons.push("lists your insurance");
  } else if (therapist && hasCostClarity(therapist)) {
    reasons.push("has more cost clarity");
  }
  if (readiness && readiness.tone === "high") {
    reasons.push("has the easiest contact path");
  }

  if (role === "Backup if stalled" && reasons.length) {
    return "Keep this ready if your first choice stalls because it " + reasons[0] + ".";
  }

  return reasons.length
    ? "It stands out because it " + reasons.slice(0, 2).join(" and ") + "."
    : getMatchCardExplanation(entry);
}

function getCompareLiveDecisionState(entry, role) {
  var therapist = entry && entry.therapist ? entry.therapist : null;
  var latestOutcome = therapist ? getLatestOutreachOutcome(therapist.slug) : null;
  var outcome = latestOutcome ? String(latestOutcome.outcome || "") : "";

  if (outcome === "booked_consult" || outcome === "good_fit_call") {
    return {
      tone: "positive",
      label: "Live status",
      title: "A real consult path is already open here.",
      copy: "Judge this against your backup on fit clarity, timing realism, and whether the next step feels concrete enough to keep moving.",
    };
  }
  if (outcome === "heard_back") {
    return {
      tone: "positive",
      label: "Live status",
      title: "This provider has already replied.",
      copy: "Use the reply to compare real momentum, not just profile quality. A strong reply should make timing, cost, and next step clearer quickly.",
    };
  }
  if (outcome === "reached_out") {
    return {
      tone: "recent",
      label: "Live status",
      title: "This route is already in motion.",
      copy:
        role === "Contact first"
          ? "Give the lead route a fair reply window before scattering attention, but keep the backup ready if this thread stays vague."
          : "Keep this warm as a backup path while you let the lead route prove itself.",
    };
  }
  if (["insurance_mismatch", "waitlist", "no_response"].indexOf(outcome) !== -1) {
    return {
      tone: "stale",
      label: "Live status",
      title: "This path already hit friction.",
      copy: "Treat this as comparison context, not as your lead route, unless new information clearly changes the picture.",
    };
  }

  return null;
}

function getCompareDecisionFocus(role, liveState, backupName) {
  if (liveState && liveState.title.indexOf("consult path") !== -1) {
    return (
      "Compare the quality of the consult path here against whether " +
      backupName +
      " still needs to stay warm."
    );
  }
  if (liveState && liveState.title.indexOf("already replied") !== -1) {
    return "Compare the actual reply quality here against whether your backup still looks cleaner on timing, cost, or next-step clarity.";
  }
  if (role === "Contact first") {
    return "Choose this if it still looks strongest after one focused review or first contact.";
  }
  if (role === "Backup if stalled") {
    return "Keep this ready if the lead route slows down or starts to feel weaker on timing, trust, or follow-through.";
  }
  return "Use this only if both the lead and backup lose strength after real comparison.";
}

function renderCompareDecisionCards(topEntries, profile) {
  var recommendation = buildFirstContactRecommendation(profile, topEntries);
  var recommendedSlug =
    recommendation && recommendation.therapist ? recommendation.therapist.slug : "";

  return (
    '<div class="compare-decision-grid">' +
    topEntries
      .map(function (entry, index) {
        var therapist = entry.therapist;
        var readiness = getContactReadiness(entry);
        var freshness = getCompareFreshness(entry);
        var role = getCompareRole(entry, index);
        var leadName =
          topEntries[0] && topEntries[0].therapist ? topEntries[0].therapist.name : "your lead";
        var backupName =
          topEntries[1] && topEntries[1].therapist ? topEntries[1].therapist.name : "your backup";
        var trust = getCompareTrustLabel(entry) || "Trust details still partial";
        var timing = getCompareTimingLabel(therapist) || "Timing not listed";
        var cost = getCompareCostLabel(therapist) || "Fees not listed";
        var action = (readiness && readiness.route) || "Review profile first";
        var reason = getCompareRoleReason(entry, profile, recommendation, role);
        var liveState = getCompareLiveDecisionState(entry, role);
        var note = String(entry?.evaluation?.shortlist_note || "").trim();
        var roleTitle =
          role === "Contact first"
            ? "Start here if you want the clearest first route."
            : role === "Backup if stalled"
              ? "Keep this close if the lead loses momentum."
              : "Only widen to this if the top two weaken.";
        var rolePlan =
          role === "Contact first"
            ? "If this route feels weaker after review or first outreach, move to " +
              backupName +
              " next instead of reopening the whole search."
            : role === "Backup if stalled"
              ? "Do not lead with this unless " +
                leadName +
                " slows down, feels less trustworthy, or looks worse on timing after review."
              : "This stays useful as an extra compare point, but it should not distract you from choosing between the lead and backup first.";
        var decisionFocus = getCompareDecisionFocus(role, liveState, backupName);

        return (
          '<article class="compare-decision-card"><div class="compare-decision-top"><span class="compare-chip compare-chip-' +
          (role === "Contact first"
            ? "positive"
            : role === "Backup if stalled"
              ? "secondary"
              : "neutral") +
          '">' +
          escapeHtml(role) +
          '</span><a class="compare-decision-link" href="' +
          escapeHtml(buildTherapistProfileHref(therapist.slug)) +
          '">View profile</a></div><div class="compare-decision-name">' +
          escapeHtml(therapist.name) +
          '</div><div class="compare-decision-meta">' +
          escapeHtml(formatTherapistLocationLine(therapist)) +
          "</div>" +
          (freshness
            ? '<div class="compare-freshness-banner tone-' +
              escapeHtml(freshness.tone) +
              '"><div class="compare-freshness-value">' +
              escapeHtml(freshness.label) +
              '</div><div class="compare-freshness-note">' +
              escapeHtml(freshness.note) +
              "</div></div>"
            : "") +
          '<div class="compare-decision-role-title">' +
          escapeHtml(roleTitle) +
          "</div>" +
          (liveState
            ? '<div class="compare-decision-live-state tone-' +
              escapeHtml(liveState.tone) +
              '"><div class="compare-decision-live-label">' +
              escapeHtml(liveState.label) +
              '</div><div class="compare-decision-live-title">' +
              escapeHtml(liveState.title) +
              '</div><div class="compare-decision-live-copy">' +
              escapeHtml(liveState.copy) +
              "</div></div>"
            : "") +
          '<p class="compare-decision-copy">' +
          escapeHtml(reason) +
          '</p><div class="compare-decision-stats"><div class="compare-decision-stat"><span class="compare-decision-label">Trust</span><span class="compare-decision-value">' +
          escapeHtml(trust) +
          '</span></div><div class="compare-decision-stat"><span class="compare-decision-label">Timing</span><span class="compare-decision-value">' +
          escapeHtml(timing) +
          '</span></div><div class="compare-decision-stat"><span class="compare-decision-label">Cost</span><span class="compare-decision-value">' +
          escapeHtml(cost) +
          '</span></div><div class="compare-decision-stat"><span class="compare-decision-label">Next step</span><span class="compare-decision-value">' +
          escapeHtml(action) +
          "</span></div></div>" +
          '<div class="compare-decision-plan">' +
          '<div class="compare-decision-plan-label">How to judge this against your backup</div>' +
          escapeHtml(decisionFocus) +
          "</div>" +
          '<div class="compare-decision-plan compare-decision-plan-soft">' +
          escapeHtml(rolePlan) +
          "</div>" +
          (note
            ? '<div class="compare-decision-note">Your note: ' + escapeHtml(note) + "</div>"
            : "") +
          "</article>"
        );
      })
      .join("") +
    "</div>"
  );
}

function buildPartnerCompareSummary(entries, profile) {
  var topEntries = (entries || []).slice(0, PRIMARY_SHORTLIST_LIMIT);
  if (topEntries.length < 2) {
    return "";
  }

  var recommendation = buildFirstContactRecommendation(profile, topEntries);
  var recommendedSlug =
    recommendation && recommendation.therapist ? recommendation.therapist.slug : "";
  var lines = [];

  lines.push("Therapist list summary");
  lines.push("");

  if (recommendation && recommendation.therapist) {
    lines.push(
      "Best first contact: " +
        recommendation.therapist.name +
        " because " +
        recommendation.rationale +
        ".",
    );
  }

  topEntries.forEach(function (entry, index) {
    var therapist = entry.therapist;
    var role = getCompareRole(entry, index);
    var reason = getCompareRoleReason(entry, profile, recommendation, role);
    var timing = getCompareTimingLabel(therapist) || "timing not listed";
    var cost = getCompareCostLabel(therapist) || "fees not listed";
    var trust = getCompareTrustLabel(entry) || "trust details partial";
    var freshness = getCompareFreshness(entry);
    var action =
      (getContactReadiness(entry) && getContactReadiness(entry).route) || "review profile";

    lines.push(
      "- " +
        therapist.name +
        " (" +
        role +
        "): " +
        reason +
        " Trust: " +
        trust +
        ". Timing: " +
        timing +
        ". Cost: " +
        cost +
        ". Freshness: " +
        (freshness ? freshness.label : "needs direct confirmation") +
        ". Next step: " +
        action +
        ".",
    );
  });

  return lines.join("\n");
}

function renderPartnerCompareSummary(entries, profile) {
  var summary = buildPartnerCompareSummary(entries, profile);
  if (!summary) {
    return "";
  }

  return (
    '<details class="partner-compare-summary"><summary class="partner-compare-summary-toggle"><div class="partner-compare-toggle-text"><div class="partner-compare-title">Shareable decision summary</div><p>Send a quick update to a partner, friend, or family member.</p></div><svg class="partner-compare-chevron" width="11" height="7" viewBox="0 0 11 7" fill="none" aria-hidden="true"><path d="M1 1l4.5 4.5L10 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></summary><div class="partner-compare-content"><div class="partner-compare-actions"><button type="button" class="btn-secondary" data-copy-partner-summary>Copy summary</button></div><pre class="partner-compare-body">' +
    escapeHtml(summary) +
    "</pre></div></details>"
  );
}

function renderComparison(entries) {
  var root = document.getElementById("matchCompare");
  var topEntries = entries.slice(0, PRIMARY_SHORTLIST_LIMIT);
  var profile = latestProfile;

  if (topEntries.length < 2) {
    root.innerHTML = "";
    return;
  }

  var rows = [
    {
      label: "Who to contact first",
      kind: "order",
      alwaysShow: true,
      getValue: function (therapist) {
        var index = topEntries.findIndex(function (entry) {
          return entry && entry.therapist && entry.therapist.slug === therapist.slug;
        });
        return getCompareRole(topEntries[index], index);
      },
    },
    {
      label: "How to reach out",
      alwaysShow: true,
      getValue: function (therapist) {
        var entry = topEntries.find(function (item) {
          return item && item.therapist && item.therapist.slug === therapist.slug;
        });
        var routeType = getPreferredRouteType(entry);
        if (routeType === "booking") return "Book a consultation";
        if (routeType === "email") return "Email";
        if (routeType === "phone") return "Call";
        if (routeType === "website") return "Visit website";
        return "View profile";
      },
    },
    {
      label: "Session cost",
      alwaysShow: true,
      getValue: function (therapist) {
        return getCompareCostLabel(therapist);
      },
    },
    {
      label: "Insurance",
      alwaysShow: true,
      getValue: function (therapist) {
        var accepted = (therapist.insurance_accepted || []).slice(0, 3);
        return accepted.length ? accepted : [];
      },
    },
    {
      label: "Telehealth / In-person",
      kind: "format",
      alwaysShow: true,
      getValue: function (therapist) {
        return [
          therapist.accepts_telehealth ? "Telehealth" : "",
          therapist.accepts_in_person ? "In-person" : "",
        ].filter(Boolean);
      },
    },
    {
      label: "Availability",
      alwaysShow: true,
      getValue: function (therapist) {
        return getCompareTimingLabel(therapist);
      },
    },
    {
      label: "Bipolar experience",
      alwaysShow: true,
      getValue: function (therapist) {
        return therapist.bipolar_years_experience
          ? therapist.bipolar_years_experience + " years"
          : "";
      },
    },
    {
      label: "Prescribes medication",
      kind: "boolean",
      getValue: function (therapist) {
        return therapist.medication_management;
      },
    },
    {
      label: "Languages",
      alwaysShow: true,
      getValue: function (therapist) {
        return therapist.languages || [];
      },
    },
  ];

  var visibleRows = rows.filter(function (row) {
    var values = topEntries.map(function (entry) {
      return row.getValue(entry.therapist);
    });
    if (row.alwaysShow) {
      return true;
    }
    return values.some(function (value) {
      return Array.isArray(value) ? value.length : Boolean(value);
    });
  });

  var headerCells = [
    '<div class="compare-cell compare-cell-label compare-cell-header">Compare</div>',
  ]
    .concat(
      topEntries.map(function (entry, index) {
        return (
          '<div class="compare-cell compare-cell-header' +
          (index === topEntries.length - 1 ? " compare-cell-end-col" : "") +
          '"><div class="compare-name">' +
          escapeHtml(entry.therapist.name) +
          '</div><div class="compare-sub">' +
          escapeHtml(formatTherapistLocationLine(entry.therapist)) +
          "</div></div>"
        );
      }),
    )
    .join("");

  var bodyCells = visibleRows
    .map(function (row, rowIndex) {
      var isLastRow = rowIndex === visibleRows.length - 1;
      return (
        '<div class="compare-cell compare-cell-label' +
        (isLastRow ? " compare-cell-last-row" : "") +
        '">' +
        escapeHtml(row.label) +
        "</div>" +
        topEntries
          .map(function (entry, index) {
            return (
              '<div class="compare-cell' +
              (index === topEntries.length - 1 ? " compare-cell-end-col" : "") +
              (isLastRow ? " compare-cell-last-row" : "") +
              '">' +
              renderCompareValue(row.getValue(entry.therapist), row.kind) +
              "</div>"
            );
          })
          .join("")
      );
    })
    .join("");
  root.innerHTML =
    '<div class="match-compare-feature">' +
    '<div class="match-compare-feature-head">' +
    '<span class="match-compare-kicker">Side-by-side</span>' +
    '<h3 class="match-compare-feature-title">Compare your matches</h3>' +
    '<p class="match-compare-feature-copy">Cost, insurance, format, and experience across all your matches — so you can pick one and reach out.</p>' +
    "</div>" +
    '<section class="match-compare">' +
    '<div class="compare-grid" style="grid-template-columns: 160px repeat(' +
    escapeHtml(String(topEntries.length)) +
    ', minmax(0, 1fr));">' +
    headerCells +
    bodyCells +
    "</div></section>" +
    renderPartnerCompareSummary(topEntries, profile) +
    "</div>";

  var copyBtn = root.querySelector("[data-copy-partner-summary]");
  if (copyBtn) {
    copyBtn.addEventListener("click", function () {
      var body = root.querySelector(".partner-compare-body");
      if (!body) return;
      navigator.clipboard.writeText(body.textContent).then(function () {
        copyBtn.textContent = "Copied!";
        window.setTimeout(function () {
          copyBtn.textContent = "Copy summary";
        }, 2000);
      });
    });
  }

  triggerMotion(root, "motion-enter");
}

function buildAdaptiveIntakeGuidance(profile) {
  var normalized = profile || {};
  var prompts = [];
  var patterns = analyzeConciergePatterns(readConciergeRequests());
  var shortcutLearningMap = buildShortcutLearningMap(readStoredFeedback(), readOutreachOutcomes());

  function add(field, label, body) {
    if (
      prompts.some(function (item) {
        return item.field === field;
      })
    ) {
      return;
    }
    prompts.push({ field: field, label: label, body: body });
  }

  if (normalized.insurance || normalized.budget_max) {
    add(
      normalized.insurance ? "insurance" : "budget_max",
      "Cost clarity matters here",
      "Insurance and budget are some of the strongest practical filters, and they often prevent dead-end outreach later.",
    );
  } else if (patterns.insurance >= 2) {
    add(
      "insurance",
      "Insurance or budget may be worth adding",
      "Cost and coverage are common friction points. Adding either one usually improves list quality.",
    );
  }

  if (normalized.care_intent === "Psychiatry" || normalized.needs_medication_management === "Yes") {
    add(
      "needs_medication_management",
      "Medication needs change the field fast",
      "When psychiatry or medication support matters, this answer becomes one of the strongest ranking signals.",
    );
  } else {
    var psychiatryPreference = getShortcutPreference(
      normalized,
      "strongest_psychiatry_option",
      shortcutLearningMap,
    );
    if (psychiatryPreference.strong > 0) {
      add(
        "care_intent",
        "Care type may sharpen the list",
        "Similar users have seen stronger outcomes when they clarify whether they want therapy, psychiatry, or either.",
      );
    }
  }

  if (normalized.priority_mode && normalized.priority_mode !== "Best overall fit") {
    add(
      "priority_mode",
      "This preference will steer tie-breaks",
      "Your priority setting helps the matcher decide whether to lean toward speed, cost, or specialization when several options look strong.",
    );
  } else {
    add(
      "priority_mode",
      "Say what matters most",
      "If you already know you care most about speed, specialization, or cost, setting it here makes the list feel much more intentional.",
    );
  }

  if ((normalized.bipolar_focus || []).length) {
    add(
      "bipolar_focus",
      "Keep the bipolar focus specific",
      "Subtype and adjacent concerns help the system distinguish between broadly qualified clinicians and truly relevant specialists.",
    );
  }

  return prompts.slice(0, 3);
}

function renderAdaptiveIntakeGuidance(profile) {
  var root = document.getElementById("intakeAdaptiveCoach");
  if (!root) {
    return;
  }

  var prompts = buildAdaptiveIntakeGuidance(profile);
  root.classList.toggle("is-empty", !prompts.length);
  root.innerHTML = prompts.length
    ? '<div class="intake-adaptive-header"><h3>What seems most predictive for this search</h3><p>As similar searches come through the product, these answers tend to shape ranking the most.</p></div><div class="intake-adaptive-list">' +
      prompts
        .map(function (item) {
          return (
            '<div class="intake-adaptive-item"><strong>' +
            escapeHtml(item.label) +
            "</strong><span>" +
            escapeHtml(item.body) +
            "</span></div>"
          );
        })
        .join("") +
      "</div>"
    : "";

  document.querySelectorAll("[data-intake-field]").forEach(function (node) {
    node.classList.remove("is-guided");
  });
  prompts.forEach(function (item) {
    var node = document.querySelector('[data-intake-field="' + item.field + '"]');
    if (node) {
      node.classList.add("is-guided");
    }
  });
}

function buildProfileVariant(profile, overrides) {
  var next = Object.assign(
    {
      care_state: profile.care_state,
      care_format: profile.care_format,
      care_intent: profile.care_intent,
      needs_medication_management: profile.needs_medication_management,
      insurance: profile.insurance,
      budget_max: profile.budget_max,
      urgency: profile.urgency,
      priority_mode: profile.priority_mode,
      bipolar_focus: (profile.bipolar_focus || []).slice(),
      preferred_modalities: (profile.preferred_modalities || []).slice(),
      population_fit: (profile.population_fit || []).slice(),
      language_preferences: (profile.language_preferences || []).slice(),
      location_query: profile.location_query || "",
    },
    overrides || {},
  );
  var built = buildUserMatchProfile(next);
  built.location_query = next.location_query || "";
  return built;
}

function buildIntakeTradeoffPreviews(profile) {
  if (!profile || !profile.care_state || !therapists.length) {
    return [];
  }

  var baseEntries = orderMatchEntries(
    rankTherapistsForUser(therapists, profile, latestLearningSignals),
    profile,
  );
  var baseTop = baseEntries[0] ? baseEntries[0].therapist.name : "";
  var scenarios = [];

  function addScenario(field, label, variantProfile, bodyBuilder) {
    var variantEntries = orderMatchEntries(
      rankTherapistsForUser(therapists, variantProfile, latestLearningSignals),
      variantProfile,
    );
    if (!variantEntries.length) {
      return;
    }
    var nextTop = variantEntries[0].therapist.name;
    var changed = nextTop && baseTop && nextTop !== baseTop;
    scenarios.push({
      field: field,
      label: label,
      changed: changed,
      body: bodyBuilder(nextTop, changed, variantEntries),
    });
  }

  if (profile.priority_mode !== "Soonest availability") {
    addScenario(
      "priority_mode",
      "If you prioritize speed instead",
      buildProfileVariant(profile, { priority_mode: "Soonest availability" }),
      function (nextTop, changed) {
        return changed
          ? nextTop +
              " would likely rise because the matcher would lean harder on wait time and low-friction outreach."
          : "The list would stay fairly similar, which suggests your current options are already relatively strong on speed.";
      },
    );
  }

  if (profile.priority_mode !== "Highest specialization") {
    addScenario(
      "priority_mode",
      "If you prioritize specialization instead",
      buildProfileVariant(profile, { priority_mode: "Highest specialization" }),
      function (nextTop, changed) {
        return changed
          ? nextTop +
              " would likely rise because the matcher would weight bipolar-specific depth more heavily."
          : "The list would stay fairly stable, which suggests the current top options already look highly specialized.";
      },
    );
  }

  if (profile.care_intent !== "Psychiatry" && profile.needs_medication_management !== "No") {
    addScenario(
      "care_intent",
      "If medication support becomes essential",
      buildProfileVariant(profile, {
        care_intent: "Psychiatry",
        needs_medication_management: "Yes",
      }),
      function (nextTop, changed) {
        return changed
          ? nextTop +
              " would likely rise because psychiatry and medication support would become hard constraints."
          : "The list would stay fairly similar, which suggests the current leaders already cover medication-related needs well.";
      },
    );
  }

  return scenarios.slice(0, 2);
}

function renderIntakeTradeoffPreview(profile) {
  var root = document.getElementById("intakeTradeoffCoach");
  if (!root) {
    return;
  }

  var scenarios = buildIntakeTradeoffPreviews(profile);
  root.classList.toggle("is-empty", !scenarios.length);
  root.innerHTML = scenarios.length
    ? '<div class="intake-adaptive-header"><h3>How one answer could change the list</h3><p>These are lightweight previews, so you can see the tradeoff between speed, fit, and specialization before you run the match.</p></div><div class="intake-tradeoff-list">' +
      scenarios
        .map(function (item) {
          return (
            '<div class="intake-adaptive-item tradeoff"><strong>' +
            escapeHtml(item.label) +
            "</strong><span>" +
            escapeHtml(item.body) +
            "</span></div>"
          );
        })
        .join("") +
      "</div>"
    : "";
}

function readStoredFeedback() {
  try {
    return JSON.parse(window.localStorage.getItem(MATCH_FEEDBACK_KEY) || "[]");
  } catch (_error) {
    return [];
  }
}

function writeStoredFeedback(value) {
  try {
    window.localStorage.setItem(MATCH_FEEDBACK_KEY, JSON.stringify(value));
  } catch (_error) {
    return;
  }
}

function getShortcutContextForTherapist(slug) {
  if (
    activeShortcutContext &&
    activeShortcutContext.therapist_slug &&
    activeShortcutContext.therapist_slug === slug
  ) {
    return activeShortcutContext;
  }
  return null;
}

function readConciergeRequests() {
  try {
    return JSON.parse(window.localStorage.getItem(CONCIERGE_REQUESTS_KEY) || "[]");
  } catch (_error) {
    return [];
  }
}

function readOutreachOutcomes() {
  try {
    return JSON.parse(window.localStorage.getItem(OUTREACH_OUTCOMES_KEY) || "[]");
  } catch (_error) {
    return [];
  }
}

function writeOutreachOutcomes(value) {
  try {
    window.localStorage.setItem(OUTREACH_OUTCOMES_KEY, JSON.stringify(value));
  } catch (_error) {
    return;
  }
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
      request && request.help_topic ? request.help_topic : "",
      request && request.request_note ? request.request_note : "",
      request && request.request_summary ? request.request_summary : "",
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

  return totals;
}

function buildLearningSegments(profile) {
  return buildLearningSegmentsBase(profile);
}

function buildLearningSignals(feedback, outreachOutcomes) {
  var entries = Array.isArray(feedback) ? feedback : [];
  var outreach = Array.isArray(outreachOutcomes) ? outreachOutcomes : [];
  var segmentMap = {};

  function ensureSegment(name) {
    if (!segmentMap[name]) {
      segmentMap[name] = {
        negative_reasons: [],
        therapist_adjustments: {},
        outreach_adjustments: {},
      };
    }
    return segmentMap[name];
  }

  entries.forEach(function (item) {
    var profile = item && item.context ? item.context.profile : null;
    var segments = buildLearningSegments(profile);

    segments.forEach(function (segment) {
      var bucket = ensureSegment(segment);
      if (item && item.value === "negative" && Array.isArray(item.reasons)) {
        bucket.negative_reasons = bucket.negative_reasons.concat(item.reasons);
      }
      if (item && item.type === "therapist_feedback" && item.therapist_slug) {
        if (!bucket.therapist_adjustments[item.therapist_slug]) {
          bucket.therapist_adjustments[item.therapist_slug] = 0;
        }
        bucket.therapist_adjustments[item.therapist_slug] += item.value === "positive" ? 3 : -3;
      }
    });
  });

  outreach.forEach(function (item) {
    if (!item || !item.therapist_slug) {
      return;
    }

    var profile = item && item.context ? item.context.profile : null;
    var segments = buildLearningSegments(profile);

    segments.forEach(function (segment) {
      var bucket = ensureSegment(segment);
      if (!bucket.outreach_adjustments[item.therapist_slug]) {
        bucket.outreach_adjustments[item.therapist_slug] = 0;
      }

      if (item.outcome === "heard_back") {
        bucket.outreach_adjustments[item.therapist_slug] += 4;
      } else if (item.outcome === "booked_consult") {
        bucket.outreach_adjustments[item.therapist_slug] += 7;
      } else if (item.outcome === "good_fit_call") {
        bucket.outreach_adjustments[item.therapist_slug] += 8;
      } else if (item.outcome === "reached_out") {
        bucket.outreach_adjustments[item.therapist_slug] += 1;
      } else if (item.outcome === "insurance_mismatch") {
        bucket.outreach_adjustments[item.therapist_slug] -= 4;
      } else if (item.outcome === "waitlist") {
        bucket.outreach_adjustments[item.therapist_slug] -= 3;
      } else if (item.outcome === "no_response") {
        bucket.outreach_adjustments[item.therapist_slug] -= 2;
      }
    });
  });

  var normalizedSegments = Object.keys(segmentMap).reduce(function (accumulator, segment) {
    var bucket = segmentMap[segment];
    var reasonWeights = FEEDBACK_REASON_OPTIONS.reduce(function (reasonAccumulator, reason) {
      var count = bucket.negative_reasons.filter(function (value) {
        return value === reason;
      }).length;

      if (count > 0) {
        reasonAccumulator[reason] = Math.min(8, 2 + count * 2);
      }
      return reasonAccumulator;
    }, {});

    Object.keys(bucket.therapist_adjustments).forEach(function (slug) {
      bucket.therapist_adjustments[slug] = Math.max(
        -10,
        Math.min(10, bucket.therapist_adjustments[slug]),
      );
    });

    Object.keys(bucket.outreach_adjustments).forEach(function (slug) {
      bucket.outreach_adjustments[slug] = Math.max(
        -8,
        Math.min(10, bucket.outreach_adjustments[slug]),
      );
    });

    accumulator[segment] = {
      reason_weights: reasonWeights,
      therapist_adjustments: bucket.therapist_adjustments,
      outreach_adjustments: bucket.outreach_adjustments,
    };
    return accumulator;
  }, {});

  var global = normalizedSegments.all || {
    reason_weights: {},
    therapist_adjustments: {},
    outreach_adjustments: {},
  };

  return {
    reason_weights: global.reason_weights,
    therapist_adjustments: global.therapist_adjustments,
    outreach_adjustments: global.outreach_adjustments,
    segments: normalizedSegments,
  };
}

function buildShortcutLearningMap(feedback, outreachOutcomes) {
  var entries = Array.isArray(feedback) ? feedback : [];
  var outcomes = Array.isArray(outreachOutcomes) ? outreachOutcomes : [];
  var learning = {};

  function ensureBucket(segment, shortcutType) {
    var key = "shortcut::" + segment;
    if (!learning[key]) {
      learning[key] = {};
    }
    if (!learning[key][shortcutType]) {
      learning[key][shortcutType] = {
        draft: 0,
        compare: 0,
        strong: 0,
        weak: 0,
      };
    }
    return learning[key][shortcutType];
  }

  entries.forEach(function (item) {
    if (!item || item.type !== "shortcut_interaction" || !item.shortcut_type) {
      return;
    }

    var segments = buildLearningSegments(
      item.context && item.context.profile ? item.context.profile : null,
    );
    segments.forEach(function (segment) {
      var bucket = ensureBucket(segment, item.shortcut_type);
      if (item.action === "copy_draft") {
        bucket.draft += 1;
      }
      if (item.action === "focus_compare") {
        bucket.compare += 1;
      }
    });
  });

  outcomes.forEach(function (item) {
    if (!item || !item.shortcut_type) {
      return;
    }

    var segments = buildLearningSegments(
      item.context && item.context.profile ? item.context.profile : null,
    );
    segments.forEach(function (segment) {
      var bucket = ensureBucket(segment, item.shortcut_type);
      if (item.outcome === "booked_consult" || item.outcome === "good_fit_call") {
        bucket.strong += 1;
      }
      if (
        item.outcome === "insurance_mismatch" ||
        item.outcome === "waitlist" ||
        item.outcome === "no_response"
      ) {
        bucket.weak += 1;
      }
    });
  });

  return learning;
}

function getShortcutPreference(profile, shortcutType, shortcutLearningMap) {
  var segments = buildLearningSegments(profile);
  var score = 0;
  var draft = 0;
  var compare = 0;
  var strong = 0;
  var weak = 0;

  segments.forEach(function (segment) {
    var bucket =
      shortcutLearningMap["shortcut::" + segment] &&
      shortcutLearningMap["shortcut::" + segment][shortcutType];
    if (!bucket) {
      return;
    }
    draft += bucket.draft;
    compare += bucket.compare;
    strong += bucket.strong || 0;
    weak += bucket.weak || 0;
    score +=
      bucket.draft * 3 + bucket.compare * 2 + (bucket.strong || 0) * 8 - (bucket.weak || 0) * 5;
  });

  return {
    score: score,
    draft: draft,
    compare: compare,
    strong: strong,
    weak: weak,
  };
}

function getShortcutInfluence(profile, entries) {
  void profile;
  void entries;
  return {};
}

function analyzeOutreachJourneys(outcomes) {
  var entries = Array.isArray(outcomes) ? outcomes : [];
  var byJourney = entries.reduce(function (accumulator, item) {
    if (!item || !item.journey_id) {
      return accumulator;
    }
    if (!accumulator[item.journey_id]) {
      accumulator[item.journey_id] = [];
    }
    accumulator[item.journey_id].push(item);
    return accumulator;
  }, {});

  var totals = {
    fallback_after_no_response: 0,
    fallback_after_waitlist: 0,
    fallback_after_insurance_mismatch: 0,
    second_choice_success: 0,
  };

  Object.keys(byJourney).forEach(function (journeyId) {
    var journey = byJourney[journeyId].slice().sort(function (a, b) {
      return new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime();
    });
    var byRank = {};

    journey.forEach(function (item) {
      if (!byRank[item.rank_position]) {
        byRank[item.rank_position] = [];
      }
      byRank[item.rank_position].push(item.outcome);
    });

    var first = byRank[1] || [];
    var second = byRank[2] || [];

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
  var entries = Array.isArray(outcomes) ? outcomes : [];
  var byJourney = entries.reduce(function (accumulator, item) {
    if (!item || !item.journey_id) {
      return accumulator;
    }
    if (!accumulator[item.journey_id]) {
      accumulator[item.journey_id] = [];
    }
    accumulator[item.journey_id].push(item);
    return accumulator;
  }, {});

  var totals = {
    on_time_pivots: 0,
    early_pivots: 0,
    late_pivots: 0,
  };

  Object.keys(byJourney).forEach(function (journeyId) {
    var journey = byJourney[journeyId].slice().sort(function (a, b) {
      return new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime();
    });
    var firstNegative = journey.find(function (item) {
      return (
        item.rank_position === 1 &&
        ["no_response", "waitlist", "insurance_mismatch"].includes(item.outcome)
      );
    });
    var fallbackAttempt = journey.find(function (item) {
      return item.rank_position > 1;
    });

    if (!firstNegative || !fallbackAttempt || !firstNegative.pivot_at) {
      return;
    }

    var pivotAt = new Date(firstNegative.pivot_at).getTime();
    var fallbackAt = new Date(fallbackAttempt.recorded_at).getTime();
    var delta = fallbackAt - pivotAt;
    var tolerance = 12 * 60 * 60 * 1000;

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

function analyzePivotTimingByUrgency(outcomes, profile) {
  var entries = Array.isArray(outcomes) ? outcomes : [];
  var targetUrgency = profile && profile.urgency ? String(profile.urgency) : "";
  if (!targetUrgency || targetUrgency === "ASAP") {
    return {
      on_time_pivots: 0,
      early_pivots: 0,
      late_pivots: 0,
    };
  }

  return analyzePivotTiming(
    entries.filter(function (item) {
      return (
        item &&
        item.context &&
        item.context.profile &&
        String(item.context.profile.urgency || "") === targetUrgency
      );
    }),
  );
}

function buildFallbackLearningMap(outcomes) {
  return buildFallbackLearningMapBase(outcomes, {
    buildLearningSegments: buildLearningSegments,
  });
}

function buildRouteLearningMap(outcomes) {
  var entries = Array.isArray(outcomes) ? outcomes : [];
  var learning = {};

  function ensureBucket(segment, routeType) {
    var key = "route::" + segment;
    if (!learning[key]) {
      learning[key] = {};
    }
    if (!learning[key][routeType]) {
      learning[key][routeType] = {
        success: 0,
        attempts: 0,
      };
    }
    return learning[key][routeType];
  }

  entries.forEach(function (item) {
    if (!item || !item.route_type) {
      return;
    }

    var segments = buildLearningSegments(
      item.context && item.context.profile ? item.context.profile : null,
    );

    segments.forEach(function (segment) {
      var bucket = ensureBucket(segment, item.route_type);
      bucket.attempts += 1;
      if (item.outcome === "booked_consult" || item.outcome === "good_fit_call") {
        bucket.success += 1;
      }
    });
  });

  return learning;
}

function getRouteLearningForProfile(profile, entry, outcomes) {
  return getRouteLearningForProfileBase(profile, entry, outcomes, {
    getPreferredRouteType: getPreferredRouteType,
    buildLearningSegments: buildLearningSegments,
  });
}

function getSelectedReasonValues(scope) {
  var selector =
    scope === "shortlist"
      ? '#shortlistReasonGroup input[type="checkbox"]:checked'
      : '[data-reason-scope="' + scope + '"] input[type="checkbox"]:checked';

  return Array.from(document.querySelectorAll(selector)).map(function (input) {
    return input.value;
  });
}

function setReasonGroupVisibility(scope, visible) {
  if (scope === "shortlist") {
    var shortlistGroup = document.getElementById("shortlistReasonGroup");
    shortlistGroup.style.display = visible ? "flex" : "none";
    if (!visible) {
      shortlistGroup.querySelectorAll('input[type="checkbox"]').forEach(function (input) {
        input.checked = false;
      });
    }
    return;
  }

  var group = document.querySelector('[data-reason-scope="' + scope + '"]');
  if (!group) {
    return;
  }

  group.style.display = visible ? "flex" : "none";
  if (!visible) {
    group.querySelectorAll('input[type="checkbox"]').forEach(function (input) {
      input.checked = false;
    });
  }
}

function renderFeedbackInsights() {
  var root = document.getElementById("feedbackInsights");
  if (!root) {
    return;
  }
  if (!isInternalMode) {
    root.hidden = true;
    return;
  }
  root.hidden = false;
  var feedback = readStoredFeedback();
  var outreachOutcomes = readOutreachOutcomes();
  var learningSignals = buildLearningSignals(feedback, outreachOutcomes);

  if (!feedback.length && !outreachOutcomes.length) {
    root.innerHTML =
      '<div class="feedback-insights-header"><h3>Your feedback so far</h3><p>A quick summary of what you have flagged on this device.</p></div><div class="insight-empty">No feedback captured yet.</div>';
    return;
  }

  var shortlistFeedback = feedback.filter(function (item) {
    return item.type === "shortlist_feedback";
  });
  var therapistFeedback = feedback.filter(function (item) {
    return item.type === "therapist_feedback";
  });
  var shortcutInteractions = feedback.filter(function (item) {
    return item.type === "shortcut_interaction";
  });
  var heardBackOutcomes = outreachOutcomes.filter(function (item) {
    return item.outcome === "heard_back";
  });
  var bookedConsultOutcomes = outreachOutcomes.filter(function (item) {
    return item.outcome === "booked_consult";
  });
  var goodFitCallOutcomes = outreachOutcomes.filter(function (item) {
    return item.outcome === "good_fit_call";
  });
  var insuranceMismatchOutcomes = outreachOutcomes.filter(function (item) {
    return item.outcome === "insurance_mismatch";
  });
  var waitlistOutcomes = outreachOutcomes.filter(function (item) {
    return item.outcome === "waitlist";
  });
  var noResponseOutcomes = outreachOutcomes.filter(function (item) {
    return item.outcome === "no_response";
  });
  var journeySummary = analyzeOutreachJourneys(outreachOutcomes);
  var timingSummary = analyzePivotTiming(outreachOutcomes);
  var negativeReasons = feedback
    .filter(function (item) {
      return item.value === "negative";
    })
    .flatMap(function (item) {
      return Array.isArray(item.reasons) ? item.reasons : [];
    });
  var reasonCounts = FEEDBACK_REASON_OPTIONS.map(function (reason) {
    return {
      reason: reason,
      count: negativeReasons.filter(function (value) {
        return value === reason;
      }).length,
    };
  }).filter(function (item) {
    return item.count > 0;
  });

  var therapistSummaryMap = therapistFeedback.reduce(function (accumulator, item) {
    var key = item.therapist_slug;
    if (!accumulator[key]) {
      accumulator[key] = {
        slug: key,
        positive: 0,
        negative: 0,
      };
    }
    if (item.value === "positive") {
      accumulator[key].positive += 1;
    }
    if (item.value === "negative") {
      accumulator[key].negative += 1;
    }
    return accumulator;
  }, {});

  var therapistSummaries = Object.values(therapistSummaryMap)
    .map(function (item) {
      var therapist = therapists.find(function (entry) {
        return entry.slug === item.slug;
      });
      return {
        name: therapist ? therapist.name : item.slug,
        positive: item.positive,
        negative: item.negative,
        net: item.positive - item.negative,
      };
    })
    .sort(function (a, b) {
      return b.net - a.net || b.positive - a.positive || a.name.localeCompare(b.name);
    });

  var helpfulShortlists = shortlistFeedback.filter(function (item) {
    return item.value === "positive";
  }).length;
  var helpfulRate = shortlistFeedback.length
    ? Math.round((helpfulShortlists / shortlistFeedback.length) * 100)
    : 0;
  var shortcutSummaries = Object.values(
    shortcutInteractions.reduce(function (accumulator, item) {
      var key = String(item.shortcut_type || "unknown");
      if (!accumulator[key]) {
        accumulator[key] = {
          type: key,
          draft: 0,
          compare: 0,
        };
      }
      if (item.action === "copy_draft") {
        accumulator[key].draft += 1;
      }
      if (item.action === "focus_compare") {
        accumulator[key].compare += 1;
      }
      return accumulator;
    }, {}),
  ).sort(function (a, b) {
    return b.draft + b.compare - (a.draft + a.compare) || a.type.localeCompare(b.type);
  });
  var shortcutLearningMap = buildShortcutLearningMap(feedback, outreachOutcomes);
  var shortcutOutcomeSummaries = Object.values(
    outreachOutcomes.reduce(function (accumulator, item) {
      var key = String(item && item.shortcut_type ? item.shortcut_type : "");
      if (!key) {
        return accumulator;
      }
      if (!accumulator[key]) {
        accumulator[key] = {
          type: key,
          strong: 0,
          weak: 0,
        };
      }
      if (item.outcome === "booked_consult" || item.outcome === "good_fit_call") {
        accumulator[key].strong += 1;
      }
      if (
        item.outcome === "insurance_mismatch" ||
        item.outcome === "waitlist" ||
        item.outcome === "no_response"
      ) {
        accumulator[key].weak += 1;
      }
      return accumulator;
    }, {}),
  ).sort(function (a, b) {
    return b.strong - a.strong || a.weak - b.weak || a.type.localeCompare(b.type);
  });
  var segmentShortcutSummaries = Object.keys(shortcutLearningMap)
    .filter(function (key) {
      return key !== "shortcut::all";
    })
    .map(function (key) {
      var segment = key.replace("shortcut::", "");
      var bestShortcut = Object.entries(shortcutLearningMap[key]).sort(function (a, b) {
        var scoreA =
          a[1].draft * 3 + a[1].compare * 2 + (a[1].strong || 0) * 8 - (a[1].weak || 0) * 5;
        var scoreB =
          b[1].draft * 3 + b[1].compare * 2 + (b[1].strong || 0) * 8 - (b[1].weak || 0) * 5;
        return scoreB - scoreA || a[0].localeCompare(b[0]);
      })[0];
      if (!bestShortcut) {
        return null;
      }
      return {
        segment: segment,
        shortcut: bestShortcut[0],
        count: bestShortcut[1].draft + bestShortcut[1].compare,
        strong: bestShortcut[1].strong || 0,
        weak: bestShortcut[1].weak || 0,
      };
    })
    .filter(Boolean)
    .sort(function (a, b) {
      return (
        b.strong - a.strong ||
        a.weak - b.weak ||
        b.count - a.count ||
        a.segment.localeCompare(b.segment)
      );
    });
  var segmentSummaries = Object.keys(learningSignals.segments || {})
    .filter(function (segment) {
      return segment !== "all";
    })
    .map(function (segment) {
      var segmentData = learningSignals.segments[segment] || {};
      return {
        label: segment.split(":")[1].replace(/-/g, " "),
        strength:
          Object.keys(segmentData.reason_weights || {}).length +
          Object.keys(segmentData.therapist_adjustments || {}).length +
          Object.keys(segmentData.outreach_adjustments || {}).length,
      };
    })
    .filter(function (item) {
      return item.strength > 0;
    })
    .sort(function (a, b) {
      return b.strength - a.strength || a.label.localeCompare(b.label);
    });
  var outreachSegmentSummaries = Object.keys(learningSignals.segments || {})
    .filter(function (segment) {
      if (segment === "all") {
        return false;
      }
      var segmentData = learningSignals.segments[segment] || {};
      return Object.keys(segmentData.outreach_adjustments || {}).length > 0;
    })
    .map(function (segment) {
      var segmentData = learningSignals.segments[segment] || {};
      return {
        label: segment.split(":")[1].replace(/-/g, " "),
        count: Object.keys(segmentData.outreach_adjustments || {}).length,
      };
    })
    .sort(function (a, b) {
      return b.count - a.count || a.label.localeCompare(b.label);
    });
  var routeLearningMap = buildRouteLearningMap(outreachOutcomes);
  var routeSummaries = Object.keys(routeLearningMap)
    .slice(0, 4)
    .map(function (key) {
      var segment = key.replace("route::", "");
      var bestRoute = Object.entries(routeLearningMap[key]).sort(function (a, b) {
        return (
          b[1].success - a[1].success || b[1].attempts - a[1].attempts || a[0].localeCompare(b[0])
        );
      })[0];
      if (!bestRoute || !bestRoute[1].success) {
        return null;
      }
      return {
        segment: segment,
        route: bestRoute[0],
        success: bestRoute[1].success,
      };
    })
    .filter(Boolean);

  root.innerHTML =
    '<div class="feedback-insights-header"><h3>Your feedback so far</h3><p>A quick summary of what you have flagged on this device.</p></div>' +
    '<div class="insight-stats">' +
    '<div class="insight-stat"><div class="insight-stat-value">' +
    feedback.length +
    '</div><div class="insight-stat-label">Total signals</div></div>' +
    '<div class="insight-stat"><div class="insight-stat-value">' +
    helpfulRate +
    '%</div><div class="insight-stat-label">Helpful list rate</div></div>' +
    '<div class="insight-stat"><div class="insight-stat-value">' +
    therapistFeedback.length +
    '</div><div class="insight-stat-label">Therapist-level votes</div></div>' +
    '<div class="insight-stat"><div class="insight-stat-value">' +
    heardBackOutcomes.length +
    '</div><div class="insight-stat-label">Heard-back outcomes</div></div>' +
    '<div class="insight-stat"><div class="insight-stat-value">' +
    bookedConsultOutcomes.length +
    '</div><div class="insight-stat-label">Booked consults</div></div>' +
    '<div class="insight-stat"><div class="insight-stat-value">' +
    goodFitCallOutcomes.length +
    '</div><div class="insight-stat-label">Good fit calls</div></div>' +
    '<div class="insight-stat"><div class="insight-stat-value">' +
    insuranceMismatchOutcomes.length +
    '</div><div class="insight-stat-label">Insurance mismatches</div></div>' +
    '<div class="insight-stat"><div class="insight-stat-value">' +
    waitlistOutcomes.length +
    '</div><div class="insight-stat-label">Waitlist hits</div></div>' +
    '<div class="insight-stat"><div class="insight-stat-value">' +
    noResponseOutcomes.length +
    '</div><div class="insight-stat-label">No-response outcomes</div></div>' +
    '<div class="insight-stat"><div class="insight-stat-value">' +
    shortcutInteractions.length +
    '</div><div class="insight-stat-label">Shortcut actions</div></div>' +
    "</div>" +
    (shortcutSummaries.length
      ? '<div class="insight-list">' +
        shortcutSummaries
          .map(function (item) {
            return (
              '<div class="insight-item"><div class="insight-item-top"><div><div class="insight-item-name">' +
              escapeHtml(item.type.replace(/_/g, " ")) +
              '</div><div class="insight-item-meta">Draft clicks: ' +
              item.draft +
              " · Compare focus: " +
              item.compare +
              '</div></div><div class="insight-balance">' +
              (item.draft + item.compare) +
              "</div></div></div>"
            );
          })
          .join("") +
        "</div>"
      : "") +
    (shortcutOutcomeSummaries.length
      ? '<div class="insight-list">' +
        shortcutOutcomeSummaries
          .map(function (item) {
            return (
              '<div class="insight-item"><div class="insight-item-top"><div><div class="insight-item-name">' +
              escapeHtml(item.type.replace(/_/g, " ")) +
              '</div><div class="insight-item-meta">Strong outcomes: ' +
              item.strong +
              " · Friction outcomes: " +
              item.weak +
              '</div></div><div class="insight-balance">' +
              (item.strong - item.weak > 0 ? "+" : "") +
              (item.strong - item.weak) +
              "</div></div></div>"
            );
          })
          .join("") +
        "</div>"
      : "") +
    (segmentShortcutSummaries.length
      ? '<div class="insight-list">' +
        segmentShortcutSummaries
          .slice(0, 4)
          .map(function (item) {
            return (
              '<div class="insight-item"><div class="insight-item-top"><div><div class="insight-item-name">' +
              escapeHtml(item.segment.split(":")[1].replace(/-/g, " ")) +
              '</div><div class="insight-item-meta">Most-used shortcut: ' +
              escapeHtml(item.shortcut.replace(/_/g, " ")) +
              " · Strong outcomes: " +
              item.strong +
              " · Friction: " +
              item.weak +
              '</div></div><div class="insight-balance">' +
              item.count +
              "</div></div></div>"
            );
          })
          .join("") +
        "</div>"
      : "") +
    (segmentSummaries.length
      ? '<div class="insight-list">' +
        segmentSummaries
          .slice(0, 4)
          .map(function (item) {
            return (
              '<div class="insight-item"><div class="insight-item-top"><div><div class="insight-item-name">' +
              escapeHtml(item.label) +
              '</div><div class="insight-item-meta">Segment-aware learning coverage</div></div><div class="insight-balance">' +
              item.strength +
              "</div></div></div>"
            );
          })
          .join("") +
        "</div>"
      : "") +
    (Object.keys(learningSignals.reason_weights || {}).length
      ? '<div class="insight-list">' +
        Object.entries(learningSignals.reason_weights)
          .sort(function (a, b) {
            return b[1] - a[1];
          })
          .slice(0, 4)
          .map(function (item) {
            return (
              '<div class="insight-item"><div class="insight-item-top"><div><div class="insight-item-name">' +
              escapeHtml(item[0]) +
              '</div><div class="insight-item-meta">Current learning weight</div></div><div class="insight-balance">+' +
              item[1] +
              "</div></div></div>"
            );
          })
          .join("") +
        "</div>"
      : "") +
    (Object.keys(learningSignals.outreach_adjustments || {}).length
      ? '<div class="insight-list">' +
        Object.entries(learningSignals.outreach_adjustments)
          .sort(function (a, b) {
            return b[1] - a[1];
          })
          .slice(0, 4)
          .map(function (item) {
            var therapist = therapists.find(function (entry) {
              return entry.slug === item[0];
            });
            return (
              '<div class="insight-item"><div class="insight-item-top"><div><div class="insight-item-name">' +
              escapeHtml(therapist ? therapist.name : item[0]) +
              '</div><div class="insight-item-meta">Reply-driven trust adjustment</div></div><div class="insight-balance">' +
              (item[1] > 0 ? "+" : "") +
              item[1] +
              "</div></div></div>"
            );
          })
          .join("") +
        "</div>"
      : "") +
    (outreachSegmentSummaries.length
      ? '<div class="insight-list">' +
        outreachSegmentSummaries
          .slice(0, 4)
          .map(function (item) {
            return (
              '<div class="insight-item"><div class="insight-item-top"><div><div class="insight-item-name">' +
              escapeHtml(item.label) +
              '</div><div class="insight-item-meta">Segment-specific outreach learning</div></div><div class="insight-balance">' +
              item.count +
              "</div></div></div>"
            );
          })
          .join("") +
        "</div>"
      : "") +
    (routeSummaries.length
      ? '<div class="insight-list">' +
        routeSummaries
          .map(function (item) {
            return (
              '<div class="insight-item"><div class="insight-item-top"><div><div class="insight-item-name">' +
              escapeHtml(item.segment.split(":")[1].replace(/-/g, " ")) +
              '</div><div class="insight-item-meta">Best-performing route type: ' +
              escapeHtml(item.route) +
              '</div></div><div class="insight-balance">' +
              item.success +
              "</div></div></div>"
            );
          })
          .join("") +
        "</div>"
      : "") +
    (journeySummary.fallback_after_no_response ||
    journeySummary.fallback_after_waitlist ||
    journeySummary.fallback_after_insurance_mismatch ||
    journeySummary.second_choice_success
      ? '<div class="insight-list">' +
        [
          {
            name: "Fallback after no response",
            meta: "Journeys where the first outreach stalled and a later option was tried",
            value: journeySummary.fallback_after_no_response,
          },
          {
            name: "Fallback after waitlist",
            meta: "Journeys where the first outreach hit a waitlist and a later option was tried",
            value: journeySummary.fallback_after_waitlist,
          },
          {
            name: "Fallback after insurance mismatch",
            meta: "Journeys where cost or coverage pushed the user to a backup option",
            value: journeySummary.fallback_after_insurance_mismatch,
          },
          {
            name: "Second-choice success",
            meta: "Journeys where a backup option produced a strong outcome",
            value: journeySummary.second_choice_success,
          },
        ]
          .filter(function (item) {
            return item.value > 0;
          })
          .map(function (item) {
            return (
              '<div class="insight-item"><div class="insight-item-top"><div><div class="insight-item-name">' +
              escapeHtml(item.name) +
              '</div><div class="insight-item-meta">' +
              escapeHtml(item.meta) +
              '</div></div><div class="insight-balance">' +
              item.value +
              "</div></div></div>"
            );
          })
          .join("") +
        "</div>"
      : "") +
    (timingSummary.on_time_pivots || timingSummary.early_pivots || timingSummary.late_pivots
      ? '<div class="insight-list">' +
        [
          {
            name: "On-time pivots",
            meta: "Fallbacks that happened close to the suggested pivot window",
            value: timingSummary.on_time_pivots,
          },
          {
            name: "Early pivots",
            meta: "Fallbacks that happened before the suggested pivot time",
            value: timingSummary.early_pivots,
          },
          {
            name: "Late pivots",
            meta: "Fallbacks that happened after the suggested pivot time",
            value: timingSummary.late_pivots,
          },
        ]
          .filter(function (item) {
            return item.value > 0;
          })
          .map(function (item) {
            return (
              '<div class="insight-item"><div class="insight-item-top"><div><div class="insight-item-name">' +
              escapeHtml(item.name) +
              '</div><div class="insight-item-meta">' +
              escapeHtml(item.meta) +
              '</div></div><div class="insight-balance">' +
              item.value +
              "</div></div></div>"
            );
          })
          .join("") +
        "</div>"
      : "") +
    (reasonCounts.length
      ? '<div class="insight-list">' +
        reasonCounts
          .slice(0, 4)
          .map(function (item) {
            return (
              '<div class="insight-item"><div class="insight-item-top"><div><div class="insight-item-name">' +
              escapeHtml(item.reason) +
              '</div><div class="insight-item-meta">Negative feedback mentions</div></div><div class="insight-balance">' +
              item.count +
              "</div></div></div>"
            );
          })
          .join("") +
        "</div>"
      : "") +
    (therapistSummaries.length
      ? '<div class="insight-list">' +
        therapistSummaries
          .slice(0, 5)
          .map(function (item) {
            return (
              '<div class="insight-item"><div class="insight-item-top"><div><div class="insight-item-name">' +
              escapeHtml(item.name) +
              '</div><div class="insight-item-meta">Positive: ' +
              item.positive +
              " • Negative: " +
              item.negative +
              '</div></div><div class="insight-balance">Net ' +
              (item.net > 0 ? "+" : "") +
              item.net +
              "</div></div></div>"
            );
          })
          .join("") +
        "</div>"
      : '<div class="insight-empty">No therapist-level feedback captured yet.</div>');
}

function buildFeedbackContext() {
  return {
    created_at: new Date().toISOString(),
    summary: latestProfile ? buildRequestSummary(latestProfile) : "",
    profile: latestProfile,
    therapist_slugs: latestEntries.slice(0, PRIMARY_SHORTLIST_LIMIT).map(function (entry) {
      return entry.therapist.slug;
    }),
  };
}

function saveFeedback(entry) {
  var feedback = readStoredFeedback();
  feedback.push(entry);
  writeStoredFeedback(feedback);
  latestLearningSignals = buildLearningSignals(feedback, readOutreachOutcomes());
  renderFeedbackInsights();
}

function updateShortlistFeedbackUi(value) {
  var positive = document.getElementById("feedbackShortlistPositive");
  var negative = document.getElementById("feedbackShortlistNegative");
  positive.classList.toggle("active-positive", value === "positive");
  negative.classList.toggle("active-negative", value === "negative");
  setReasonGroupVisibility("shortlist", value === "negative");
}

function recordShortlistFeedback(value) {
  if (!latestProfile || !latestEntries.length) {
    return;
  }

  saveFeedback({
    type: "shortlist_feedback",
    value: value,
    reasons: value === "negative" ? getSelectedReasonValues("shortlist") : [],
    context: buildFeedbackContext(),
  });
  updateShortlistFeedbackUi(value);
  document.getElementById("feedbackStatus").textContent =
    value === "positive" ? "Saved: this list felt useful." : "Saved: this list needs work.";
  latestEntries = rankEntriesForProfile(latestProfile);
  renderResults(latestEntries, latestProfile);
  renderFeedbackInsights();
}

function getMatchAdaptiveStrategy(profile) {
  latestAdaptiveSignals = summarizeAdaptiveSignals(
    readFunnelEvents(),
    readOutreachOutcomes(),
    buildLearningSegments(profile),
  );
  return latestAdaptiveSignals;
}

function buildAdaptiveStrategySnapshot(profile) {
  var strategy = getMatchAdaptiveStrategy(profile);
  return {
    match_action:
      strategy && strategy.preferred_match_action ? strategy.preferred_match_action : "help",
    home_mode: strategy && strategy.preferred_home_mode ? strategy.preferred_home_mode : "trust",
    directory_sort:
      strategy && strategy.preferred_directory_sort
        ? strategy.preferred_directory_sort
        : "best_match",
    segments: buildLearningSegments(profile),
  };
}

function getAdaptiveSecondPassMode(profile) {
  if (activeMatchExperimentVariant !== "adaptive") {
    return "balanced";
  }

  var strategy = getMatchAdaptiveStrategy(profile);
  var homeMode = strategy && strategy.preferred_home_mode ? strategy.preferred_home_mode : "trust";

  if (homeMode === "speed") {
    return "speed";
  }
  if (homeMode === "specialization") {
    return "specialization";
  }
  if (homeMode === "contact") {
    return "followthrough";
  }
  return "reviewed";
}

function triggerMotion(selector, className) {
  var element = typeof selector === "string" ? document.querySelector(selector) : selector;
  if (!element) {
    return;
  }
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}

function getTherapistContactEmailLink(entry) {
  if (
    !entry ||
    !entry.therapist ||
    !entry.therapist.email ||
    entry.therapist.email === "contact@example.com"
  ) {
    return "";
  }

  var subject = "Inquiry from BipolarTherapyHub";
  var body = buildEntryOutreachDraft(entry, latestProfile);

  return (
    "mailto:" +
    entry.therapist.email +
    "?subject=" +
    encodeURIComponent(subject) +
    "&body=" +
    encodeURIComponent(body)
  );
}

function getPreferredOutreach(entry) {
  return getPreferredOutreachBase(entry, {
    getTherapistContactEmailLink: getTherapistContactEmailLink,
  });
}

function getPreferredRouteType(entry) {
  return getPreferredRouteTypeBase(entry);
}

function getContactReadiness(entry) {
  if (!entry || !entry.therapist) {
    return null;
  }

  var therapist = entry.therapist;
  var outreach = getPreferredOutreach(entry);
  var routeLabel = outreach
    ? outreach.label
    : therapist.preferred_contact_method === "booking"
      ? "Booking link"
      : therapist.preferred_contact_method === "website"
        ? "Website intake"
        : therapist.preferred_contact_method === "phone"
          ? "Phone call"
          : therapist.preferred_contact_method === "email"
            ? "Email"
            : "Profile review first";

  var readinessTone =
    therapist.preferred_contact_method === "booking" ||
    therapist.preferred_contact_method === "website"
      ? "high"
      : therapist.preferred_contact_method === "phone" ||
          therapist.preferred_contact_method === "email"
        ? "medium"
        : "light";

  return {
    route: routeLabel,
    tone: readinessTone,
    guidance: String(therapist.contact_guidance || "").trim(),
    firstStep: String(therapist.first_step_expectation || "").trim(),
    wait: String(therapist.estimated_wait_time || "").trim(),
  };
}

function getRankingServices() {
  return {
    buildLearningSegments: buildLearningSegments,
    getPreferredOutreach: getPreferredOutreach,
    getPreferredRouteType: getPreferredRouteType,
    getRouteLearningForProfile: getRouteLearningForProfile,
    getRoutePriority: getRoutePriority,
    hasInsuranceClarity: hasInsuranceClarity,
    hasCostClarity: hasCostClarity,
    getResponsivenessScore: getResponsivenessScore,
    pickRecommendedFirstContact: pickRecommendedFirstContact,
    buildFallbackLearningMap: buildFallbackLearningMap,
  };
}

function getOutreachRenderServices() {
  return {
    escapeHtml: escapeHtml,
    formatTherapistLocationLine: formatTherapistLocationLine,
    trackFunnelEvent: trackFunnelEvent,
    buildMatchTrackingPayload: buildMatchTrackingPayload,
    buildEntryOutreachDraft: buildEntryOutreachDraft,
    setActionState: setActionState,
  };
}

function buildAdaptiveGuidance(profile, entries) {
  var requests = readConciergeRequests();
  var patterns = analyzeConciergePatterns(requests);
  var topEntries = (entries || []).slice(0, PRIMARY_SHORTLIST_LIMIT);
  var items = [];
  var topEvaluation = topEntries[0] && topEntries[0].evaluation ? topEntries[0].evaluation : null;
  var segmentCue = getSegmentAwareRecommendationCue(profile, topEvaluation);

  if (profile && profile.insurance) {
    items.push({
      tone: "practical",
      title: "Double-check insurance before you reach out",
      body: "Insurance and cost questions are one of the most common places people get stuck. Start with therapists who explicitly list your coverage or sliding-scale options.",
    });
  } else if (patterns.insurance >= 2) {
    items.push({
      tone: "practical",
      title: "Cost clarity helps people move faster",
      body: "People often hesitate when insurance or fees feel fuzzy. If cost matters, compare insurance accepted, fee ranges, and sliding-scale notes before picking your first outreach.",
    });
  }

  if (profile && profile.urgency && profile.urgency !== "ASAP") {
    items.push({
      tone: "timing",
      title: "Lead with timing if you need care soon",
      body: "When urgency matters, prioritize the therapists with the clearest wait-time signals and the easiest first step, like booking links or direct contact guidance.",
    });
  } else if (patterns.availability >= 2) {
    items.push({
      tone: "timing",
      title: "Availability is a common friction point",
      body: "If two options feel equally strong, use typical wait time and contact readiness to decide who to contact first.",
    });
  }

  if (
    (profile && profile.needs_medication_management === "Yes") ||
    (profile && profile.care_intent === "Psychiatry") ||
    patterns.medication >= 2
  ) {
    items.push({
      tone: "clinical",
      title: "Be explicit about medication needs",
      body: "Medication-management uncertainty is common. Mention whether you want psychiatry, therapy plus med support, or help coordinating with an outside prescriber.",
    });
  }

  if (topEntries.length >= 2 && (patterns.contact_first >= 1 || patterns.fit_uncertainty >= 2)) {
    var firstReady = getContactReadiness(topEntries[0]);
    var secondReady = getContactReadiness(topEntries[1]);
    items.push({
      tone: "decision",
      title: "If you are unsure who to contact first",
      body:
        "Start with the option that has the clearest contact path" +
        (firstReady ? " like " + firstReady.route.toLowerCase() : "") +
        ", then keep your second-best fit as backup rather than contacting everyone at once.",
    });
    if (secondReady && firstReady && secondReady.route !== firstReady.route) {
      items.push({
        tone: "decision",
        title: "Use fit and ease together",
        body: "A strong next move is to contact the therapist with the best balance of fit and easy follow-through, then compare the second option if the first path stalls.",
      });
    }
  }

  if (segmentCue) {
    items.push({
      tone: "decision",
      title: "Use the strongest practical cue in your first outreach",
      body: segmentCue,
    });
  }

  return items.slice(0, 3);
}

function renderAdaptiveGuidance(profile, entries) {
  var root = document.getElementById("matchAdaptiveGuidance");
  if (!root) {
    return;
  }
  var items = buildAdaptiveGuidance(profile, entries);
  renderAdaptiveGuidanceSection({
    root: root,
    items: items,
    isInternalMode: isInternalMode,
    escapeHtml: escapeHtml,
  });
}

function buildQueueReserveCopy(entry) {
  var therapist = entry && entry.therapist ? entry.therapist : {};
  var parts = [];

  if (therapist.accepting_new_patients) {
    parts.push("Looks open to new patients");
  }
  if (therapist.estimated_wait_time) {
    parts.push("availability note: " + therapist.estimated_wait_time);
  }
  if (therapist.bipolar_years_experience) {
    parts.push(therapist.bipolar_years_experience + " years of bipolar-focused experience");
  }
  if (therapist.medication_management) {
    parts.push("offers medication support");
  }

  if (!parts.length) {
    return "Worth keeping in reserve if your top options do not feel quite right.";
  }

  return (
    parts.slice(0, 2).join(" and ") +
    ". Keep this profile in reserve if you want a broader fallback set."
  );
}

function renderShortlistQueue(entries) {
  var root = document.getElementById("matchQueue");
  if (!root) {
    return;
  }

  var queueEntries = (entries || []).slice(PRIMARY_SHORTLIST_LIMIT, SHORTLIST_QUEUE_LIMIT);
  renderShortlistQueueSection({
    root: root,
    queueEntries: queueEntries,
    escapeHtml: escapeHtml,
    profileBaseHref: "/therapists/",
    formatTherapistLocationLine: formatTherapistLocationLine,
    buildQueueReserveCopy: buildQueueReserveCopy,
    shortlistLimit: PRIMARY_SHORTLIST_LIMIT,
  });

  root.querySelectorAll("[data-match-profile-link]").forEach(function (link) {
    link.addEventListener("click", function () {
      var slug = link.getAttribute("data-match-profile-link") || "";
      trackFunnelEvent(
        "match_result_profile_opened",
        buildMatchTrackingPayload(slug, {
          context: link.getAttribute("data-profile-link-context") || "queue",
        }),
      );
    });
  });
}

function getRoutePriority(contactReadiness) {
  return getRoutePriorityBase(contactReadiness);
}

function hasInsuranceClarity(profile, therapist) {
  return hasInsuranceClarityBase(profile, therapist);
}

function hasCostClarity(therapist) {
  return hasCostClarityBase(therapist);
}

function pickRecommendedFirstContact(profile, entries) {
  return pickRecommendedFirstContactBase(profile, entries, {
    shortlistLimit: PRIMARY_SHORTLIST_LIMIT,
    readOutreachOutcomes: readOutreachOutcomes,
    getShortcutInfluence: getShortcutInfluence,
    getContactReadiness: getContactReadiness,
    getRouteLearningForProfile: getRankingServices().getRouteLearningForProfile,
    getRoutePriority: getRankingServices().getRoutePriority,
    hasInsuranceClarity: getRankingServices().hasInsuranceClarity,
    hasCostClarity: getRankingServices().hasCostClarity,
    getResponsivenessScore: getRankingServices().getResponsivenessScore,
  });
}

function getEntryRankPosition(slug) {
  if (!slug || !Array.isArray(latestEntries)) {
    return 0;
  }
  return (
    latestEntries.findIndex(function (entry) {
      return entry && entry.therapist && entry.therapist.slug === slug;
    }) + 1
  );
}

function startMatchSessionTracking(profile, entries) {
  var topEntry = Array.isArray(entries) && entries[0] ? entries[0] : null;
  var topTherapist = topEntry && topEntry.therapist ? topEntry.therapist : {};
  var topRoute = topEntry ? getPreferredRouteType(topEntry) || "" : "";
  matchSessionStats = {
    started_at: Date.now(),
    journey_id: currentJourneyId || "",
    result_count: Array.isArray(entries) ? entries.length : 0,
    top_slug: topTherapist.slug || "",
    top_has_photo: Boolean(topTherapist.photo_url),
    top_completeness: Number(topTherapist.completeness_score || 0) || 0,
    top_bipolar_years: Number(topTherapist.bipolar_years_experience || 0) || 0,
    top_route_type: topRoute,
    care_intent: (profile && profile.care_intent) || "",
    care_format: (profile && profile.care_format) || "",
    care_state: (profile && profile.care_state) || "",
    priority_mode: (profile && profile.priority_mode) || "",
    has_insurance: Boolean(profile && profile.insurance),
    has_budget: Boolean(profile && profile.budget_max),
    experiments: getActiveExperimentContext(),
    contact_clicks: 0,
    profile_clicks: 0,
    refine_opens: 0,
    save_clicks: 0,
    contacted_top: false,
    contacted_top_route: "",
    contacted_routes: [],
    contacted_slugs: [],
    outcome_emitted: false,
  };
}

function recordMatchSessionInteraction(kind, payload) {
  if (!matchSessionStats) return;
  if (kind === "contact_click") {
    matchSessionStats.contact_clicks += 1;
    var slug = payload && payload.slug ? String(payload.slug) : "";
    var route = payload && payload.route ? String(payload.route) : "";
    if (slug && matchSessionStats.contacted_slugs.indexOf(slug) === -1) {
      matchSessionStats.contacted_slugs.push(slug);
    }
    if (route && matchSessionStats.contacted_routes.indexOf(route) === -1) {
      matchSessionStats.contacted_routes.push(route);
    }
    if (slug && slug === matchSessionStats.top_slug) {
      matchSessionStats.contacted_top = true;
      if (route && !matchSessionStats.contacted_top_route) {
        matchSessionStats.contacted_top_route = route;
      }
    }
  } else if (kind === "profile_click") {
    matchSessionStats.profile_clicks += 1;
  } else if (kind === "refine_open") {
    matchSessionStats.refine_opens += 1;
  } else if (kind === "save_click") {
    matchSessionStats.save_clicks += 1;
  }
}

function emitMatchSessionOutcome() {
  if (!matchSessionStats || matchSessionStats.outcome_emitted) return;
  matchSessionStats.outcome_emitted = true;
  var stats = matchSessionStats;
  var outcome =
    stats.contact_clicks > 0 ? "contacted" : stats.profile_clicks > 0 ? "explored" : "bounced";
  trackFunnelEvent("match_session_outcome", {
    journey_id: stats.journey_id,
    result_count: stats.result_count,
    top_slug: stats.top_slug,
    top_has_photo: stats.top_has_photo,
    top_completeness: stats.top_completeness,
    top_bipolar_years: stats.top_bipolar_years,
    top_route_type: stats.top_route_type,
    care_intent: stats.care_intent,
    care_format: stats.care_format,
    care_state: stats.care_state,
    priority_mode: stats.priority_mode,
    has_insurance: stats.has_insurance,
    has_budget: stats.has_budget,
    contact_clicks: stats.contact_clicks,
    profile_clicks: stats.profile_clicks,
    refine_opens: stats.refine_opens,
    save_clicks: stats.save_clicks,
    contacted_top: stats.contacted_top,
    contacted_top_route: stats.contacted_top_route,
    contacted_routes: stats.contacted_routes,
    contacted_slug_count: stats.contacted_slugs.length,
    outcome: outcome,
    ms_on_page: Date.now() - stats.started_at,
    experiments: stats.experiments,
  });
}

if (typeof window !== "undefined" && !window.__matchSessionOutcomeBound) {
  window.__matchSessionOutcomeBound = true;
  // pagehide is the one event modern browsers reliably fire on tab
  // close + bfcache navigations; beforeunload is a fallback for older
  // Safari. funnel-analytics flushes via sendBeacon on both.
  window.addEventListener("pagehide", emitMatchSessionOutcome);
  window.addEventListener("beforeunload", emitMatchSessionOutcome);
}

function buildMatchTrackingPayload(slug, extra) {
  var payload = Object.assign(
    {
      therapist_slug: slug || "",
      rank_position: getEntryRankPosition(slug) || "",
      result_count: Array.isArray(latestEntries) ? latestEntries.length : 0,
      top_slug:
        latestEntries[0] && latestEntries[0].therapist ? latestEntries[0].therapist.slug : "",
      strategy: buildAdaptiveStrategySnapshot(latestProfile),
      experiments: getActiveExperimentContext(),
    },
    extra || {},
  );
  return payload;
}

function persistMatchRequest(profile, entries) {
  if (!currentJourneyId || persistedJourneyId === currentJourneyId) {
    return;
  }

  persistedJourneyId = currentJourneyId;
  submitMatchRequest({
    journey_id: currentJourneyId,
    source_surface: "match_flow",
    created_at: new Date().toISOString(),
    request_summary: profile ? buildRequestSummary(profile) : "Directory list comparison",
    care_state: profile && profile.care_state ? profile.care_state : "",
    care_format: profile && profile.care_format ? profile.care_format : "",
    care_intent: profile && profile.care_intent ? profile.care_intent : "",
    needs_medication_management:
      profile && profile.needs_medication_management ? profile.needs_medication_management : "",
    insurance: profile && profile.insurance ? profile.insurance : "",
    budget_max: profile && profile.budget_max ? profile.budget_max : null,
    priority_mode: profile && profile.priority_mode ? profile.priority_mode : "",
    urgency: profile && profile.urgency ? profile.urgency : "",
    bipolar_focus: profile && Array.isArray(profile.bipolar_focus) ? profile.bipolar_focus : [],
    preferred_modalities:
      profile && Array.isArray(profile.preferred_modalities) ? profile.preferred_modalities : [],
    population_fit: profile && Array.isArray(profile.population_fit) ? profile.population_fit : [],
    language_preferences:
      profile && Array.isArray(profile.language_preferences) ? profile.language_preferences : [],
    cultural_preferences:
      profile && profile.cultural_preferences ? profile.cultural_preferences : "",
    top_slug: entries && entries[0] && entries[0].therapist ? entries[0].therapist.slug : "",
  }).catch(function () {
    persistedJourneyId = persistedJourneyId || currentJourneyId;
  });
}

function buildFirstContactRecommendation(profile, entries) {
  return buildFirstContactRecommendationBase(profile, entries, {
    pickRecommendedFirstContact: getRankingServices().pickRecommendedFirstContact,
    hasInsuranceClarity: getRankingServices().hasInsuranceClarity,
    hasCostClarity: getRankingServices().hasCostClarity,
    getResponsivenessScore: getRankingServices().getResponsivenessScore,
    getSegmentLearningCopy: getSegmentLearningCopy,
    getSegmentAwareRecommendationCue: getSegmentAwareRecommendationCue,
  });
}

function getLatestOutreachOutcome(slug) {
  var outcomes = readOutreachOutcomes()
    .filter(function (item) {
      return item && item.therapist_slug === slug;
    })
    .sort(function (a, b) {
      return new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime();
    });
  return outcomes[0] || null;
}

function getLatestShortlistOutcome(slugs) {
  var outcomes = readOutreachOutcomes();
  var shortlist = Array.isArray(slugs) ? slugs : [];
  for (var i = 0; i < outcomes.length; i += 1) {
    var item = outcomes[i];
    if (item && shortlist.indexOf(item.therapist_slug) !== -1) {
      return item;
    }
  }
  return null;
}

function recordEntryOutreachOutcome(slug, outcome) {
  var entry = (latestEntries || []).find(function (item) {
    return item.therapist.slug === slug;
  });
  if (!entry) {
    return;
  }

  var rankPosition =
    latestEntries.findIndex(function (item) {
      return item.therapist.slug === slug;
    }) + 1;
  var contactPlan = buildContactOrderPlan(latestProfile, latestEntries);
  var routeType = getPreferredRouteType(entry);
  var rememberedRoute = readRememberedTherapistContactRoute(entry.therapist.slug);
  var actualRouteType =
    rememberedRoute && rememberedRoute.route ? rememberedRoute.route : routeType;
  var shortcutContext = getShortcutContextForTherapist(entry.therapist.slug);
  var outcomes = readOutreachOutcomes();
  outcomes.unshift({
    recorded_at: new Date().toISOString(),
    journey_id: currentJourneyId || buildJourneyId(latestProfile, latestEntries),
    therapist_slug: entry.therapist.slug,
    therapist_name: entry.therapist.name,
    rank_position: rankPosition || 1,
    outcome: outcome,
    route_type: routeType,
    actual_route_type: actualRouteType,
    route_signal_source: rememberedRoute && rememberedRoute.route ? rememberedRoute.source : "",
    shortcut_type: shortcutContext ? shortcutContext.shortcut_type : "",
    pivot_at: contactPlan ? contactPlan.pivotAt : "",
    recommended_wait_window: contactPlan ? contactPlan.waitWindow : "",
    request_summary: latestProfile
      ? buildRequestSummary(latestProfile)
      : "Directory list comparison",
    context: {
      created_at: new Date().toISOString(),
      summary: latestProfile ? buildRequestSummary(latestProfile) : "Directory list comparison",
      profile: latestProfile,
      strategy: buildAdaptiveStrategySnapshot(latestProfile),
      therapist_slugs: latestEntries.slice(0, PRIMARY_SHORTLIST_LIMIT).map(function (item) {
        return item.therapist.slug;
      }),
    },
  });
  writeOutreachOutcomes(outcomes.slice(0, 150));
  latestLearningSignals = buildLearningSignals(readStoredFeedback(), readOutreachOutcomes());
  if (latestProfile) {
    latestEntries = rankEntriesForProfile(latestProfile);
  }
  if (shouldAdvanceOutreachFocus(outcome)) {
    outreachFocusSlug = getNextOutreachSlug(slug) || "";
  } else {
    outreachFocusSlug = slug;
  }
  renderResults(latestEntries, latestProfile);
  submitMatchOutcome({
    request_id: currentJourneyId || buildJourneyId(latestProfile, latestEntries),
    provider_id:
      (entry.therapist && (entry.therapist.provider_id || entry.therapist.providerId)) || "",
    therapist_slug: entry.therapist.slug,
    therapist_name: entry.therapist.name,
    rank_position: rankPosition || 1,
    result_count: Array.isArray(latestEntries) ? latestEntries.length : 0,
    top_slug: latestEntries[0] && latestEntries[0].therapist ? latestEntries[0].therapist.slug : "",
    route_type: routeType,
    actual_route_type: actualRouteType,
    route_signal_source: rememberedRoute && rememberedRoute.route ? rememberedRoute.source : "",
    shortcut_type: shortcutContext ? shortcutContext.shortcut_type : "",
    pivot_at: contactPlan ? contactPlan.pivotAt : "",
    recommended_wait_window: contactPlan ? contactPlan.waitWindow : "",
    outcome: outcome,
    request_summary: latestProfile
      ? buildRequestSummary(latestProfile)
      : "Directory list comparison",
    recorded_at: new Date().toISOString(),
    context: {
      summary: latestProfile ? buildRequestSummary(latestProfile) : "Directory list comparison",
      strategy: buildAdaptiveStrategySnapshot(latestProfile),
    },
  }).catch(function () {});
  if (shouldAdvanceOutreachFocus(outcome)) {
    var nextSlug = getNextOutreachSlug(slug);
    var nextEntry = (latestEntries || []).find(function (item) {
      return item && item.therapist && item.therapist.slug === nextSlug;
    });
    setActionState(
      true,
      nextEntry
        ? "Saved. Next up: " + nextEntry.therapist.name + "."
        : "Saved. That signals it may be time to move to your next option.",
    );
    return;
  }
  setActionState(
    true,
    "Saved for " + entry.therapist.name + ": " + formatOutcomeLabel(outcome) + ".",
  );
}

function buildFallbackRecommendation(profile, entries) {
  return buildFallbackRecommendationBase(profile, entries, {
    buildFirstContactRecommendation: buildFirstContactRecommendation,
    getLatestOutreachOutcome: getLatestOutreachOutcome,
    readOutreachOutcomes: readOutreachOutcomes,
    buildFallbackLearningMap: getRankingServices().buildFallbackLearningMap,
    buildLearningSegments: getRankingServices().buildLearningSegments,
    getRouteLearningForProfile: getRankingServices().getRouteLearningForProfile,
    getPreferredOutreach: getRankingServices().getPreferredOutreach,
    formatOutcomeLabel: formatOutcomeLabel,
  });
}

function renderFallbackRecommendation(profile, entries) {
  return renderFallbackRecommendationBase(profile, entries, {
    root: document.getElementById("matchFallbackContact"),
    buildFallbackRecommendation: buildFallbackRecommendation,
    buildContactOrderPlan: buildContactOrderPlan,
    getPreferredOutreach: getRankingServices().getPreferredOutreach,
    escapeHtml: getOutreachRenderServices().escapeHtml,
    formatTherapistLocationLine: getOutreachRenderServices().formatTherapistLocationLine,
    trackFunnelEvent: getOutreachRenderServices().trackFunnelEvent,
    buildMatchTrackingPayload: getOutreachRenderServices().buildMatchTrackingPayload,
    buildEntryOutreachDraft: getOutreachRenderServices().buildEntryOutreachDraft,
    setActionState: getOutreachRenderServices().setActionState,
  });
}

function renderFirstContactRecommendation(profile, entries) {
  return renderFirstContactRecommendationBase(profile, entries, {
    root: document.getElementById("matchFirstContact"),
    buildFirstContactRecommendation: buildFirstContactRecommendation,
    buildContactOrderPlan: buildContactOrderPlan,
    getPreferredOutreach: getRankingServices().getPreferredOutreach,
    getLatestOutreachOutcome: getLatestOutreachOutcome,
    escapeHtml: getOutreachRenderServices().escapeHtml,
    formatTherapistLocationLine: getOutreachRenderServices().formatTherapistLocationLine,
    formatOutcomeLabel: formatOutcomeLabel,
    outreachOutcomeOptions: OUTREACH_OUTCOME_OPTIONS,
    trackFunnelEvent: getOutreachRenderServices().trackFunnelEvent,
    buildMatchTrackingPayload: getOutreachRenderServices().buildMatchTrackingPayload,
    buildEntryOutreachDraft: getOutreachRenderServices().buildEntryOutreachDraft,
    setActionState: getOutreachRenderServices().setActionState,
    recordEntryOutreachOutcome: recordEntryOutreachOutcome,
  });
}

function buildContactOrderPlan(profile, entries) {
  return buildContactOrderPlanBase(profile, entries, {
    buildFirstContactRecommendation: buildFirstContactRecommendation,
    buildFallbackRecommendation: buildFallbackRecommendation,
    readOutreachOutcomes: readOutreachOutcomes,
    analyzePivotTimingByUrgency: analyzePivotTimingByUrgency,
    buildLearningSegments: getRankingServices().buildLearningSegments,
  });
}

function renderOutreachPanel(entries) {
  return renderOutreachPanelBase(entries, {
    root: document.getElementById("matchOutreach"),
    profile: latestProfile,
    outreachFocusSlug: outreachFocusSlug,
    setOutreachFocusSlug: function (value) {
      outreachFocusSlug = value || "";
    },
    renderOutreachPanel: renderOutreachPanel,
    getLatestOutreachOutcome: getLatestOutreachOutcome,
    escapeHtml: getOutreachRenderServices().escapeHtml,
    getPreferredOutreach: getRankingServices().getPreferredOutreach,
    buildEntryOutreachDraft: getOutreachRenderServices().buildEntryOutreachDraft,
    formatTherapistLocationLine: getOutreachRenderServices().formatTherapistLocationLine,
    formatOutcomeLabel: formatOutcomeLabel,
    outreachOutcomeOptions: OUTREACH_OUTCOME_OPTIONS,
    trackFunnelEvent: getOutreachRenderServices().trackFunnelEvent,
    buildMatchTrackingPayload: getOutreachRenderServices().buildMatchTrackingPayload,
    setActionState: getOutreachRenderServices().setActionState,
    recordEntryOutreachOutcome: recordEntryOutreachOutcome,
  });
}

var NAME_TITLE_PREFIXES = /^(dr|dr\.|mr|mr\.|mrs|mrs\.|ms|ms\.|mx|mx\.|prof|prof\.)$/i;

function getInitials(name) {
  var words = String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .filter(function (w) {
      return !NAME_TITLE_PREFIXES.test(w);
    });
  return words
    .map(function (w) {
      return w[0];
    })
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// Deterministic, name-driven palette. Each therapist always gets the same
// palette so the avatar feels like theirs; the palette set is varied enough
// that a grid of cards doesn't look monotone, but every hue stays in a calm,
// brand-adjacent range (no loud primaries).
var AVATAR_PALETTES = [
  { from: "#d4e4e9", to: "#b8d1d8", ink: "#155f70" }, // teal (brand)
  { from: "#dce7d8", to: "#bdd0b9", ink: "#3d6b4a" }, // sage
  { from: "#ead5d4", to: "#dab8b7", ink: "#7a4d4a" }, // blush
  { from: "#e9e0d0", to: "#d3c6ad", ink: "#6f5b36" }, // sand
  { from: "#dcd8ea", to: "#bab5d0", ink: "#534e7a" }, // lavender
  { from: "#d4dfe9", to: "#b0c2d4", ink: "#3d567a" }, // sky
];

function getAvatarPalette(name) {
  var input = String(name || "");
  var hash = 0;
  for (var i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTES[hash % AVATAR_PALETTES.length];
}

function buildAvatarStyle(palette) {
  return (
    "background: radial-gradient(120% 90% at 25% 15%, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0) 55%), " +
    "linear-gradient(135deg, " +
    palette.from +
    " 0%, " +
    palette.to +
    " 100%); color: " +
    palette.ink +
    ";"
  );
}

function getCareFormatLabel(therapist) {
  var tele = Boolean(therapist && therapist.accepts_telehealth);
  var inPerson = Boolean(therapist && therapist.accepts_in_person);
  if (tele && inPerson) return "In-person & telehealth";
  if (tele) return "Telehealth";
  if (inPerson) return "In-person";
  return "";
}

function getShortCareFormatLabel(therapist) {
  var tele = Boolean(therapist && therapist.accepts_telehealth);
  var inPerson = Boolean(therapist && therapist.accepts_in_person);
  if (tele && inPerson) return "Both";
  if (tele) return "Telehealth";
  if (inPerson) return "In-person";
  return "";
}

function getHeroFitChips(therapist, entry) {
  var chips = [];
  var check =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  if (therapist.license_number) {
    chips.push({ icon: check, label: "Verified CA license" });
  }
  if (therapist.accepting_new_patients) {
    chips.push({ icon: check, label: "Accepting new patients" });
  }
  var insurance = Array.isArray(therapist.insurance_accepted) ? therapist.insurance_accepted : [];
  if (insurance.length) {
    var top = insurance.slice(0, 2).join(", ");
    chips.push({ icon: check, label: "In-network: " + top });
  }
  var format = getCareFormatLabel(therapist);
  if (format && chips.length < 3) {
    chips.push({ icon: check, label: format });
  }
  // Fallback: use the matching explanation if we still have < 2 chips
  if (chips.length < 2) {
    var explanation = getMatchCardExplanation(entry);
    if (explanation) {
      chips.push({ icon: check, label: explanation.split(".")[0].slice(0, 56) });
    }
  }
  return chips.slice(0, 3);
}

function renderHeroPhoto(therapist) {
  var initials = getInitials(therapist.name);
  if (therapist.photo_url) {
    return '<img src="' + escapeHtml(therapist.photo_url) + '" alt="" loading="lazy" />';
  }
  var palette = getAvatarPalette(therapist.name);
  return (
    '<div class="mx-hero-photo-fill" style="' +
    buildAvatarStyle(palette) +
    '" aria-hidden="true">' +
    '<span class="mx-hero-photo-initials">' +
    escapeHtml(initials) +
    "</span>" +
    "</div>"
  );
}

function renderCardPhoto(therapist) {
  var initials = getInitials(therapist.name);
  if (therapist.photo_url) {
    return '<img src="' + escapeHtml(therapist.photo_url) + '" alt="" loading="lazy" />';
  }
  var palette = getAvatarPalette(therapist.name);
  return (
    '<span class="mx-card-photo-fill" style="' +
    buildAvatarStyle(palette) +
    '" aria-hidden="true">' +
    escapeHtml(initials) +
    "</span>"
  );
}

function renderSaveIcon(saved) {
  var fill = saved ? "currentColor" : "none";
  return (
    '<svg viewBox="0 0 24 24" fill="' +
    fill +
    '" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
    '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>' +
    "</svg>"
  );
}

function syncSaveButtonState(btn, slug) {
  if (!btn || !slug) return;
  var saved = isSavedSlug(slug);
  var baseClass = btn.classList.contains("mx-card-save") ? "mx-card-save" : "mx-save";
  btn.className = baseClass + (saved ? " is-saved" : "");
  btn.setAttribute("aria-pressed", saved ? "true" : "false");
  btn.setAttribute(
    "aria-label",
    saved ? "Saved. Tap to remove from your list." : "Save to your list.",
  );
  btn.innerHTML =
    renderSaveIcon(saved) + '<span class="mx-save-label">' + (saved ? "Saved" : "Save") + "</span>";
}

function syncAllSaveButtons() {
  document.querySelectorAll("[data-save-slug]").forEach(function (btn) {
    syncSaveButtonState(btn, btn.getAttribute("data-save-slug") || "");
  });
}

var saveAnnouncementTimer = 0;
function announceSaveAction(message) {
  var node = document.getElementById("matchSaveAnnouncement");
  if (!node) {
    node = document.createElement("div");
    node.id = "matchSaveAnnouncement";
    node.setAttribute("role", "status");
    node.setAttribute("aria-live", "polite");
    node.className = "mx-save-toast";
    document.body.appendChild(node);
  }
  node.textContent = message;
  node.classList.add("is-visible");
  window.clearTimeout(saveAnnouncementTimer);
  saveAnnouncementTimer = window.setTimeout(function () {
    node.classList.remove("is-visible");
  }, 2400);
}

subscribeToSavedList(syncAllSaveButtons);

function renderSaveButton(slug, variant) {
  var saved = isSavedSlug(slug);
  var className = (variant === "card" ? "mx-card-save" : "mx-save") + (saved ? " is-saved" : "");
  var label = saved ? "Saved" : "Save";
  return (
    '<button type="button" class="' +
    className +
    '" data-save-slug="' +
    escapeHtml(slug || "") +
    '" aria-label="' +
    (saved ? "Saved. Tap to remove from your list." : "Save to your list.") +
    '" aria-pressed="' +
    (saved ? "true" : "false") +
    '">' +
    renderSaveIcon(saved) +
    '<span class="mx-save-label">' +
    label +
    "</span>" +
    "</button>"
  );
}

function renderLeadResultCard(entry, _backupName, options) {
  var settings = options || {};
  var therapist = entry.therapist || {};
  var preferredRoute = getPreferredOutreach(entry);
  var routeType = getPreferredRouteType(entry);
  var credLine = [therapist.credentials, therapist.title].filter(Boolean).join(" · ");
  var locLine =
    [therapist.city, therapist.state].filter(Boolean).join(", ") +
    (therapist.zip ? " " + therapist.zip : "");
  var metaLine = credLine + (credLine && locLine ? " · " : "") + locLine;
  var ctaLabel =
    routeType === "booking"
      ? "Book consultation"
      : routeType === "phone"
        ? "Call therapist"
        : routeType === "email"
          ? "Email therapist"
          : "Contact therapist";
  var chips = getHeroFitChips(therapist, entry);
  var fitReasons = getHeroFitReasons(entry, therapist, latestProfile);
  var chipsHtml = chips
    .map(function (chip) {
      return '<span class="mx-fit-chip">' + chip.icon + escapeHtml(chip.label) + "</span>";
    })
    .join("");

  var availabilityLabel = getCompareTimingLabel(therapist);
  var costLabel = getCompareCostLabel(therapist);
  var formatLabel = getCareFormatLabel(therapist);

  var badgeHtml = settings.showBestBadge
    ? '<span class="mx-hero-badge">' +
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z"/></svg>' +
      "Best match for you" +
      "</span>"
    : "";
  return (
    '<article class="mx-hero">' +
    '<div class="mx-hero-photo">' +
    badgeHtml +
    renderHeroPhoto(therapist) +
    "</div>" +
    '<div class="mx-hero-body">' +
    '<div class="mx-hero-top">' +
    "<div>" +
    '<h3 class="mx-hero-name">' +
    escapeHtml(therapist.name || "") +
    "</h3>" +
    (metaLine ? '<p class="mx-hero-cred">' + escapeHtml(metaLine) + "</p>" : "") +
    "</div>" +
    renderSaveButton(therapist.slug || "", "hero") +
    "</div>" +
    (chipsHtml ? '<div class="mx-fit-row">' + chipsHtml + "</div>" : "") +
    renderTrustEvidenceStrip(therapist, { variant: "card", className: "mx-hero-trust" }) +
    '<div class="mx-hero-meta">' +
    '<div class="mx-meta-item">' +
    '<span class="mx-meta-label">Availability</span>' +
    '<span class="mx-meta-value' +
    (availabilityLabel ? " is-available" : "") +
    '">' +
    escapeHtml(availabilityLabel || "Check profile") +
    "</span>" +
    "</div>" +
    '<div class="mx-meta-item">' +
    '<span class="mx-meta-label">Session fee</span>' +
    '<span class="mx-meta-value">' +
    escapeHtml(costLabel || "See profile") +
    "</span>" +
    "</div>" +
    '<div class="mx-meta-item">' +
    '<span class="mx-meta-label">Format</span>' +
    '<span class="mx-meta-value">' +
    escapeHtml(formatLabel || "See profile") +
    "</span>" +
    "</div>" +
    "</div>" +
    (fitReasons.length
      ? '<div class="mx-hero-fit"><h4 class="mx-hero-fit-title">Why this may be a good fit</h4><ul class="mx-hero-fit-list">' +
        fitReasons
          .map(function (reason) {
            return "<li>" + escapeHtml(reason) + "</li>";
          })
          .join("") +
        "</ul></div>"
      : "") +
    '<div class="mx-hero-actions">' +
    (preferredRoute
      ? '<a href="' +
        escapeHtml(preferredRoute.href) +
        '" class="mx-btn-primary" data-match-primary-cta="' +
        escapeHtml(therapist.slug || "") +
        '" data-match-primary-route="' +
        escapeHtml(ctaLabel) +
        '"' +
        (preferredRoute.external ? ' target="_blank" rel="noopener noreferrer"' : "") +
        ">" +
        escapeHtml(ctaLabel) +
        "</a>"
      : "") +
    '<a href="' +
    escapeHtml(buildTherapistProfileHref(therapist.slug)) +
    '" class="mx-btn-secondary" data-match-profile-link="' +
    escapeHtml(therapist.slug || "") +
    '" data-profile-link-context="primary-card">View details</a>' +
    "</div>" +
    '<p class="mx-hero-reassure">You do not need to get this perfect. Start with your top match.</p>' +
    "</div>" +
    "</article>"
  );
}

function renderSupportingResultCard(entry, _rank, options) {
  var settings = options || {};
  var therapist = entry.therapist || {};
  var preferredRoute = getPreferredOutreach(entry);
  var routeType = getPreferredRouteType(entry);
  var explanation = getMatchCardExplanation(entry);
  var credLine = [therapist.credentials, therapist.title].filter(Boolean).join(" · ");
  var locLine = [therapist.city, therapist.state].filter(Boolean).join(", ");
  var metaLine = credLine + (credLine && locLine ? " · " : "") + locLine;
  var availabilityLabel = getCompareTimingLabel(therapist);
  var costLabel = getCompareCostLabel(therapist);
  var formatLabel = getShortCareFormatLabel(therapist);
  var ctaLabel =
    routeType === "booking"
      ? "Book"
      : routeType === "phone"
        ? "Call"
        : routeType === "email"
          ? "Email"
          : "Contact";
  var contextLabel = settings.context === "bank" ? "bank-card" : "supporting-card";
  var metaParts = [];
  if (availabilityLabel) {
    metaParts.push('<span class="mx-avail">● ' + escapeHtml(availabilityLabel) + "</span>");
  }
  if (costLabel) {
    metaParts.push("<span>" + escapeHtml(costLabel) + "</span>");
  }
  if (formatLabel) {
    metaParts.push("<span>" + escapeHtml(formatLabel) + "</span>");
  }
  var metaHtml = metaParts.join('<span class="mx-dot" aria-hidden="true"></span>');

  return (
    '<article class="mx-card">' +
    '<div class="mx-card-top">' +
    '<div class="mx-card-photo">' +
    renderCardPhoto(therapist) +
    "</div>" +
    '<div class="mx-card-ident">' +
    '<h3 class="mx-card-name">' +
    escapeHtml(therapist.name || "") +
    "</h3>" +
    (metaLine ? '<p class="mx-card-cred">' + escapeHtml(metaLine) + "</p>" : "") +
    "</div>" +
    renderSaveButton(therapist.slug || "", "card") +
    "</div>" +
    (explanation
      ? '<div class="mx-card-fit"><span class="mx-card-fit-label">Why this may be a good fit</span><p class="mx-card-reason">' +
        escapeHtml(explanation) +
        "</p></div>"
      : "") +
    (metaHtml ? '<div class="mx-card-meta">' + metaHtml + "</div>" : "") +
    '<div class="mx-card-actions">' +
    (preferredRoute
      ? '<a href="' +
        escapeHtml(preferredRoute.href) +
        '" class="mx-btn-primary" data-match-primary-cta="' +
        escapeHtml(therapist.slug || "") +
        '" data-match-primary-route="' +
        escapeHtml(ctaLabel) +
        '"' +
        (preferredRoute.external ? ' target="_blank" rel="noopener noreferrer"' : "") +
        ">" +
        escapeHtml(ctaLabel) +
        "</a>"
      : "") +
    '<a href="' +
    escapeHtml(buildTherapistProfileHref(therapist.slug)) +
    '" class="mx-btn-secondary" data-match-profile-link="' +
    escapeHtml(therapist.slug || "") +
    '" data-profile-link-context="' +
    escapeHtml(contextLabel) +
    '">Profile</a>' +
    "</div>" +
    "</article>"
  );
}

function countActiveRefinements(profile) {
  if (!profile) return 0;
  var count = 0;
  if (profile.insurance) count += 1;
  if (profile.care_format) count += 1;
  if (profile.budget_max) count += 1;
  if (profile.urgency && profile.urgency !== "ASAP") count += 1;
  if (Array.isArray(profile.bipolar_focus) && profile.bipolar_focus.length) count += 1;
  if (Array.isArray(profile.preferred_modalities) && profile.preferred_modalities.length)
    count += 1;
  if (Array.isArray(profile.population_fit) && profile.population_fit.length) count += 1;
  if (Array.isArray(profile.language_preferences) && profile.language_preferences.length)
    count += 1;
  return count;
}

function buildResultsHeaderHtml(profile, totalCount) {
  var careIntent =
    profile && profile.care_intent ? String(profile.care_intent) : "Bipolar-informed care";
  var zip = profile && profile.location_query ? String(profile.location_query) : "";
  var format =
    profile && profile.care_format ? String(profile.care_format) : "In-person or telehealth";
  var parts = [careIntent];
  if (zip) parts.push(zip);
  if (format) parts.push(format);
  var subDetails = parts.join(" · ");

  var activeCount = countActiveRefinements(profile);
  var countBadge = activeCount
    ? '<span class="mx-refine-btn-count">' + activeCount + "</span>"
    : '<span class="mx-refine-btn-count" hidden>0</span>';

  return (
    '<header class="mx-results-header">' +
    '<div class="mx-results-header-copy">' +
    '<div class="mx-results-kicker">Your matches</div>' +
    '<h1 class="mx-results-title">' +
    totalCount +
    " bipolar-informed " +
    (totalCount === 1 ? "match" : "matches") +
    " for you</h1>" +
    '<p class="mx-results-sub">Ranked for <strong>' +
    escapeHtml(subDetails) +
    "</strong>. Tap <em>Refine</em> to tighten the fit.</p>" +
    "</div>" +
    '<button type="button" class="mx-refine-btn" data-mx-refine-open="header">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
    '<line x1="4" y1="21" x2="4" y2="14"></line>' +
    '<line x1="4" y1="10" x2="4" y2="3"></line>' +
    '<line x1="12" y1="21" x2="12" y2="12"></line>' +
    '<line x1="12" y1="8" x2="12" y2="3"></line>' +
    '<line x1="20" y1="21" x2="20" y2="16"></line>' +
    '<line x1="20" y1="12" x2="20" y2="3"></line>' +
    '<line x1="1" y1="14" x2="7" y2="14"></line>' +
    '<line x1="9" y1="8" x2="15" y2="8"></line>' +
    '<line x1="17" y1="16" x2="23" y2="16"></line>' +
    "</svg>" +
    "Refine" +
    countBadge +
    "</button>" +
    "</header>"
  );
}

function renderPrimaryMatchCards(entries, profile) {
  var root = getMatchShellRefs().resultsRoot;
  if (!root) {
    return;
  }

  // Hide entries with no working contact method — never render a card whose
  // only action would 404 or dead-end. A card must have at least one of:
  // booking_url, website, phone, or email.
  var allEntries = (entries || [])
    .filter(function (entry) {
      return Boolean(getPreferredOutreach(entry));
    })
    .slice(0, 10);

  if (!allEntries.length) {
    root.className = "match-empty";
    return;
  }

  var leadEntry = allEntries[0];
  var runnerUps = allEntries.slice(1, 3); // ranks 2 & 3
  var bankEntries = allEntries.slice(3); // ranks 4-10

  // Only show the "Best match" badge when rank 1 materially beats rank 2.
  var leadScore = leadEntry && typeof leadEntry.score === "number" ? leadEntry.score : null;
  var runnerScore =
    runnerUps[0] && typeof runnerUps[0].score === "number" ? runnerUps[0].score : null;
  var showBestBadge =
    leadScore !== null && runnerScore !== null ? leadScore - runnerScore > 0.05 : true;

  var runnersHtml = runnerUps.length
    ? '<div class="mx-runners">' +
      runnerUps
        .map(function (entry) {
          return renderSupportingResultCard(entry, 0, { context: "runner" });
        })
        .join("") +
      "</div>"
    : "";

  var swipeHint =
    '<div class="mx-swipe-hint" aria-hidden="true">' +
    "<span>Swipe for your top 3</span>" +
    '<span class="mx-swipe-hint-dots">' +
    '<span class="mx-swipe-hint-dot is-active"></span>' +
    '<span class="mx-swipe-hint-dot"></span>' +
    '<span class="mx-swipe-hint-dot"></span>' +
    "</span>" +
    "</div>";

  var refineBand =
    '<aside class="mx-refine-band">' +
    '<div class="mx-refine-copy">' +
    '<h3 class="mx-refine-title">Want a tighter fit?</h3>' +
    '<p class="mx-refine-sub">Narrow these matches with a detail you care about.</p>' +
    "</div>" +
    '<div class="mx-refine-chips">' +
    '<button type="button" class="mx-refine-chip" data-mx-refine-open="insurance">' +
    '<span class="mx-refine-chip-dot" aria-hidden="true"></span>Takes my insurance</button>' +
    '<button type="button" class="mx-refine-chip" data-mx-refine-open="format">' +
    '<span class="mx-refine-chip-dot" aria-hidden="true"></span>Telehealth only</button>' +
    '<button type="button" class="mx-refine-chip" data-mx-refine-open="language">' +
    '<span class="mx-refine-chip-dot" aria-hidden="true"></span>Language</button>' +
    "</div>" +
    "</aside>";

  var bankHtml = bankEntries.length
    ? '<header class="mx-bank-header">' +
      '<h2 class="mx-bank-title">More strong matches</h2>' +
      '<span class="mx-bank-count">' +
      bankEntries.length +
      " more</span>" +
      "</header>" +
      '<section class="mx-bank-grid">' +
      bankEntries
        .map(function (entry) {
          return renderSupportingResultCard(entry, 0, { context: "bank" });
        })
        .join("") +
      "</section>"
    : "";

  root.className = "match-list";
  root.innerHTML =
    '<div class="results-panel">' +
    buildResultsHeaderHtml(profile, allEntries.length) +
    swipeHint +
    '<section class="mx-top-three">' +
    renderLeadResultCard(leadEntry, null, { showBestBadge: showBestBadge }) +
    runnersHtml +
    "</section>" +
    refineBand +
    bankHtml +
    "</div>";

  // Deliberately NOT calling placeBuilderInResults: that used to move
  // the .match-builder into #matchResults wrapped in a <details>
  // "Refine your results" summary, which created a second refinement
  // surface competing with the drawer AND trapped the drawer inside a
  // transformed / collapsed ancestor that broke position:fixed. The
  // drawer now lives at its original DOM location (inside .match-layout)
  // and is the only refinement surface; it's opened via the header
  // Refine button.

  // Wire the results-header Refine button and the smart-refine chips
  // ("Takes my insurance" / "Telehealth only" / "Language") to open the
  // refine drawer.
  root.querySelectorAll("[data-mx-refine-open]").forEach(function (chip) {
    chip.addEventListener("click", function () {
      setRefineDrawerOpen(true);
      var target = chip.getAttribute("data-mx-refine-open");
      trackFunnelEvent("match_smart_refine_chip", { target: target });
      // For the smart chips (insurance / format / language), focus the
      // relevant field in the drawer so the user can type immediately.
      if (target && target !== "header") {
        var focusMap = {
          insurance: "insurance",
          format: 'input[name="care_format"]',
          language: "language_preferences",
        };
        var selector = focusMap[target];
        if (selector) {
          window.requestAnimationFrame(function () {
            var node = document.getElementById(selector) || document.querySelector(selector);
            if (node && typeof node.focus === "function") {
              node.focus({ preventScroll: true });
            }
          });
        }
      }
    });
  });

  root.querySelectorAll("[data-match-primary-cta]").forEach(function (link) {
    link.addEventListener("click", function () {
      var slug = link.getAttribute("data-match-primary-cta") || "";
      trackFunnelEvent(
        "match_primary_cta_clicked",
        buildMatchTrackingPayload(slug, {
          route: link.getAttribute("data-match-primary-route") || "",
        }),
      );
      recordMatchSessionInteraction("contact_click", {
        slug: slug,
        route: link.getAttribute("data-match-primary-route") || "",
      });
    });
  });

  var summaryPrimaryAction = document.getElementById("startWithLeadButton");
  if (summaryPrimaryAction) {
    summaryPrimaryAction.addEventListener("click", function () {
      var slug = summaryPrimaryAction.getAttribute("data-match-summary-primary") || "";
      trackFunnelEvent(
        "match_summary_primary_clicked",
        buildMatchTrackingPayload(slug, {
          route: "Summary primary action",
        }),
      );
    });
  }

  root.querySelectorAll("[data-match-profile-link]").forEach(function (link) {
    link.addEventListener("click", function () {
      var slug = link.getAttribute("data-match-profile-link") || "";
      trackFunnelEvent(
        "match_result_profile_opened",
        buildMatchTrackingPayload(slug, {
          context: link.getAttribute("data-profile-link-context") || "result",
        }),
      );
      recordMatchSessionInteraction("profile_click", { slug: slug });
    });
  });

  root.querySelectorAll(".mx-save, .mx-card-save").forEach(function (btn) {
    if (btn.dataset.boundSaveClick === "true") return;
    btn.dataset.boundSaveClick = "true";
    btn.addEventListener("click", function (event) {
      event.preventDefault();
      var slug = btn.getAttribute("data-save-slug") || "";
      if (!slug) {
        var card = btn.closest(".mx-hero, .mx-card");
        var anchor = card
          ? card.querySelector("[data-match-primary-cta], [data-match-profile-link]")
          : null;
        if (anchor) {
          slug =
            anchor.getAttribute("data-match-primary-cta") ||
            anchor.getAttribute("data-match-profile-link") ||
            "";
        }
      }
      if (!slug) return;

      var result = toggleSavedSlug(slug, { surface: "match_results" });
      trackFunnelEvent("match_card_save_clicked", buildMatchTrackingPayload(slug, {}));
      recordMatchSessionInteraction("save_click", { slug: slug });

      if (result.reason === "full") {
        announceSaveAction("Your list is full. Remove someone before saving another.");
        return;
      }

      syncSaveButtonState(btn, slug);
      announceSaveAction(
        result.reason === "added"
          ? "Saved to your list. Open the list from the top nav."
          : "Removed from your list.",
      );
    });
  });

  bindRefineButtons();
  bindSummaryMatchSlider(root);
  bindPrimaryMatchSlider(root);
}

function safeRenderResults(entries, profile) {
  try {
    renderResults(entries, profile);
  } catch (error) {
    console.error("Fell back to primary match cards after richer match rendering failed.", error);
    renderPrimaryMatchCards(entries, profile);
    setActionState(true, "Your list is ready. Some secondary sections did not finish rendering.");
  }
}

var matchEntriesBySlug = Object.create(null);

function rememberEntriesForDetails(entries) {
  matchEntriesBySlug = Object.create(null);
  var missingContact = [];
  (entries || []).forEach(function (entry) {
    if (entry && entry.therapist && entry.therapist.slug) {
      matchEntriesBySlug[entry.therapist.slug] = entry;
      if (!getContactRoutes(entry).length) {
        missingContact.push(entry.therapist.slug + " (" + (entry.therapist.name || "?") + ")");
      }
    }
  });
  if (missingContact.length) {
    console.warn(
      "[match] therapists missing all contact methods (cards will be hidden):",
      missingContact,
    );
  }
}

function renderDetailsBody(entry) {
  var therapist = entry.therapist || {};
  var credLine = [therapist.credentials, therapist.title].filter(Boolean).join(" · ");
  var locLine =
    [therapist.city, therapist.state].filter(Boolean).join(", ") +
    (therapist.zip ? " " + therapist.zip : "");
  var chips = getHeroFitChips(therapist, entry);
  var chipsHtml = chips
    .map(function (chip) {
      return '<span class="mx-fit-chip">' + chip.icon + escapeHtml(chip.label) + "</span>";
    })
    .join("");

  var availability = getCompareTimingLabel(therapist);
  var cost = getCompareCostLabel(therapist);
  var format = getCareFormatLabel(therapist);
  var insurance = Array.isArray(therapist.insurance_accepted)
    ? therapist.insurance_accepted.filter(Boolean).slice(0, 6).join(", ")
    : "";

  var gridItems = [];
  if (availability) gridItems.push(["Availability", availability]);
  if (format) gridItems.push(["Format", format]);
  if (cost) gridItems.push(["Session fee", cost]);
  if (insurance) gridItems.push(["Insurance", insurance]);
  if (therapist.license_number) {
    gridItems.push([
      "License",
      "CA " + therapist.license_number,
      '<a href="https://search.dca.ca.gov/" target="_blank" rel="noopener noreferrer">CA ' +
        escapeHtml(therapist.license_number) +
        "</a>",
    ]);
  }
  var gridHtml = gridItems.length
    ? '<div class="mx-details-grid">' +
      gridItems
        .map(function (pair) {
          var valueHtml = pair[2] ? pair[2] : escapeHtml(pair[1]);
          return (
            '<div class="mx-details-grid-item">' +
            '<span class="mx-details-grid-label">' +
            escapeHtml(pair[0]) +
            "</span>" +
            '<span class="mx-details-grid-value">' +
            valueHtml +
            "</span>" +
            "</div>"
          );
        })
        .join("") +
      "</div>"
    : "";

  var reasons = Array.isArray(entry && entry.evaluation && entry.evaluation.reasons)
    ? entry.evaluation.reasons.filter(Boolean).slice(0, 4)
    : [];
  var fitHtml = reasons.length
    ? '<div class="mx-details-section"><h4>Why this may be a good fit</h4><ul>' +
      reasons
        .map(function (reason) {
          return "<li>" + escapeHtml(reason) + "</li>";
        })
        .join("") +
      "</ul></div>"
    : "";

  var specialties = Array.isArray(therapist.specialties) ? therapist.specialties : [];
  var specialtiesHtml = specialties.length
    ? '<div class="mx-details-section"><h4>Specialties</h4><p>' +
      escapeHtml(specialties.slice(0, 8).join(", ")) +
      "</p></div>"
    : "";

  var populations = Array.isArray(therapist.client_populations) ? therapist.client_populations : [];
  var populationsHtml = populations.length
    ? '<div class="mx-details-section"><h4>Populations served</h4><p>' +
      escapeHtml(populations.slice(0, 6).join(", ")) +
      "</p></div>"
    : "";

  var approach = therapist.care_approach || therapist.bio_preview || "";
  var approachHtml = approach
    ? '<div class="mx-details-section"><h4>Approach</h4><p>' +
      escapeHtml(String(approach).slice(0, 420)) +
      "</p></div>"
    : "";

  var preferredRoute = getPreferredOutreach(entry);
  var routeType = getPreferredRouteType(entry);
  var ctaLabel =
    routeType === "booking"
      ? "Book consultation"
      : routeType === "phone"
        ? "Call therapist"
        : routeType === "email"
          ? "Email therapist"
          : "Contact therapist";

  var actionsHtml =
    '<div class="mx-details-actions">' +
    (preferredRoute
      ? '<a href="' +
        escapeHtml(preferredRoute.href) +
        '" class="mx-btn-primary" data-match-primary-cta="' +
        escapeHtml(therapist.slug || "") +
        '" data-match-primary-route="' +
        escapeHtml(ctaLabel) +
        '"' +
        (preferredRoute.external ? ' target="_blank" rel="noopener noreferrer"' : "") +
        ">" +
        escapeHtml(ctaLabel) +
        "</a>"
      : "") +
    '<a href="' +
    escapeHtml(buildTherapistProfileHref(therapist.slug)) +
    '" class="mx-btn-secondary">Full profile</a>' +
    "</div>";

  return (
    '<p class="mx-details-kicker">Therapist details</p>' +
    '<h3 class="mx-details-name" id="matchDetailsTitle">' +
    escapeHtml(therapist.name || "") +
    "</h3>" +
    (credLine || locLine
      ? '<p class="mx-details-cred">' +
        escapeHtml([credLine, locLine].filter(Boolean).join(" · ")) +
        "</p>"
      : "") +
    (chipsHtml ? '<div class="mx-details-chips">' + chipsHtml + "</div>" : "") +
    gridHtml +
    fitHtml +
    specialtiesHtml +
    populationsHtml +
    approachHtml +
    actionsHtml
  );
}

function openMatchDetails(slug) {
  var entry = matchEntriesBySlug[slug];
  if (!entry) return false;
  var dialog = document.getElementById("matchDetailsDialog");
  var body = document.getElementById("matchDetailsBody");
  if (!dialog || !body || typeof dialog.showModal !== "function") return false;
  body.innerHTML = renderDetailsBody(entry);
  if (!dialog.open) dialog.showModal();
  return true;
}

function bindMatchDetailsDialog() {
  var dialog = document.getElementById("matchDetailsDialog");
  var close = document.getElementById("matchDetailsClose");
  if (!dialog || !close) return;
  close.addEventListener("click", function () {
    if (dialog.open) dialog.close();
  });
  dialog.addEventListener("click", function (event) {
    if (event.target === dialog) dialog.close();
  });
  document.addEventListener("click", function (event) {
    var link =
      event.target && event.target.closest
        ? event.target.closest("a[data-match-profile-link]")
        : null;
    if (!link) return;
    var slug = link.getAttribute("data-match-profile-link");
    if (!slug) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) return;
    if (openMatchDetails(slug)) {
      event.preventDefault();
    }
  });
}

// ─── Contact modal ──────────────────────────────────────────────
// Single-purpose dialog launched by every contact CTA on the match
// page. Replaces the raw tel:/mailto: that previously fired straight
// from anchors (which opened FaceTime on macOS).

function isMobileViewport() {
  if (typeof window === "undefined") return false;
  if ("ontouchstart" in window || navigator.maxTouchPoints > 0) return true;
  if (window.matchMedia && window.matchMedia("(max-width: 767px)").matches) return true;
  return false;
}

function getDomainFromUrl(url) {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch (_e) {
    return "";
  }
}

function formatPhoneDisplay(phone) {
  var digits = String(phone || "").replace(/[^\d]/g, "");
  if (digits.length === 11 && digits.charAt(0) === "1") {
    digits = digits.slice(1);
  }
  if (digits.length === 10) {
    return "(" + digits.slice(0, 3) + ") " + digits.slice(3, 6) + "-" + digits.slice(6);
  }
  return String(phone || "").trim();
}

function getContactRoutes(entry) {
  var therapist = (entry && entry.therapist) || {};
  var routes = [];
  var phoneDigits = String(therapist.phone || "").replace(/[^\d+]/g, "");
  if (phoneDigits) {
    routes.push({
      type: "phone",
      label: "Phone",
      display: formatPhoneDisplay(therapist.phone),
      href: "tel:" + phoneDigits,
      raw: therapist.phone,
    });
  }
  if (therapist.email && therapist.email !== "contact@example.com") {
    routes.push({
      type: "email",
      label: "Email",
      display: therapist.email,
      href: "mailto:" + therapist.email,
      raw: therapist.email,
    });
  }
  if (therapist.booking_url) {
    var bookingHref = /^(https?:)/i.test(therapist.booking_url)
      ? therapist.booking_url
      : "https://" + therapist.booking_url.replace(/^\/+/, "");
    routes.push({
      type: "booking",
      label: "Book online",
      display: getDomainFromUrl(bookingHref) || "Booking page",
      href: bookingHref,
      raw: bookingHref,
    });
  }
  if (therapist.website) {
    var siteHref = /^(https?:)/i.test(therapist.website)
      ? therapist.website
      : "https://" + therapist.website.replace(/^\/+/, "");
    routes.push({
      type: "website",
      label: "Website",
      display: getDomainFromUrl(siteHref) || "Website",
      href: siteHref,
      raw: siteHref,
    });
  }
  return routes;
}

// Maps the frontend's snake_case therapist viewmodel to the camelCase
// shape the shared contact-modal module accepts.
function toSharedContactTherapist(therapist) {
  var t = therapist || {};
  return {
    name: t.name || "",
    phone: t.phone || "",
    email: t.email || "",
    website: t.website || "",
    bookingUrl: t.booking_url || t.bookingUrl || "",
    preferredContactMethod: t.preferred_contact_method || t.preferredContactMethod || "",
  };
}

function renderContactDialogBody(entry) {
  var therapist = entry.therapist || {};
  var result = buildContactModalContent(toSharedContactTherapist(therapist), {
    isMobile: isMobileViewport(),
  });
  return result.html;
}

function flashCopyConfirmation(button) {
  if (!button) return;
  var original = button.getAttribute("data-original-label") || button.textContent;
  button.setAttribute("data-original-label", original);
  button.textContent = "Copied ✓";
  button.classList.add("is-copied");
  window.setTimeout(function () {
    button.textContent = original;
    button.classList.remove("is-copied");
  }, 2000);
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_e) {
      // fall through to legacy path
    }
  }
  try {
    var textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
    return true;
  } catch (_e) {
    return false;
  }
}

function bindContactDialogActions(entry) {
  var body = document.getElementById("contactDialogBody");
  if (!body) return;
  var therapist = entry.therapist || {};

  body.querySelectorAll("[data-contact-copy]").forEach(function (button) {
    button.addEventListener("click", async function () {
      var value = button.getAttribute("data-contact-copy-value") || "";
      var ok = await copyTextToClipboard(value);
      if (ok) {
        flashCopyConfirmation(button);
        trackFunnelEvent("match_contact_modal_copy", {
          slug: therapist.slug || "",
          target: button.getAttribute("data-contact-copy"),
        });
      }
    });
  });

  var copyMessageBtn = body.querySelector("[data-contact-copy-message]");
  if (copyMessageBtn) {
    copyMessageBtn.addEventListener("click", async function () {
      var textarea = body.querySelector("#contactDraftMessage");
      var text = textarea ? textarea.value : "";
      var ok = await copyTextToClipboard(text);
      if (ok) {
        flashCopyConfirmation(copyMessageBtn);
        trackFunnelEvent("match_contact_modal_copy_message", {
          slug: therapist.slug || "",
        });
      }
    });
  }

  var sendEmailBtn = body.querySelector("[data-contact-send-email]");
  if (sendEmailBtn) {
    sendEmailBtn.addEventListener("click", function () {
      var email = sendEmailBtn.getAttribute("data-contact-send-email") || "";
      var textarea = body.querySelector("#contactDraftMessage");
      var bodyText = textarea ? textarea.value : "";
      var href =
        "mailto:" +
        email +
        "?subject=" +
        encodeURIComponent("Inquiry from BipolarTherapyHub") +
        "&body=" +
        encodeURIComponent(bodyText);
      trackFunnelEvent("match_contact_modal_send_email", {
        slug: therapist.slug || "",
      });
      window.location.href = href;
    });
  }

  body.querySelectorAll("[data-contact-other-route]").forEach(function (link) {
    link.addEventListener("click", function () {
      trackFunnelEvent("match_contact_modal_other_route", {
        slug: therapist.slug || "",
        route: link.getAttribute("data-contact-other-route") || "",
      });
    });
  });
}

function openContactDialog(slug) {
  var entry = matchEntriesBySlug[slug];
  if (!entry || !entry.therapist) return false;
  var routes = getContactRoutes(entry);
  if (!routes.length) return false;
  var dialog = document.getElementById("contactDialog");
  var body = document.getElementById("contactDialogBody");
  if (!dialog || !body || typeof dialog.showModal !== "function") return false;
  body.innerHTML = renderContactDialogBody(entry);
  if (!dialog.open) dialog.showModal();
  bindContactDialogActions(entry);
  trackFunnelEvent("match_contact_modal_opened", {
    slug: entry.therapist.slug || "",
  });
  // Modal-open is the canonical contact-intent signal on /match.html —
  // every contact path on a card routes through this dialog. Record it
  // as a contact click so match_session_outcome correctly classifies
  // the session as "contacted" rather than "bounced." Without this,
  // the dashboard read 13 modal opens as 0 contacts.
  recordMatchSessionInteraction("contact_click", {
    slug: entry.therapist.slug || "",
    route: "modal",
  });
  return true;
}

function bindContactDialog() {
  var dialog = document.getElementById("contactDialog");
  var close = document.getElementById("contactDialogClose");
  if (!dialog || !close) return;
  close.addEventListener("click", function () {
    if (dialog.open) dialog.close();
  });
  dialog.addEventListener("click", function (event) {
    if (event.target === dialog) dialog.close();
  });

  document.addEventListener(
    "click",
    function (event) {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) return;
      var target = event.target && event.target.closest ? event.target : null;
      if (!target) return;
      var trigger = target.closest(
        "[data-match-primary-cta], [data-fallback-contact-link], [data-contact-trigger]",
      );
      if (!trigger) return;
      var slug =
        trigger.getAttribute("data-match-primary-cta") ||
        trigger.getAttribute("data-fallback-contact-link") ||
        trigger.getAttribute("data-contact-trigger");
      if (!slug) return;
      if (openContactDialog(slug)) {
        event.preventDefault();
      }
    },
    true,
  );
}

function renderResults(entries, profile) {
  var refs = getMatchShellRefs();
  var root = refs.resultsRoot;
  var hasRefinements = hasMeaningfulRefinements(profile);
  var primaryEntries = (entries || []).slice(0, PRIMARY_SHORTLIST_LIMIT);

  if (!entries.length) {
    var requestedZip = getRequestedZip(profile);
    var zipSuggestions = getClosestZipSuggestions(
      profile,
      (therapists || []).map(function (therapist) {
        return { therapist: therapist };
      }),
    );
    trackFunnelEvent("match_results_empty", {
      has_refinements: hasRefinements,
      has_zip: Boolean(requestedZip),
      zip_suggestion_count: zipSuggestions.length,
    });
    setActionState(false, "Try widening your constraints before saving or sharing this result.");
    renderNoResultsState(
      profile,
      requestedZip && zipSuggestions.length ? zipSuggestions : [],
      hasRefinements,
    );
    clearRenderedMatchPanels();
    var refineSectionEmpty = document.getElementById("matchRefineSection");
    if (refineSectionEmpty) {
      refineSectionEmpty.setAttribute("open", "");
    }
    return;
  }

  trackFunnelEvent("match_results_viewed", {
    result_count: entries.length,
    primary_count: primaryEntries.length,
    top_slug: entries[0] && entries[0].therapist ? entries[0].therapist.slug || "" : "",
    has_refinements: hasRefinements,
  });

  if (!currentJourneyId) {
    currentJourneyId = buildJourneyId(profile, entries);
  }
  persistMatchRequest(profile, entries);
  rememberEntriesForDetails(entries);
  setActionState(true, getMatchAdaptiveStrategy().match_action_copy.status);
  renderPrimaryMatchCards(entries, profile);
  triggerMotion(root, "motion-enter");
  renderFallbackRecommendation(profile, primaryEntries);
  renderAdaptiveGuidance(profile, entries);
  renderShortlistQueue(entries);
  if (refs.feedbackBar) {
    refs.feedbackBar.hidden = false;
  }
  renderComparison(entries);

  // Collapse refine section when real results are showing (not starter mode)
  var refineSection = document.getElementById("matchRefineSection");
  if (refineSection && !starterResultsMode) {
    refineSection.removeAttribute("open");
  } else if (refineSection && starterResultsMode) {
    refineSection.setAttribute("open", "");
  }

  // Hide hero content
  var heroRoot = document.getElementById("matchResults");
  if (heroRoot) {
    heroRoot.classList.remove("match-empty");
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  var profile = readCurrentIntakeProfile();
  await ensureZipcodesReadyForProfile(profile);
  executeMatch(profile, {
    scroll: true,
    source: currentJourneyId ? "match_refine" : "match_page",
  });
}

function renderDirectoryShortlist(slugs) {
  var savedShortlist = readDirectoryShortlist();
  var selected = slugs
    .map(function (slug) {
      var therapist = therapists.find(function (item) {
        return item.slug === slug;
      });
      var shortlistEntry = savedShortlist.find(function (item) {
        return item.slug === slug;
      });
      return therapist
        ? {
            therapist: therapist,
            evaluation: {
              score: 0,
              confidence_score: 0,
              completeness_score: 0,
              shortlist_priority: shortlistEntry ? shortlistEntry.priority : "",
              shortlist_note: shortlistEntry ? shortlistEntry.note : "",
              reasons: [
                "Saved directly from the directory for side-by-side comparison.",
                shortlistEntry && shortlistEntry.priority
                  ? "You marked this as " + shortlistEntry.priority.toLowerCase() + "."
                  : "",
                shortlistEntry && shortlistEntry.note ? "Your note: " + shortlistEntry.note : "",
              ].filter(Boolean),
              cautions: [],
              score_breakdown: {
                access: 0,
                practical: 0,
                clinical: 0,
                trust: 0,
                uncertainty: 0,
                learned: 0,
              },
            },
          }
        : null;
    })
    .filter(Boolean)
    .map(function (entry) {
      entry.evaluation.reasons.push(
        entry.therapist.verification_status === "editorially_verified"
          ? "This profile is editorially verified."
          : "Profile details should be reviewed before deciding.",
      );
      return entry;
    });

  if (!selected.length) {
    return false;
  }

  latestProfile = null;
  latestEntries = selected;
  currentJourneyId = buildJourneyId(null, selected);
  starterResultsMode = false;
  var latestShortlistOutcome = getLatestShortlistOutcome(
    selected.map(function (entry) {
      return entry.therapist.slug;
    }),
  );
  if (
    latestShortlistOutcome &&
    ["no_response", "waitlist", "insurance_mismatch"].indexOf(latestShortlistOutcome.outcome) !== -1
  ) {
    outreachFocusSlug = getNextOutreachSlug(latestShortlistOutcome.therapist_slug) || "";
  } else if (latestShortlistOutcome && latestShortlistOutcome.therapist_slug) {
    outreachFocusSlug = latestShortlistOutcome.therapist_slug;
  } else {
    outreachFocusSlug = selected[0] && selected[0].therapist ? selected[0].therapist.slug : "";
  }
  if (
    queueFocusSlugFromUrl &&
    selected.some(function (entry) {
      return entry && entry.therapist && entry.therapist.slug === queueFocusSlugFromUrl;
    })
  ) {
    outreachFocusSlug = queueFocusSlugFromUrl;
  }
  window.history.replaceState({}, "", buildShortlistComparePath(selected));
  persistMatchRequest(null, selected);
  safeRenderResults(selected, null);
  if (directoryEntryMode === "directory_shortlist_queue") {
    trackFunnelEvent("directory_outreach_queue_landed", {
      shortlist_size: selected.length,
      therapist_slugs: selected.map(function (entry) {
        return entry.therapist.slug;
      }),
    });
    setActionState(
      true,
      latestShortlistOutcome
        ? "Your outreach queue is ready to resume. Pick up with the next live contact step."
        : "Your outreach queue is ready. Start with the lead contact card, then keep the backup close.",
    );
  } else {
    setActionState(
      true,
      "You can compare these saved therapists or run the full intake for ranked recommendations.",
    );
  }
  return true;
}

function resetForm() {
  var refs = getMatchShellRefs();
  var form = refs.form;
  form.reset();
  syncZipResolvedLabel("");
  syncMatchStartState();
  renderMatchIntakePreview(readCurrentIntakeProfile());
  renderAdaptiveIntakeGuidance(readCurrentIntakeProfile());
  renderIntakeTradeoffPreview(readCurrentIntakeProfile());
  activeSecondPassMode = "balanced";
  latestProfile = null;
  latestEntries = [];
  currentJourneyId = null;
  persistedJourneyId = "";
  starterResultsMode = false;
  setMatchJourneyMode("intake");
  window.history.replaceState({}, "", "match.html");
  setActionState(false, "Run a match to review your top options.");
  syncMatchStartState();
  renderMatchLandingShell();
  clearRenderedMatchPanels();
  updateShortlistFeedbackUi("");
  if (refs.feedbackStatus) {
    refs.feedbackStatus.textContent =
      "Your feedback helps us improve which providers rise for searches like yours.";
  }
}

function refreshIntakeUiFromForm() {
  var refs = getMatchShellRefs();
  var form = refs.form;
  var profile = readCurrentIntakeProfile();

  syncZipResolvedLabel(
    profile.location_query || (form.elements.location_query || { value: "" }).value,
  );
  syncMatchStartState();
  renderMatchIntakePreview(profile);
  renderAdaptiveIntakeGuidance(profile);
  renderIntakeTradeoffPreview(profile);

  return profile;
}

(async function init() {
  initValuePillPopover();
  startZipcodesPreload();
  var therapistsPromise = fetchPublicTherapists();
  therapists = await therapistsPromise;

  if (isDatasetEmpty(therapists)) {
    var emptyResultsRoot = document.getElementById("matchResults");
    if (emptyResultsRoot) {
      emptyResultsRoot.className = "match-results";
      emptyResultsRoot.innerHTML = renderDatasetEmptyStateMarkup();
    }
    var emptyHideSelectors = [".match-layout", ".match-refine-backdrop"];
    emptyHideSelectors.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (node) {
        node.setAttribute("hidden", "");
        node.style.display = "none";
      });
    });
    return;
  }

  var landedSource = "direct";
  try {
    var landedParams = new URLSearchParams(window.location.search || "");
    if (landedParams.has("care_state") || landedParams.has("location_query")) {
      landedSource = "homepage_handoff";
    } else if (landedParams.has("shortlist")) {
      landedSource = "resumed_shortlist";
    }
  } catch (_landedError) {
    /* ignore */
  }
  trackFunnelEvent("match_intake_landed", {
    source: landedSource,
  });

  latestLearningSignals = buildLearningSignals(readStoredFeedback(), readOutreachOutcomes());
  activeMatchExperimentVariant = getExperimentVariant("match_ranking", ["control", "adaptive"]);
  trackExperimentExposure("match_ranking", activeMatchExperimentVariant, {
    surface: "match",
  });
  latestAdaptiveSignals = getMatchAdaptiveStrategy();
  var refs = getMatchShellRefs();
  initMatchCareDropdown();
  bindMatchDetailsDialog();
  bindContactDialog();
  bindRefineButtons();
  bindRefineTeaserShortcuts();
  bindInsuranceAutocomplete();
  var matchForm = refs.form;
  matchForm.addEventListener("submit", handleSubmit);
  matchForm.addEventListener("input", function (event) {
    syncMirroredFieldValues(event.target);
    maybeWarmZipcodesForValue(matchForm.elements.location_query.value);
    refreshIntakeUiFromForm();
    maybeLiveRecompute(event);
  });
  matchForm.addEventListener("change", function (event) {
    syncMirroredFieldValues(event.target);
    maybeWarmZipcodesForValue(matchForm.elements.location_query.value);
    refreshIntakeUiFromForm();
    maybeLiveRecompute(event);
  });
  var refinements = refs.refinements;
  if (refinements) {
    refinements.addEventListener("toggle", function () {
      if (refinements.open) {
        trackFunnelEvent("match_refinements_opened", {
          care_intent: matchForm.elements.care_intent.value || "",
          has_zip: Boolean(normalizeLocationQuery(matchForm.elements.location_query.value)),
        });
      }
    });
  }
  var resetMatchButton = document.getElementById("resetMatch");
  if (resetMatchButton) {
    resetMatchButton.addEventListener("click", resetForm);
  }
  document.getElementById("feedbackShortlistPositive").addEventListener("click", function () {
    recordShortlistFeedback("positive");
  });
  document.getElementById("feedbackShortlistNegative").addEventListener("click", function () {
    recordShortlistFeedback("negative");
  });

  var restoredProfile = restoreProfileFromUrl();
  var restoredShortlist = restoreShortlistFromUrl();
  refreshIntakeUiFromForm();
  if (restoredProfile) {
    hydrateForm(restoredProfile);
    await ensureZipcodesReadyForProfile(restoredProfile);
    executeMatch(restoredProfile, {
      scroll: false,
      source: "homepage_handoff",
    });
  } else if (!restoredProfile && restoredShortlist.length) {
    renderDirectoryShortlist(restoredShortlist);
  } else {
    renderStarterResults();
    syncZipResolvedLabel(matchForm.elements.location_query.value);
    updateShortlistFeedbackUi("");
  }
  var root = refs.resultsRoot;
  var fallbackProfile = latestProfile || readCurrentIntakeProfile();
  if (
    root &&
    root.classList.contains("match-empty") &&
    fallbackProfile &&
    fallbackProfile.care_state
  ) {
    await ensureZipcodesReadyForProfile(fallbackProfile);
    executeMatch(fallbackProfile, {
      scroll: false,
      source: "restored_fallback",
    });
  }
  renderFeedbackInsights();
})();
