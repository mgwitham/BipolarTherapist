import "./sentry-init.js";
import "./site-analytics.js";
import { fetchPublicTherapists } from "./cms.js";
import { escapeHtml } from "./escape-html.js";
import {
  clearRenderedMatchPanels,
  getMatchShellRefs,
  renderMatchLandingShell,
  scrollToTopMatches as scrollToTopMatchesBase,
  setActionState,
  setMatchJourneyMode as setMatchJourneyModeBase,
} from "./match-shell.js";
import {
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
import { renderAdaptiveGuidanceSection, renderNoResultsStateSection } from "./match-results.js";
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
} from "./match-outreach.js";
import {
  buildUserMatchProfile,
  getDataFreshnessSummary,
  getRecentAppliedSummary,
  getRecentConfirmationSummary,
  rankTherapistsForUser,
} from "./matching-model.js";
import { submitMatchRequest } from "./review-api.js";
import { renderOutreachPanelMarkup } from "./outreach-scripts.js";
import {
  getExperimentVariant,
  readFunnelEvents,
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
  renderRoundAvatar,
  renderSpecialtyPills,
  renderVoiceCascade,
  getLocationModalityLabel,
  getCostLabel,
  getCardLocationLabel,
  getFeeLabel,
  getInsuranceLabel,
  renderAvailabilityBadge,
} from "./card-content.js";
import {
  readList as readSavedList,
  isSaved as isSavedSlug,
  toggleSaved as toggleSavedSlug,
  subscribe as subscribeToSavedList,
} from "./saved-list.js";

var therapists = [];
var latestProfile = null;
var latestEntries = [];
var latestLearningSignals = null;
var currentJourneyId = null;
var persistedJourneyId = "";
var starterResultsMode = false;

// Match-session conversion tracker. The single number that matters for
// the patient funnel is "of all sessions where matches were shown, what
// fraction ended with at least one contact CTA click?", this state
// counts the in-session interactions, then emits one
// match_session_outcome event on pagehide. funnel-analytics already
// flushes its queue on pagehide via sendBeacon, so the event delivers
// even when the user just closes the tab.
var matchSessionStats = null;
var MATCH_FEEDBACK_KEY = "bth_match_feedback_v1";
var CONCIERGE_REQUESTS_KEY = "bth_concierge_requests_v1";
var OUTREACH_OUTCOMES_KEY = "bth_outreach_outcomes_v1";
var MATCH_RESULTS_URL_KEY = "matchResultsUrl";
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

function getActiveExperimentContext() {
  return {
    homepage_messaging: getExperimentVariant("homepage_messaging", ["control", "adaptive"]),
    match_ranking: activeMatchExperimentVariant,
  };
}

function clearStoredMatchResultsUrl() {
  try {
    window.sessionStorage.removeItem(MATCH_RESULTS_URL_KEY);
  } catch (_error) {
    /* ignore */
  }
}

function rememberMatchResultsUrl(profile, entries) {
  var hasPersonalizedResults = Boolean(
    profile &&
    profile.care_state &&
    profile.care_intent &&
    Array.isArray(entries) &&
    entries.length > 0,
  );
  try {
    if (hasPersonalizedResults) {
      window.sessionStorage.setItem(MATCH_RESULTS_URL_KEY, window.location.href);
    } else {
      window.sessionStorage.removeItem(MATCH_RESULTS_URL_KEY);
    }
  } catch (_error) {
    /* ignore */
  }
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
var PRIMARY_SHORTLIST_LIMIT = 6;
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

function slugifyForProfile(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildTherapistProfileHref(therapist) {
  var name = String((therapist && therapist.name) || "").trim();
  var city = String((therapist && therapist.city) || "").trim();
  var state = String((therapist && therapist.state) || "CA").trim();
  if (!name) return "/directory";
  var slug = slugifyForProfile([name, city, state].join(" "));
  return slug ? "/therapists/" + slug + "/?ref=match" : "/directory";
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
  clearStoredMatchResultsUrl();
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
  form.elements.care_format.value = "";
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

  root.querySelectorAll('[data-empty-action="open-refine"]').forEach(function (button) {
    button.addEventListener("click", function () {
      trackFunnelEvent("match_recovery_clicked", { action: "open_refine_from_empty" });
      setRefineDrawerOpen(true);
    });
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
    // Nothing to recompute yet, surface a gentle prompt instead.
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
    // .match-layout), NOT inside #matchResults, so wiping
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
    setRefineSubmitLabel(count);
    lastLiveCount = count;
    lastLiveTopSlug = topSlug;
    trackFunnelEvent("match_live_filter_applied", {
      changed_field: changedField,
      result_count: count,
    });
  }, 120);
}

// Update the drawer's commit button to reflect the live result count.
// Button label reflects action, not a count, counts implied false precision.
function setRefineSubmitLabel(count) {
  var btn = document.querySelector(".refine-bottom-submit");
  if (!btn) return;
  if (count === 0) {
    btn.textContent = "No matches, try fewer filters";
    btn.disabled = false;
  } else {
    btn.textContent = "See your matches";
    btn.disabled = false;
  }
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
    // Seed the commit-button label with the count of currently-rendered
    // matches, so the user sees "Show 8 matches" immediately on open
    // rather than the generic "Show matches" until they tweak something.
    var initialCount = Array.isArray(latestEntries) ? latestEntries.length : 0;
    if (initialCount > 0) setRefineSubmitLabel(initialCount);
    // Sync drawer fields to the last-run profile so "Show N matches" count
    // and every form field both reflect the same search state on open.
    if (latestProfile) hydrateForm(latestProfile);
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
  // Sticky bar button (outside the results root, so not caught by the
  // root.querySelectorAll binding inside renderResults)
  document.querySelectorAll("[data-mx-refine-open]").forEach(function (btn) {
    if (btn.dataset.boundRefine !== "true") {
      btn.dataset.boundRefine = "true";
      btn.addEventListener("click", function () {
        setRefineDrawerOpen(true);
        var target = btn.getAttribute("data-mx-refine-open");
        trackFunnelEvent("match_smart_refine_chip", { target: target });
      });
    }
  });

  // refineSearchButton: external trigger, always opens the drawer
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

  // Care-type drawer radios → sync to the main care_intent select so
  // readCurrentIntakeProfile() always reads the up-to-date value,
  // then kick off a live recompute so results update immediately.
  document.querySelectorAll('[name="care_intent_drawer"]').forEach(function (radio) {
    if (radio.dataset.boundCareIntent === "true") return;
    radio.dataset.boundCareIntent = "true";
    radio.addEventListener("change", function (event) {
      var select = document.getElementById("care_intent_primary");
      if (!select || !radio.checked) return;
      if (event && typeof event.stopPropagation === "function") {
        event.stopPropagation();
      }
      select.value = radio.value;
      select.dispatchEvent(new window.Event("input", { bubbles: true }));
      select.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
  });

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
    clearStoredMatchResultsUrl();
    setMatchJourneyMode("intake");
    setActionState(false, "Enter a valid 5-digit ZIP code to review your top options.");
    renderIntakeTradeoffPreview(profile);
    return false;
  }

  if (zipStatus.status === "out_of_state") {
    clearStoredMatchResultsUrl();
    setMatchJourneyMode("intake");
    setActionState(false, zipStatus.message || "We are not currently live in that state yet.");
    renderIntakeTradeoffPreview(profile);
    return false;
  }

  if (zipStatus.status === "unknown") {
    clearStoredMatchResultsUrl();
    setMatchJourneyMode("results");
    // Clear any stale results from a previous search so the user doesn't see
    // the old list while the error message says there are no matches here.
    latestEntries = [];
    safeRenderResults([], profile);
    setActionState(
      false,
      "No exact reviewed profile is live in this ZIP code yet. Try a nearby ZIP or widen to telehealth.",
    );
    renderIntakeTradeoffPreview(profile);
    return false;
  }

  if (!profile.care_state || !profile.care_intent) {
    clearStoredMatchResultsUrl();
    setMatchJourneyMode("intake");
    setActionState(false, "Choose your care type and ZIP code to review your top options.");
    renderIntakeTradeoffPreview(profile);
    return false;
  }

  // Adaptive ranking is disabled, every submit uses the deterministic
  // base + zip-aware pipeline.
  activeSecondPassMode = "balanced";
  var entries = rankEntriesForProfile(profile);
  // Flush any prior session's outcome before we overwrite stats, this
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
  rememberMatchResultsUrl(profile, entries);
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
    : "I am looking for bipolar informed care.";
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

// Engine reasons that every result on the page already passes, they
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
  // entirely, better than showing a non-differentiating bullet.
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
  "Family therapy": "Family therapy, supports bipolar households",
  Psychoeducation: "Psychoeducation, core to bipolar self-management",
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
// already passes, "Sees patients in person nearby" / "Matches the
// requested care type"). Falls back to filtered engine reasons if the
// therapist record is too sparse to synthesize anything specific.
function getHeroFitReasons(entry, therapist, profileArg) {
  var profile = profileArg || {};
  var out = [];

  // 1. Concrete bipolar experience (years, when ≥ 3), most specific
  //    signal a patient cares about. "8 years" beats "substantial".
  var years = Number(therapist.bipolar_years_experience || 0);
  if (years >= 3) {
    out.push(years + " " + (years === 1 ? "year" : "years") + " specializing in bipolar care");
  }

  // 2. Specific bipolar specialty overlap, prefer what the user asked
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
          return /bipolar|cycl|mixed/i.test(s);
        });
    var displayMatched = matched.filter(function (s) {
      return !/^psychos/i.test(s);
    });
    if (displayMatched.length) {
      out.push("Treats " + displayMatched.slice(0, 2).join(" + "));
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

  // 4. Insurance match named explicitly, high practical signal
  if (
    profile.insurance &&
    reasonsInsuranceMatches(profile.insurance, therapist.insurance_accepted)
  ) {
    out.push("In-network with " + profile.insurance);
  }

  // 5. Concrete timing, only when it's actually fast. Vague timing
  //    isn't worth a bullet.
  var wait = therapist.estimated_wait_time ? String(therapist.estimated_wait_time) : "";
  if (/within\s*1\s*week|same\s*week|days|immediate/i.test(wait)) {
    out.push("Openings " + wait.toLowerCase());
  }

  // 6. Medication management when the user asked for it
  if (profile.needs_medication_management === "Yes" && therapist.medication_management) {
    out.push("Provides medication management");
  }

  // 7. Editorial verification, trust signal
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

function buildPartnerCompareSummary(entries, profile) {
  var topEntries = (entries || []).slice(0, PRIMARY_SHORTLIST_LIMIT);
  if (topEntries.length < 2) {
    return "";
  }

  var recommendation = buildFirstContactRecommendation(profile, topEntries);
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

// Build the canonical row definitions for the shortlist comparison.
// Extracted so the diff-strip and full-grid views can share the same
// data + formatting without duplicating the row table.
function buildShortlistCompareRows(topEntries) {
  return [
    {
      label: "Session cost",
      getValue: function (therapist) {
        return getCompareCostLabel(therapist);
      },
    },
    {
      label: "Insurance",
      getValue: function (therapist) {
        var accepted = (therapist.insurance_accepted || []).slice(0, 3);
        return accepted.length ? accepted : [];
      },
    },
    {
      label: "Telehealth / In-person",
      kind: "format",
      getValue: function (therapist) {
        return [
          therapist.accepts_telehealth ? "Telehealth" : "",
          therapist.accepts_in_person ? "In-person" : "",
        ].filter(Boolean);
      },
    },
    {
      label: "Availability",
      getValue: function (therapist) {
        return getCompareTimingLabel(therapist);
      },
    },
    {
      label: "Bipolar experience",
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
      getValue: function (therapist) {
        return therapist.languages || [];
      },
    },
    {
      label: "How to reach out",
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
  ];
}

// Smart-diff: returns true when the row's value differs across entries.
// Booleans, strings, and arrays are all normalized to a comparable
// signature so e.g. ["Aetna","BCBS"] vs ["BCBS","Aetna"] is the same.
function shortlistRowDiffers(row, topEntries) {
  var sigs = topEntries.map(function (entry) {
    var v = row.getValue(entry.therapist);
    if (Array.isArray(v)) {
      return v
        .map(function (x) {
          return String(x || "").toLowerCase();
        })
        .sort()
        .join("|");
    }
    if (typeof v === "boolean") return v ? "y" : "n";
    return String(v || "").toLowerCase();
  });
  var first = sigs[0];
  for (var i = 1; i < sigs.length; i++) {
    if (sigs[i] !== first) return true;
  }
  return false;
}

// "Best fit" hero card: photo, name, location, 3 differentiating
// reasons, primary CTA expanded by default. The hero earns its size
// because the matching engine already ranked this one #1, surface
// that signal instead of pretending all are equal.
function renderShortlistHero(entry, profile) {
  var t = (entry && entry.therapist) || {};
  var reasons = getHeroFitReasons(entry, t, profile);
  var photo =
    t.photo_url || t.photo
      ? '<img src="' + escapeHtml(t.photo_url || t.photo) + '" alt="" loading="lazy" />'
      : '<div class="mx-sl-hero-photo-fill">' +
        escapeHtml(String(t.name || "?").charAt(0)) +
        "</div>";
  var location = formatTherapistLocationLine(t);
  var reasonsHtml = reasons.length
    ? '<ul class="mx-sl-hero-reasons">' +
      reasons
        .map(function (r) {
          return (
            '<li><span class="mx-sl-check" aria-hidden="true">✓</span>' + escapeHtml(r) + "</li>"
          );
        })
        .join("") +
      "</ul>"
    : "";
  var outreach = buildMatchOutreachDisclosure(entry, { expanded: true });
  var slug = String(t.slug || "");
  return (
    '<section class="mx-sl-hero" data-slug="' +
    escapeHtml(slug) +
    '">' +
    '<div class="mx-sl-hero-badge">Best match for you</div>' +
    '<div class="mx-sl-hero-body">' +
    '<div class="mx-sl-hero-photo">' +
    photo +
    "</div>" +
    '<div class="mx-sl-hero-ident">' +
    '<div class="mx-sl-hero-name">' +
    escapeHtml(t.name || "") +
    (t.credentials
      ? ', <span class="mx-sl-hero-cred">' + escapeHtml(t.credentials) + "</span>"
      : "") +
    "</div>" +
    '<div class="mx-sl-hero-sub">' +
    escapeHtml(location) +
    "</div>" +
    "</div>" +
    "</div>" +
    (reasonsHtml
      ? '<div class="mx-sl-hero-why-title">Why we lead with this one</div>' + reasonsHtml
      : "") +
    '<div class="mx-sl-hero-cta">' +
    outreach +
    "</div>" +
    (slug
      ? '<a class="mx-sl-hero-full-link" href="/therapists/' +
        escapeHtml(slug) +
        '?ref=shortlist">See full profile →</a>'
      : "") +
    "</section>"
  );
}

// Compact card for ranks 2..N. One per supporting therapist, in a
// responsive row. Each gets the same shape so visual cadence helps
// the eye scan: name, one-line differentiator, one-line metadata,
// expandable Reach-out disclosure.
function renderShortlistSupporting(entry, rank, profile) {
  var t = (entry && entry.therapist) || {};
  var reasons = getHeroFitReasons(entry, t, profile);
  var oneReason = reasons[0] || "";
  var cost = getCompareCostLabel(t) || "";
  var wait = getCompareTimingLabel(t) || "";
  var meta = [cost, wait].filter(Boolean).join(" · ");
  var outreach = buildMatchOutreachDisclosure(entry, { expanded: false });
  var slug = String(t.slug || "");
  return (
    '<article class="mx-sl-card" data-slug="' +
    escapeHtml(slug) +
    '">' +
    '<div class="mx-sl-card-rank">#' +
    String(rank) +
    "</div>" +
    '<div class="mx-sl-card-name">' +
    escapeHtml(t.name || "") +
    (t.credentials
      ? ', <span class="mx-sl-card-cred">' + escapeHtml(t.credentials) + "</span>"
      : "") +
    "</div>" +
    '<div class="mx-sl-card-sub">' +
    escapeHtml(formatTherapistLocationLine(t)) +
    "</div>" +
    (oneReason
      ? '<div class="mx-sl-card-reason"><span class="mx-sl-check" aria-hidden="true">✓</span>' +
        escapeHtml(oneReason) +
        "</div>"
      : "") +
    (meta ? '<div class="mx-sl-card-meta">' + escapeHtml(meta) + "</div>" : "") +
    '<div class="mx-sl-card-cta">' +
    outreach +
    "</div>" +
    "</article>"
  );
}

// "What's different" strip, renders only rows where the value
// differs across the shortlist. Rows where everyone matches are
// suppressed entirely. This is the synthesis the patient would have
// to do mentally otherwise.
function renderShortlistDiffStrip(diffRows, topEntries) {
  if (!diffRows.length) return "";
  var cols = topEntries.length;
  var headerCells =
    '<div class="mx-sl-diff-cell mx-sl-diff-label-cell mx-sl-diff-head">Where they differ</div>' +
    topEntries
      .map(function (entry) {
        var t = entry.therapist || {};
        return (
          '<div class="mx-sl-diff-cell mx-sl-diff-head"><div class="mx-sl-diff-head-name">' +
          escapeHtml(t.name || "") +
          "</div></div>"
        );
      })
      .join("");
  var rowCells = diffRows
    .map(function (row) {
      return (
        '<div class="mx-sl-diff-cell mx-sl-diff-label-cell">' +
        escapeHtml(row.label) +
        "</div>" +
        topEntries
          .map(function (entry) {
            return (
              '<div class="mx-sl-diff-cell">' +
              renderCompareValue(row.getValue(entry.therapist), row.kind) +
              "</div>"
            );
          })
          .join("")
      );
    })
    .join("");
  return (
    '<section class="mx-sl-diff">' +
    '<div class="mx-sl-section-title">Where they differ</div>' +
    '<div class="mx-sl-section-sub">Skipping the rows where they all match. Focus on what actually shapes your decision.</div>' +
    '<div class="mx-sl-diff-grid" style="grid-template-columns: 140px repeat(' +
    String(cols) +
    ', minmax(0, 1fr));">' +
    headerCells +
    rowCells +
    "</div></section>"
  );
}

// Full attribute grid, collapsed by default. The detail-oriented
// patient who wants everything in one place can expand; everyone
// else doesn't see the clutter.
function renderShortlistFullGrid(rows, topEntries) {
  if (!rows.length) return "";
  var headerCells =
    '<div class="compare-cell compare-cell-label compare-cell-header">Compare</div>' +
    topEntries
      .map(function (entry, index) {
        return (
          '<div class="compare-cell compare-cell-header' +
          (index === topEntries.length - 1 ? " compare-cell-end-col" : "") +
          '"><div class="compare-name">' +
          escapeHtml(entry.therapist.name) +
          '</div><div class="compare-sub">' +
          escapeHtml(formatTherapistLocationLine(entry.therapist)) +
          "</div></div>"
        );
      })
      .join("");
  var bodyCells = rows
    .map(function (row, rowIndex) {
      var isLastRow = rowIndex === rows.length - 1;
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
  return (
    '<details class="mx-sl-fullgrid">' +
    '<summary><span class="mx-sl-fullgrid-label">See every attribute side-by-side</span>' +
    '<svg width="11" height="7" viewBox="0 0 11 7" fill="none" aria-hidden="true"><path d="M1 1l4.5 4.5L10 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></summary>' +
    '<section class="match-compare mx-sl-fullgrid-body">' +
    '<div class="compare-grid" style="grid-template-columns: 160px repeat(' +
    String(topEntries.length) +
    ', minmax(0, 1fr));">' +
    headerCells +
    bodyCells +
    "</div></section></details>"
  );
}

// Shortlist viewer entry point. Replaces the old dense comparison
// grid with a decision-support layout: hero pick, supporting cards,
// "where they differ" diff strip, full grid behind a disclosure, and
// a single share affordance at the bottom. Keeps the same DOM target
// (#matchCompare) so the existing caller is unchanged.
function renderComparison(entries) {
  var root = document.getElementById("matchCompare");
  if (!root) return;
  var topEntries = entries.slice(0, PRIMARY_SHORTLIST_LIMIT);
  var profile = latestProfile;
  if (topEntries.length === 0) {
    root.innerHTML = "";
    return;
  }
  var hero = topEntries[0];
  var supporting = topEntries.slice(1);
  var rows = buildShortlistCompareRows(topEntries);
  var diffRows =
    topEntries.length >= 2
      ? rows.filter(function (row) {
          return shortlistRowDiffers(row, topEntries);
        })
      : [];

  var heroHtml = renderShortlistHero(hero, profile);
  var supportingHtml = supporting.length
    ? '<section class="mx-sl-supporting">' +
      '<div class="mx-sl-section-title">Also worth a look</div>' +
      '<div class="mx-sl-supporting-grid">' +
      supporting
        .map(function (entry, idx) {
          return renderShortlistSupporting(entry, idx + 2, profile);
        })
        .join("") +
      "</div></section>"
    : "";
  var diffHtml = renderShortlistDiffStrip(diffRows, topEntries);
  var fullGridHtml = topEntries.length >= 2 ? renderShortlistFullGrid(rows, topEntries) : "";
  var shareHtml = renderPartnerCompareSummary(topEntries, profile);

  var pageHeader =
    '<header class="mx-sl-page-head">' +
    '<div class="mx-sl-page-kicker">Your shortlist · ' +
    String(topEntries.length) +
    " therapist" +
    (topEntries.length === 1 ? "" : "s") +
    "</div>" +
    '<h2 class="mx-sl-page-title">Pick one to reach out to today.</h2>' +
    '<p class="mx-sl-page-sub">Most patients hear back within 2 business days. You can always come back and reach out to another.</p>' +
    "</header>";

  root.innerHTML =
    '<div class="mx-sl-feature">' +
    pageHeader +
    heroHtml +
    supportingHtml +
    diffHtml +
    fullGridHtml +
    (shareHtml ? '<div class="mx-sl-share">' + shareHtml + "</div>" : "") +
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

function updateShortlistFeedbackUi(_value) {
  // Feedback bar removed; no-op kept so call sites don't error.
}

function recordShortlistFeedback(value) {
  if (!latestProfile || !latestEntries.length) {
    return;
  }

  var reasons =
    value === "negative"
      ? Array.from(
          document.querySelectorAll('#noFitReasonGroup input[type="checkbox"]:checked'),
        ).map(function (el) {
          return el.value;
        })
      : [];

  saveFeedback({
    type: "shortlist_feedback",
    value: value,
    reasons: reasons,
    context: buildFeedbackContext(),
  });
  // Forward to the admin funnel log so this signal isn't trapped in
  // one user's localStorage. The admin Shortlist quality panel reads
  // these events to track positive/negative rate and top reasons.
  trackFunnelEvent("shortlist_feedback", {
    value: value,
    reasons: reasons,
    care_intent: latestProfile.care_intent || "",
    care_state: latestProfile.care_state || "",
    result_count: latestEntries.length,
    top_slug: latestEntries[0] && latestEntries[0].therapist ? latestEntries[0].therapist.slug : "",
    request_id: currentJourneyId || "",
  });
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

  var p = latestProfile || {};
  var format = String(p.care_format || "").trim() || "therapy";
  var zip = String(p.location_query || "").trim();
  var urgency = String(p.urgency || "").trim();
  var medMgmt = p.needs_medication_management;

  var bodyParts = ["Hi"];
  var details = [];
  if (format && format !== "therapy") details.push(format.toLowerCase() + " therapy");
  else details.push("therapy");
  if (zip) details.push("near " + zip);
  if (urgency) details.push(urgency.toLowerCase());
  if (medMgmt === "Yes") details.push("with medication management");
  else if (medMgmt === "No") details.push("without medication management");
  var body =
    bodyParts.join("") +
    ", I'm looking for " +
    details.join(", ") +
    ". Are you currently accepting new clients?";

  var subject = "Inquiry from BipolarTherapyHub";

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

function buildContactOrderPlan(profile, entries) {
  return buildContactOrderPlanBase(profile, entries, {
    buildFirstContactRecommendation: buildFirstContactRecommendation,
    buildFallbackRecommendation: buildFallbackRecommendation,
    readOutreachOutcomes: readOutreachOutcomes,
    analyzePivotTimingByUrgency: analyzePivotTimingByUrgency,
    buildLearningSegments: getRankingServices().buildLearningSegments,
  });
}

function getPersonalizedCtaLabel(routeType) {
  if (routeType === "website") return "Visit their website";
  if (routeType === "booking") return "Book a session";
  if (routeType === "email") return "Email therapist";
  if (routeType === "phone") return "Call therapist";
  return "";
}

function buildIntakeMirrorSentence(profile) {
  if (!profile) return "";
  var parts = [];
  var format = String(profile.care_format || "").trim();
  var intent =
    String(profile.care_intent || "")
      .trim()
      .toLowerCase() || "care";
  var formatPrefix =
    format === "In-Person" ? "In-person" : format === "Telehealth" ? "Telehealth" : "";
  var firstPart = (formatPrefix ? formatPrefix + " " : "") + intent;
  var zip = String(profile.location_query || "").trim();
  if (zip && format !== "Telehealth") firstPart += " near " + zip;
  else if (format === "Telehealth") firstPart += " across California";
  parts.push(firstPart.charAt(0).toUpperCase() + firstPart.slice(1));
  var urgency = String(profile.urgency || "").trim();
  if (urgency) parts.push("Available " + urgency);
  var medMgmt = profile.needs_medication_management;
  if (medMgmt === "No") parts.push("No medication management");
  else if (medMgmt === "Yes") parts.push("With medication management");
  if (profile.insurance) parts.push(profile.insurance + " insurance");
  var priorityLabels = {
    "Soonest availability": "Ranked by shortest wait",
    "Lowest cost": "Ranked by lowest cost",
    "Highest specialization": "Ranked by most experience",
  };
  var priorityMode = String(profile.priority_mode || "").trim();
  if (priorityLabels[priorityMode]) parts.push(priorityLabels[priorityMode]);
  return parts.join(". ") + ".";
}

// Generic bipolar terms too broad to use as a card reason label.
var REASON_LINE_GENERIC = {
  "bipolar disorder": true,
  "bipolar i": true,
  "bipolar ii": true,
  "bipolar 1": true,
  "bipolar 2": true,
  "mood disorder": true,
  "mood disorders": true,
  psychosis: true,
};

function buildMatchReasonLine(therapist) {
  var t = therapist || {};
  var years = Number(t.bipolar_years_experience || 0);
  if (years > 0) {
    return years + " yr" + (years === 1 ? "" : "s") + " bipolar experience";
  }
  var specs = Array.isArray(t.specialties) ? t.specialties : [];
  for (var i = 0; i < specs.length; i++) {
    var s = String(specs[i] || "").trim();
    if (/bipolar|cycl|mixed/i.test(s) && !REASON_LINE_GENERIC[s.toLowerCase()]) {
      return s + " specialist";
    }
  }
  return "";
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

// Slots 2–5: location · fee · availability · insurance.
// Distance is computed here so the slot renderer stays pure.
function buildCardInfoRow(therapist) {
  var t = therapist || {};
  var userZip = latestProfile ? String(latestProfile.location_query || "") : "";
  var teleSelected = Boolean(latestProfile && latestProfile.care_format === "Telehealth");
  var distanceMiles = null;
  if (!teleSelected && userZip && t.zip) {
    var d = getZipDistance(userZip, t.zip);
    if (Number.isFinite(d) && d <= 60) distanceMiles = d;
  }

  var parts = [];

  var locLabel = getCardLocationLabel(t, {
    distanceMiles: distanceMiles,
    teleSelected: teleSelected,
  });
  if (locLabel) parts.push('<span class="bth-card-info-item">' + escapeHtml(locLabel) + "</span>");

  var feeLabel = getFeeLabel(t);
  if (feeLabel) parts.push('<span class="bth-card-info-item">' + escapeHtml(feeLabel) + "</span>");

  var availHtml = renderAvailabilityBadge(t);
  if (availHtml) parts.push('<span class="bth-card-info-item">' + availHtml + "</span>");

  var insLabel = getInsuranceLabel(t);
  if (insLabel) parts.push('<span class="bth-card-info-item">' + escapeHtml(insLabel) + "</span>");

  if (!parts.length) return "";
  return (
    '<div class="bth-card-info">' +
    parts.join('<span class="bth-card-info-dot" aria-hidden="true">·</span>') +
    "</div>"
  );
}

// Build the "How to reach out" disclosure for a match card.
// Returns "" when the therapist has no contactable channel.
function buildMatchOutreachDisclosure(entry, options) {
  var therapist = entry && entry.therapist ? entry.therapist : null;
  if (!therapist) return "";
  var settings = options || {};
  var expanded = settings.expanded === true;
  var routeType = getPreferredRouteType(entry) || "";
  var inner = renderOutreachPanelMarkup({
    therapist: therapist,
    contactStrategy: routeType ? { route: routeType } : null,
    escapeHtml: escapeHtml,
    inline: expanded,
  });
  if (!inner) return "";
  var slug = String(therapist.slug || "");
  if (expanded) {
    var firstName = String(therapist.name || "").split(" ")[0] || "them";
    return (
      '<details open class="mx-outreach mx-outreach--expanded" data-mx-outreach="' +
      escapeHtml(slug) +
      '">' +
      '<summary class="mx-outreach-expanded-summary">' +
      '<div class="mx-outreach-expanded-header">' +
      '<span class="mx-outreach-expanded-kicker">Next step</span>' +
      '<span class="mx-outreach-expanded-label">Reach out to ' +
      escapeHtml(firstName) +
      "</span>" +
      "</div>" +
      '<svg class="mx-outreach-chevron mx-outreach-expanded-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3 4.5l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      "</summary>" +
      '<div class="mx-outreach-body outreach-script-shell">' +
      inner +
      "</div></details>"
    );
  }
  return (
    '<details class="mx-outreach" data-mx-outreach="' +
    escapeHtml(slug) +
    '">' +
    '<summary class="mx-outreach-summary">' +
    '<span class="mx-outreach-summary-label">How to reach out</span>' +
    '<span class="mx-outreach-summary-helper">We\'ve drafted a message for you</span>' +
    '<svg class="mx-outreach-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3 4.5l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
    "</summary>" +
    '<div class="mx-outreach-body outreach-script-shell">' +
    inner +
    "</div></details>"
  );
}

function renderLeadResultCard(entry, _backupName, options) {
  var settings = options || {};
  var therapist = entry.therapist || {};
  var preferredRoute = getPreferredOutreach(entry);
  var routeType = getPreferredRouteType(entry);
  var ctaLabel = getPersonalizedCtaLabel(routeType);
  var reasonLine = buildMatchReasonLine(therapist);

  var topMatchLabel = settings.showBestBadge
    ? '<span class="mx-top-match-label">Best fit for what you described</span>'
    : "";

  return (
    '<article class="bth-card bth-card-lead">' +
    topMatchLabel +
    '<div class="bth-card-header">' +
    '<div class="bth-card-avatar-slot">' +
    renderRoundAvatar(therapist, "profile") +
    "</div>" +
    '<div class="bth-card-ident">' +
    '<h3 class="bth-card-name">' +
    escapeHtml(therapist.name || "") +
    (therapist.credentials
      ? ', <span class="bth-card-creds">' + escapeHtml(therapist.credentials) + "</span>"
      : "") +
    "</h3>" +
    (reasonLine ? '<p class="mx-card-reason">' + escapeHtml(reasonLine) + "</p>" : "") +
    "</div>" +
    renderSaveButton(therapist.slug || "", "card") +
    "</div>" +
    renderSpecialtyPills(therapist) +
    buildCardInfoRow(therapist) +
    '<div class="bth-card-actions">' +
    (preferredRoute
      ? '<a href="' +
        escapeHtml(preferredRoute.href) +
        '" class="bth-btn-primary" data-match-primary-cta="' +
        escapeHtml(therapist.slug || "") +
        '" data-match-primary-route="' +
        escapeHtml(routeType || "") +
        '"' +
        (preferredRoute.external ? ' target="_blank" rel="noopener noreferrer"' : "") +
        ">" +
        escapeHtml(ctaLabel) +
        "</a>"
      : "") +
    '<a href="' +
    escapeHtml(buildTherapistProfileHref(therapist)) +
    '" class="mx-profile-link">See full profile</a>' +
    "</div>" +
    buildMatchOutreachDisclosure(entry, { expanded: true }) +
    "</article>"
  );
}

function renderSupportingResultCard(entry, _rank, _options) {
  var therapist = entry.therapist || {};
  var preferredRoute = getPreferredOutreach(entry);
  var routeType = getPreferredRouteType(entry);
  var ctaLabel = getPersonalizedCtaLabel(routeType);
  var reasonLine = buildMatchReasonLine(therapist);
  return (
    '<article class="bth-card">' +
    '<div class="bth-card-header">' +
    '<div class="bth-card-avatar-slot">' +
    renderRoundAvatar(therapist, "card") +
    "</div>" +
    '<div class="bth-card-ident">' +
    '<h3 class="bth-card-name">' +
    escapeHtml(therapist.name || "") +
    (therapist.credentials
      ? ', <span class="bth-card-creds">' + escapeHtml(therapist.credentials) + "</span>"
      : "") +
    "</h3>" +
    (reasonLine ? '<p class="mx-card-reason">' + escapeHtml(reasonLine) + "</p>" : "") +
    "</div>" +
    renderSaveButton(therapist.slug || "", "card") +
    "</div>" +
    renderSpecialtyPills(therapist) +
    buildCardInfoRow(therapist) +
    '<div class="bth-card-actions">' +
    (preferredRoute
      ? '<a href="' +
        escapeHtml(preferredRoute.href) +
        '" class="bth-btn-primary" data-match-primary-cta="' +
        escapeHtml(therapist.slug || "") +
        '" data-match-primary-route="' +
        escapeHtml(routeType || "") +
        '"' +
        (preferredRoute.external ? ' target="_blank" rel="noopener noreferrer"' : "") +
        ">" +
        escapeHtml(ctaLabel) +
        "</a>"
      : "") +
    '<a href="' +
    escapeHtml(buildTherapistProfileHref(therapist)) +
    '" class="mx-profile-link">See full profile</a>' +
    "</div>" +
    buildMatchOutreachDisclosure(entry) +
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

function buildActiveFilterChipsHtml(profile) {
  if (!profile) return "";
  var chips = [];

  // Only chip for an explicit format choice, "Either" is the model's
  // internal default for "Any" and should not surface as an active filter.
  if (
    profile.care_format &&
    profile.care_format !== "No preference" &&
    profile.care_format !== "Either"
  ) {
    chips.push({ key: "care_format", label: profile.care_format });
  }
  if (profile.insurance) {
    chips.push({ key: "insurance", label: profile.insurance + " insurance" });
  }
  if (profile.budget_max) {
    chips.push({ key: "budget_max", label: "Under $" + profile.budget_max + "/session" });
  }
  if (profile.priority_mode && profile.priority_mode !== "Best overall fit") {
    var modeLabels = {
      "Soonest availability": "Soonest",
      "Lowest cost": "Affordable",
      "Highest specialization": "Most experienced",
    };
    chips.push({
      key: "priority_mode",
      label: modeLabels[profile.priority_mode] || profile.priority_mode,
    });
  }
  if (Array.isArray(profile.language_preferences) && profile.language_preferences.length) {
    chips.push({
      key: "language_preferences",
      label: profile.language_preferences.join(", "),
    });
  }

  if (!chips.length) return "";

  var xIcon =
    '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true" width="9" height="9">' +
    '<line x1="2" y1="2" x2="8" y2="8"/><line x1="8" y1="2" x2="2" y2="8"/>' +
    "</svg>";

  return (
    '<div class="mx-active-filters">' +
    chips
      .map(function (chip) {
        return (
          '<button type="button" class="mx-filter-chip" data-clear-filter="' +
          escapeHtml(chip.key) +
          '">' +
          escapeHtml(chip.label) +
          xIcon +
          "</button>"
        );
      })
      .join("") +
    "</div>"
  );
}

function buildResultsHeaderHtml(profile, totalCount) {
  var mirrorSentence = buildIntakeMirrorSentence(profile);

  var activeCount = countActiveRefinements(profile);
  var countBadge = activeCount
    ? '<span class="mx-refine-btn-count">' + activeCount + "</span>"
    : '<span class="mx-refine-btn-count" hidden>0</span>';

  return (
    '<header class="mx-results-header">' +
    '<div class="mx-results-kicker">Your matches</div>' +
    '<h1 class="mx-results-title">' +
    totalCount +
    " bipolar informed " +
    (totalCount === 1 ? "match" : "matches") +
    " for you</h1>" +
    (mirrorSentence ? '<p class="mx-results-sub">' + escapeHtml(mirrorSentence) + "</p>" : "") +
    '<button type="button" class="mx-refine-btn mx-refine-btn--header" data-mx-refine-open="header">' +
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
    "Edit my preferences" +
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

  var isAsap = profile && String(profile.urgency || "").toUpperCase() === "ASAP";

  // Hide entries with no working contact method, never render a card whose
  // only action would 404 or dead-end. A card must have at least one of:
  // booking_url, website, phone, or email.
  // When urgency is ASAP, also exclude therapists who are not accepting new patients.
  var allEntries = (entries || [])
    .filter(function (entry) {
      if (!getPreferredOutreach(entry)) return false;
      if (isAsap && entry.therapist && entry.therapist.accepting_new_patients === false) {
        return false;
      }
      return true;
    })
    .slice(0, 8);

  if (!allEntries.length) {
    root.className = "match-empty";
    return;
  }

  var leadEntry = allEntries[0];
  var runnerUps = allEntries.slice(1, 5); // ranks 2-5, 2×2 grid, always visible
  var moreEntries = allEntries.slice(5); // ranks 6+, hidden behind Show more

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

  var moreHtml = moreEntries.length
    ? '<section class="mx-more-cards" hidden>' +
      moreEntries
        .map(function (entry) {
          return renderSupportingResultCard(entry, 0, { context: "more" });
        })
        .join("") +
      "</section>" +
      '<div class="mx-show-more-wrap">' +
      '<button type="button" class="mx-show-more" id="matchShowMore">' +
      "Show " +
      moreEntries.length +
      " more " +
      (moreEntries.length === 1 ? "match" : "matches") +
      "</button>" +
      "</div>"
    : "";

  var compareTriggerHtml =
    allEntries.length >= 2
      ? '<div class="mx-compare-trigger-wrap">' +
        '<button type="button" class="mx-compare-trigger" id="matchCompareTrigger">Compare these</button>' +
        "</div>"
      : "";

  var noFitLinkHtml =
    '<div id="matchNoFitLink" class="mx-no-fit-link-wrap">' +
    '<button type="button" class="mx-no-fit-link" id="matchNoFitOpen">Not seeing the right fit?</button>' +
    "</div>";

  var refineBarHtml =
    '<div class="mx-refine-bar">' +
    '<button type="button" class="mx-refine-bar-btn" data-mx-refine-open="bar">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" width="16" height="16">' +
    '<line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line>' +
    '<line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line>' +
    '<line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line>' +
    '<line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line>' +
    '<line x1="17" y1="16" x2="23" y2="16"></line>' +
    "</svg>" +
    "Edit my preferences" +
    "</button>" +
    "</div>";

  root.className = "match-list";
  root.innerHTML =
    '<div class="results-panel">' +
    buildResultsHeaderHtml(profile, allEntries.length) +
    buildActiveFilterChipsHtml(profile) +
    '<section class="mx-top-three">' +
    renderLeadResultCard(leadEntry, null, { showBestBadge: showBestBadge }) +
    runnersHtml +
    "</section>" +
    moreHtml +
    refineBarHtml +
    compareTriggerHtml +
    noFitLinkHtml +
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

  // Active filter chip dismissal, clears the field from the form and re-runs match
  root.querySelectorAll("[data-clear-filter]").forEach(function (chip) {
    chip.addEventListener("click", function () {
      var field = chip.getAttribute("data-clear-filter");
      var form = document.getElementById("matchForm");
      if (!form || !field) return;
      if (field === "care_format") {
        form.querySelectorAll('input[name="care_format"]').forEach(function (r) {
          r.checked = false;
        });
      } else if (field === "priority_mode") {
        form.querySelectorAll('input[name="priority_mode"]').forEach(function (r) {
          r.checked = r.value === "Best overall fit";
        });
      } else if (field === "language_preferences") {
        var lf = form.querySelector(
          'input[name="language_preferences"], textarea[name="language_preferences"]',
        );
        if (lf) lf.value = "";
      } else {
        var el = form.querySelector('[name="' + field + '"]');
        if (el) el.value = "";
      }
      var newProfile = readCurrentIntakeProfile();
      executeMatch(newProfile, { scroll: false, source: "filter_chip_dismiss" });
      trackFunnelEvent("match_filter_chip_dismissed", { field: field });
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

  // "How to reach out" disclosure on each match card
  root.querySelectorAll("[data-mx-outreach]").forEach(function (details) {
    details.addEventListener("toggle", function () {
      if (!details.open) return;
      var slug = details.getAttribute("data-mx-outreach") || "";
      trackFunnelEvent("outreach_panel_opened", {
        surface: "match_card",
        therapist_slug: slug,
      });
      if (!emailNudgeShownThisSession) {
        var alreadyDismissed = false;
        try {
          alreadyDismissed = !!window.sessionStorage.getItem("mxEmailNudge");
        } catch (_) {}
        if (!alreadyDismissed) {
          emailNudgeShownThisSession = true;
          showMatchEmailNudge(root);
        }
      }
    });
  });

  root.querySelectorAll("[data-mx-outreach] [data-outreach-copy-message]").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      var details = btn.closest("[data-mx-outreach]");
      var slug = details ? details.getAttribute("data-mx-outreach") || "" : "";
      var bodyEl = details ? details.querySelector("[data-outreach-message-body]") : null;
      var text = bodyEl ? bodyEl.textContent || "" : "";
      if (!text) return;
      var labelEl = btn.querySelector("span");
      var originalLabel = labelEl ? labelEl.textContent : "";
      try {
        await navigator.clipboard.writeText(text);
        if (labelEl) labelEl.textContent = "Copied";
        btn.classList.add("is-copied");
        trackFunnelEvent("outreach_message_copied", {
          surface: "match_card",
          therapist_slug: slug,
        });
        trackFunnelEvent("match_contact_completed", {
          slug: slug,
          method: "message_copied",
          surface: "match_card",
        });
      } catch (_error) {
        if (labelEl) labelEl.textContent = "Copy failed";
      }
      window.setTimeout(function () {
        if (labelEl) labelEl.textContent = originalLabel || "Copy first message";
        btn.classList.remove("is-copied");
      }, 1800);
    });
  });

  root.querySelectorAll("[data-mx-outreach] .outreach-script-call").forEach(function (link) {
    link.addEventListener("click", function () {
      var details = link.closest("[data-mx-outreach]");
      var slug = details ? details.getAttribute("data-mx-outreach") || "" : "";
      trackFunnelEvent("outreach_call_clicked", {
        surface: "match_card",
        therapist_slug: slug,
      });
      trackFunnelEvent("match_contact_completed", {
        slug: slug,
        method: "call_clicked",
        surface: "match_card",
      });
    });
  });

  root.querySelectorAll("[data-mx-outreach] [data-outreach-close]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var details = btn.closest("details");
      if (details) details.open = false;
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

  if (typeof window.IntersectionObserver === "function") {
    var impressionSeen = new Set();
    var impressionObserver = new window.IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var card = entry.target;
          var slug = (card.querySelector("[data-match-primary-cta]") || {}).getAttribute
            ? card.querySelector("[data-match-primary-cta]").getAttribute("data-match-primary-cta")
            : "";
          if (!slug || impressionSeen.has(slug)) return;
          impressionSeen.add(slug);
          trackFunnelEvent(
            "match_card_impression",
            buildMatchTrackingPayload(slug, {
              rank: allEntries.findIndex(function (e) {
                return e.therapist && e.therapist.slug === slug;
              }),
            }),
          );
          impressionObserver.unobserve(card);
        });
      },
      { threshold: 0.5 },
    );
    root.querySelectorAll("article.bth-card, article.bth-card-lead").forEach(function (card) {
      impressionObserver.observe(card);
    });
  }

  var showMoreBtn = document.getElementById("matchShowMore");
  if (showMoreBtn) {
    showMoreBtn.addEventListener("click", function () {
      var moreSection = root.querySelector(".mx-more-cards");
      var showMoreWrap = root.querySelector(".mx-show-more-wrap");
      if (moreSection) {
        moreSection.hidden = false;
        moreSection.classList.add("is-revealed");
      }
      if (showMoreWrap) showMoreWrap.hidden = true;
      trackFunnelEvent("match_show_more_clicked", {
        result_count: allEntries.length,
        top_slug: leadEntry && leadEntry.therapist ? leadEntry.therapist.slug || "" : "",
      });
    });
  }

  var compareTrigger = document.getElementById("matchCompareTrigger");
  if (compareTrigger) {
    compareTrigger.addEventListener("click", function () {
      trackFunnelEvent("match_compare_opened", { result_count: allEntries.length });
      renderComparison(allEntries);
      var compareEl = document.getElementById("matchCompare");
      if (compareEl) {
        compareEl.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      compareTrigger.hidden = true;
    });
  }

  var noFitOpenBtn = document.getElementById("matchNoFitOpen");
  if (noFitOpenBtn) {
    noFitOpenBtn.addEventListener("click", function () {
      trackFunnelEvent("match_no_fit_feedback_opened", { result_count: allEntries.length });
      var dialog = document.getElementById("noFitFeedbackDialog");
      if (dialog && typeof dialog.showModal === "function") dialog.showModal();
    });
  }

  var stickyBar = document.getElementById("matchRefineSticky");
  var stickyCount = document.getElementById("matchRefineStickyCount");
  if (stickyBar) {
    stickyBar.hidden = false;
    var activeCount = countActiveRefinements(profile);
    if (stickyCount) {
      if (activeCount) {
        stickyCount.textContent = activeCount;
        stickyCount.hidden = false;
      } else {
        stickyCount.hidden = true;
      }
    }
  }

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
var currentMatchSlugs = [];
var emailNudgeShownThisSession = false;

function rememberEntriesForDetails(entries) {
  matchEntriesBySlug = Object.create(null);
  currentMatchSlugs = [];
  var missingContact = [];
  (entries || []).forEach(function (entry) {
    if (entry && entry.therapist && entry.therapist.slug) {
      matchEntriesBySlug[entry.therapist.slug] = entry;
      currentMatchSlugs.push(entry.therapist.slug);
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

function showMatchEmailNudge(root) {
  if (document.getElementById("matchEmailNudge")) return;
  var slugs = currentMatchSlugs.slice(0, 5);
  if (!slugs.length) return;

  var nudge = document.createElement("div");
  nudge.className = "mx-email-nudge";
  nudge.id = "matchEmailNudge";
  nudge.innerHTML =
    '<p class="mx-email-nudge-heading">Email yourself this shortlist</p>' +
    '<form class="mx-email-nudge-form" id="matchEmailNudgeForm" novalidate>' +
    '<input type="email" class="mx-email-nudge-input" placeholder="you@example.com" autocomplete="email" aria-label="Your email address" />' +
    '<button type="submit" class="mx-email-nudge-btn">Send</button>' +
    "</form>" +
    '<p class="mx-email-nudge-status" id="matchEmailNudgeStatus"></p>' +
    '<button type="button" class="mx-email-nudge-dismiss" id="matchEmailNudgeDismiss">No thanks</button>';

  var anchor =
    root.querySelector(".mx-compare-trigger-wrap") || root.querySelector(".mx-no-fit-link-wrap");
  if (anchor && anchor.parentNode) {
    anchor.parentNode.insertBefore(nudge, anchor);
  } else {
    var panel = root.querySelector(".results-panel");
    if (panel) panel.appendChild(nudge);
  }

  trackFunnelEvent("match_email_nudge_shown", { slug_count: slugs.length });

  document.getElementById("matchEmailNudgeDismiss").addEventListener("click", function () {
    nudge.remove();
    try {
      window.sessionStorage.setItem("mxEmailNudge", "1");
    } catch (_) {}
    trackFunnelEvent("match_email_nudge_dismissed", {});
  });

  document.getElementById("matchEmailNudgeForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    var input = nudge.querySelector(".mx-email-nudge-input");
    var btn = nudge.querySelector(".mx-email-nudge-btn");
    var status = document.getElementById("matchEmailNudgeStatus");
    var email = String((input && input.value) || "").trim();
    if (!email) {
      status.textContent = "Enter your email address.";
      status.className = "mx-email-nudge-status mx-email-nudge-status--error";
      if (input) input.focus();
      return;
    }
    btn.disabled = true;
    status.textContent = "";
    status.className = "mx-email-nudge-status";
    trackFunnelEvent("match_email_nudge_send_attempted", { slug_count: slugs.length });
    try {
      var response = await window.fetch("/api/review/saved-list/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email,
          items: slugs.map(function (s) {
            return { slug: s, note: "" };
          }),
        }),
      });
      var payload = await response.json().catch(function () {
        return {};
      });
      if (!response.ok) {
        throw new Error((payload && payload.error) || "Could not send the email.");
      }
      nudge.innerHTML =
        '<p class="mx-email-nudge-status mx-email-nudge-status--success" style="margin:0;padding:0.2rem 0;">Sent, check your inbox.</p>';
      try {
        window.sessionStorage.setItem("mxEmailNudge", "1");
      } catch (_) {}
      trackFunnelEvent("match_email_nudge_sent", { slug_count: slugs.length });
    } catch (error) {
      status.textContent = (error && error.message) || "Could not send. Try again.";
      status.className = "mx-email-nudge-status mx-email-nudge-status--error";
      btn.disabled = false;
    }
  });
}

function renderDetailsBody(entry) {
  var therapist = entry.therapist || {};
  var locationLabel = getLocationModalityLabel(therapist);
  var availabilityHtml = renderAvailabilityBadge(therapist);
  var costLabel = getCostLabel(therapist);

  var modalities = Array.isArray(therapist.treatment_modalities)
    ? therapist.treatment_modalities.filter(Boolean)
    : [];
  var populations = Array.isArray(therapist.client_populations)
    ? therapist.client_populations.filter(Boolean)
    : [];

  var approachHtml = modalities.length
    ? '<div class="bth-modal-row"><span class="bth-modal-row-label">Approach</span><span class="bth-modal-row-value">' +
      escapeHtml(modalities.slice(0, 6).join(" · ")) +
      "</span></div>"
    : "";
  var seesHtml = populations.length
    ? '<div class="bth-modal-row"><span class="bth-modal-row-label">Sees</span><span class="bth-modal-row-value">' +
      escapeHtml(populations.slice(0, 6).join(" · ")) +
      "</span></div>"
    : "";
  var costHtml = costLabel
    ? '<div class="bth-modal-row"><span class="bth-modal-row-label">Cost</span><span class="bth-modal-row-value">' +
      escapeHtml(costLabel) +
      "</span></div>"
    : "";

  // Reaching out, only render labels when the corresponding clinician
  // field is populated.
  var contactGuidance = String(therapist.contact_guidance || "").trim();
  var firstStep = String(therapist.first_step_expectation || "").trim();
  var reachingOutItems = "";
  if (contactGuidance) {
    reachingOutItems +=
      '<div class="bth-modal-reach-item"><strong>What to include:</strong> ' +
      escapeHtml(contactGuidance) +
      "</div>";
  }
  if (firstStep) {
    reachingOutItems +=
      '<div class="bth-modal-reach-item"><strong>What happens next:</strong> ' +
      escapeHtml(firstStep) +
      "</div>";
  }

  var ctaInfo = buildModalPrimaryCta(therapist, entry);
  var primaryCtaHtml =
    '<a href="' +
    escapeHtml(ctaInfo.href) +
    '" class="bth-modal-cta" data-match-primary-cta="' +
    escapeHtml(therapist.slug || "") +
    '" data-match-primary-route="' +
    escapeHtml(ctaInfo.routeLabel) +
    '"' +
    (ctaInfo.external ? ' target="_blank" rel="noopener noreferrer"' : "") +
    ">" +
    escapeHtml(ctaInfo.label) +
    "</a>";

  // Secondary contact line (shows whichever channels weren't already the
  // primary CTA, so we never double-up).
  var reachingOutHtml =
    '<div class="bth-modal-reaching-out">' +
    (reachingOutItems
      ? '<h4 class="bth-modal-section-label">Reaching out</h4>' + reachingOutItems
      : "") +
    primaryCtaHtml +
    "</div>";

  var teaserHtml =
    '<a href="' +
    escapeHtml(buildTherapistProfileHref(therapist) + "#outreach") +
    '" class="bth-modal-teaser" data-modal-outreach-link="' +
    escapeHtml(therapist.slug || "") +
    '">See full profile + outreach script →</a>';

  return (
    '<div class="bth-modal-header">' +
    '<div class="bth-modal-avatar">' +
    renderRoundAvatar(therapist, "modal") +
    "</div>" +
    '<div class="bth-modal-ident">' +
    '<h3 class="bth-modal-name" id="matchDetailsTitle">' +
    escapeHtml(therapist.name || "") +
    (therapist.credentials
      ? ', <span class="bth-modal-creds">' + escapeHtml(therapist.credentials) + "</span>"
      : "") +
    "</h3>" +
    renderSpecialtyPills(therapist) +
    "</div>" +
    "</div>" +
    '<div class="bth-modal-meta">' +
    (locationLabel ? '<span class="bth-modal-loc">' + escapeHtml(locationLabel) + "</span>" : "") +
    (availabilityHtml ? '<span class="bth-modal-avail">' + availabilityHtml + "</span>" : "") +
    "</div>" +
    // Only surface the cascade in the modal when it's the clinician's
    // own words, populations/modalities/etc. already get their own
    // labeled rows below, so showing the cascade then would duplicate.
    (therapist.claim_status === "claimed" &&
    therapist.care_approach &&
    String(therapist.care_approach).trim()
      ? renderVoiceCascade(therapist)
      : "") +
    '<div class="bth-modal-rows">' +
    approachHtml +
    seesHtml +
    costHtml +
    "</div>" +
    reachingOutHtml +
    teaserHtml
  );
}

// Spec'd CTA mapping: button label + destination derived from
// preferred_contact_method, with a strict fallback ladder when null.
// Returns { href, label, routeLabel, routeKey, external }.
function buildModalPrimaryCta(therapist, entry) {
  var method = String(therapist.preferred_contact_method || "").toLowerCase();
  var phone = String(therapist.phone || "").trim();
  var email = String(therapist.email || "").trim();
  var booking = String(therapist.booking_url || "").trim();
  var website = String(therapist.website || "").trim();

  function emailHref() {
    var route = getPreferredOutreach(entry);
    if (route && route.href && /^mailto:/i.test(route.href)) return route.href;
    return "mailto:" + email;
  }

  if (method === "phone" && phone) {
    return {
      href: "tel:" + phone,
      label: "Call " + phone + " →",
      routeLabel: "Call therapist",
      routeKey: "phone",
      external: false,
    };
  }
  if (method === "email" && email) {
    return {
      href: emailHref(),
      label: "Send an email →",
      routeLabel: "Email therapist",
      routeKey: "email",
      external: false,
    };
  }
  if (method === "booking" && booking) {
    return {
      href: booking,
      label: "Book a consultation →",
      routeLabel: "Book consultation",
      routeKey: "booking",
      external: true,
    };
  }
  if (method === "website" && website) {
    return {
      href: website,
      label: "Visit practice site →",
      routeLabel: "Visit site",
      routeKey: "website",
      external: true,
    };
  }
  // Fallback ladder: phone → email → booking → full profile
  if (phone) {
    return {
      href: "tel:" + phone,
      label: "Call " + phone + " →",
      routeLabel: "Call therapist",
      routeKey: "phone",
      external: false,
    };
  }
  if (email) {
    return {
      href: emailHref(),
      label: "Send an email →",
      routeLabel: "Email therapist",
      routeKey: "email",
      external: false,
    };
  }
  if (booking) {
    return {
      href: booking,
      label: "Book a consultation →",
      routeLabel: "Book consultation",
      routeKey: "booking",
      external: true,
    };
  }
  return {
    href: buildTherapistProfileHref(therapist),
    label: "See full profile →",
    routeLabel: "See full profile",
    routeKey: "profile",
    external: false,
  };
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
        trackFunnelEvent("match_contact_completed", {
          slug: therapist.slug || "",
          method: "message_copied",
          surface: "contact_modal",
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
      trackFunnelEvent("match_contact_completed", {
        slug: therapist.slug || "",
        method: "email_clicked",
        surface: "contact_modal",
      });
      var a = document.createElement("a");
      a.href = href;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  }

  body.querySelectorAll("[data-contact-other-route]").forEach(function (link) {
    link.addEventListener("click", function () {
      trackFunnelEvent("match_contact_modal_other_route", {
        slug: therapist.slug || "",
        route: link.getAttribute("data-contact-other-route") || "",
      });
      trackFunnelEvent("match_contact_completed", {
        slug: therapist.slug || "",
        method: "other_route",
        surface: "contact_modal",
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
  // Modal-open is the canonical contact-intent signal on /match.html,
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

  var guidanceEl = document.getElementById("matchResultsGuidance");
  if (guidanceEl) {
    guidanceEl.textContent =
      "Start with your top match. Most therapists respond within 2 business days.";
    guidanceEl.hidden = false;
  }

  var zip = String((profile && profile.location_query) || "").trim();
  if (/^\d{5}$/.test(zip)) {
    try {
      window.sessionStorage.setItem("bth_sort_zip_v1", zip);
    } catch (_) {}
  }

  renderFallbackRecommendation(profile, primaryEntries);
  renderAdaptiveGuidance(profile, entries);
  if (refs.feedbackBar) {
    refs.feedbackBar.hidden = false;
  }

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

var MATCH_LOADING_SKELETON_HTML =
  '<div class="mx-loading" role="status" aria-live="polite">' +
  '<div class="mx-loading-header">' +
  '<div class="mx-loading-kicker">Your matches</div>' +
  '<div class="mx-loading-title">Finding your top bipolar informed matches</div>' +
  '<div class="mx-loading-sub">This usually takes a second.</div>' +
  "</div>" +
  '<div class="mx-loading-hero"></div>' +
  '<div class="mx-loading-runners">' +
  '<div class="mx-loading-card"></div>' +
  '<div class="mx-loading-card"></div>' +
  "</div>" +
  "</div>";

async function handleSubmit(event) {
  event.preventDefault();
  // If the submit was fired from inside the open drawer (the bottom
  // commit button), close the drawer before running so the user actually
  // sees the new results, otherwise the drawer occludes them.
  var drawerWasOpen = document.body.classList.contains("match-refine-drawer-open");
  if (drawerWasOpen) {
    setRefineDrawerOpen(false);
  }
  var profile = readCurrentIntakeProfile();

  var root = getMatchShellRefs().resultsRoot;
  if (root) {
    root.className = "match-results match-results-hero match-empty";
    root.innerHTML = MATCH_LOADING_SKELETON_HTML;
  }

  // Submission now hands off to /results, which reads the same URL
  // params, scores, and renders the new card design. /match keeps
  // working as today on direct visits, only the post-submit render
  // path moved.
  var params = new URLSearchParams();
  var scalarKeys = [
    "care_intent",
    "location_query",
    "care_state",
    "care_format",
    "needs_medication_management",
    "insurance",
    "budget_max",
    "urgency",
    "priority_mode",
    "therapist_gender_preference",
  ];
  scalarKeys.forEach(function (k) {
    var v = profile && profile[k];
    if (v != null && String(v) !== "") params.set(k, String(v));
  });
  ["bipolar_focus", "preferred_modalities", "population_fit", "language_preferences"].forEach(
    function (k) {
      var v = profile && profile[k];
      if (Array.isArray(v) && v.length) params.set(k, v.join(","));
    },
  );
  window.location.assign("/results?" + params.toString());
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
  clearStoredMatchResultsUrl();
  var latestShortlistOutcome = getLatestShortlistOutcome(
    selected.map(function (entry) {
      return entry.therapist.slug;
    }),
  );
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
  clearStoredMatchResultsUrl();
  setMatchJourneyMode("intake");
  window.history.replaceState({}, "", "match.html");
  setActionState(false, "Run a match to review your top options.");
  syncMatchStartState();
  renderMatchLandingShell();
  clearRenderedMatchPanels();
  updateShortlistFeedbackUi("");
  var resetStickyBar = document.getElementById("matchRefineSticky");
  if (resetStickyBar) resetStickyBar.hidden = true;
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
    // Mirror text input values across drawer/primary fields and warm the
    // ZIP cache, but do NOT fire live recompute on every keystroke.
    // Typed inputs (ZIP, insurance) commit on `change` (blur). Tap-toggles
    // (priority cards, format buttons, checkboxes) fire `change` natively.
    syncMirroredFieldValues(event.target);
    maybeWarmZipcodesForValue(matchForm.elements.location_query.value);
    refreshIntakeUiFromForm();
  });
  matchForm.addEventListener("change", function (event) {
    syncMirroredFieldValues(event.target);
    maybeWarmZipcodesForValue(matchForm.elements.location_query.value);
    refreshIntakeUiFromForm();
    maybeLiveRecompute(event);
    if (document.body.classList.contains("match-refine-drawer-open") && event.target.name) {
      trackFunnelEvent("match_filter_changed", {
        field: event.target.name,
        value: event.target.type === "checkbox" ? event.target.checked : event.target.value,
      });
    }
    // In results mode with the drawer closed, changing care type or format in the main
    // form silently does nothing (maybeLiveRecompute bails without the drawer). Re-run
    // immediately so the toggle is always reversible without needing to reopen the drawer.
    if (
      !document.body.classList.contains("match-refine-drawer-open") &&
      refs.builder &&
      refs.builder.classList.contains("is-results-mode") &&
      event.target &&
      (event.target.name === "care_intent" || event.target.name === "care_format")
    ) {
      handleSubmit({ preventDefault: function () {} });
    }
  });
  var refinements = refs.refinements;
  if (refinements) {
    refinements.addEventListener("toggle", function () {
      // Keep body class in sync regardless of how the panel was opened
      // (inline summary click vs setRefineDrawerOpen button path).
      // Without this, maybeLiveRecompute bails when the user opens the
      // panel via the inline summary and then changes priority/filters.
      var bodyHasClass = document.body.classList.contains("match-refine-drawer-open");
      if (refinements.open && !bodyHasClass) {
        setRefineDrawerOpen(true);
      } else if (!refinements.open && bodyHasClass) {
        setRefineDrawerOpen(false);
      }
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
  var noFitDialog = document.getElementById("noFitFeedbackDialog");
  var noFitSubmit = document.getElementById("noFitDialogSubmit");
  var noFitCancel = document.getElementById("noFitDialogCancel");
  var noFitClose = document.getElementById("noFitDialogClose");
  var noFitStatus = document.getElementById("noFitDialogStatus");

  function closeNoFitDialog() {
    if (noFitDialog && typeof noFitDialog.close === "function") noFitDialog.close();
  }

  if (noFitSubmit) {
    noFitSubmit.addEventListener("click", function () {
      recordShortlistFeedback("negative");
      if (noFitStatus) noFitStatus.textContent = "Thanks, this shapes future matches.";
      window.setTimeout(closeNoFitDialog, 1200);
    });
  }
  if (noFitCancel) {
    noFitCancel.addEventListener("click", closeNoFitDialog);
  }
  if (noFitClose) {
    noFitClose.addEventListener("click", closeNoFitDialog);
  }

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
  document.addEventListener("click", function (event) {
    var link = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!link) return;
    var href = link.getAttribute("href") || "";
    if (href.indexOf("/therapists/") !== -1 && href.indexOf("ref=match") !== -1) {
      try {
        window.sessionStorage.setItem(MATCH_RESULTS_URL_KEY, window.location.href);
      } catch (_) {}
    }
  });
})();
