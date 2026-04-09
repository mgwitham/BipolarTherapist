import { fetchPublicSiteSettings, fetchPublicTherapists } from "./cms.js";
import {
  clearRenderedMatchPanels,
  getMatchShellRefs,
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
var PRIMARY_SHORTLIST_LIMIT = 3;
var SHORTLIST_QUEUE_LIMIT = 8;
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
    button: getMatchShellRefs().searchButton,
    helper: document.getElementById("matchStartHelper"),
    careField: document.querySelector("[data-match-care-field]"),
    escapeHtml: escapeHtml,
  });
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
  var baseEntries = orderMatchEntries(
    rankTherapistsForUser(therapists, profile, latestLearningSignals),
    profile,
  );
  return applySecondPassRefinement(baseEntries, profile, activeSecondPassMode);
}

function buildStarterProfile() {
  return buildUserMatchProfile({
    care_state: "CA",
    care_intent: "Therapy",
    care_format: "Telehealth",
    needs_medication_management: "Open to either",
    insurance: "",
    budget_max: "",
    priority_mode: "Best overall fit",
    urgency: "ASAP",
    bipolar_focus: [],
    preferred_modalities: [],
    population_fit: [],
    language_preferences: [],
    cultural_preferences: "",
    location_query: "",
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
    "Showing a strong California starter shortlist. Add your ZIP code and care preferences to personalize it.",
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
  ["refineSearchButton"].forEach(function (id) {
    var button = document.getElementById(id);
    if (!button || button.dataset.boundRefine === "true") {
      return;
    }
    button.dataset.boundRefine = "true";
    button.addEventListener("click", function () {
      var builder = document.querySelector(".match-builder");
      var refinements = document.querySelector(".match-refinements");
      if (refinements) {
        refinements.open = true;
      }
      if (builder) {
        builder.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });
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
      .slice(0, 3)
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
      .slice(0, 3);
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

  return slugs.length
    ? "match.html?shortlist=" + encodeURIComponent(slugs.join(","))
    : "match.html";
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
  var signal = getPublicResponsivenessSignal(therapist);
  if (!signal) {
    return 0;
  }
  if (signal.tone === "positive") {
    return 2;
  }
  return 1;
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

  if ((profile && profile.insurance) || segments.includes("insurance:user")) {
    return (
      "Could you let me know whether you currently take " +
      (profile && profile.insurance ? profile.insurance : "my insurance") +
      ", what the likely out-of-pocket cost would be, and whether it makes sense to begin with " +
      recommendation.route.toLowerCase() +
      "?"
    );
  }
  if (
    (profile && profile.care_intent === "Psychiatry") ||
    (profile && profile.needs_medication_management === "Yes") ||
    segments.some(function (segment) {
      return segment.indexOf("intent:psychiatry") === 0 || segment.indexOf("medication:yes") === 0;
    })
  ) {
    return (
      "Could you let me know whether you support medication management or psychiatry needs like mine, what next steps usually look like, and whether it makes sense to begin with " +
      recommendation.route.toLowerCase() +
      "?"
    );
  }
  if (profile && profile.care_format) {
    return (
      "Could you let me know whether you currently have " +
      profile.care_format.toLowerCase() +
      " availability, what next steps look like, and whether it makes sense to begin with " +
      recommendation.route.toLowerCase() +
      "?"
    );
  }

  return (
    "Could you let me know about current availability, next steps, and whether it makes sense to begin with " +
    recommendation.route.toLowerCase() +
    "?"
  );
}

function buildEntryOutreachDraft(entry, profile) {
  if (!entry || !entry.therapist) {
    return "";
  }

  var outreach = getPreferredOutreach(entry);
  var route = outreach ? outreach.label : "Review profile";
  var introLine =
    "Hi " +
    entry.therapist.name +
    ",\n\nI found your profile on BipolarTherapyHub and wanted to reach out because your practice seems like it may be a fit.";
  var context = [
    profile && profile.care_state ? "I am seeking care in " + profile.care_state + "." : "",
    profile && profile.care_intent
      ? "I am primarily looking for " + profile.care_intent.toLowerCase() + "."
      : "",
    profile && profile.care_format
      ? "My preferred format is " + profile.care_format.toLowerCase() + "."
      : "",
    profile && profile.needs_medication_management === "Yes"
      ? "Medication support is important for me."
      : "",
    profile && profile.insurance
      ? "I would also like to confirm whether you take " + profile.insurance + "."
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  var ask =
    getSegmentAwareDraftAsk(profile, {
      route: route,
      entry: entry,
    }) + "\n\nThank you.";

  return [introLine, context, ask].filter(Boolean).join("\n\n");
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

function getLeadMatchTrustSummary(entry) {
  var therapist = entry && entry.therapist ? entry.therapist : null;
  if (!therapist) {
    return "This provider rose because the fit and practical follow-through signals are stronger than the rest of the shortlist.";
  }

  if (therapist.verification_status === "editorially_verified") {
    return "This profile has been editorially reviewed, so the public details are stronger than a generic listing.";
  }

  if (therapist.bipolar_years_experience) {
    return (
      "This profile shows " +
      therapist.bipolar_years_experience +
      " years of bipolar-related care experience, which gives you a clearer starting signal."
    );
  }

  return "This provider rose because the fit, trust, and practical next-step signals are stronger than the rest of the shortlist.";
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
      label: "Why trust this start",
      copy: getLeadMatchTrustSummary(entry),
    },
    {
      label: "Trust signal",
      copy: freshness ? trustLabel + " • " + freshness.label : trustLabel,
    },
    {
      label: "Timing and momentum",
      copy: timingLabel,
    },
  ];

  return (
    '<div class="match-section"><h4>Why this is the best place to start</h4><div class="match-snapshot-grid">' +
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
    var tone =
      value === "Contact first"
        ? "positive"
        : value === "Backup if stalled"
          ? "secondary"
          : "neutral";
    return '<span class="compare-chip compare-chip-' + tone + '">' + escapeHtml(value) + "</span>";
  }
  if (kind === "format") {
    if (Array.isArray(value)) {
      return value.length
        ? value
            .map(function (item) {
              return (
                '<span class="compare-chip compare-chip-neutral">' + escapeHtml(item) + "</span>"
              );
            })
            .join("")
        : '<span class="compare-sub">Not listed</span>';
    }
    return value
      ? '<span class="compare-chip compare-chip-neutral">' + escapeHtml(String(value)) + "</span>"
      : '<span class="compare-sub">Not listed</span>';
  }
  if (kind === "boolean") {
    if (value === true) {
      return '<span class="compare-chip compare-chip-positive">Available</span>';
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
    return "$" + min + "–$" + max + " per session";
  }
  if (min) {
    return "$" + min + " per session";
  }
  if (max) {
    return "Up to $" + max + " per session";
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

function getCompareRole(entry, index, recommendedSlug) {
  var priority = String(entry?.evaluation?.shortlist_priority || "").toLowerCase();
  var slug = entry?.therapist?.slug || "";

  if (recommendedSlug && slug === recommendedSlug) {
    return "Contact first";
  }
  if (priority === "top pick") {
    return "Contact first";
  }
  if (priority === "backup") {
    return "Backup if stalled";
  }
  if (index === 0) {
    return "Strong contender";
  }
  if (index === 1) {
    return "Backup if stalled";
  }
  return "Compare if needed";
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
        var role = getCompareRole(entry, index, recommendedSlug);
        var trust = getCompareTrustLabel(entry) || "Trust details still partial";
        var timing = getCompareTimingLabel(therapist) || "Timing not listed";
        var cost = getCompareCostLabel(therapist) || "Fees not listed";
        var action = (readiness && readiness.route) || "Review profile first";
        var reason = getCompareRoleReason(entry, profile, recommendation, role);
        var note = String(entry?.evaluation?.shortlist_note || "").trim();

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

  lines.push("Therapist shortlist summary");
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
    var role = getCompareRole(entry, index, recommendedSlug);
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
      label: "Decision role",
      kind: "order",
      alwaysShow: true,
      getValue: function (therapist) {
        var index = topEntries.findIndex(function (entry) {
          return entry && entry.therapist && entry.therapist.slug === therapist.slug;
        });
        var recommendation = buildFirstContactRecommendation(profile, topEntries);
        var recommendedSlug =
          recommendation && recommendation.therapist ? recommendation.therapist.slug : "";
        return getCompareRole(topEntries[index], index, recommendedSlug);
      },
    },
    {
      label: "Best next step",
      alwaysShow: true,
      getValue: function (therapist) {
        var entry = topEntries.find(function (item) {
          return item && item.therapist && item.therapist.slug === therapist.slug;
        });
        var readiness = getContactReadiness(entry);
        return readiness && readiness.route ? readiness.route : "";
      },
    },
    {
      label: "Timing",
      alwaysShow: true,
      getValue: function (therapist) {
        return getCompareTimingLabel(therapist);
      },
    },
    {
      label: "Trust signal",
      alwaysShow: true,
      getValue: function (therapist) {
        var entry = topEntries.find(function (item) {
          return item && item.therapist && item.therapist.slug === therapist.slug;
        });
        return getCompareTrustLabel(entry);
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
      label: "Medication support",
      kind: "boolean",
      getValue: function (therapist) {
        return therapist.medication_management;
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
      label: "Format",
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
      label: "Insurance",
      alwaysShow: true,
      getValue: function (therapist) {
        var accepted = (therapist.insurance_accepted || []).slice(0, 3);
        return accepted.length ? accepted : [];
      },
    },
    {
      label: "Cost",
      alwaysShow: true,
      getValue: function (therapist) {
        return getCompareCostLabel(therapist);
      },
    },
    {
      label: "Why they stand out",
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
  var compareTitle = profile ? "Decide who to contact first" : "Compare your saved shortlist";
  var compareCopy = profile
    ? "Use fit, trust, timing, cost, and next step together so you can move on one therapist instead of stalling across three."
    : "Your saved shortlist is now organized into a clearer first choice, backup, and side-by-side decision view.";
  var persistedShortlist = persistEntriesToDirectoryShortlist(topEntries);
  var compareUrl = buildShortlistCompareUrl(topEntries);
  var savedCount = persistedShortlist.length;

  root.innerHTML =
    '<details class="result-disclosure"><summary><div><div class="result-disclosure-title">Compare finalists in detail</div><div class="result-disclosure-copy">Open this if you want a side-by-side decision board for your top shortlist.</div></div><span class="result-disclosure-toggle" aria-hidden="true"></span></summary><div class="result-disclosure-body"><section class="match-support-panel"><div class="match-support-panel-static"><div><div class="match-support-panel-title">' +
    escapeHtml(compareTitle) +
    '</div><div class="match-support-panel-copy">' +
    escapeHtml(compareCopy) +
    '</div></div></div><div class="match-support-panel-body"><section class="match-compare"><div class="match-compare-header"><h3>Shortlist decision board</h3><p>Start with the decision cards, then scan the detailed comparison only if you need to pressure-test the finalists.</p></div><div class="compare-summary-bar"><div><span class="compare-summary-kicker">Saved for later</span><div class="compare-summary-text">This comparison is now saved on this browser for quick return' +
    (savedCount ? " across " + escapeHtml(String(savedCount)) + " shortlisted therapists." : ".") +
    '</div></div><div class="compare-summary-actions"><button type="button" class="btn-secondary" data-copy-compare-link>Copy compare link</button><a class="btn-secondary" href="directory.html">Back to directory</a></div></div>' +
    renderPartnerCompareSummary(topEntries, profile) +
    renderCompareDecisionCards(topEntries, profile) +
    '<div class="compare-grid" style="grid-template-columns: 160px repeat(' +
    escapeHtml(String(topEntries.length)) +
    ', minmax(0, 1fr));">' +
    headerCells +
    bodyCells +
    "</div></section></div></section></div></details>";

  var copyButton = root.querySelector("[data-copy-compare-link]");
  if (copyButton) {
    copyButton.addEventListener("click", async function () {
      try {
        await navigator.clipboard.writeText(compareUrl);
        setActionState(true, "Copied the shortlist comparison link.");
      } catch (_error) {
        setActionState(true, "Unable to copy the comparison link automatically.");
      }
    });
  }

  var summaryButton = root.querySelector("[data-copy-partner-summary]");
  if (summaryButton) {
    summaryButton.addEventListener("click", async function () {
      try {
        await navigator.clipboard.writeText(buildPartnerCompareSummary(topEntries, profile));
        setActionState(true, "Copied the shareable shortlist summary.");
      } catch (_error) {
        setActionState(true, "Unable to copy the shortlist summary automatically.");
      }
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
      "Cost and coverage are common friction points. Adding either one usually improves shortlist quality.",
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
        "Care type may sharpen the shortlist",
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
      "If you already know you care most about speed, specialization, or cost, setting it here makes the shortlist feel much more intentional.",
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
          : "The shortlist would stay fairly similar, which suggests your current options are already relatively strong on speed.";
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
          : "The shortlist would stay fairly stable, which suggests the current top options already look highly specialized.";
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
          : "The shortlist would stay fairly similar, which suggests the current leaders already cover medication-related needs well.";
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
    ? '<div class="intake-adaptive-header"><h3>How one answer could change the shortlist</h3><p>These are lightweight previews, so you can see the tradeoff between speed, fit, and specialization before you run the match.</p></div><div class="intake-tradeoff-list">' +
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
  var normalized = profile || {};
  var segments = ["all"];

  if (normalized.care_format) {
    segments.push("format:" + normalized.care_format.toLowerCase());
  }
  if (normalized.care_intent) {
    segments.push("intent:" + normalized.care_intent.toLowerCase());
  }
  if (
    normalized.needs_medication_management &&
    normalized.needs_medication_management !== "Open to either"
  ) {
    segments.push(
      "medication:" +
        String(normalized.needs_medication_management).toLowerCase().replace(/\s+/g, "-"),
    );
  }
  if (normalized.insurance && String(normalized.insurance).trim()) {
    segments.push("insurance:user");
  }
  if (normalized.urgency && normalized.urgency !== "ASAP") {
    segments.push("urgency:" + String(normalized.urgency).toLowerCase().replace(/\s+/g, "-"));
  }

  return segments;
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
  var learning = {};

  function ensureBucket(trigger, segment, slug) {
    var key = trigger + "::" + segment;
    if (!learning[key]) {
      learning[key] = {};
    }
    if (!learning[key][slug]) {
      learning[key][slug] = {
        success: 0,
        attempts: 0,
      };
    }
    return learning[key][slug];
  }

  Object.keys(byJourney).forEach(function (journeyId) {
    var journey = byJourney[journeyId].slice().sort(function (a, b) {
      return new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime();
    });
    var firstRankNegative = journey.find(function (item) {
      return (
        item.rank_position === 1 &&
        ["no_response", "waitlist", "insurance_mismatch"].includes(item.outcome)
      );
    });

    if (!firstRankNegative) {
      return;
    }

    var segments = buildLearningSegments(
      firstRankNegative.context && firstRankNegative.context.profile
        ? firstRankNegative.context.profile
        : null,
    );
    var fallbackEvents = journey.filter(function (item) {
      return item.rank_position > 1;
    });

    fallbackEvents.forEach(function (event) {
      segments.forEach(function (segment) {
        var bucket = ensureBucket(firstRankNegative.outcome, segment, event.therapist_slug);
        bucket.attempts += 1;
        if (event.outcome === "booked_consult" || event.outcome === "good_fit_call") {
          bucket.success += 1;
        }
      });
    });
  });

  return learning;
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
  var routeType = getPreferredRouteType(entry);
  var segments = buildLearningSegments(profile);
  var routeLearning = buildRouteLearningMap(outcomes);
  var score = 0;
  var success = 0;
  var attempts = 0;

  segments.forEach(function (segment) {
    var bucket =
      routeLearning["route::" + segment] && routeLearning["route::" + segment][routeType];
    if (!bucket) {
      return;
    }
    success += bucket.success;
    attempts += bucket.attempts;
    score += bucket.success * 3 + Math.max(0, bucket.attempts - bucket.success);
  });

  return {
    routeType: routeType,
    score: score,
    success: success,
    attempts: attempts,
  };
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
    '%</div><div class="insight-stat-label">Helpful shortlist rate</div></div>' +
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
    therapist_slugs: latestEntries.slice(0, 3).map(function (entry) {
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
    value === "positive"
      ? "Saved: this shortlist felt useful."
      : "Saved: this shortlist needs work.";
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

  var subject = "Interested in learning more about care";
  var body =
    "Hi " +
    entry.therapist.name +
    ",\n\nI found your profile on BipolarTherapyHub and would like to learn more about whether your practice may be a fit.\n\n" +
    (entry.evaluation && entry.evaluation.shortlist_note
      ? "My note to myself: " + entry.evaluation.shortlist_note + "\n\n"
      : "") +
    "Could you let me know about current availability, next steps, and whether you are currently accepting new patients?\n\nThank you.";

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
  if (!entry || !entry.therapist) {
    return null;
  }

  var therapist = entry.therapist;
  var customLabel = String(therapist.preferred_contact_label || "").trim();
  if (therapist.preferred_contact_method === "booking" && therapist.booking_url) {
    return {
      label: customLabel || "Book consultation",
      href: therapist.booking_url,
      external: true,
    };
  }
  if (therapist.preferred_contact_method === "website" && therapist.website) {
    return {
      label: customLabel || "Visit website",
      href: therapist.website,
      external: true,
    };
  }
  if (therapist.preferred_contact_method === "phone" && therapist.phone) {
    return {
      label: customLabel || "Call therapist",
      href: "tel:" + therapist.phone,
      external: false,
    };
  }

  var emailLink = getTherapistContactEmailLink(entry);
  if (emailLink) {
    return {
      label: customLabel || "Email therapist",
      href: emailLink,
      external: false,
    };
  }

  return null;
}

function getPreferredRouteType(entry) {
  var therapist = entry && entry.therapist ? entry.therapist : null;
  if (!therapist) {
    return "profile";
  }

  if (therapist.preferred_contact_method === "booking" && therapist.booking_url) {
    return "booking";
  }
  if (therapist.preferred_contact_method === "website" && therapist.website) {
    return "website";
  }
  if (therapist.preferred_contact_method === "phone" && therapist.phone) {
    return "phone";
  }
  if (
    therapist.preferred_contact_method === "email" &&
    therapist.email &&
    therapist.email !== "contact@example.com"
  ) {
    return "email";
  }
  if (therapist.booking_url) {
    return "booking";
  }
  if (therapist.website) {
    return "website";
  }
  if (therapist.phone) {
    return "phone";
  }
  if (therapist.email && therapist.email !== "contact@example.com") {
    return "email";
  }
  return "profile";
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
  if (!contactReadiness) {
    return 0;
  }
  if (contactReadiness.tone === "high") {
    return 3;
  }
  if (contactReadiness.tone === "medium") {
    return 2;
  }
  return 1;
}

function hasInsuranceClarity(profile, therapist) {
  if (!profile || !profile.insurance) {
    return false;
  }
  return (therapist.insurance_accepted || []).includes(profile.insurance);
}

function hasCostClarity(therapist) {
  return Boolean(
    therapist &&
    (therapist.session_fee_min || therapist.session_fee_max || therapist.sliding_scale),
  );
}

function pickRecommendedFirstContact(profile, entries) {
  var shortlist = (entries || []).slice(0, PRIMARY_SHORTLIST_LIMIT);
  if (!shortlist.length) {
    return null;
  }
  var outreachOutcomes = readOutreachOutcomes();
  var shortcutInfluence = getShortcutInfluence(profile, shortlist);

  var ranked = shortlist
    .map(function (entry, index) {
      var therapist = entry.therapist;
      var readiness = getContactReadiness(entry);
      var routeLearning = getRouteLearningForProfile(profile, entry, outreachOutcomes);
      var shortcutSignal = shortcutInfluence[therapist.slug] || null;
      var score = 0;

      score += Math.max(0, 30 - index * 8);
      score += getRoutePriority(readiness) * 10;
      score += therapist.accepting_new_patients ? 6 : 0;
      score +=
        therapist.estimated_wait_time && therapist.estimated_wait_time !== "Waitlist only" ? 4 : 0;
      score += hasInsuranceClarity(profile, therapist) ? 8 : 0;
      score += hasCostClarity(therapist) ? 3 : 0;
      score +=
        therapist.medication_management && profile && profile.needs_medication_management === "Yes"
          ? 6
          : 0;
      score += readiness && readiness.guidance ? 3 : 0;
      score += getResponsivenessScore(therapist) * 6;
      score += Math.min(8, routeLearning.score);
      if (shortcutSignal) {
        score += Math.min(12, shortcutSignal.preference.strong * 4);
        score -= Math.min(8, shortcutSignal.preference.weak * 3);
        if (shortcutSignal.rank === 1) {
          score += 4;
        }
      }

      return {
        entry: entry,
        readiness: readiness,
        routeLearning: routeLearning,
        shortcutSignal: shortcutSignal,
        score: score,
      };
    })
    .sort(function (a, b) {
      return b.score - a.score || a.entry.therapist.name.localeCompare(b.entry.therapist.name);
    });

  return ranked[0];
}

function buildFirstContactRecommendation(profile, entries) {
  var picked = pickRecommendedFirstContact(profile, entries);
  if (!picked) {
    return null;
  }

  var therapist = picked.entry.therapist;
  var readiness = picked.readiness;
  var routeLearning = picked.routeLearning;
  var shortcutSignal = picked.shortcutSignal;
  var reasons = [];

  if (readiness && readiness.tone === "high") {
    reasons.push("the contact path is especially friction-light");
  } else if (readiness && readiness.tone === "medium") {
    reasons.push("the contact path is straightforward");
  }
  if (therapist.accepting_new_patients) {
    reasons.push("they appear to be accepting new patients");
  }
  if (profile && profile.urgency && profile.urgency !== "ASAP" && therapist.estimated_wait_time) {
    reasons.push("their timing signal is clearer than most options");
  }
  if (hasInsuranceClarity(profile, therapist)) {
    reasons.push("they explicitly list your insurance");
  } else if (hasCostClarity(therapist)) {
    reasons.push("their fees are more transparent");
  }
  if (getResponsivenessScore(therapist) === 2) {
    reasons.push("earlier outreach patterns suggest they tend to reply");
  } else if (getResponsivenessScore(therapist) === 1) {
    reasons.push("there is some early contact signal to work with");
  }
  if (profile && profile.needs_medication_management === "Yes" && therapist.medication_management) {
    reasons.push("they offer medication management");
  }
  if (routeLearning && routeLearning.success > 0) {
    reasons.push(
      "similar users have seen stronger outcomes through " +
        routeLearning.routeType.replace(/_/g, " ") +
        " outreach",
    );
  }
  if (shortcutSignal && shortcutSignal.rank === 1 && shortcutSignal.preference.strong > 0) {
    reasons.push(
      "this also aligns with the strongest-performing " +
        shortcutSignal.title.toLowerCase() +
        " shortcut for similar users",
    );
  }

  return {
    therapist: therapist,
    entry: picked.entry,
    route: readiness ? readiness.route : "Review profile",
    rationale:
      reasons.length > 1
        ? reasons.slice(0, 2).join(" and ")
        : reasons[0] || "they balance fit and follow-through well",
    firstStep:
      (readiness && readiness.firstStep) ||
      "After first contact, the next step is usually a fit conversation or intake review.",
    segmentLearning: getSegmentLearningCopy(picked.entry.evaluation),
    segmentCue: getSegmentAwareRecommendationCue(profile, picked.entry.evaluation),
    routeLearning: routeLearning,
    shortcutSignal: shortcutSignal,
  };
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
    request_summary: profile ? buildRequestSummary(profile) : "Directory shortlist comparison",
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
    shortcut_type: shortcutContext ? shortcutContext.shortcut_type : "",
    pivot_at: contactPlan ? contactPlan.pivotAt : "",
    recommended_wait_window: contactPlan ? contactPlan.waitWindow : "",
    request_summary: latestProfile
      ? buildRequestSummary(latestProfile)
      : "Directory shortlist comparison",
    context: {
      created_at: new Date().toISOString(),
      summary: latestProfile
        ? buildRequestSummary(latestProfile)
        : "Directory shortlist comparison",
      profile: latestProfile,
      strategy: buildAdaptiveStrategySnapshot(latestProfile),
      therapist_slugs: latestEntries.slice(0, 3).map(function (item) {
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
    shortcut_type: shortcutContext ? shortcutContext.shortcut_type : "",
    pivot_at: contactPlan ? contactPlan.pivotAt : "",
    recommended_wait_window: contactPlan ? contactPlan.waitWindow : "",
    outcome: outcome,
    request_summary: latestProfile
      ? buildRequestSummary(latestProfile)
      : "Directory shortlist comparison",
    recorded_at: new Date().toISOString(),
    context: {
      summary: latestProfile
        ? buildRequestSummary(latestProfile)
        : "Directory shortlist comparison",
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
  var recommendation = buildFirstContactRecommendation(profile, entries);
  if (!recommendation) {
    return null;
  }

  var latestOutcome = getLatestOutreachOutcome(recommendation.therapist.slug);
  if (
    !latestOutcome ||
    ["no_response", "waitlist", "insurance_mismatch"].indexOf(latestOutcome.outcome) === -1
  ) {
    return null;
  }

  var outcomes = readOutreachOutcomes();
  var fallbackLearning = buildFallbackLearningMap(outcomes);
  var activeSegments = buildLearningSegments(profile);
  var fallbackCandidates = (entries || []).filter(function (entry) {
    return entry.therapist.slug !== recommendation.therapist.slug;
  });
  var rankedFallbacks = fallbackCandidates
    .map(function (entry, index) {
      var learningScore = 0;
      var learningWins = 0;
      var learningAttempts = 0;
      var routeLearning = getRouteLearningForProfile(profile, entry, outcomes);

      activeSegments.forEach(function (segment) {
        var bucket =
          fallbackLearning[latestOutcome.outcome + "::" + segment] &&
          fallbackLearning[latestOutcome.outcome + "::" + segment][entry.therapist.slug];
        if (!bucket) {
          return;
        }
        learningWins += bucket.success;
        learningAttempts += bucket.attempts;
        learningScore += bucket.success * 5 + Math.max(0, bucket.attempts - bucket.success);
      });

      return {
        entry: entry,
        learningScore: learningScore,
        learningWins: learningWins,
        learningAttempts: learningAttempts,
        routeLearning: routeLearning,
        fallbackRank: index + 2,
      };
    })
    .sort(function (a, b) {
      return (
        b.learningScore - a.learningScore ||
        b.routeLearning.score - a.routeLearning.score ||
        b.entry.evaluation.score - a.entry.evaluation.score ||
        a.fallbackRank - b.fallbackRank
      );
    });

  var fallbackPick = rankedFallbacks[0] || null;
  var fallbackEntry = fallbackPick ? fallbackPick.entry : null;
  if (!fallbackEntry) {
    return null;
  }

  var fallbackRoute = getPreferredOutreach(fallbackEntry);
  var fallbackReason =
    latestOutcome.outcome === "no_response"
      ? "the first outreach has not gotten a reply yet"
      : latestOutcome.outcome === "waitlist"
        ? "the first outreach appears to be blocked by availability"
        : "the first outreach hit an insurance or cost mismatch";
  var nextMove =
    latestOutcome.outcome === "insurance_mismatch"
      ? "Lead by confirming coverage and expected out-of-pocket cost right away."
      : latestOutcome.outcome === "waitlist"
        ? "Lead with timing and ask whether they have a realistic next opening."
        : "Use the backup option now rather than waiting too long on the first path.";

  return {
    therapist: fallbackEntry.therapist,
    entry: fallbackEntry,
    route: fallbackRoute ? fallbackRoute.label : "Review profile",
    triggerLabel: formatOutcomeLabel(latestOutcome.outcome),
    rationale:
      "Because " +
      fallbackReason +
      ", this looks like the strongest backup option based on fit, follow-through, and current shortlist position." +
      (fallbackPick && fallbackPick.learningWins
        ? " Similar fallback journeys have also produced " +
          fallbackPick.learningWins +
          " strong outcome" +
          (fallbackPick.learningWins > 1 ? "s" : "") +
          " for this backup path."
        : ""),
    nextMove: nextMove,
    learningWins: fallbackPick ? fallbackPick.learningWins : 0,
    learningAttempts: fallbackPick ? fallbackPick.learningAttempts : 0,
    routeLearning: fallbackPick ? fallbackPick.routeLearning : null,
  };
}

function renderFallbackRecommendation(profile, entries) {
  var root = document.getElementById("matchFallbackContact");
  if (!root) {
    return;
  }

  var fallback = buildFallbackRecommendation(profile, entries);
  var contactPlan = buildContactOrderPlan(profile, entries);
  if (!fallback) {
    root.innerHTML = "";
    return;
  }

  var preferredRoute = getPreferredOutreach(fallback.entry);
  var fallbackSummaryCopy =
    "Open this only if your first outreach stalls, hits a waitlist, or turns into an insurance mismatch.";

  root.innerHTML =
    '<details class="result-disclosure"><summary><div><div class="result-disclosure-title">Keep a backup ready</div><div class="result-disclosure-copy">' +
    escapeHtml(fallbackSummaryCopy) +
    '</div></div><span class="result-disclosure-toggle" aria-hidden="true"></span></summary><div class="result-disclosure-body"><section class="match-support-panel"><div class="match-support-panel-static"><div><div class="match-support-panel-title">Backup option if the first path stalls</div><div class="match-support-panel-copy">If your first choice is not available or does not respond, this is the next option to try.</div></div></div><div class="match-support-panel-body"><section class="first-contact-reco"><div class="first-contact-card"><div class="first-contact-top"><div><div class="first-contact-kicker">Backup option</div><div class="first-contact-name">' +
    escapeHtml(fallback.therapist.name) +
    '</div><div class="first-contact-meta">' +
    escapeHtml(formatTherapistLocationLine(fallback.therapist) || "") +
    '</div></div><a href="therapist.html?slug=' +
    encodeURIComponent(fallback.therapist.slug) +
    '" class="btn-secondary" style="width:auto" data-match-profile-link="' +
    escapeHtml(fallback.therapist.slug) +
    '" data-profile-link-context="fallback">Review profile</a></div><div class="first-contact-body"><p><strong>Why this backup:</strong> ' +
    escapeHtml(fallback.rationale) +
    '</p><div class="first-contact-summary-grid"><div class="first-contact-summary-card"><div class="first-contact-summary-label">Pivot when</div><div class="first-contact-summary-value">' +
    escapeHtml(contactPlan ? contactPlan.trigger : "Move here if the first outreach stalls.") +
    '</div></div><div class="first-contact-summary-card"><div class="first-contact-summary-label">Suggested timing</div><div class="first-contact-summary-value">' +
    escapeHtml(
      contactPlan
        ? "Around " +
            contactPlan.waitWindow +
            " from first outreach, or by " +
            contactPlan.pivotAtLabel
        : "As soon as the first path looks blocked.",
    ) +
    '</div></div><div class="first-contact-summary-card"><div class="first-contact-summary-label">Lead with</div><div class="first-contact-summary-value">' +
    escapeHtml(fallback.nextMove || "Use the clearest next contact route and keep momentum.") +
    "</div></div></div>" +
    (contactPlan && contactPlan.timingRationale
      ? '<div class="first-contact-signal">' + escapeHtml(contactPlan.timingRationale) + "</div>"
      : fallback.routeLearning && fallback.routeLearning.success > 0
        ? '<div class="first-contact-signal">Similar users have seen stronger backup outcomes through ' +
          escapeHtml(fallback.routeLearning.routeType.replace(/_/g, " ")) +
          " outreach.</div>"
        : "") +
    '<div class="first-contact-actions">' +
    (preferredRoute
      ? '<a class="btn-primary" href="' +
        escapeHtml(preferredRoute.href) +
        '"' +
        (preferredRoute.external ? ' target="_blank" rel="noopener"' : "") +
        ' data-fallback-contact-link="' +
        escapeHtml(fallback.therapist.slug) +
        '" data-fallback-route-label="' +
        escapeHtml(preferredRoute.label) +
        '">' +
        escapeHtml(preferredRoute.label) +
        "</a>"
      : "") +
    '<button type="button" class="btn-secondary" data-copy-fallback-draft="' +
    escapeHtml(fallback.therapist.slug) +
    '">Copy backup message</button></div></div></div></section></div></section></div></details>';

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

  root.querySelectorAll("[data-fallback-contact-link]").forEach(function (link) {
    link.addEventListener("click", function () {
      var slug = link.getAttribute("data-fallback-contact-link") || "";
      trackFunnelEvent(
        "match_fallback_outreach_started",
        buildMatchTrackingPayload(slug, {
          route: link.getAttribute("data-fallback-route-label") || "",
        }),
      );
    });
  });

  root.querySelectorAll("[data-copy-fallback-draft]").forEach(function (button) {
    button.addEventListener("click", async function () {
      var slug = button.getAttribute("data-copy-fallback-draft") || "";
      var entry = (entries || []).find(function (item) {
        return item && item.therapist && item.therapist.slug === slug;
      });
      if (!entry) {
        return;
      }
      try {
        await navigator.clipboard.writeText(buildEntryOutreachDraft(entry, latestProfile));
        trackFunnelEvent(
          "match_fallback_draft_copied",
          buildMatchTrackingPayload(slug, {
            route: fallback.route || "Backup option",
          }),
        );
        setActionState(true, "Copied the backup outreach for " + entry.therapist.name + ".");
      } catch (_error) {
        setActionState(true, "Unable to copy the backup outreach automatically.");
      }
    });
  });
}

function renderFirstContactRecommendation(_profile, _entries) {
  var root = document.getElementById("matchFirstContact");
  if (!root) {
    return;
  }

  var recommendation = buildFirstContactRecommendation(_profile, _entries);
  if (!recommendation) {
    root.innerHTML = "";
    return;
  }

  var preferredRoute = getPreferredOutreach(recommendation.entry);
  var latestOutcome = getLatestOutreachOutcome(recommendation.therapist.slug);
  var trackerOpen = Boolean(latestOutcome);
  var trackerSummaryCopy = latestOutcome
    ? "Your first outreach already has a saved outcome. Open this to update what happened or change course."
    : "Open this after you contact the first provider so the backup plan can adapt if needed.";

  root.innerHTML =
    '<details class="result-disclosure"' +
    (trackerOpen ? " open" : "") +
    '><summary><div><div class="result-disclosure-title">Track what happened after your first outreach</div><div class="result-disclosure-copy">' +
    escapeHtml(trackerSummaryCopy) +
    '</div></div><span class="result-disclosure-toggle" aria-hidden="true"></span></summary><div class="result-disclosure-body"><section class="first-contact-reco"><div class="first-contact-header"><h3>First outreach tracker</h3><p>This supports your next step after you contact the lead provider. Save the outcome here so the backup plan can respond.</p></div><div class="first-contact-card"><div class="first-contact-top"><div><div class="first-contact-kicker">Lead provider</div><div class="first-contact-name">' +
    escapeHtml(recommendation.therapist.name) +
    '</div><div class="first-contact-meta">' +
    escapeHtml(formatTherapistLocationLine(recommendation.therapist) || "") +
    '</div></div><a href="therapist.html?slug=' +
    encodeURIComponent(recommendation.therapist.slug) +
    '" class="btn-secondary" style="width:auto" data-match-profile-link="' +
    escapeHtml(recommendation.therapist.slug) +
    '" data-profile-link-context="first-contact">Review profile</a></div><div class="first-contact-body"><p><strong>Why this one:</strong> ' +
    escapeHtml(recommendation.rationale) +
    '</p><div class="first-contact-summary-grid"><div class="first-contact-summary-card"><div class="first-contact-summary-label">Best route</div><div class="first-contact-summary-value">' +
    escapeHtml(recommendation.route || "Review profile") +
    '</div></div><div class="first-contact-summary-card"><div class="first-contact-summary-label">First step</div><div class="first-contact-summary-value">' +
    escapeHtml(recommendation.firstStep || "Start with a brief fit-oriented outreach.") +
    '</div></div><div class="first-contact-summary-card"><div class="first-contact-summary-label">Why it rose</div><div class="first-contact-summary-value">' +
    escapeHtml(
      recommendation.segmentCue ||
        recommendation.segmentLearning ||
        "This option looks strongest when balancing fit and follow-through.",
    ) +
    "</div></div></div>" +
    (recommendation.routeLearning && recommendation.routeLearning.success > 0
      ? '<div class="first-contact-signal">Similar users have seen stronger outcomes through ' +
        escapeHtml(recommendation.routeLearning.routeType.replace(/_/g, " ")) +
        ' outreach.<div class="first-contact-signal-note">Use that route first before widening to backup options.</div></div>'
      : recommendation.shortcutSignal && recommendation.shortcutSignal.preference.strong > 0
        ? '<div class="first-contact-signal">This also lines up with the strongest-performing ' +
          escapeHtml(recommendation.shortcutSignal.title.toLowerCase()) +
          " shortcut for similar users.</div>"
        : "") +
    '<div class="first-contact-actions">' +
    (preferredRoute
      ? '<a class="btn-primary" href="' +
        escapeHtml(preferredRoute.href) +
        '"' +
        (preferredRoute.external ? ' target="_blank" rel="noopener"' : "") +
        ' data-entry-contact-link="' +
        escapeHtml(recommendation.therapist.slug) +
        '" data-entry-route-label="' +
        escapeHtml(preferredRoute.label) +
        '">' +
        escapeHtml(preferredRoute.label) +
        "</a>"
      : "") +
    '<button type="button" class="btn-secondary" data-copy-entry-draft="' +
    escapeHtml(recommendation.therapist.slug) +
    '">Copy first message</button></div><div class="first-contact-tracker"><div class="first-contact-tracker-title">What happened after outreach?</div><div class="first-contact-tracker-actions">' +
    OUTREACH_OUTCOME_OPTIONS.map(function (option) {
      return (
        '<button type="button" class="feedback-btn' +
        (latestOutcome && latestOutcome.outcome === option.value
          ? option.tone === "negative"
            ? " active-negative"
            : " active-positive"
          : "") +
        '" data-entry-outreach="' +
        escapeHtml(recommendation.therapist.slug) +
        '" data-entry-outcome="' +
        escapeHtml(option.value) +
        '">' +
        escapeHtml(option.label) +
        "</button>"
      );
    }).join("") +
    '</div><div class="first-contact-tracker-note">Save the outcome here so the backup plan and ranking logic can adapt.</div></div></div></div></section></div></details>';

  root.querySelectorAll("[data-match-profile-link]").forEach(function (link) {
    link.addEventListener("click", function () {
      var slug = link.getAttribute("data-match-profile-link") || "";
      trackFunnelEvent(
        "match_result_profile_opened",
        buildMatchTrackingPayload(slug, {
          context: link.getAttribute("data-profile-link-context") || "first-contact",
        }),
      );
    });
  });

  root.querySelectorAll("[data-entry-contact-link]").forEach(function (link) {
    link.addEventListener("click", function () {
      var slug = link.getAttribute("data-entry-contact-link") || "";
      trackFunnelEvent(
        "match_recommended_outreach_started",
        buildMatchTrackingPayload(slug, {
          route: link.getAttribute("data-entry-route-label") || "",
        }),
      );
    });
  });

  root.querySelectorAll("[data-copy-entry-draft]").forEach(function (button) {
    button.addEventListener("click", async function () {
      var slug = button.getAttribute("data-copy-entry-draft") || "";
      var entry = (_entries || []).find(function (item) {
        return item && item.therapist && item.therapist.slug === slug;
      });
      if (!entry) {
        return;
      }
      try {
        await navigator.clipboard.writeText(buildEntryOutreachDraft(entry, latestProfile));
        trackFunnelEvent(
          "match_recommended_draft_copied",
          buildMatchTrackingPayload(slug, {
            route: recommendation.route || "Recommended first contact",
          }),
        );
        setActionState(
          true,
          "Copied the recommended first outreach for " + entry.therapist.name + ".",
        );
      } catch (_error) {
        setActionState(true, "Unable to copy the recommended outreach automatically.");
      }
    });
  });

  root.querySelectorAll("[data-entry-outreach]").forEach(function (button) {
    button.addEventListener("click", function () {
      recordEntryOutreachOutcome(
        button.getAttribute("data-entry-outreach"),
        button.getAttribute("data-entry-outcome"),
      );
    });
  });
}

function buildContactOrderPlan(profile, entries) {
  return buildContactOrderPlanBase(profile, entries, {
    buildFirstContactRecommendation: buildFirstContactRecommendation,
    buildFallbackRecommendation: buildFallbackRecommendation,
    readOutreachOutcomes: readOutreachOutcomes,
    analyzePivotTimingByUrgency: analyzePivotTimingByUrgency,
    buildLearningSegments: buildLearningSegments,
  });
}

function renderOutreachPanel(entries) {
  var root = document.getElementById("matchOutreach");
  if (!root) {
    return;
  }

  if (!entries || !entries.length) {
    root.innerHTML = "";
    return;
  }
  var topEntries = entries.slice(0, 3);
  var focusSlug = outreachFocusSlug || (topEntries[0] ? topEntries[0].therapist.slug : "");
  var focusIndex = Math.max(
    0,
    topEntries.findIndex(function (entry) {
      return entry.therapist.slug === focusSlug;
    }),
  );
  if (!topEntries[focusIndex]) {
    focusIndex = 0;
  }
  var hasRecordedOutcome = topEntries.some(function (entry) {
    return Boolean(getLatestOutreachOutcome(entry.therapist.slug));
  });
  root.innerHTML =
    '<details class="result-disclosure"' +
    (hasRecordedOutcome || outreachFocusSlug ? " open" : "") +
    '><summary><div><div class="result-disclosure-title">Outreach scripts and tracking</div><div class="result-disclosure-copy">Open this when you are ready to contact providers or save what happened next.</div></div><span class="result-disclosure-toggle" aria-hidden="true"></span></summary><div class="result-disclosure-body"><section class="match-support-panel"><div class="match-support-panel-static"><div><div class="match-support-panel-title">What to do next</div><div class="match-support-panel-copy">Start with one provider, then move to your backup if the first option stalls.</div></div><div class="outreach-carousel-meta"><div class="outreach-carousel-count">' +
    escapeHtml(String(focusIndex + 1) + " of " + String(topEntries.length)) +
    '</div><div class="outreach-carousel-nav"><button type="button" class="btn-secondary" id="outreachPrev"' +
    (focusIndex === 0 ? " disabled" : "") +
    '>Previous</button><button type="button" class="btn-secondary" id="outreachNext"' +
    (focusIndex === topEntries.length - 1 ? " disabled" : "") +
    '>Next</button></div></div></div><div class="match-support-panel-body"><div class="outreach-carousel-frame">' +
    topEntries
      .map(function (entry, index) {
        var therapist = entry.therapist;
        var preferredRoute = getPreferredOutreach(entry);
        var latestOutcome = getLatestOutreachOutcome(therapist.slug);
        var role = index === 0 ? "Contact first" : index === 1 ? "Contact second" : "Contact third";
        var script = buildEntryOutreachDraft(entry, latestProfile).replace(/\n+/g, " ").trim();
        return (
          '<article class="outreach-carousel-card"' +
          (index === focusIndex ? "" : " hidden") +
          ' data-outreach-card="' +
          escapeHtml(therapist.slug) +
          '"><div class="outreach-card-top"><div><h4>' +
          escapeHtml(therapist.name) +
          "</h4><p>" +
          escapeHtml(
            (therapist.credentials || "") + (therapist.title ? " · " + therapist.title : ""),
          ) +
          '</p><div class="outreach-note">' +
          escapeHtml(formatTherapistLocationLine(therapist)) +
          '</div></div><span class="match-summary-pill">' +
          escapeHtml(role) +
          '</span></div><div class="outreach-compact-grid"><div class="outreach-card-route"><div class="outreach-note-label">Start here</div><div class="outreach-note-body outreach-note-body-compact">' +
          escapeHtml(preferredRoute ? preferredRoute.label : "View full profile") +
          '</div></div><div class="outreach-card-route outreach-card-script"><div class="outreach-note-label">What to say</div><div class="outreach-note-body outreach-script-preview">' +
          escapeHtml(script) +
          '</div></div></div><div class="outreach-card-actions">' +
          (preferredRoute
            ? '<a class="btn-primary" href="' +
              escapeHtml(preferredRoute.href) +
              '"' +
              (preferredRoute.external ? ' target="_blank" rel="noopener"' : "") +
              ' data-entry-contact-link="' +
              escapeHtml(therapist.slug) +
              '" data-entry-route-label="' +
              escapeHtml(preferredRoute.label) +
              '">' +
              escapeHtml(preferredRoute.label) +
              "</a>"
            : "") +
          '<button type="button" class="btn-secondary" data-copy-entry-draft="' +
          escapeHtml(therapist.slug) +
          '">Copy script</button><a class="btn-secondary" href="therapist.html?slug=' +
          encodeURIComponent(therapist.slug) +
          '" data-match-profile-link="' +
          escapeHtml(therapist.slug) +
          '" data-profile-link-context="outreach-card">View profile</a></div><div class="first-contact-tracker"><div class="first-contact-tracker-title">Update outcome</div><div class="first-contact-tracker-actions">' +
          OUTREACH_OUTCOME_OPTIONS.map(function (option) {
            return (
              '<button type="button" class="feedback-btn' +
              (latestOutcome && latestOutcome.outcome === option.value
                ? option.tone === "negative"
                  ? " active-negative"
                  : " active-positive"
                : "") +
              '" data-entry-outreach="' +
              escapeHtml(therapist.slug) +
              '" data-entry-outcome="' +
              escapeHtml(option.value) +
              '">' +
              escapeHtml(option.label) +
              "</button>"
            );
          }).join("") +
          "</div></div></article>"
        );
      })
      .join("") +
    "</div></div></section></div></details>";

  var prevButton = document.getElementById("outreachPrev");
  if (prevButton) {
    prevButton.addEventListener("click", function () {
      var nextIndex = Math.max(0, focusIndex - 1);
      outreachFocusSlug = topEntries[nextIndex].therapist.slug;
      renderOutreachPanel(entries);
    });
  }

  var nextButton = document.getElementById("outreachNext");
  if (nextButton) {
    nextButton.addEventListener("click", function () {
      var nextIndex = Math.min(topEntries.length - 1, focusIndex + 1);
      outreachFocusSlug = topEntries[nextIndex].therapist.slug;
      renderOutreachPanel(entries);
    });
  }

  root.querySelectorAll("[data-copy-entry-draft]").forEach(function (button) {
    button.addEventListener("click", async function () {
      var slug = button.getAttribute("data-copy-entry-draft");
      var entry = entries.find(function (item) {
        return item.therapist.slug === slug;
      });
      if (!entry) {
        return;
      }
      try {
        await navigator.clipboard.writeText(buildEntryOutreachDraft(entry, latestProfile));
        trackFunnelEvent(
          "match_entry_draft_copied",
          buildMatchTrackingPayload(entry.therapist.slug, {
            route: getPreferredOutreach(entry)
              ? getPreferredOutreach(entry).label
              : "Review profile",
          }),
        );
        setActionState(true, "Tailored outreach draft copied for " + entry.therapist.name + ".");
      } catch (_error) {
        setActionState(true, "Unable to copy the tailored outreach draft automatically.");
      }
    });
  });

  root.querySelectorAll("[data-entry-contact-link]").forEach(function (link) {
    link.addEventListener("click", function () {
      var slug = link.getAttribute("data-entry-contact-link") || "";
      trackFunnelEvent(
        "match_entry_outreach_started",
        buildMatchTrackingPayload(slug, {
          route: link.getAttribute("data-entry-route-label") || "",
        }),
      );
    });
  });

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

  root.querySelectorAll("[data-entry-outreach]").forEach(function (button) {
    button.addEventListener("click", function () {
      recordEntryOutreachOutcome(
        button.getAttribute("data-entry-outreach"),
        button.getAttribute("data-entry-outcome"),
      );
      renderOutreachPanel(entries);
    });
  });

  var frame = root.querySelector(".outreach-carousel-frame");
  if (frame) {
    var touchStartX = 0;
    frame.addEventListener("touchstart", function (event) {
      touchStartX = event.touches[0] ? event.touches[0].clientX : 0;
    });
    frame.addEventListener("touchend", function (event) {
      var touchEndX = event.changedTouches[0] ? event.changedTouches[0].clientX : 0;
      var delta = touchEndX - touchStartX;
      if (Math.abs(delta) < 40) {
        return;
      }
      if (delta < 0 && focusIndex < topEntries.length - 1) {
        outreachFocusSlug = topEntries[focusIndex + 1].therapist.slug;
        renderOutreachPanel(entries);
      } else if (delta > 0 && focusIndex > 0) {
        outreachFocusSlug = topEntries[focusIndex - 1].therapist.slug;
        renderOutreachPanel(entries);
      }
    });
  }
}

function renderPrimaryMatchCards(entries, _profile) {
  var root = getMatchShellRefs().resultsRoot;
  if (!root) {
    return;
  }

  var primaryEntries = (entries || []).slice(0, PRIMARY_SHORTLIST_LIMIT);

  if (!primaryEntries.length) {
    root.className = "match-empty";
    return;
  }

  var requestSummary = _profile
    ? buildRequestSummary(_profile)
    : "Shortlist based on your current answers.";
  var resultCountLabel =
    primaryEntries.length === 1
      ? "Showing 1 strongest match right now."
      : "Showing the top " + primaryEntries.length + " matches to start with.";
  var summaryIntro = starterResultsMode
    ? "These are strong starting providers to explore before you narrow by ZIP code, care type, insurance, or medication needs."
    : _profile
      ? "Your homepage answers are already applied. Start with the first provider below, keep the second as backup, or browse the full directory if you want to explore more on your own."
      : "These saved providers are organized into the clearest place to start first.";
  var summaryKicker = starterResultsMode
    ? "Your first matches are ready"
    : "Your shortlist is ready";
  var directoryBrowseUrl = buildDirectoryBrowseUrl(_profile);
  var leadAction = buildPrimaryResultAction(primaryEntries[0]);
  var appliedPills = _profile
    ? buildAppliedAnswerPills(_profile)
    : ["Therapy", "California", "Starter shortlist"];
  var backupName =
    primaryEntries[1] && primaryEntries[1].therapist ? primaryEntries[1].therapist.name || "" : "";
  var nextStepLabel =
    leadAction && leadAction.therapistName
      ? "Best next move: start with " +
        leadAction.therapistName +
        (backupName ? ", then keep " + backupName + " as your backup." : ".")
      : "Best next move: start with your first provider, then keep your second option as backup.";

  root.className = "match-list";
  root.innerHTML =
    '<div class="match-summary-bar"><div class="match-summary-top"><div><span class="match-summary-kicker">' +
    escapeHtml(summaryKicker) +
    '</span><div class="match-summary-meta">' +
    escapeHtml(resultCountLabel) +
    '</div><div class="match-summary-meta">' +
    escapeHtml(nextStepLabel) +
    '</div></div><div class="match-summary-actions">' +
    (leadAction
      ? '<a class="btn-primary" href="' +
        escapeHtml(leadAction.href) +
        '" id="startWithLeadButton" data-match-summary-primary="' +
        escapeHtml(leadAction.therapistSlug) +
        '"' +
        (leadAction.external ? ' target="_blank" rel="noopener"' : "") +
        ">" +
        escapeHtml(leadAction.label) +
        "</a>"
      : "") +
    '<button type="button" class="btn-secondary" id="refineSearchButton">' +
    escapeHtml(starterResultsMode ? "Get a more specific match" : "Adjust this shortlist") +
    '</button><a class="btn-secondary" href="' +
    escapeHtml(directoryBrowseUrl) +
    '">Search the directory</a></div></div><div class="match-summary-text">' +
    escapeHtml(summaryIntro) +
    " " +
    escapeHtml(requestSummary) +
    '</div><div class="match-summary-applied"><div class="match-summary-applied-label">Applied answers</div>' +
    appliedPills
      .map(function (pill) {
        return '<span class="match-summary-pill">' + escapeHtml(pill) + "</span>";
      })
      .join("") +
    "</div></div>" +
    primaryEntries
      .map(function (entry, index) {
        var therapist = entry && entry.therapist ? entry.therapist : {};
        var preferredRoute = getPreferredOutreach(entry);
        var routeType = getPreferredRouteType(entry);
        var locationLine = [therapist.city, therapist.state, therapist.zip]
          .filter(Boolean)
          .join(", ");
        if (therapist.state && therapist.zip) {
          locationLine = [therapist.city, therapist.state + " " + therapist.zip]
            .filter(Boolean)
            .join(", ");
        }
        var credentialLine = [therapist.credentials, therapist.title].filter(Boolean).join(" · ");
        var confidence = getMatchConfidenceMeta(entry);
        var explanation = getMatchCardExplanation(entry);
        var caution = getMatchCardCaution(entry);
        var actionCopy = getMatchCardActionCopy(entry);
        var ctaLabel =
          routeType === "booking"
            ? "Start with this provider"
            : routeType === "phone"
              ? "Call this provider"
              : routeType === "email"
                ? "Email this provider"
                : routeType === "website"
                  ? "Visit provider site"
                  : "View full profile";
        return (
          '<article class="match-card' +
          (index === 0 ? " lead-card" : "") +
          '">' +
          '<div class="match-card-header">' +
          '<div class="match-card-badges"><div class="match-rank' +
          (index === 0 ? " is-lead" : "") +
          '">' +
          escapeHtml(index === 0 ? "Best place to start" : "Top " + (index + 1) + " match") +
          '</div><div class="match-confidence tone-' +
          escapeHtml(confidence.tone) +
          '">' +
          escapeHtml(confidence.label) +
          "</div></div>" +
          '<a href="therapist.html?slug=' +
          encodeURIComponent(therapist.slug || "") +
          '" class="btn-secondary match-card-profile-link" data-match-profile-link="' +
          escapeHtml(therapist.slug || "") +
          '" data-profile-link-context="primary-card">View profile</a>' +
          "</div>" +
          '<div class="match-card-body">' +
          "<h3>" +
          escapeHtml(therapist.name || "") +
          "</h3>" +
          (credentialLine
            ? '<div class="match-credentials">' + escapeHtml(credentialLine) + "</div>"
            : "") +
          (locationLine ? '<div class="match-meta">' + escapeHtml(locationLine) + "</div>" : "") +
          '<p class="match-explanation">' +
          escapeHtml(explanation) +
          "</p>" +
          (caution
            ? '<div class="match-segment-learning"><strong>Watch for:</strong> ' +
              escapeHtml(caution) +
              "</div>"
            : "") +
          (index === 0 ? renderLeadMatchSnapshot(entry) : "") +
          "</div>" +
          '<div class="match-summary-pills">' +
          getShortlistSummary(entry) +
          "</div>" +
          '<div class="match-card-footer"><div class="match-card-action-block"><div class="match-card-action-label">Best next step</div><div class="match-card-action-title">' +
          escapeHtml(ctaLabel) +
          '</div><div class="match-card-action-copy">' +
          escapeHtml(actionCopy) +
          '</div><div class="outreach-card-actions">' +
          '<a href="' +
          escapeHtml(
            preferredRoute
              ? preferredRoute.href
              : "therapist.html?slug=" + encodeURIComponent(therapist.slug || ""),
          ) +
          '" class="btn-primary match-card-cta" data-match-primary-cta="' +
          escapeHtml(therapist.slug || "") +
          '" data-match-primary-route="' +
          escapeHtml(ctaLabel) +
          '"' +
          (preferredRoute && preferredRoute.external ? ' target="_blank" rel="noopener"' : "") +
          ">" +
          escapeHtml(ctaLabel) +
          '</a><button type="button" class="btn-secondary match-card-copy-btn" data-copy-entry-draft="' +
          escapeHtml(therapist.slug || "") +
          '">Copy first message</button></div></div></div>' +
          "</article>"
        );
      })
      .join("");

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
}

function safeRenderResults(entries, profile) {
  try {
    renderResults(entries, profile);
  } catch (error) {
    console.error("Fell back to primary match cards after richer match rendering failed.", error);
    renderPrimaryMatchCards(entries, profile);
    setActionState(
      true,
      "Your shortlist is ready. Some secondary sections did not finish rendering.",
    );
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
  renderFirstContactRecommendation(profile, primaryEntries);
  renderFallbackRecommendation(profile, primaryEntries);
  renderAdaptiveGuidance(profile, entries);
  renderShortlistQueue(entries);
  if (refs.feedbackBar) {
    refs.feedbackBar.hidden = false;
  }
  renderOutreachPanel(entries);
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
  persistEntriesToDirectoryShortlist(selected);
  window.history.replaceState({}, "", buildShortlistComparePath(selected));
  persistMatchRequest(null, selected);
  safeRenderResults(selected, null);
  setActionState(
    true,
    "You can compare these saved therapists or run the full intake for ranked recommendations.",
  );
  return true;
}

function resetForm() {
  var refs = getMatchShellRefs();
  var form = refs.form;
  form.reset();
  syncZipResolvedLabel("");
  syncMatchStartState();
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
