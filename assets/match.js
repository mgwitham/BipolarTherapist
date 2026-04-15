import { fetchPublicSiteSettings, fetchPublicTherapists } from "./cms.js";
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
import { getZipMarketStatus, preloadZipcodes } from "./zip-lookup.js";

var therapists = [];
var latestProfile = null;
var latestEntries = [];
var latestLearningSignals = null;
var currentJourneyId = null;
var persistedJourneyId = "";
var outreachFocusSlug = "";
var starterResultsMode = false;
var activeShortcutContext = null;
var DIRECTORY_SHORTLIST_KEY = "bth_directory_shortlist_v1";
var SHORTLIST_RESHAPE_HISTORY_KEY = "bth_shortlist_reshape_history_v1";
var MATCH_FEEDBACK_KEY = "bth_match_feedback_v1";
var CONCIERGE_REQUESTS_KEY = "bth_concierge_requests_v1";
var OUTREACH_OUTCOMES_KEY = "bth_outreach_outcomes_v1";
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
var SHORTLIST_QUEUE_LIMIT = 12;
var MATCH_PRIORITY_SLUGS = [];
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

function normalizePrioritySlugs(siteSettings) {
  return Array.isArray(siteSettings && siteSettings.matchPrioritySlugs)
    ? siteSettings.matchPrioritySlugs
        .map(function (value) {
          return String(value || "").trim();
        })
        .filter(Boolean)
    : [];
}

function applyMatchPriorityProminence(entries) {
  var prioritySet = new Set(MATCH_PRIORITY_SLUGS);
  return (entries || []).slice().sort(function (a, b) {
    var aPriority = prioritySet.has(a && a.therapist ? a.therapist.slug : "");
    var bPriority = prioritySet.has(b && b.therapist ? b.therapist.slug : "");
    var scoreDiff = Math.abs(
      (Number(a?.evaluation?.score) || 0) - (Number(b?.evaluation?.score) || 0),
    );

    if (aPriority !== bPriority && scoreDiff <= 12) {
      return Number(bPriority) - Number(aPriority);
    }

    return (
      (Number(b?.evaluation?.score) || 0) - (Number(a?.evaluation?.score) || 0) ||
      (Number(b?.evaluation?.confidence_score) || 0) -
        (Number(a?.evaluation?.confidence_score) || 0) ||
      String(a?.therapist?.name || "").localeCompare(String(b?.therapist?.name || ""))
    );
  });
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
  if (!/^\d{5}$/.test(String(fromZip || "")) || !/^\d{5}$/.test(String(toZip || ""))) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.abs(Number(fromZip) - Number(toZip));
}

function applyZipAwareOrdering(entries, profile) {
  var requestedZip = getRequestedZip(profile);
  if (!requestedZip) {
    return (entries || []).slice();
  }

  return (entries || []).slice().sort(function (a, b) {
    var aScore = Number(a?.evaluation?.score) || 0;
    var bScore = Number(b?.evaluation?.score) || 0;
    var scoreDiff = Math.abs(aScore - bScore);
    var aZip = getTherapistZipValue(a && a.therapist);
    var bZip = getTherapistZipValue(b && b.therapist);
    var aDistance = getZipDistance(requestedZip, aZip);
    var bDistance = getZipDistance(requestedZip, bZip);
    var aExact = aZip === requestedZip;
    var bExact = bZip === requestedZip;

    if (aExact !== bExact && scoreDiff <= 18) {
      return Number(bExact) - Number(aExact);
    }

    if (
      aDistance !== bDistance &&
      Number.isFinite(aDistance) &&
      Number.isFinite(bDistance) &&
      scoreDiff <= 14
    ) {
      return aDistance - bDistance;
    }

    if (Number.isFinite(aDistance) !== Number.isFinite(bDistance) && scoreDiff <= 10) {
      return Number(Number.isFinite(aDistance)) - Number(Number.isFinite(bDistance));
    }

    return 0;
  });
}

function orderMatchEntries(entries, profile) {
  return applyMatchPriorityProminence(applyZipAwareOrdering(entries, profile));
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
  if (!mode || mode === "balanced") {
    return (entries || []).slice();
  }

  return (entries || []).slice().sort(function (a, b) {
    var aScore = getSecondPassScore(a, profile, mode);
    var bScore = getSecondPassScore(b, profile, mode);

    return (
      bScore - aScore ||
      (Number(b?.evaluation?.score) || 0) - (Number(a?.evaluation?.score) || 0) ||
      String(a?.therapist?.name || "").localeCompare(String(b?.therapist?.name || ""))
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
      syncZipResolvedLabel(document.getElementById("location_query").value);
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

function bindRefineButtons() {
  // refineSearchButton: external trigger — always opens the panel
  var externalBtn = document.getElementById("refineSearchButton");
  if (externalBtn && externalBtn.dataset.boundRefine !== "true") {
    externalBtn.dataset.boundRefine = "true";
    externalBtn.addEventListener("click", function () {
      var refinements = document.querySelector(".match-refinements");
      var moreBtn = document.getElementById("openAdvancedFiltersButton");
      if (refinements) {
        refinements.open = true;
        if (moreBtn) {
          moreBtn.setAttribute("aria-expanded", "true");
          moreBtn.classList.add("is-expanded");
        }
      }
      var builder = document.querySelector(".match-builder");
      if (builder) {
        builder.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }

  // openAdvancedFiltersButton: inline toggle button
  var moreBtn = document.getElementById("openAdvancedFiltersButton");
  if (moreBtn && moreBtn.dataset.boundRefine !== "true") {
    moreBtn.dataset.boundRefine = "true";
    moreBtn.addEventListener("click", function () {
      var refinements = document.querySelector(".match-refinements");
      if (refinements) {
        refinements.open = !refinements.open;
        moreBtn.setAttribute("aria-expanded", refinements.open ? "true" : "false");
        moreBtn.classList.toggle("is-expanded", refinements.open);
      }
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

  activeSecondPassMode = getAdaptiveSecondPassMode(profile);
  var entries = rankEntriesForProfile(profile);
  trackFunnelEvent("match_submitted", {
    care_state: profile.care_state,
    care_intent: profile.care_intent,
    urgency: profile.urgency,
    priority_mode: profile.priority_mode,
    result_count: entries.length,
    top_slug: entries[0] ? entries[0].therapist.slug : "",
    strategy: buildAdaptiveStrategySnapshot(profile),
    experiments: getActiveExperimentContext(),
    source: settings.source,
  });
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
  try {
    return (JSON.parse(window.localStorage.getItem(DIRECTORY_SHORTLIST_KEY) || "[]") || [])
      .map(function (item) {
        if (typeof item === "string") {
          return {
            slug: item,
            priority: "",
            note: "",
          };
        }

        if (!item || !item.slug) {
          return null;
        }

        return {
          slug: String(item.slug),
          priority: String(item.priority || ""),
          note: String(item.note || ""),
        };
      })
      .filter(Boolean)
      .slice(0, PRIMARY_SHORTLIST_LIMIT);
  } catch (_error) {
    return [];
  }
}

function writeDirectoryShortlist(value) {
  try {
    window.localStorage.setItem(DIRECTORY_SHORTLIST_KEY, JSON.stringify(value || []));
  } catch (_error) {
    return;
  }
}

function normalizeDirectoryShortlistValue(value) {
  return (Array.isArray(value) ? value : [])
    .map(function (item) {
      if (!item || !item.slug) {
        return null;
      }
      return {
        slug: String(item.slug),
        priority: String(item.priority || ""),
        note: String(item.note || ""),
      };
    })
    .filter(Boolean)
    .slice(0, PRIMARY_SHORTLIST_LIMIT);
}

function persistEntriesToDirectoryShortlist(entries) {
  var existing = readDirectoryShortlist();
  var normalized = normalizeDirectoryShortlistValue(
    (entries || []).slice(0, PRIMARY_SHORTLIST_LIMIT).map(function (entry) {
      var saved = existing.find(function (item) {
        return item.slug === entry?.therapist?.slug;
      });
      return {
        slug: entry?.therapist?.slug || "",
        priority:
          String(entry?.evaluation?.shortlist_priority || "").trim() ||
          String(saved?.priority || "").trim(),
        note:
          String(entry?.evaluation?.shortlist_note || "").trim() ||
          String(saved?.note || "").trim(),
      };
    }),
  );

  if (normalized.length) {
    writeDirectoryShortlist(normalized);
  }

  return normalized;
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
    href: preferredRoute
      ? preferredRoute.href
      : "therapist.html?slug=" + encodeURIComponent(therapist.slug || ""),
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
  var select = document.getElementById("care_intent");

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

function getMatchConfidenceMeta(entry) {
  var confidence = Number(entry?.evaluation?.confidence_score || 0);
  if (confidence >= 80) {
    return { label: "High confidence", tone: "high" };
  }
  if (confidence >= 60) {
    return { label: "Good confidence", tone: "medium" };
  }
  return { label: "Promising fit", tone: "light" };
}

function getMatchCardExplanation(entry) {
  var reasons = Array.isArray(entry?.evaluation?.reasons)
    ? entry.evaluation.reasons.filter(Boolean)
    : [];
  return (
    reasons[0] || "This option rose because it balances fit, practical details, and follow-through."
  );
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
    '<div class="match-section"><h4>Why this recommendation is worth trusting</h4><div class="match-snapshot-grid">' +
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
          '</span><a class="compare-decision-link" href="therapist.html?slug=' +
          encodeURIComponent(therapist.slug) +
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
    '<section class="partner-compare-summary"><div class="partner-compare-header"><div><div class="partner-compare-title">Shareable decision summary</div><p>Use this when you want to send a quick update to a partner, friend, or family member without sending the full comparison page.</p></div><button type="button" class="btn-secondary" data-copy-partner-summary>Copy summary</button></div><pre class="partner-compare-body">' +
    escapeHtml(summary) +
    "</pre></section>"
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
    {
      label: "What makes them different",
      alwaysShow: true,
      getValue: function (therapist) {
        var entry = topEntries.find(function (item) {
          return item && item.therapist && item.therapist.slug === therapist.slug;
        });
        return getMatchCardExplanation(entry);
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
    "</div></section></div>";

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
      '<div class="feedback-insights-header"><h3>Internal Match Insights</h3><p>Local-only summary of the feedback captured on this device.</p></div><div class="insight-empty">No feedback captured yet.</div>';
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
    '<div class="feedback-insights-header"><h3>Internal Match Insights</h3><p>Local-only summary of the feedback captured on this device.</p></div>' +
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

  var subject = buildEntryOutreachSubject(entry, latestProfile);
  var body = buildEntryOutreachDraft(entry, latestProfile);

  return (
    "mailto:" +
    encodeURIComponent(entry.therapist.email) +
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
    profileBaseHref: "therapist.html?slug=",
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

function getInitials(name) {
  return (name || "")
    .split(" ")
    .filter(Boolean)
    .map(function (w) {
      return w[0];
    })
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function buildFeeText(therapist) {
  if (therapist.session_fee_min && therapist.session_fee_max) {
    return "$" + therapist.session_fee_min + "–$" + therapist.session_fee_max + "/session";
  }
  if (therapist.session_fee_min) {
    return "From $" + therapist.session_fee_min + "/session";
  }
  return "";
}

function renderLeadResultCard(entry, backupName) {
  var therapist = entry.therapist || {};
  var preferredRoute = getPreferredOutreach(entry);
  var routeType = getPreferredRouteType(entry);
  var explanation = getMatchCardExplanation(entry);
  var confidence = getMatchConfidenceMeta(entry);
  var readiness = getContactReadiness(entry);
  var initials = getInitials(therapist.name);
  var credLine = [therapist.credentials, therapist.title].filter(Boolean).join(" · ");
  var locLine =
    [therapist.city, therapist.state].filter(Boolean).join(", ") +
    (therapist.zip ? " " + therapist.zip : "");
  var feeText = buildFeeText(therapist);
  var ctaLabel =
    routeType === "booking"
      ? "Book a consultation"
      : routeType === "phone"
        ? "Call this provider"
        : routeType === "email"
          ? "Email this provider"
          : routeType === "website"
            ? "Visit provider site"
            : "View full profile";
  var signals = [];
  if (therapist.accepting_new_patients) {
    signals.push('<span class="result-signal is-green">Accepting patients</span>');
  }
  if (therapist.accepts_telehealth) {
    signals.push('<span class="result-signal">Telehealth available</span>');
  }
  if (therapist.accepts_in_person) {
    signals.push('<span class="result-signal">In-person available</span>');
  }
  if (feeText) {
    signals.push('<span class="result-signal">' + escapeHtml(feeText) + "</span>");
  }
  if (therapist.sliding_scale) {
    signals.push('<span class="result-signal">Sliding scale</span>');
  }
  var contactNote = "";

  return (
    '<article class="result-lead">' +
    '<div class="result-lead-header">' +
    '<div class="result-avatar result-avatar--lead">' +
    escapeHtml(initials) +
    "</div>" +
    '<div class="result-lead-identity">' +
    '<div class="result-badges">' +
    '<span class="result-badge result-badge--lead">Best match</span>' +
    '<span class="result-confidence tone-' +
    escapeHtml(confidence.tone) +
    '">' +
    escapeHtml(confidence.label) +
    "</span>" +
    "</div>" +
    '<h3 class="result-name">' +
    escapeHtml(therapist.name || "") +
    "</h3>" +
    (credLine ? '<div class="result-creds">' + escapeHtml(credLine) + "</div>" : "") +
    (locLine ? '<div class="result-loc">' + escapeHtml(locLine) + "</div>" : "") +
    "</div>" +
    "</div>" +
    (signals.length ? '<div class="result-signals">' + signals.join("") + "</div>" : "") +
    (explanation ? '<p class="result-reason">' + escapeHtml(explanation) + "</p>" : "") +
    (contactNote ? '<div class="result-contact-note">' + escapeHtml(contactNote) + "</div>" : "") +
    '<div class="result-actions">' +
    (preferredRoute
      ? '<a href="' +
        escapeHtml(preferredRoute.href) +
        '" class="result-cta-primary" data-match-primary-cta="' +
        escapeHtml(therapist.slug || "") +
        '" data-match-primary-route="' +
        escapeHtml(ctaLabel) +
        '"' +
        (preferredRoute.external ? ' target="_blank" rel="noopener"' : "") +
        ">" +
        escapeHtml(ctaLabel) +
        "</a>"
      : "") +
    '<button type="button" class="result-cta-secondary" data-copy-entry-draft="' +
    escapeHtml(therapist.slug || "") +
    '">Copy first outreach</button>' +
    '<a href="therapist.html?slug=' +
    encodeURIComponent(therapist.slug || "") +
    '" class="result-view-profile" data-match-profile-link="' +
    escapeHtml(therapist.slug || "") +
    '" data-profile-link-context="primary-card">View profile</a>' +
    "</div>" +
    (backupName
      ? '<div class="result-backup-note">If this stalls, your next best option is <strong>' +
        escapeHtml(backupName) +
        "</strong></div>"
      : "") +
    "</article>"
  );
}

function renderSupportingResultCard(entry, rank) {
  var therapist = entry.therapist || {};
  var preferredRoute = getPreferredOutreach(entry);
  var routeType = getPreferredRouteType(entry);
  var explanation = getMatchCardExplanation(entry);
  var initials = getInitials(therapist.name);
  var credLine = [therapist.credentials, therapist.title].filter(Boolean).join(" · ");
  var locLine =
    [therapist.city, therapist.state].filter(Boolean).join(", ") +
    (therapist.zip ? " " + therapist.zip : "");
  var feeText = buildFeeText(therapist);
  var ctaLabel =
    routeType === "booking"
      ? "Book"
      : routeType === "phone"
        ? "Call"
        : routeType === "email"
          ? "Email"
          : routeType === "website"
            ? "Visit site"
            : "View profile";

  return (
    '<article class="result-card">' +
    '<div class="result-card-rank">#' +
    rank +
    "</div>" +
    '<div class="result-card-avatar">' +
    '<div class="result-avatar">' +
    escapeHtml(initials) +
    "</div>" +
    "</div>" +
    '<div class="result-card-body">' +
    '<div class="result-card-header">' +
    '<div class="result-card-identity">' +
    '<div class="result-name">' +
    escapeHtml(therapist.name || "") +
    "</div>" +
    (credLine ? '<div class="result-creds">' + escapeHtml(credLine) + "</div>" : "") +
    (locLine ? '<div class="result-loc">' + escapeHtml(locLine) + "</div>" : "") +
    "</div>" +
    "</div>" +
    (explanation
      ? '<p class="result-reason result-reason--compact">' + escapeHtml(explanation) + "</p>"
      : "") +
    '<div class="result-card-meta">' +
    (therapist.accepting_new_patients
      ? '<span class="result-signal is-green">Accepting</span>'
      : "") +
    (therapist.accepts_telehealth ? '<span class="result-signal">Telehealth</span>' : "") +
    (feeText ? '<span class="result-signal">' + escapeHtml(feeText) + "</span>" : "") +
    "</div>" +
    "</div>" +
    '<div class="result-card-action">' +
    (preferredRoute
      ? '<a href="' +
        escapeHtml(preferredRoute.href) +
        '" class="result-cta-sm" data-match-primary-cta="' +
        escapeHtml(therapist.slug || "") +
        '" data-match-primary-route="' +
        escapeHtml(ctaLabel) +
        '"' +
        (preferredRoute.external ? ' target="_blank" rel="noopener"' : "") +
        ">" +
        escapeHtml(ctaLabel) +
        "</a>"
      : "") +
    '<a href="therapist.html?slug=' +
    encodeURIComponent(therapist.slug || "") +
    '" class="result-card-profile-link" data-match-profile-link="' +
    escapeHtml(therapist.slug || "") +
    '" data-profile-link-context="supporting-card">View profile</a>' +
    "</div>" +
    "</article>"
  );
}

function renderPrimaryMatchCards(entries, _profile) {
  var root = getMatchShellRefs().resultsRoot;
  if (!root) {
    return;
  }

  var primaryEntries = (entries || []).slice(0, 5);

  if (!primaryEntries.length) {
    root.className = "match-empty";
    return;
  }

  var leadEntry = primaryEntries[0];
  var supportingEntries = primaryEntries.slice(1);
  var backupName =
    primaryEntries[1] && primaryEntries[1].therapist ? primaryEntries[1].therapist.name || "" : "";

  root.className = "match-list";
  root.innerHTML =
    '<div class="results-panel">' +
    renderLeadResultCard(leadEntry, backupName) +
    (supportingEntries.length
      ? '<div class="result-supporting-header">Other strong matches</div>' +
        '<div class="result-supporting-list">' +
        supportingEntries
          .map(function (entry, i) {
            return renderSupportingResultCard(entry, i + 2);
          })
          .join("") +
        "</div>"
      : "") +
    "</div>";

  placeBuilderInResults(root);

  root.querySelectorAll("[data-match-primary-cta]").forEach(function (link) {
    link.addEventListener("click", function () {
      var slug = link.getAttribute("data-match-primary-cta") || "";
      trackFunnelEvent(
        "match_primary_cta_clicked",
        buildMatchTrackingPayload(slug, {
          route: link.getAttribute("data-match-primary-route") || "",
        }),
      );
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
    });
  });

  root.querySelectorAll("[data-copy-entry-draft]").forEach(function (button) {
    button.addEventListener("click", async function () {
      var slug = button.getAttribute("data-copy-entry-draft") || "";
      var entry = (entries || []).find(function (item) {
        return item && item.therapist && item.therapist.slug === slug;
      });
      if (!entry) {
        return;
      }
      try {
        await navigator.clipboard.writeText(buildEntryOutreachDraft(entry, latestProfile));
        trackFunnelEvent(
          "match_entry_draft_copied",
          buildMatchTrackingPayload(slug, {
            route: "Primary card",
          }),
        );
        setActionState(true, "Copied a first outreach message for " + entry.therapist.name + ".");
      } catch (_error) {
        setActionState(true, "Unable to copy the outreach message automatically.");
      }
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
    setActionState(false, "Try widening your constraints before saving or sharing this result.");
    renderNoResultsState(
      profile,
      requestedZip && zipSuggestions.length ? zipSuggestions : [],
      hasRefinements,
    );
    clearRenderedMatchPanels();
    return;
  }

  if (!currentJourneyId) {
    currentJourneyId = buildJourneyId(profile, entries);
  }
  persistMatchRequest(profile, entries);
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
}

function handleSubmit(event) {
  event.preventDefault();
  var profile = readCurrentIntakeProfile();
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

  syncZipResolvedLabel(form.elements.location_query.value);
  syncMatchStartState();
  renderMatchIntakePreview(profile);
  renderAdaptiveIntakeGuidance(profile);
  renderIntakeTradeoffPreview(profile);

  return profile;
}

(async function init() {
  var siteSettings = await fetchPublicSiteSettings();
  MATCH_PRIORITY_SLUGS = normalizePrioritySlugs(siteSettings);
  await preloadZipcodes();
  therapists = await fetchPublicTherapists();
  latestLearningSignals = buildLearningSignals(readStoredFeedback(), readOutreachOutcomes());
  activeMatchExperimentVariant = getExperimentVariant("match_ranking", ["control", "adaptive"]);
  trackExperimentExposure("match_ranking", activeMatchExperimentVariant, {
    surface: "match",
  });
  latestAdaptiveSignals = getMatchAdaptiveStrategy();
  var refs = getMatchShellRefs();
  initMatchCareDropdown();
  bindRefineButtons();
  bindRefineTeaserShortcuts();
  var matchForm = refs.form;
  matchForm.addEventListener("submit", handleSubmit);
  matchForm.addEventListener("input", function () {
    refreshIntakeUiFromForm();
  });
  matchForm.addEventListener("change", function () {
    refreshIntakeUiFromForm();
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
    executeMatch(fallbackProfile, {
      scroll: false,
      source: "restored_fallback",
    });
  }
  renderFeedbackInsights();
})();
