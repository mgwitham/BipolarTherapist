import { fetchPublicTherapists } from "./cms.js";
import launchProfileControls from "../data/import/launch-profile-controls.json";
import {
  buildMatchExplanation,
  getEditoriallyVerifiedOperationalCount,
  getMatchTier,
  getOperationalTrustSummary,
  getRecentAppliedSummary,
  getRecentConfirmationSummary,
  getTherapistMatchReadiness,
  buildUserMatchProfile,
  getTherapistMerchandisingQuality,
  rankTherapistsForUser,
} from "./matching-model.js";
import { getPublicResponsivenessSignal } from "./responsiveness-signal.js";
import {
  readFunnelEvents,
  summarizeAdaptiveSignals,
  trackFunnelEvent,
} from "./funnel-analytics.js";
import { getZipMarketStatus } from "./zip-lookup.js";

var therapists = [];
var latestProfile = null;
var latestEntries = [];
var latestLearningSignals = null;
var currentJourneyId = null;
var compareFocusSlug = "";
var activeShortcutContext = null;
var DIRECTORY_SHORTLIST_KEY = "bth_directory_shortlist_v1";
var SAVED_SHORTLIST_KEY = "bth_saved_match_shortlist_v1";
var MATCH_FEEDBACK_KEY = "bth_match_feedback_v1";
var CONCIERGE_REQUESTS_KEY = "bth_concierge_requests_v1";
var OUTREACH_OUTCOMES_KEY = "bth_outreach_outcomes_v1";
var activeSecondPassMode = "balanced";
var OUTREACH_OUTCOME_OPTIONS = [
  { value: "reached_out", label: "Reached out", tone: "positive" },
  { value: "heard_back", label: "Heard back", tone: "positive" },
  { value: "booked_consult", label: "Booked consult", tone: "positive" },
  { value: "good_fit_call", label: "Good fit call", tone: "positive" },
  { value: "insurance_mismatch", label: "Insurance mismatch", tone: "negative" },
  { value: "waitlist", label: "Hit a waitlist", tone: "negative" },
  { value: "no_response", label: "No response yet", tone: "negative" },
];
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
var SECOND_PASS_MODES = [
  {
    id: "reviewed",
    label: "Reviewed details",
    summary:
      "Second pass: lean harder toward profiles with stronger reviewed details and higher decision-readiness.",
  },
  {
    id: "speed",
    label: "Speed",
    summary: "Second pass: lean harder toward specialists who look easier to act on quickly.",
  },
  {
    id: "specialization",
    label: "Specialization",
    summary: "Second pass: lean harder toward bipolar-specific depth and specialization.",
  },
  {
    id: "followthrough",
    label: "Follow-through",
    summary: "Second pass: lean harder toward contact paths and follow-through potential.",
  },
];
var MATCH_PRIORITY_SLUGS = Array.isArray(launchProfileControls?.matchPrioritySlugs)
  ? launchProfileControls.matchPrioritySlugs
      .map(function (value) {
        return String(value || "").trim();
      })
      .filter(Boolean)
  : [];
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

function syncZipResolvedLabel(value) {
  var resolved = document.getElementById("matchZipResolved");
  if (!resolved) {
    return;
  }

  var zipStatus = getZipMarketStatus(value);
  if (!zipStatus.place) {
    resolved.textContent = "";
    resolved.classList.remove("is-visible");
    return;
  }

  resolved.textContent =
    zipStatus.status === "live" ? "- " + zipStatus.place.label : zipStatus.message;
  resolved.classList.add("is-visible");
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

function getSecondPassModeConfig(mode) {
  return SECOND_PASS_MODES.find(function (item) {
    return item.id === mode;
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

function renderMatchLaunchExplainer(entries, profile) {
  var root = document.getElementById("matchLaunchExplainer");
  if (!root) {
    return;
  }

  var list = Array.isArray(entries) ? entries : [];
  var hasRefinements = hasMeaningfulRefinements(profile);
  if (!list.length || hasRefinements) {
    root.textContent = "";
    return;
  }

  var prioritySet = new Set(MATCH_PRIORITY_SLUGS);
  var top = list[0];
  var second = list[1];
  var topIsPriority = top && top.therapist ? prioritySet.has(top.therapist.slug) : false;
  var closeCall =
    top &&
    second &&
    Math.abs(
      (Number(top.evaluation && top.evaluation.score) || 0) -
        (Number(second.evaluation && second.evaluation.score) || 0),
    ) <= 12;

  if (topIsPriority && closeCall) {
    root.textContent =
      "Because the top options were already close, this shortlist gave a light edge to a profile with especially strong reviewed details, decision-readiness, and contact clarity.";
    return;
  }

  root.textContent =
    "This shortlist is led mainly by your location, practical fit, bipolar-related fit, and the clearest next step.";
}

function renderSecondPassControls(profile, entries) {
  var bar = document.getElementById("matchRefineBar");
  var copy = document.getElementById("matchRefineCopy");
  var optionsRoot = document.getElementById("matchRefineOptions");
  var resetButton = document.getElementById("matchRefineReset");

  if (!bar || !copy || !optionsRoot || !resetButton) {
    return;
  }

  if (!profile || !Array.isArray(entries) || !entries.length) {
    bar.hidden = true;
    optionsRoot.innerHTML = "";
    resetButton.hidden = true;
    return;
  }

  bar.hidden = false;
  copy.textContent =
    activeSecondPassMode === "balanced"
      ? "The first pass stays balanced by default. Use a second pass only if you want the shortlist to lean more toward one specific priority."
      : (getSecondPassModeConfig(activeSecondPassMode) || {}).summary ||
        "This shortlist is leaning toward one specific second-pass priority.";

  optionsRoot.innerHTML = SECOND_PASS_MODES.map(function (mode) {
    return (
      '<button type="button" class="match-refine-option' +
      (mode.id === activeSecondPassMode ? " active" : "") +
      '" data-second-pass-mode="' +
      escapeHtml(mode.id) +
      '">' +
      escapeHtml(mode.label) +
      "</button>"
    );
  }).join("");

  resetButton.hidden = activeSecondPassMode === "balanced";

  optionsRoot.querySelectorAll("[data-second-pass-mode]").forEach(function (button) {
    button.addEventListener("click", function () {
      var nextMode = button.getAttribute("data-second-pass-mode") || "balanced";
      activeSecondPassMode = nextMode;
      latestEntries = rankEntriesForProfile(latestProfile);
      trackFunnelEvent("match_second_pass_refined", {
        mode: activeSecondPassMode,
        result_count: latestEntries.length,
        top_slug: latestEntries[0] ? latestEntries[0].therapist.slug : "",
      });
      renderResults(latestEntries, latestProfile);
    });
  });

  resetButton.onclick = function () {
    activeSecondPassMode = "balanced";
    latestEntries = rankEntriesForProfile(latestProfile);
    trackFunnelEvent("match_second_pass_refined", {
      mode: "balanced",
      result_count: latestEntries.length,
      top_slug: latestEntries[0] ? latestEntries[0].therapist.slug : "",
    });
    renderResults(latestEntries, latestProfile);
  };
}

function collectCheckedValues(form, name) {
  return Array.from(form.querySelectorAll('input[name="' + name + '"]:checked')).map(
    function (input) {
      return input.value;
    },
  );
}

function splitCommaSeparated(value) {
  return String(value || "")
    .split(",")
    .map(function (item) {
      return item.trim();
    })
    .filter(Boolean);
}

function normalizeLocationQuery(value) {
  return String(value || "").trim();
}

function deriveStateFromLocation(value) {
  var normalized = normalizeLocationQuery(value);
  if (!normalized) {
    return "";
  }

  var upper = normalized.toUpperCase();
  if (/^\d{5}$/.test(normalized)) {
    var zipStatus = getZipMarketStatus(normalized);
    return zipStatus.place ? zipStatus.place.state : "";
  }
  if (/^[A-Z]{2}$/.test(upper)) {
    return upper;
  }

  if (US_STATE_MAP[upper]) {
    return US_STATE_MAP[upper];
  }

  var cityMatch = therapists.find(function (therapist) {
    return (
      String(therapist.city || "")
        .trim()
        .toUpperCase() === upper
    );
  });
  if (cityMatch && cityMatch.state) {
    return String(cityMatch.state || "")
      .trim()
      .toUpperCase();
  }

  if (upper.indexOf("CALIFORNIA") !== -1) {
    return "CA";
  }

  var knownState = Object.keys(US_STATE_MAP).find(function (stateName) {
    return upper.indexOf(stateName) !== -1;
  });
  return knownState ? US_STATE_MAP[knownState] : "";
}

function getLocationIntent(profile) {
  if (!profile) {
    return null;
  }

  var raw = normalizeLocationQuery(profile.location_query || profile.care_state || "");
  if (!raw) {
    return null;
  }

  var upper = raw.toUpperCase();
  var isZipCode = /^\d{5}$/.test(raw);
  var cityMatch = therapists.find(function (therapist) {
    return (
      String(therapist.city || "")
        .trim()
        .toUpperCase() === upper
    );
  });
  var isStateOnly = /^[A-Z]{2}$/.test(upper) || Boolean(US_STATE_MAP[upper]);
  var mentionsTelehealth = upper.indexOf("TELEHEALTH") !== -1 || upper.indexOf("VIRTUAL") !== -1;

  if (isZipCode) {
    return {
      type: "zip",
      label: raw,
      shortLabel: raw,
      state: profile.care_state || "CA",
      telehealth: mentionsTelehealth,
    };
  }

  if (cityMatch) {
    return {
      type: "city",
      label: cityMatch.city + ", " + cityMatch.state,
      shortLabel: cityMatch.city,
      state: cityMatch.state,
      telehealth: mentionsTelehealth,
    };
  }

  if (mentionsTelehealth && profile.care_state) {
    return {
      type: "telehealth",
      label: raw,
      shortLabel: raw,
      state: profile.care_state,
      telehealth: true,
    };
  }

  if (isStateOnly || upper.indexOf("CALIFORNIA") !== -1) {
    return {
      type: "state",
      label: raw,
      shortLabel: raw,
      state: profile.care_state,
      telehealth: true,
    };
  }

  return {
    type: "regional",
    label: raw,
    shortLabel: raw,
    state: profile.care_state,
    telehealth: mentionsTelehealth,
  };
}

function buildLocationAwareSummary(profile, hasRefinements) {
  var intent = getLocationIntent(profile);
  if (!intent) {
    return hasRefinements
      ? "We balance care constraints first, then bipolar-specific fit and reviewed details."
      : "Start with location, then add optional refinements only if you want a tighter shortlist.";
  }

  if (!hasRefinements && intent.type === "city") {
    return (
      "We anchored this shortlist to " +
      intent.shortLabel +
      " first, then widened carefully to bipolar fit, reviewed details, and the clearest next step. Add refinements if you want a narrower result set."
    );
  }

  if (!hasRefinements && intent.type === "zip") {
    return (
      "We anchored this shortlist to ZIP code " +
      intent.shortLabel +
      " first, then widened carefully to bipolar fit, reviewed details, and the clearest next step. Add refinements if you want a narrower result set."
    );
  }

  if (!hasRefinements && (intent.type === "state" || intent.type === "telehealth")) {
    return (
      "We treated this as a broader " +
      (intent.state ? intent.state + " " : "") +
      "telehealth-style search, then ranked for bipolar fit, reviewed details, and practical next steps. Add refinements if you want a tighter shortlist."
    );
  }

  if (!hasRefinements) {
    return "We anchored this shortlist to your location first, then balanced bipolar fit, reviewed details, and the clearest next step. Add refinements if you want a narrower result set.";
  }

  return "We balance care constraints first, then bipolar-specific fit, reviewed details, and the next move that seems most usable.";
}

function buildLocationAwareResultsMeta(profile, entries, hasRefinements) {
  var intent = getLocationIntent(profile);
  var count = Math.min((entries || []).length, 3);
  var requestedZip = getRequestedZip(profile);
  var zipSuggestions = getClosestZipSuggestions(profile, entries);
  if (!intent) {
    return hasRefinements
      ? "Showing " + count + " ranked match" + (count > 1 ? "es" : "") + "."
      : "Showing " +
          count +
          " strong location-based option" +
          (count > 1 ? "s" : "") +
          ". Add refinements if you want a narrower shortlist.";
  }

  if (requestedZip) {
    var exactZipMatch = (entries || []).some(function (entry) {
      return getTherapistZipValue(entry && entry.therapist) === requestedZip;
    });

    if (!exactZipMatch && zipSuggestions.length) {
      return (
        "No exact reviewed profile is live in ZIP " +
        requestedZip +
        " yet. Showing the nearest reviewed ZIPs instead: " +
        zipSuggestions
          .map(function (item) {
            return item.zip;
          })
          .join(", ") +
        "."
      );
    }
  }

  if (!hasRefinements && intent.type === "city") {
    return (
      "Showing " +
      count +
      " strong option" +
      (count > 1 ? "s" : "") +
      " anchored around " +
      intent.shortLabel +
      ". Add refinements if you want a narrower shortlist."
    );
  }

  if (!hasRefinements && (intent.type === "state" || intent.type === "telehealth")) {
    return (
      "Showing " +
      count +
      " broad " +
      (intent.state ? intent.state + " " : "") +
      "telehealth-friendly option" +
      (count > 1 ? "s" : "") +
      ". Add refinements if you want a narrower shortlist."
    );
  }

  return "Showing " + count + " ranked match" + (count > 1 ? "es" : "") + ".";
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

function renderTags(values) {
  return (values || [])
    .filter(Boolean)
    .map(function (value) {
      return '<span class="match-summary-pill">' + escapeHtml(value) + "</span>";
    })
    .join("");
}

function getResponsivenessSignalLabel(therapist) {
  var signal = getPublicResponsivenessSignal(therapist);
  return signal ? signal.label : "";
}

function getResponsivenessSignalNote(therapist) {
  var signal = getPublicResponsivenessSignal(therapist);
  return signal ? signal.note : "";
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

function syncMatchCareSelectTrigger() {
  var select = document.getElementById("care_intent");
  var trigger = document.querySelector("[data-match-custom-select] .custom-select-trigger");
  var options = Array.from(
    document.querySelectorAll("[data-match-custom-select] .custom-select-option"),
  );

  if (!select || !trigger) {
    return;
  }

  var selectedValue = String(select.value || "Either");
  var selectedOption = options.find(function (option) {
    return option.dataset.value === selectedValue;
  });

  trigger.textContent = selectedOption
    ? selectedOption.textContent.trim()
    : "What type of care do you want?";

  options.forEach(function (option) {
    option.setAttribute("aria-selected", String(option.dataset.value === selectedValue));
  });
}

function initMatchCareDropdown() {
  var selectRoot = document.querySelector("[data-match-custom-select]");
  var select = document.getElementById("care_intent");

  if (!selectRoot || !select) {
    return;
  }

  var field = selectRoot.closest(".search-field--prompt");
  var trigger = selectRoot.querySelector(".custom-select-trigger");
  var options = Array.from(selectRoot.querySelectorAll(".custom-select-option"));

  function setOpenState(isOpen) {
    selectRoot.classList.toggle("is-open", isOpen);
    if (field) {
      field.classList.toggle("is-open", isOpen);
    }
    if (trigger) {
      trigger.setAttribute("aria-expanded", String(isOpen));
    }
  }

  function closeMenu() {
    setOpenState(false);
  }

  function setSelectedValue(value) {
    select.value = value || "Either";
    syncMatchCareSelectTrigger();
  }

  syncMatchCareSelectTrigger();

  if (trigger) {
    trigger.addEventListener("click", function () {
      setOpenState(!selectRoot.classList.contains("is-open"));
    });

    trigger.addEventListener("keydown", function (event) {
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setOpenState(true);
        if (options[0]) {
          options[0].focus();
        }
      } else if (event.key === "Escape") {
        closeMenu();
      }
    });
  }

  options.forEach(function (option, index) {
    option.addEventListener("click", function () {
      setSelectedValue(option.dataset.value || "Either");
      closeMenu();
      if (trigger) {
        trigger.focus();
      }
    });

    option.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
        if (trigger) {
          trigger.focus();
        }
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        (options[index + 1] || options[0]).focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        (options[index - 1] || options[options.length - 1]).focus();
      }
    });
  });

  select.addEventListener("change", syncMatchCareSelectTrigger);

  document.addEventListener("click", function (event) {
    if (!selectRoot.contains(event.target)) {
      closeMenu();
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      closeMenu();
    }
  });
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
  if (
    (profile && profile.urgency && profile.urgency !== "Flexible") ||
    segments.some(function (segment) {
      return segment.indexOf("urgency:") === 0;
    })
  ) {
    return "Lead with availability and next-step timing in your first message so you can tell quickly whether this path can move fast enough.";
  }
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
  if (profile && profile.care_format && profile.care_format !== "Either") {
    return "Name your preferred format in the first outreach so you can avoid losing time on the wrong care setup.";
  }
  return "";
}

function getSegmentAwareDraftAsk(profile, recommendation) {
  var evaluation = recommendation && recommendation.entry ? recommendation.entry.evaluation : null;
  var segments =
    evaluation && Array.isArray(evaluation.active_segments) ? evaluation.active_segments : [];

  if (
    (profile && profile.urgency && profile.urgency !== "Flexible") ||
    segments.some(function (segment) {
      return segment.indexOf("urgency:") === 0;
    })
  ) {
    return (
      "Could you let me know your current availability, how quickly a first step could happen, and whether it makes sense to begin with " +
      recommendation.route.toLowerCase() +
      "?"
    );
  }
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
  if (profile && profile.care_format && profile.care_format !== "Either") {
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

function getEntrySegmentCue(profile, entry) {
  return getSegmentAwareRecommendationCue(
    profile,
    entry && entry.evaluation ? entry.evaluation : null,
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
    profile && profile.care_intent && profile.care_intent !== "Either"
      ? "I am primarily looking for " + profile.care_intent.toLowerCase() + "."
      : "",
    profile && profile.care_format && profile.care_format !== "Either"
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
    entry.evaluation && entry.evaluation.shortlist_priority
      ? entry.evaluation.shortlist_priority
      : "",
    entry.evaluation && entry.evaluation.shortlist_note ? "Note saved" : "",
    therapist.verification_status === "editorially_verified" ? "Verified" : "",
    therapist.bipolar_years_experience
      ? therapist.bipolar_years_experience + " yrs bipolar care"
      : "",
    getResponsivenessSignalLabel(therapist),
    therapist.estimated_wait_time || "",
    therapist.medication_management ? "Medication management" : "",
  ].filter(Boolean);

  return renderTags(pills);
}

function buildMatchStandoutCopy(entry) {
  var therapist = entry && entry.therapist ? entry.therapist : {};
  var reasons = [];

  if (therapist.verification_status === "editorially_verified") {
    reasons.push("editorial review is already in place");
  }
  if (getEditoriallyVerifiedOperationalCount(therapist) >= 2) {
    reasons.push("multiple practical details are editor-verified");
  }
  if (Number(therapist.bipolar_years_experience || 0) >= 8) {
    reasons.push("bipolar-specific experience is unusually clear");
  }
  if (therapist.medication_management) {
    reasons.push("medication support is part of the care path");
  }
  if (therapist.accepting_new_patients && therapist.estimated_wait_time) {
    reasons.push("the availability context is clearer than usual");
  }

  if (!reasons.length) {
    return "This option is worth a closer look because the profile gives a clearer-than-usual picture of fit and next-step logistics.";
  }

  return "This option stands out because " + reasons.slice(0, 2).join(" and ") + ".";
}

function buildMatchTrustSnapshot(entry) {
  var therapist = entry && entry.therapist ? entry.therapist : {};
  var recentApplied = getRecentAppliedSummary(therapist);
  var recentConfirmation = getRecentConfirmationSummary(therapist);
  var operationalTrust = getOperationalTrustSummary(therapist);
  var readiness = getTherapistMatchReadiness(therapist);
  var quality = getTherapistMerchandisingQuality(therapist);

  if (recentApplied) {
    return recentApplied.label + ". " + recentApplied.note;
  }
  if (recentConfirmation) {
    return recentConfirmation.label + ". " + recentConfirmation.note;
  }
  if (operationalTrust) {
    return (
      operationalTrust +
      " " +
      (readiness.score >= 85 || quality.score >= 90
        ? "Overall, this looks more decision-ready than average."
        : "A few details may still be worth confirming directly.")
    );
  }
  return "Core fit details are present, but some practical reviewed details may still need direct confirmation.";
}

function buildMatchReachabilitySnapshot(entry) {
  var therapist = entry && entry.therapist ? entry.therapist : {};
  var contactReadiness = getContactReadiness(entry);
  var route = contactReadiness ? contactReadiness.route : "review the full profile first";

  if (therapist.accepting_new_patients && therapist.estimated_wait_time) {
    return (
      "Appears reachable, and a recent availability note suggests " +
      therapist.estimated_wait_time.toLowerCase() +
      ". The clearest next move is to start with " +
      route.toLowerCase() +
      "."
    );
  }
  if (therapist.accepting_new_patients) {
    return (
      "Appears to be accepting new patients. The clearest next move is to start with " +
      route.toLowerCase() +
      "."
    );
  }
  if (therapist.estimated_wait_time) {
    return (
      "A recent availability note suggests " +
      therapist.estimated_wait_time.toLowerCase() +
      ", but current openings should still be confirmed directly. The clearest next move is to start with " +
      route.toLowerCase() +
      "."
    );
  }
  return "The contact path is clear, but live timing still needs direct confirmation before you rely on it.";
}

function buildPublicRankingCopy(entry) {
  var breakdown = entry && entry.evaluation ? entry.evaluation.score_breakdown || {} : {};
  var weighted = [
    { label: "practical fit", value: Number(breakdown.practical || 0) || 0 },
    { label: "bipolar-specific fit", value: Number(breakdown.clinical || 0) || 0 },
    { label: "reviewed details", value: Number(breakdown.trust || 0) || 0 },
    { label: "access and follow-through", value: Number(breakdown.access || 0) || 0 },
  ]
    .sort(function (a, b) {
      return b.value - a.value;
    })
    .filter(function (item) {
      return item.value > 0;
    });

  var topReasons = weighted.slice(0, 2).map(function (item) {
    return item.label;
  });
  var uncertainty = Number(breakdown.uncertainty || 0) || 0;

  if (!topReasons.length) {
    return "This result rose because the overall fit looked stronger than the alternatives, while still keeping practical unknowns in view.";
  }

  return (
    "This result rose mainly because " +
    topReasons.join(" and ") +
    " looked stronger here." +
    (uncertainty > 0
      ? " We still keep unresolved details in view instead of pretending every field is fully settled."
      : "")
  );
}

function buildCompareModeRankingCopy(entry) {
  var therapist = entry && entry.therapist ? entry.therapist : {};
  return (
    "This comparison view is not trying to invent a full ranked score. Use the trust snapshot, reachability, and contact readiness to decide whether " +
    (therapist.name || "this option") +
    " feels like the clearest first contact or a better backup path."
  );
}

function renderCompareValue(value) {
  if (Array.isArray(value)) {
    return value.length
      ? escapeHtml(value.join(", "))
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

function getContactPlanRole(plan, slug) {
  if (!plan || !slug) {
    return "";
  }
  if (plan.first && plan.first.therapist && plan.first.therapist.slug === slug) {
    return "Contact first";
  }
  if (plan.fallback && plan.fallback.therapist && plan.fallback.therapist.slug === slug) {
    return "Backup if stalled";
  }
  return "Keep in reserve";
}

function getContactPlanNextMove(plan, slug) {
  if (!plan || !slug) {
    return "";
  }
  if (plan.first && plan.first.therapist && plan.first.therapist.slug === slug) {
    return (
      "Start here first. If this path stalls, pivots to " +
      (plan.fallback && plan.fallback.therapist
        ? plan.fallback.therapist.name
        : "your backup option") +
      " around " +
      plan.pivotAtLabel +
      "."
    );
  }
  if (plan.fallback && plan.fallback.therapist && plan.fallback.therapist.slug === slug) {
    return "Hold this as your backup. Move here if the first outreach hits no response, waitlist, or insurance friction.";
  }
  return "Keep this one as a third option if the first two paths do not move cleanly.";
}

function getCompareDecisionLenses(entries, profile) {
  var shortlist = (entries || []).slice(0, PRIMARY_SHORTLIST_LIMIT);
  var lensesBySlug = {};
  var shortcutInfluence = getShortcutInfluence(profile, shortlist);

  function buildLensLabel(baseLabel, signal) {
    if (!signal || !signal.preference) {
      return baseLabel;
    }

    if (signal.preference.strong || signal.preference.weak) {
      return (
        baseLabel +
        " (" +
        signal.preference.strong +
        " strong / " +
        signal.preference.weak +
        " friction)"
      );
    }

    return baseLabel;
  }

  shortlist.forEach(function (entry, index) {
    if (!entry || !entry.therapist) {
      return;
    }
    lensesBySlug[entry.therapist.slug] = [];
    if (index === 0) {
      lensesBySlug[entry.therapist.slug].push("Top overall fit");
    }
  });

  getEditorialShortcuts(shortlist, profile).forEach(function (lane) {
    if (!lane || !lane.entry || !lane.entry.therapist) {
      return;
    }

    var slug = lane.entry.therapist.slug;
    if (!lensesBySlug[slug]) {
      lensesBySlug[slug] = [];
    }

    if (lane.type === "fastest_next_step") {
      lensesBySlug[slug].push(buildLensLabel("Speed-first", shortcutInfluence[slug]));
    } else if (lane.type === "strongest_therapy_option") {
      lensesBySlug[slug].push(buildLensLabel("Therapy-first", shortcutInfluence[slug]));
    } else if (lane.type === "strongest_psychiatry_option") {
      lensesBySlug[slug].push(buildLensLabel("Psychiatry-first", shortcutInfluence[slug]));
    }
  });

  return lensesBySlug;
}

function renderComparison(entries) {
  var root = document.getElementById("matchCompare");
  var topEntries = entries.slice(0, PRIMARY_SHORTLIST_LIMIT);
  var decisionLenses = getCompareDecisionLenses(entries, latestProfile);
  var contactPlan = buildContactOrderPlan(latestProfile, entries);

  if (compareFocusSlug) {
    topEntries = topEntries.slice().sort(function (a, b) {
      return (
        Number(b.therapist.slug === compareFocusSlug) -
        Number(a.therapist.slug === compareFocusSlug)
      );
    });
  }

  if (topEntries.length < 2) {
    root.innerHTML = "";
    return;
  }

  var rows = [
    {
      label: "Decision logic",
      getValue: function (therapist) {
        return decisionLenses[therapist.slug] || [];
      },
    },
    {
      label: "Contact plan role",
      getValue: function (therapist) {
        return getContactPlanRole(contactPlan, therapist.slug);
      },
    },
    {
      label: "Next move if you choose this",
      getValue: function (therapist) {
        return getContactPlanNextMove(contactPlan, therapist.slug);
      },
    },
    {
      label: "Care format",
      getValue: function (therapist) {
        return [
          therapist.accepts_telehealth ? "Telehealth" : "",
          therapist.accepts_in_person ? "In-person" : "",
        ]
          .filter(Boolean)
          .join(" / ");
      },
    },
    {
      label: "Medication management",
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
      label: "Typical wait time",
      getValue: function (therapist) {
        return therapist.estimated_wait_time;
      },
    },
    {
      label: "Best way to reach them",
      getValue: function (therapist) {
        if (therapist.preferred_contact_method === "booking" && therapist.booking_url) {
          return "Booking link";
        }
        if (therapist.preferred_contact_method === "website" && therapist.website) {
          return "Website intake";
        }
        if (therapist.preferred_contact_method === "phone" && therapist.phone) {
          return "Phone";
        }
        if (
          therapist.preferred_contact_method === "email" &&
          therapist.email &&
          therapist.email !== "contact@example.com"
        ) {
          return "Email";
        }
        if (therapist.booking_url) {
          return "Booking link";
        }
        if (therapist.website) {
          return "Website";
        }
        if (therapist.phone) {
          return "Phone";
        }
        if (therapist.email && therapist.email !== "contact@example.com") {
          return "Email";
        }
        return "";
      },
    },
    {
      label: "Session fees",
      getValue: function (therapist) {
        if (therapist.session_fee_min || therapist.session_fee_max) {
          return (
            "$" +
            (therapist.session_fee_min || "") +
            (therapist.session_fee_max ? "–$" + therapist.session_fee_max : "") +
            "/session"
          );
        }
        return therapist.sliding_scale ? "Sliding scale available" : "";
      },
    },
    {
      label: "Insurance",
      getValue: function (therapist) {
        return (therapist.insurance_accepted || []).slice(0, 4);
      },
    },
    {
      label: "Languages",
      getValue: function (therapist) {
        return therapist.languages || [];
      },
    },
    {
      label: "Contact responsiveness",
      getValue: function (therapist) {
        return getResponsivenessSignalLabel(therapist) || "";
      },
    },
    {
      label: "Trust signal",
      getValue: function (therapist) {
        return therapist.verification_status === "editorially_verified"
          ? "Editorially verified"
          : "Profile under review";
      },
    },
  ];

  var headerCells = ['<div class="compare-cell label header">Compare</div>']
    .concat(
      topEntries.map(function (entry, index) {
        return (
          '<div class="compare-cell header"><div class="compare-name">' +
          escapeHtml(entry.therapist.name) +
          '</div><div class="compare-sub">' +
          escapeHtml(
            entry.evaluation && entry.evaluation.shortlist_priority
              ? entry.evaluation.shortlist_priority
              : "Top " + (index + 1) + " match",
          ) +
          "</div></div>"
        );
      }),
    )
    .join("");

  var bodyCells = rows
    .map(function (row) {
      return (
        '<div class="compare-cell label">' +
        escapeHtml(row.label) +
        "</div>" +
        topEntries
          .map(function (entry) {
            return (
              '<div class="compare-cell">' +
              renderCompareValue(row.getValue(entry.therapist)) +
              "</div>"
            );
          })
          .join("")
      );
    })
    .join("");

  root.innerHTML =
    '<section class="match-compare"><div class="match-compare-header"><h3>Compare the shortlist side by side</h3><p>Use this to narrow down the top options before opening full profiles.</p>' +
    (contactPlan && contactPlan.first
      ? '<p class="compare-focus-note" style="margin-top:0.55rem">' +
        escapeHtml(
          "If you are only contacting one person first, start with " +
            contactPlan.first.therapist.name +
            (contactPlan.fallback && contactPlan.fallback.therapist
              ? " and hold " + contactPlan.fallback.therapist.name + " as backup."
              : "."),
        ) +
        "</p>"
      : "") +
    (compareFocusSlug
      ? '<div class="compare-focus-note">Focused on: ' +
        escapeHtml(
          (
            topEntries.find(function (entry) {
              return entry.therapist.slug === compareFocusSlug;
            }) || topEntries[0]
          ).therapist.name,
        ) +
        "</div>"
      : "") +
    '</div><div class="compare-grid">' +
    headerCells +
    bodyCells +
    "</div></section>";

  triggerMotion(root, "motion-enter");
}

function getWaitPriority(value) {
  var wait = String(value || "");
  if (!wait) return 50;
  if (wait === "Immediate availability") return 0;
  if (wait === "Within 1 week") return 1;
  if (wait === "Within 2 weeks") return 2;
  if (wait === "2-4 weeks") return 3;
  if (wait === "1-2 months") return 4;
  if (wait === "Waitlist only") return 5;
  return 6;
}

function getEditorialShortcuts(entries, profile) {
  var shortlist = (entries || []).slice(0, PRIMARY_SHORTLIST_LIMIT);
  var shortcutLearningMap = buildShortcutLearningMap(readStoredFeedback(), readOutreachOutcomes());
  var psychiatry = shortlist
    .filter(function (entry) {
      var therapist = entry.therapist || {};
      return (
        therapist.medication_management ||
        /psychiatrist|psychiatric|pmhnp|np|md/i.test(
          String((therapist.title || "") + " " + (therapist.credentials || "")),
        )
      );
    })
    .sort(function (a, b) {
      return (
        getTherapistMerchandisingQuality(b.therapist).score -
        getTherapistMerchandisingQuality(a.therapist).score
      );
    })[0];

  var therapy = shortlist
    .filter(function (entry) {
      return !entry.therapist.medication_management;
    })
    .sort(function (a, b) {
      return (
        getTherapistMerchandisingQuality(b.therapist).score -
        getTherapistMerchandisingQuality(a.therapist).score
      );
    })[0];

  var fastest = shortlist.slice().sort(function (a, b) {
    return (
      getWaitPriority(a.therapist.estimated_wait_time) -
        getWaitPriority(b.therapist.estimated_wait_time) ||
      getTherapistMerchandisingQuality(b.therapist).score -
        getTherapistMerchandisingQuality(a.therapist).score
    );
  })[0];

  return [
    {
      title: "Strongest psychiatry option",
      type: "strongest_psychiatry_option",
      entry: psychiatry,
      copy: "Best when medication support or psychiatry coordination is part of the decision.",
    },
    {
      title: "Strongest therapy option",
      type: "strongest_therapy_option",
      entry: therapy,
      copy: "Best when you want a therapy-first option with strong bipolar-specific trust and detail.",
    },
    {
      title: "Fastest next step",
      type: "fastest_next_step",
      entry: fastest,
      copy: "Best when speed, availability, and a lower-friction first move matter most.",
    },
  ]
    .filter(function (item) {
      return Boolean(item.entry);
    })
    .map(function (item) {
      item.preference = getShortcutPreference(profile, item.type, shortcutLearningMap);
      return item;
    })
    .sort(function (a, b) {
      return (
        b.preference.score - a.preference.score ||
        getTherapistMerchandisingQuality(b.entry.therapist).score -
          getTherapistMerchandisingQuality(a.entry.therapist).score ||
        a.title.localeCompare(b.title)
      );
    });
}

function renderEditorialShortcuts(entries, profile) {
  if (!(entries || []).length) {
    return "";
  }

  return (
    '<section class="match-editorial"><div class="match-editorial-header"><h3>Quick ways to orient this shortlist</h3><p>These are editorial shortcuts through the same top matches, not a separate ranking system.</p></div><div class="match-editorial-grid">' +
    getEditorialShortcuts(entries, profile)
      .map(function (lane) {
        return (
          '<div class="match-editorial-card"><div class="match-editorial-title">' +
          escapeHtml(lane.title) +
          '</div><div class="match-editorial-name">' +
          escapeHtml(lane.entry.therapist.name) +
          '</div><div class="match-editorial-copy">' +
          escapeHtml(lane.copy) +
          " " +
          escapeHtml(buildMatchExplanation(lane.entry)) +
          (lane.preference && lane.preference.score
            ? '<div class="match-editorial-note">Similar users have used this shortcut ' +
              (lane.preference.draft + lane.preference.compare) +
              " time" +
              (lane.preference.draft + lane.preference.compare > 1 ? "s" : "") +
              (lane.preference.strong || lane.preference.weak
                ? ", with " +
                  lane.preference.strong +
                  " strong outcome" +
                  (lane.preference.strong === 1 ? "" : "s") +
                  " and " +
                  lane.preference.weak +
                  " friction signal" +
                  (lane.preference.weak === 1 ? "" : "s")
                : "") +
              ".</div>"
            : "") +
          '</div><div class="match-editorial-actions"><button type="button" class="btn-secondary shortcut-draft-btn" data-shortcut-draft="' +
          escapeHtml(lane.entry.therapist.slug) +
          '" data-shortcut-type="' +
          escapeHtml(lane.type) +
          '">Copy tailored draft</button><button type="button" class="btn-secondary shortcut-compare-btn" data-shortcut-compare="' +
          escapeHtml(lane.entry.therapist.slug) +
          '" data-shortcut-type="' +
          escapeHtml(lane.type) +
          '">Focus compare</button></div><a href="therapist.html?slug=' +
          encodeURIComponent(lane.entry.therapist.slug) +
          '" class="match-editorial-link">Open profile →</a></div>'
        );
      })
      .join("") +
    "</div></section>"
  );
}

function buildRequestSummary(profile) {
  var hasRefinements = hasMeaningfulRefinements(profile);
  var summary = [
    profile.location_query ? "Location: " + profile.location_query : "",
    !profile.location_query && profile.care_state ? "State: " + profile.care_state : "",
    profile.care_format && profile.care_format !== "Either" ? "Format: " + profile.care_format : "",
    profile.care_intent && profile.care_intent !== "Either"
      ? "Looking for: " + profile.care_intent
      : "",
    profile.needs_medication_management === "Yes" ? "Needs medication management" : "",
    profile.insurance ? "Insurance: " + profile.insurance : "",
    profile.urgency && profile.urgency !== "Flexible" ? "Timeline: " + profile.urgency : "",
    profile.priority_mode && profile.priority_mode !== "Best overall fit"
      ? "Priority: " + profile.priority_mode
      : "",
  ].filter(Boolean);

  if (summary.length === 1 && profile.location_query && !hasRefinements) {
    return (
      "Location: " +
      profile.location_query +
      " • Broad shortlist with optional refinements still open."
    );
  }

  return summary.length ? summary.join(" • ") : "Shortlist based on your current answers.";
}

function hasMeaningfulRefinements(profile) {
  if (!profile) {
    return false;
  }

  return Boolean(
    (profile.care_format && profile.care_format !== "Either") ||
    (profile.care_intent && profile.care_intent !== "Either") ||
    (profile.needs_medication_management &&
      profile.needs_medication_management !== "Open to either") ||
    profile.insurance ||
    profile.budget_max ||
    (profile.urgency && profile.urgency !== "Flexible") ||
    (profile.priority_mode && profile.priority_mode !== "Best overall fit") ||
    (profile.bipolar_focus && profile.bipolar_focus.length) ||
    (profile.preferred_modalities && profile.preferred_modalities.length) ||
    (profile.population_fit && profile.population_fit.length) ||
    (profile.language_preferences && profile.language_preferences.length),
  );
}

function readCurrentIntakeProfile() {
  var form = document.getElementById("matchForm");
  if (!form) {
    return null;
  }
  var locationQuery = normalizeLocationQuery(form.elements.location_query.value);
  var profile = buildUserMatchProfile({
    care_state: deriveStateFromLocation(locationQuery),
    care_format: form.elements.care_format.value,
    care_intent: form.elements.care_intent.value,
    needs_medication_management: form.elements.needs_medication_management.value,
    insurance: form.elements.insurance.value,
    budget_max: form.elements.budget_max.value,
    urgency: form.elements.urgency.value,
    priority_mode: form.elements.priority_mode.value,
    bipolar_focus: collectCheckedValues(form, "bipolar_focus"),
    preferred_modalities: collectCheckedValues(form, "preferred_modalities"),
    population_fit: collectCheckedValues(form, "population_fit"),
    language_preferences: splitCommaSeparated(form.elements.language_preferences.value),
  });
  profile.location_query = locationQuery;
  return profile;
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

  if (normalized.urgency && normalized.urgency !== "Flexible") {
    add(
      "urgency",
      "Tighten urgency carefully",
      "For time-sensitive searches, the timing window tends to change ranking quickly, especially when availability and fallback speed matter.",
    );
  } else if (patterns.availability >= 2) {
    add(
      "urgency",
      "Urgency often drives better matches",
      "Similar users often get clearer recommendations once they signal whether this is flexible, soon, or urgent.",
    );
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

  if (profile.care_intent === "Either") {
    addScenario(
      "care_intent",
      "If you narrow to therapy only",
      buildProfileVariant(profile, { care_intent: "Therapy" }),
      function (nextTop, changed) {
        return changed
          ? nextTop + " would likely become the top therapy-first option."
          : "The same top option would likely remain, which suggests the current leader is already strong for therapy.";
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

function recordShortcutInteraction(shortcutType, action, therapistSlug) {
  activeShortcutContext = {
    shortcut_type: shortcutType,
    action: action,
    therapist_slug: therapistSlug || "",
    created_at: new Date().toISOString(),
  };
  var feedback = readStoredFeedback();
  feedback.push({
    type: "shortcut_interaction",
    shortcut_type: activeShortcutContext.shortcut_type,
    action: activeShortcutContext.action,
    therapist_slug: activeShortcutContext.therapist_slug,
    created_at: activeShortcutContext.created_at,
    context: {
      profile: latestProfile,
      therapist_slugs: latestEntries.slice(0, SHORTLIST_QUEUE_LIMIT).map(function (entry) {
        return entry.therapist.slug;
      }),
    },
  });
  writeStoredFeedback(feedback);
  renderFeedbackInsights();
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

  if (normalized.care_format && normalized.care_format !== "Either") {
    segments.push("format:" + normalized.care_format.toLowerCase());
  }
  if (normalized.care_intent && normalized.care_intent !== "Either") {
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
  if (normalized.urgency && normalized.urgency !== "Flexible") {
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
  var lanes = getEditorialShortcuts(entries, profile);
  var bySlug = {};

  lanes.forEach(function (lane, index) {
    if (!lane || !lane.entry || !lane.entry.therapist) {
      return;
    }

    bySlug[lane.entry.therapist.slug] = {
      type: lane.type,
      title: lane.title,
      rank: index + 1,
      preference: lane.preference || { score: 0, strong: 0, weak: 0, draft: 0, compare: 0 },
    };
  });

  return bySlug;
}

function getShortcutInfluenceCopy(signal) {
  if (!signal) {
    return "";
  }

  var title = String(signal.title || "shortcut path").toLowerCase();
  if (
    (signal.preference && signal.preference.strong > 0) ||
    (signal.preference && signal.preference.weak > 0)
  ) {
    return (
      "This therapist is also being reinforced by the " +
      title +
      " path for similar users, with " +
      signal.preference.strong +
      " strong outcome" +
      (signal.preference.strong === 1 ? "" : "s") +
      " and " +
      signal.preference.weak +
      " friction signal" +
      (signal.preference.weak === 1 ? "" : "s") +
      "."
    );
  }

  return "This therapist also aligns with the " + title + " path for similar users.";
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
  if (!targetUrgency || targetUrgency === "Flexible") {
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
    root.style.display = "none";
    return;
  }
  root.style.display = "";
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

function recordTherapistFeedback(slug, value) {
  if (!latestProfile || !latestEntries.length) {
    return;
  }

  saveFeedback({
    type: "therapist_feedback",
    therapist_slug: slug,
    value: value,
    reasons: value === "negative" ? getSelectedReasonValues(slug) : [],
    context: buildFeedbackContext(),
  });

  document.querySelectorAll('[data-feedback-slug="' + slug + '"]').forEach(function (button) {
    button.classList.remove("active-positive", "active-negative");
    if (button.getAttribute("data-feedback-value") === value) {
      button.classList.add(value === "positive" ? "active-positive" : "active-negative");
    }
  });
  setReasonGroupVisibility(slug, value === "negative");

  document.getElementById("feedbackStatus").textContent =
    "Saved feedback for " +
    latestEntries
      .map(function (entry) {
        return entry.therapist;
      })
      .find(function (therapist) {
        return therapist.slug === slug;
      }).name +
    ".";
  latestEntries = rankEntriesForProfile(latestProfile);
  renderResults(latestEntries, latestProfile);
  renderFeedbackInsights();
}

function setActionState(enabled, message) {
  ["saveShortlist", "copyShareLink", "emailShortlist", "requestHelp"].forEach(function (id) {
    document.getElementById(id).disabled = !enabled;
  });
  if (message) {
    var status = document.getElementById("matchActionStatus");
    status.textContent = message;
    status.classList.remove("motion-pulse");
    void status.offsetWidth;
    status.classList.add("motion-pulse");
  }
}

function buildEmailShortlistBody(entries, profile) {
  var requestSummary = profile
    ? buildRequestSummary(profile)
    : "Saved shortlist from BipolarTherapyHub";
  var primaryEntries = (entries || []).slice(0, PRIMARY_SHORTLIST_LIMIT);
  var reserveEntries = (entries || []).slice(PRIMARY_SHORTLIST_LIMIT, SHORTLIST_QUEUE_LIMIT);
  var lines = [
    "Here is your BipolarTherapyHub shortlist.",
    "",
    "Search summary:",
    requestSummary,
    "",
    "Top matches:",
  ];

  primaryEntries.forEach(function (entry, index) {
    var therapist = entry.therapist;
    var bestRoute = getPreferredOutreach(entry);
    var routeLabel = bestRoute ? bestRoute.label : "Review profile";
    var planNote = getContactPlanNextMove(
      buildContactOrderPlan(profile, primaryEntries),
      therapist.slug,
    );
    lines.push(
      [
        index + 1 + ". " + therapist.name,
        therapist.credentials ? therapist.credentials : "",
        therapist.city && therapist.state ? therapist.city + ", " + therapist.state : "",
        buildMatchStandoutCopy(entry),
        "Best route: " + routeLabel,
        planNote ? "Next move: " + planNote : "",
        "Profile: " +
          window.location.origin +
          "/therapist.html?slug=" +
          encodeURIComponent(therapist.slug),
      ]
        .filter(Boolean)
        .join(" — "),
    );
  });

  if (reserveEntries.length) {
    lines.push("");
    lines.push("Keep in reserve:");
    reserveEntries.forEach(function (entry, index) {
      lines.push(
        PRIMARY_SHORTLIST_LIMIT +
          index +
          1 +
          ". " +
          entry.therapist.name +
          " — " +
          buildQueueReserveCopy(entry),
      );
    });
  }

  lines.push("");
  lines.push("Open this shortlist:");
  lines.push(window.location.href);

  return lines.join("\n");
}

function openEmailShortlist() {
  if (!latestEntries.length) {
    return;
  }

  var subject = "My BipolarTherapyHub shortlist";
  var body = buildEmailShortlistBody(latestEntries, latestProfile);
  trackFunnelEvent("match_shortlist_emailed", {
    result_count: latestEntries.length,
    top_slug: latestEntries[0] ? latestEntries[0].therapist.slug : "",
    strategy: buildAdaptiveStrategySnapshot(latestProfile),
  });
  window.location.href =
    "mailto:?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
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

function getVisibleStrategySegments(profile) {
  return buildLearningSegments(profile).filter(function (segment) {
    return segment !== "all";
  });
}

function getSegmentAudienceCopy(profile) {
  var segments = getVisibleStrategySegments(profile);
  if (!segments.length) {
    return "searches like this";
  }

  if (
    segments.some(function (segment) {
      return segment.indexOf("urgency:") === 0;
    })
  ) {
    return "more urgent searches like this";
  }
  if (segments.includes("insurance:user")) {
    return "insurance-sensitive searches like this";
  }
  if (
    segments.some(function (segment) {
      return segment.indexOf("intent:psychiatry") === 0 || segment.indexOf("medication:yes") === 0;
    })
  ) {
    return "psychiatry or medication-related searches like this";
  }
  if (
    segments.some(function (segment) {
      return segment.indexOf("format:") === 0;
    })
  ) {
    return "care-format-specific searches like this";
  }

  return "searches like this";
}

function getGentleStrategyExplanation(profile) {
  var strategy = latestAdaptiveSignals || getMatchAdaptiveStrategy(profile);
  var audience = getSegmentAudienceCopy(profile);
  var preference =
    strategy && strategy.preferred_match_action ? strategy.preferred_match_action : "help";
  var basis =
    strategy && strategy.match_action_basis === "outcomes"
      ? "what has worked best"
      : "how people tend to move";

  if (preference === "outreach") {
    return (
      "For " +
      audience +
      ", we currently emphasize a clearer first outreach because that is " +
      basis +
      " so far."
    );
  }
  if (preference === "save") {
    return (
      "For " +
      audience +
      ", we currently emphasize saving and comparing because that is " +
      basis +
      " so far."
    );
  }
  return (
    "For " +
    audience +
    ", we currently emphasize a little more narrowing support before outreach because that is " +
    basis +
    " so far."
  );
}

function renderAdaptiveMatchActions(profile, entries) {
  var strategy = getMatchAdaptiveStrategy(profile);
  var note = document.getElementById("matchAdaptiveNextStep");
  var requestHelpButton = document.getElementById("requestHelp");
  var saveButton = document.getElementById("saveShortlist");
  var summary = document.getElementById("matchSummary");
  var hasResults = Boolean(entries && entries.length);
  var hasRefinements = hasMeaningfulRefinements(profile);
  var contextLabel =
    profile && profile.urgency && profile.urgency !== "Flexible"
      ? "Urgency still matters most, so practicality stays high in the ranking."
      : profile && profile.care_intent && profile.care_intent !== "Either"
        ? "Because you named a clear care intent, that clinical path still stays front and center."
        : "";

  if (saveButton && strategy && strategy.match_action_copy) {
    saveButton.textContent = strategy.match_action_copy.save_label;
  }

  if (requestHelpButton && strategy && strategy.match_action_copy) {
    requestHelpButton.textContent = strategy.match_action_copy.request_help_label;
  }

  if (summary && hasResults) {
    summary.textContent = buildLocationAwareSummary(profile, hasRefinements);
  } else if (summary) {
    summary.textContent = buildLocationAwareSummary(profile, hasRefinements);
  }

  if (!note) {
    return;
  }

  if (!hasResults || !strategy || !strategy.match_action_copy) {
    note.innerHTML = "";
    note.classList.add("is-empty");
    return;
  }

  note.classList.remove("is-empty");
  note.innerHTML =
    '<div class="match-adaptive-next-step-title">' +
    escapeHtml(strategy.match_action_copy.title) +
    '</div><div class="match-adaptive-next-step-body">' +
    escapeHtml(strategy.match_action_copy.body) +
    (contextLabel ? " " + escapeHtml(contextLabel) : "") +
    '</div><div class="match-adaptive-next-step-body">' +
    escapeHtml(getGentleStrategyExplanation(profile)) +
    "</div>";
}

function getRecommendationActionCopy(profile) {
  var strategy = latestAdaptiveSignals || getMatchAdaptiveStrategy(profile);
  var preference =
    strategy && strategy.preferred_match_action ? strategy.preferred_match_action : "help";
  var urgent = profile && profile.urgency && profile.urgency !== "Flexible";

  if (preference === "outreach") {
    return {
      header: "Who to contact first",
      intro: urgent
        ? "If you want the clearest next move right now, start here."
        : "If you want one clear next move, start here.",
      kicker: "Best next outreach",
      signalTitle: "Why taking action may make sense here",
      signalBody:
        "Similar users often move forward best when they start with one strong outreach instead of over-comparing.",
      primaryLabel: urgent ? "Start outreach now" : "Start outreach",
      secondaryLabel: "Copy first message",
    };
  }

  if (preference === "save") {
    return {
      header: "Who to keep at the top of your shortlist",
      intro: "If you want to save one option as your clearest next move, start here.",
      kicker: "Strongest saved option",
      signalTitle: "Why saving first can still be productive",
      signalBody:
        "Similar users often save or compare first, then come back to this option when they are ready to reach out.",
      primaryLabel: "Review this next step",
      secondaryLabel: "Copy first message",
    };
  }

  return {
    header: "Who to contact first",
    intro: "If you want one calm, high-confidence next move, start here.",
    kicker: "Best first step",
    signalTitle: "Why guided narrowing may help here",
    signalBody:
      "Similar users often want a little more confidence before reaching out, so this recommendation is designed to make the next step feel clearer.",
    primaryLabel: "Take this next step",
    secondaryLabel: "Copy first message",
  };
}

function getRouteSpecificPrimaryLabel(entry, actionCopy) {
  var routeType = getPreferredRouteType(entry);
  if (routeType === "booking") {
    return "Open booking link";
  }
  if (routeType === "phone") {
    return "Call this practice";
  }
  if (routeType === "email") {
    return "Open email draft";
  }
  if (routeType === "website") {
    return "Open contact page";
  }
  return actionCopy.primaryLabel;
}

function buildRouteSpecificCopy(recommendation) {
  if (!recommendation || !recommendation.entry) {
    return "";
  }

  var routeType = getPreferredRouteType(recommendation.entry);
  if (routeType === "booking") {
    return "Use the booking link first so you can see the fastest real next opening.";
  }
  if (routeType === "phone") {
    return "Lead with a quick call so you can confirm fit, availability, and next steps in one move.";
  }
  if (routeType === "email") {
    return "Start with a short email so you can confirm availability and fit without overexplaining.";
  }
  if (routeType === "website") {
    return "Use the website contact path first, then keep the profile open so you can cross-check details while you reach out.";
  }
  return "Start with the clearest contact route first, then use the full profile only if you need more detail.";
}

function buildRecommendedMessageFocus(profile, recommendation) {
  var cues = [];
  if (recommendation && recommendation.segmentCue) {
    cues.push(recommendation.segmentCue);
  }
  if (profile && profile.insurance) {
    cues.push("Ask early whether they take " + profile.insurance + ".");
  }
  if (profile && profile.urgency && profile.urgency !== "Flexible") {
    cues.push("Mention your timing so they can respond with a realistic next opening.");
  }
  if (profile && profile.needs_medication_management === "Yes") {
    cues.push("Say clearly that medication support matters for you.");
  }

  return (
    cues[0] ||
    "Keep the first message short, practical, and focused on fit, availability, and next steps."
  );
}

function getExecutionStrategyCopy(profile) {
  var strategy = latestAdaptiveSignals || getMatchAdaptiveStrategy(profile);
  var preference =
    strategy && strategy.preferred_match_action ? strategy.preferred_match_action : "help";
  var urgent = profile && profile.urgency && profile.urgency !== "Flexible";

  if (preference === "outreach") {
    return {
      outreachHeader: "Start the strongest next move",
      outreachBody:
        "This plan leans toward taking one clear outreach step now, then pivoting quickly if the first path stalls.",
      contactOrderTitle: urgent ? "Action-first contact order" : "Recommended contact order",
      copyPlanLabel: "Copy action plan",
      helpLabel: "Need help before you reach out?",
      pivotReminderLabel: urgent ? "Copy follow-up reminder" : "Copy pivot reminder",
      fallbackHeader: "Who to try next if action stalls",
      fallbackBody: "You do not need to lose momentum if the first outreach does not move.",
      fallbackPrimary: "Start backup outreach",
      fallbackSecondary: "Copy backup message",
    };
  }

  if (preference === "save") {
    return {
      outreachHeader: "Keep the strongest next steps organized",
      outreachBody:
        "This plan leans toward saving a clear first option, keeping a backup path ready, and moving when you feel ready.",
      contactOrderTitle: "Saved contact order",
      copyPlanLabel: "Copy saved plan",
      helpLabel: "Need help narrowing this?",
      pivotReminderLabel: "Copy follow-up reminder",
      fallbackHeader: "Who to keep as your backup option",
      fallbackBody:
        "You can keep a backup path ready without feeling forced to contact everyone now.",
      fallbackPrimary: "Review backup option",
      fallbackSecondary: "Copy backup message",
    };
  }

  return {
    outreachHeader: "Take the next step",
    outreachBody:
      "Use your shortlist to reach out with more confidence, or get help narrowing who to contact first.",
    contactOrderTitle: "Suggested contact order",
    copyPlanLabel: "Copy contact plan",
    helpLabel: "Get help narrowing this",
    pivotReminderLabel: "Copy pivot reminder",
    fallbackHeader: "Who to try next if this stalls",
    fallbackBody: "You do not need to lose momentum if the first path is not moving.",
    fallbackPrimary: "Start backup outreach",
    fallbackSecondary: "Copy fallback draft",
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

function serializeProfileToUrl(profile) {
  var params = new URLSearchParams();
  Object.keys(profile || {}).forEach(function (key) {
    var value = profile[key];
    if (!value || (Array.isArray(value) && !value.length)) {
      return;
    }
    if (Array.isArray(value)) {
      params.set(key, value.join(","));
      return;
    }
    params.set(key, String(value));
  });
  var next = params.toString() ? "match.html?" + params.toString() : "match.html";
  window.history.replaceState({}, "", next);
}

function restoreProfileFromUrl() {
  var params = new URLSearchParams(window.location.search);
  if (!params.toString()) {
    return null;
  }

  var intakeKeys = [
    "location_query",
    "care_state",
    "care_format",
    "care_intent",
    "needs_medication_management",
    "insurance",
    "budget_max",
    "urgency",
    "priority_mode",
    "bipolar_focus",
    "preferred_modalities",
    "population_fit",
    "language_preferences",
  ];

  var hasIntakeParams = intakeKeys.some(function (key) {
    return String(params.get(key) || "").trim() !== "";
  });

  if (!hasIntakeParams) {
    return null;
  }

  var locationQuery = params.get("location_query") || "";
  var profile = buildUserMatchProfile({
    care_state: deriveStateFromLocation(locationQuery) || params.get("care_state") || "",
    care_format: params.get("care_format") || "Either",
    care_intent: params.get("care_intent") || "Either",
    needs_medication_management: params.get("needs_medication_management") || "Open to either",
    insurance: params.get("insurance") || "",
    budget_max: params.get("budget_max") || "",
    urgency: params.get("urgency") || "Flexible",
    priority_mode: params.get("priority_mode") || "Best overall fit",
    bipolar_focus: splitCommaSeparated(params.get("bipolar_focus") || ""),
    preferred_modalities: splitCommaSeparated(params.get("preferred_modalities") || ""),
    population_fit: splitCommaSeparated(params.get("population_fit") || ""),
    language_preferences: splitCommaSeparated(params.get("language_preferences") || ""),
  });
  profile.location_query = locationQuery;
  return profile;
}

function restoreShortlistFromUrl() {
  var params = new URLSearchParams(window.location.search);
  var raw = params.get("shortlist") || "";
  if (!raw) {
    return [];
  }

  return splitCommaSeparated(raw);
}

function hydrateForm(profile) {
  if (!profile) {
    return;
  }

  var form = document.getElementById("matchForm");
  form.elements.location_query.value = profile.location_query || profile.care_state || "";
  syncZipResolvedLabel(form.elements.location_query.value);
  form.elements.care_format.value = profile.care_format || "Either";
  form.elements.care_intent.value = profile.care_intent || "Either";
  form.elements.needs_medication_management.value =
    profile.needs_medication_management || "Open to either";
  form.elements.insurance.value = profile.insurance || "";
  form.elements.budget_max.value = profile.budget_max || "";
  form.elements.urgency.value = profile.urgency || "Flexible";
  form.elements.priority_mode.value = profile.priority_mode || "Best overall fit";
  form.elements.language_preferences.value = (profile.language_preferences || []).join(", ");

  ["bipolar_focus", "preferred_modalities", "population_fit"].forEach(function (name) {
    var selected = new Set(profile[name] || []);
    form.querySelectorAll('input[name="' + name + '"]').forEach(function (input) {
      input.checked = selected.has(input.value);
    });
  });
  syncMatchCareSelectTrigger();
  renderAdaptiveIntakeGuidance(readCurrentIntakeProfile());
  renderIntakeTradeoffPreview(readCurrentIntakeProfile());
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

  if (profile && profile.urgency && profile.urgency !== "Flexible") {
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

  if (!isInternalMode) {
    root.innerHTML = "";
    return;
  }

  var items = buildAdaptiveGuidance(profile, entries);
  if (!items.length) {
    root.innerHTML = "";
    return;
  }

  root.innerHTML =
    '<section class="adaptive-guidance"><div class="adaptive-guidance-header"><h3>Helpful guidance before you reach out</h3><p>This adapts to your request and the hesitation patterns we have been seeing in the product.</p></div><div class="adaptive-guidance-grid">' +
    items
      .map(function (item) {
        return (
          '<article class="adaptive-guidance-card tone-' +
          escapeHtml(item.tone) +
          '"><div class="adaptive-guidance-title">' +
          escapeHtml(item.title) +
          '</div><div class="adaptive-guidance-body">' +
          escapeHtml(item.body) +
          "</div></article>"
        );
      })
      .join("") +
    "</div></section>";
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
  if (!queueEntries.length) {
    root.hidden = true;
    root.innerHTML = "";
    return;
  }

  root.hidden = false;
  root.innerHTML =
    '<div class="match-queue-header"><h3>Keep these in reserve</h3><p>Your main recommendation set stays focused on the best 3 options. These extra profiles give you a deeper queue if you want more to compare or fall back to.</p></div><div class="match-queue-list">' +
    queueEntries
      .map(function (entry, index) {
        var therapist = entry.therapist;
        return (
          '<article class="match-queue-card"><div><div class="match-queue-rank">Reserve ' +
          escapeHtml(String(PRIMARY_SHORTLIST_LIMIT + index + 1)) +
          '</div><div class="match-queue-name">' +
          escapeHtml(therapist.name) +
          '</div><div class="match-queue-meta">' +
          escapeHtml(therapist.credentials || "") +
          (therapist.title ? " · " + escapeHtml(therapist.title) : "") +
          " · " +
          escapeHtml(therapist.city || "") +
          (therapist.state ? ", " + escapeHtml(therapist.state) : "") +
          '</div><div class="match-queue-copy">' +
          escapeHtml(buildQueueReserveCopy(entry)) +
          "</div></div>" +
          '<a href="therapist.html?slug=' +
          encodeURIComponent(therapist.slug) +
          '" class="btn-secondary" style="width:auto" data-match-profile-link="' +
          escapeHtml(therapist.slug) +
          '" data-profile-link-context="queue">View Profile</a></article>'
        );
      })
      .join("") +
    "</div>";

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
  if (
    profile &&
    profile.urgency &&
    profile.urgency !== "Flexible" &&
    therapist.estimated_wait_time
  ) {
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

function buildRecommendedOutreachDraft(recommendation, profile) {
  if (!recommendation || !recommendation.entry || !recommendation.therapist) {
    return "";
  }

  var therapist = recommendation.therapist;
  var introLine =
    "Hi " +
    therapist.name +
    ",\n\nI found your profile on BipolarTherapyHub and your practice stood out as a strong fit for what I am looking for.";
  var context = [
    profile && profile.care_state ? "I am seeking care in " + profile.care_state + "." : "",
    profile && profile.care_intent && profile.care_intent !== "Either"
      ? "I am primarily looking for " + profile.care_intent.toLowerCase() + "."
      : "",
    profile && profile.care_format && profile.care_format !== "Either"
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
  var ask = getSegmentAwareDraftAsk(profile, recommendation) + "\n\nThank you.";

  return [introLine, context, ask].filter(Boolean).join("\n\n");
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
    },
    extra || {},
  );
  return payload;
}

async function copyRecommendedOutreachDraft() {
  var recommendation = buildFirstContactRecommendation(latestProfile, latestEntries);
  if (!recommendation) {
    return;
  }

  var draft = buildRecommendedOutreachDraft(recommendation, latestProfile);
  try {
    await navigator.clipboard.writeText(draft);
    trackFunnelEvent(
      "match_recommended_draft_copied",
      buildMatchTrackingPayload(recommendation.therapist.slug, {
        route: recommendation.route,
      }),
    );
    setActionState(true, "Recommended outreach draft copied.");
  } catch (_error) {
    setActionState(true, "Unable to copy the outreach draft automatically on this device.");
  }
}

function openRecommendedOutreach() {
  var recommendation = buildFirstContactRecommendation(latestProfile, latestEntries);
  if (!recommendation) {
    return;
  }
  trackFunnelEvent(
    "match_recommended_outreach_started",
    buildMatchTrackingPayload(recommendation.therapist.slug, {
      route: recommendation.route,
    }),
  );

  var preferred = getPreferredOutreach(recommendation.entry);
  if (preferred && String(preferred.href || "").startsWith("mailto:")) {
    window.location.href = preferred.href;
    return;
  }

  if (preferred && preferred.href) {
    window.open(
      preferred.href,
      preferred.external ? "_blank" : "_self",
      preferred.external ? "noopener" : undefined,
    );
    return;
  }

  window.location.href = "therapist.html?slug=" + encodeURIComponent(recommendation.therapist.slug);
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

function recordRecommendedOutreachOutcome(outcome) {
  var recommendation = buildFirstContactRecommendation(latestProfile, latestEntries);
  if (!recommendation) {
    return;
  }

  var rankPosition =
    latestEntries.findIndex(function (entry) {
      return entry.therapist.slug === recommendation.therapist.slug;
    }) + 1;
  var contactPlan = buildContactOrderPlan(latestProfile, latestEntries);
  var routeType = getPreferredRouteType(recommendation.entry);
  var shortcutContext = getShortcutContextForTherapist(recommendation.therapist.slug);

  var outcomes = readOutreachOutcomes();
  outcomes.unshift({
    recorded_at: new Date().toISOString(),
    journey_id: currentJourneyId || buildJourneyId(latestProfile, latestEntries),
    therapist_slug: recommendation.therapist.slug,
    therapist_name: recommendation.therapist.name,
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
      therapist_slugs: latestEntries.slice(0, 3).map(function (entry) {
        return entry.therapist.slug;
      }),
    },
  });
  writeOutreachOutcomes(outcomes.slice(0, 100));
  latestLearningSignals = buildLearningSignals(readStoredFeedback(), readOutreachOutcomes());
  if (latestProfile) {
    latestEntries = rankEntriesForProfile(latestProfile);
  }
  renderResults(latestEntries, latestProfile);
  renderFirstContactRecommendation(latestProfile, latestEntries);
  setActionState(true, "Outreach outcome saved: " + formatOutcomeLabel(outcome) + ".");
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
  renderResults(latestEntries, latestProfile);
  setActionState(
    true,
    "Outreach outcome saved for " + entry.therapist.name + ": " + formatOutcomeLabel(outcome) + ".",
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

async function copyFallbackOutreachDraft() {
  var fallback = buildFallbackRecommendation(latestProfile, latestEntries);
  if (!fallback) {
    return;
  }

  try {
    await navigator.clipboard.writeText(buildEntryOutreachDraft(fallback.entry, latestProfile));
    trackFunnelEvent(
      "match_fallback_draft_copied",
      buildMatchTrackingPayload(fallback.therapist.slug, {
        route: fallback.route,
      }),
    );
    setActionState(true, "Fallback outreach draft copied.");
  } catch (_error) {
    setActionState(true, "Unable to copy the fallback outreach draft automatically.");
  }
}

function openFallbackOutreach() {
  var fallback = buildFallbackRecommendation(latestProfile, latestEntries);
  if (!fallback) {
    return;
  }

  trackFunnelEvent(
    "match_fallback_outreach_started",
    buildMatchTrackingPayload(fallback.therapist.slug, {
      route: fallback.route,
      trigger: fallback.triggerLabel,
    }),
  );

  var preferred = getPreferredOutreach(fallback.entry);
  if (preferred && String(preferred.href || "").startsWith("mailto:")) {
    window.location.href = preferred.href;
    return;
  }

  if (preferred && preferred.href) {
    window.open(
      preferred.href,
      preferred.external ? "_blank" : "_self",
      preferred.external ? "noopener" : undefined,
    );
    return;
  }

  window.location.href = "therapist.html?slug=" + encodeURIComponent(fallback.therapist.slug);
}

function renderFallbackRecommendation(profile, entries) {
  var root = document.getElementById("matchFallbackContact");
  if (!root) {
    return;
  }

  var fallback = buildFallbackRecommendation(profile, entries);
  var executionCopy = getExecutionStrategyCopy(profile);
  if (!fallback) {
    root.innerHTML = "";
    return;
  }

  root.innerHTML =
    '<section class="first-contact-reco"><div class="first-contact-header"><h3>' +
    escapeHtml(executionCopy.fallbackHeader) +
    "</h3><p>" +
    escapeHtml(executionCopy.fallbackBody) +
    '</p></div><div class="first-contact-card"><div class="first-contact-top"><div><div class="first-contact-kicker">Recommended backup outreach</div><div class="first-contact-name">' +
    escapeHtml(fallback.therapist.name) +
    '</div><div class="first-contact-meta">' +
    escapeHtml(fallback.therapist.credentials || "") +
    (fallback.therapist.title ? " · " + escapeHtml(fallback.therapist.title) : "") +
    " · " +
    escapeHtml(fallback.route) +
    '</div></div><a href="therapist.html?slug=' +
    encodeURIComponent(fallback.therapist.slug) +
    '" class="btn-secondary" style="width:auto" data-match-profile-link="' +
    escapeHtml(fallback.therapist.slug) +
    '" data-profile-link-context="fallback">Review profile</a></div><div class="first-contact-body"><p><strong>Why pivot now:</strong> ' +
    escapeHtml(
      "The first outreach is currently marked as " +
        fallback.triggerLabel.toLowerCase() +
        ", so this is the best next option.",
    ) +
    "</p><p><strong>Why this backup:</strong> " +
    escapeHtml(fallback.rationale) +
    "</p>" +
    (fallback.learningWins
      ? '<div class="first-contact-signal"><strong>Why this backup is reinforced:</strong> ' +
        escapeHtml(
          "Similar fallback journeys have produced " +
            fallback.learningWins +
            " strong outcome" +
            (fallback.learningWins > 1 ? "s" : "") +
            (fallback.learningAttempts
              ? " across " +
                fallback.learningAttempts +
                " tracked backup attempt" +
                (fallback.learningAttempts > 1 ? "s" : "")
              : "") +
            ".",
        ) +
        "</div>"
      : "") +
    (fallback.routeLearning && fallback.routeLearning.success
      ? '<div class="first-contact-signal"><strong>Why this route may recover better:</strong> ' +
        escapeHtml(
          "Similar users have seen stronger backup outcomes through " +
            fallback.routeLearning.routeType.replace(/_/g, " ") +
            " outreach.",
        ) +
        "</div>"
      : "") +
    '<div class="first-contact-signal"><strong>How to approach this backup:</strong> ' +
    escapeHtml(fallback.nextMove) +
    '</div><div class="first-contact-actions"><button type="button" class="btn-primary" id="fallbackOutreachAction">' +
    escapeHtml(executionCopy.fallbackPrimary) +
    '</button><button type="button" class="btn-secondary" id="copyFallbackDraft">' +
    escapeHtml(executionCopy.fallbackSecondary) +
    "</button></div></div></div></section>";

  var startButton = document.getElementById("fallbackOutreachAction");
  if (startButton) {
    startButton.addEventListener("click", openFallbackOutreach);
  }

  var copyButton = document.getElementById("copyFallbackDraft");
  if (copyButton) {
    copyButton.addEventListener("click", function () {
      copyFallbackOutreachDraft();
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
}

function renderFirstContactRecommendation(profile, entries) {
  var root = document.getElementById("matchFirstContact");
  if (!root) {
    return;
  }

  var recommendation = buildFirstContactRecommendation(profile, entries);
  if (!recommendation) {
    root.innerHTML = "";
    return;
  }
  var latestOutcome = getLatestOutreachOutcome(recommendation.therapist.slug);
  var responsivenessLabel = getResponsivenessSignalLabel(recommendation.therapist);
  var responsivenessNote = getResponsivenessSignalNote(recommendation.therapist);
  var actionCopy = getRecommendationActionCopy(profile);
  var gentleStrategyExplanation = getGentleStrategyExplanation(profile);
  var routeSpecificPrimaryLabel = getRouteSpecificPrimaryLabel(recommendation.entry, actionCopy);
  var routeSpecificCopy = buildRouteSpecificCopy(recommendation);
  var messageFocus = buildRecommendedMessageFocus(profile, recommendation);

  root.innerHTML =
    '<section class="first-contact-reco"><div class="first-contact-header"><h3>' +
    escapeHtml(actionCopy.header) +
    "</h3><p>" +
    escapeHtml(actionCopy.intro) +
    '</p></div><div class="first-contact-card"><div class="first-contact-top"><div><div class="first-contact-kicker">' +
    escapeHtml(actionCopy.kicker) +
    '</div><div class="first-contact-name">' +
    escapeHtml(recommendation.therapist.name) +
    '</div><div class="first-contact-meta">' +
    escapeHtml(recommendation.therapist.credentials || "") +
    (recommendation.therapist.title ? " · " + escapeHtml(recommendation.therapist.title) : "") +
    " · " +
    escapeHtml(recommendation.route) +
    '</div></div><a href="therapist.html?slug=' +
    encodeURIComponent(recommendation.therapist.slug) +
    '" class="btn-secondary" style="width:auto" data-match-profile-link="' +
    escapeHtml(recommendation.therapist.slug) +
    '" data-profile-link-context="recommended">Review profile</a></div><div class="first-contact-body"><p><strong>Why start here:</strong> ' +
    escapeHtml(
      "This therapist is a strong first outreach because " + recommendation.rationale + ".",
    ) +
    "</p><p><strong>What likely happens next:</strong> " +
    escapeHtml(recommendation.firstStep) +
    "</p>" +
    '<div class="first-contact-summary-grid">' +
    '<div class="first-contact-summary-card"><div class="first-contact-summary-label">Best route</div><div class="first-contact-summary-value">' +
    escapeHtml(recommendation.route) +
    "</div></div>" +
    '<div class="first-contact-summary-card"><div class="first-contact-summary-label">Likely next step</div><div class="first-contact-summary-value">' +
    escapeHtml(recommendation.firstStep) +
    "</div></div>" +
    '<div class="first-contact-summary-card"><div class="first-contact-summary-label">What to lead with</div><div class="first-contact-summary-value">' +
    escapeHtml(messageFocus) +
    "</div></div></div>" +
    '<div class="first-contact-signal"><strong>How to use this route:</strong> ' +
    escapeHtml(routeSpecificCopy) +
    "</div>" +
    (recommendation.segmentCue
      ? '<div class="first-contact-signal"><strong>How to approach this outreach:</strong> ' +
        escapeHtml(recommendation.segmentCue) +
        "</div>"
      : "") +
    (recommendation.segmentLearning
      ? '<div class="first-contact-signal"><strong>Why this is reinforced:</strong> ' +
        escapeHtml(recommendation.segmentLearning) +
        "</div>"
      : "") +
    (recommendation.shortcutSignal && recommendation.shortcutSignal.preference.strong > 0
      ? '<div class="first-contact-signal"><strong>Why this shortcut logic carries through:</strong> ' +
        escapeHtml(
          "This recommendation also lines up with the " +
            recommendation.shortcutSignal.title.toLowerCase() +
            " shortcut, which has produced " +
            recommendation.shortcutSignal.preference.strong +
            " strong outcome" +
            (recommendation.shortcutSignal.preference.strong === 1 ? "" : "s") +
            " for similar users.",
        ) +
        "</div>"
      : "") +
    '<div class="first-contact-signal"><strong>' +
    escapeHtml(actionCopy.signalTitle) +
    ":</strong> " +
    escapeHtml(actionCopy.signalBody) +
    "</div>" +
    '<div class="first-contact-signal"><strong>Why this flow is leaning this way:</strong> ' +
    escapeHtml(gentleStrategyExplanation) +
    "</div>" +
    (responsivenessLabel
      ? '<div class="first-contact-signal"><strong>Contact responsiveness:</strong> ' +
        escapeHtml(responsivenessLabel) +
        (responsivenessNote
          ? '<div class="first-contact-signal-note">' + escapeHtml(responsivenessNote) + "</div>"
          : "") +
        "</div>"
      : "") +
    '<div class="first-contact-actions"><button type="button" class="btn-primary" id="recommendedOutreachAction">' +
    escapeHtml(routeSpecificPrimaryLabel) +
    '</button><button type="button" class="btn-secondary" id="copyRecommendedDraft">' +
    escapeHtml(actionCopy.secondaryLabel) +
    '</button></div><div class="first-contact-tracker"><div class="first-contact-tracker-title">What happened after outreach?</div><div class="first-contact-tracker-actions">' +
    OUTREACH_OUTCOME_OPTIONS.map(function (option) {
      return (
        '<button type="button" class="feedback-btn' +
        (latestOutcome && latestOutcome.outcome === option.value
          ? option.tone === "negative"
            ? " active-negative"
            : " active-positive"
          : "") +
        '" data-outreach-outcome="' +
        escapeHtml(option.value) +
        '">' +
        escapeHtml(option.label) +
        "</button>"
      );
    }).join("") +
    '</div><div class="first-contact-tracker-note">' +
    escapeHtml(
      latestOutcome
        ? "Latest outcome: " +
            formatOutcomeLabel(latestOutcome.outcome) +
            " on " +
            new Date(latestOutcome.recorded_at).toLocaleDateString()
        : "Track both responsiveness and conversion quality so the product can learn from real follow-through.",
    ) +
    "</div></div></div></div></section>";

  var startButton = document.getElementById("recommendedOutreachAction");
  if (startButton) {
    startButton.addEventListener("click", openRecommendedOutreach);
  }

  var copyButton = document.getElementById("copyRecommendedDraft");
  if (copyButton) {
    copyButton.addEventListener("click", function () {
      copyRecommendedOutreachDraft();
    });
  }

  root.querySelectorAll("[data-outreach-outcome]").forEach(function (button) {
    button.addEventListener("click", function () {
      recordRecommendedOutreachOutcome(button.getAttribute("data-outreach-outcome"));
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
}

function getBaseFallbackWaitMs(profile) {
  if (profile && profile.urgency === "ASAP") {
    return 24 * 60 * 60 * 1000;
  }
  if (profile && profile.urgency === "Within 2 weeks") {
    return 48 * 60 * 60 * 1000;
  }
  if (profile && profile.urgency === "Within a month") {
    return 4 * 24 * 60 * 60 * 1000;
  }
  return 5 * 24 * 60 * 60 * 1000;
}

function formatWaitWindow(ms) {
  var hours = Math.round(ms / (60 * 60 * 1000));
  if (hours <= 48) {
    return hours + " hours";
  }

  var days = Math.round(hours / 24);
  return days + (days === 1 ? " day" : " days");
}

function getAdaptivePivotTiming(profile, outcomes) {
  var baseMs = getBaseFallbackWaitMs(profile);
  var timing = analyzePivotTimingByUrgency(outcomes, profile);
  var adjustedMs = baseMs;
  var rationale = "";

  if (timing.early_pivots >= Math.max(2, timing.late_pivots + 1)) {
    adjustedMs = Math.max(24 * 60 * 60 * 1000, Math.round(baseMs * 0.75));
    rationale = "Similar urgency journeys have tended to pivot a bit earlier.";
  } else if (timing.late_pivots >= Math.max(2, timing.early_pivots + 1)) {
    adjustedMs = Math.min(7 * 24 * 60 * 60 * 1000, Math.round(baseMs * 1.25));
    rationale = "Similar urgency journeys have tended to need a little more time before pivoting.";
  } else if (timing.on_time_pivots > 0) {
    rationale = "Similar urgency journeys suggest this timing window is about right.";
  }

  return {
    ms: adjustedMs,
    label: formatWaitWindow(adjustedMs),
    rationale: rationale,
  };
}

function formatReminderDate(value) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function buildContactOrderPlan(profile, entries) {
  var first = buildFirstContactRecommendation(profile, entries);
  if (!first) {
    return null;
  }

  var fallback = buildFallbackRecommendation(profile, entries);
  var adaptiveTiming = getAdaptivePivotTiming(profile, readOutreachOutcomes());
  var waitWindow = adaptiveTiming.label;
  var pivotAt = new Date(Date.now() + adaptiveTiming.ms);

  return {
    first: first,
    fallback: fallback,
    waitWindow: waitWindow,
    pivotAt: pivotAt.toISOString(),
    pivotAtLabel: formatReminderDate(pivotAt),
    timingRationale: adaptiveTiming.rationale,
    routeRationale:
      first.routeLearning && first.routeLearning.success > 0
        ? "Similar " +
          buildLearningSegments(profile)
            .slice(0, 2)
            .map(function (segment) {
              return segment.split(":")[1].replace(/-/g, " ");
            })
            .join(" / ") +
          " searches have seen stronger outcomes through " +
          first.routeLearning.routeType.replace(/_/g, " ") +
          " outreach."
        : "",
    shortcutRationale:
      first.shortcutSignal && first.shortcutSignal.preference.strong > 0
        ? "This first step also matches the strongest-performing " +
          first.shortcutSignal.title.toLowerCase() +
          " shortcut for similar users."
        : "",
    trigger:
      "If you see no reply, a waitlist, or an insurance mismatch after about " +
      waitWindow +
      ", move to the backup path.",
  };
}

function buildPivotReminderText(plan) {
  if (!plan || !plan.first) {
    return "";
  }

  return [
    "BipolarTherapyHub follow-up reminder",
    "",
    "Start: " + plan.first.therapist.name + " via " + plan.first.route,
    "Pivot at: " + plan.pivotAtLabel,
    plan.fallback ? "Backup: " + plan.fallback.therapist.name + " via " + plan.fallback.route : "",
    plan.trigger,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildOutreachPlan(entries) {
  var plan = buildContactOrderPlan(latestProfile, entries);
  var lines = [];

  if (plan && plan.first) {
    lines.push("1. Start with " + plan.first.therapist.name + " via " + plan.first.route + ".");
    lines.push("2. Wait about " + plan.waitWindow + " for movement before pivoting if needed.");
    if (plan.fallback) {
      lines.push(
        "3. If the first path stalls, try " +
          plan.fallback.therapist.name +
          " via " +
          plan.fallback.route +
          ".",
      );
    }
    lines.push("");
  }

  lines = lines.concat(
    entries.slice(0, 3).map(function (entry, index) {
      return (
        index +
        1 +
        ". " +
        entry.therapist.name +
        " — " +
        [entry.evaluation.shortlist_priority, entry.evaluation.shortlist_note]
          .filter(Boolean)
          .join(" | ")
      );
    }),
  );

  return lines.filter(Boolean).join("\n");
}

function buildConciergeRequestPayload(entries, formValues) {
  return {
    created_at: new Date().toISOString(),
    share_link: window.location.href,
    request_summary: latestProfile
      ? buildRequestSummary(latestProfile)
      : "Comparing a shortlist saved from the directory.",
    shortlist: (entries || []).slice(0, 3).map(function (entry) {
      var outreach = getPreferredOutreach(entry);
      return {
        slug: entry.therapist.slug,
        name: entry.therapist.name,
        priority: entry.evaluation.shortlist_priority || "",
        note: entry.evaluation.shortlist_note || "",
        outreach: outreach ? outreach.label : "Not listed",
        follow_up_status: "unreviewed",
      };
    }),
    requester_name: String(formValues.requester_name || "").trim(),
    follow_up_preference: String(formValues.follow_up_preference || ""),
    help_topic: String(formValues.help_topic || ""),
    request_note: String(formValues.request_note || "").trim(),
    request_status: "new",
  };
}

function buildConciergeRequestBrief(request) {
  return [
    "BipolarTherapyHub concierge request",
    "",
    request.requester_name ? "Name: " + request.requester_name : "",
    request.follow_up_preference ? "Preferred follow-up: " + request.follow_up_preference : "",
    request.help_topic ? "What they want help with: " + request.help_topic : "",
    "Request summary: " + request.request_summary,
    "",
    "Shortlist:",
    request.shortlist
      .map(function (item, index) {
        return (
          index +
          1 +
          ". " +
          item.name +
          (item.priority ? " — " + item.priority : "") +
          (item.note ? " — Note: " + item.note : "") +
          " — Best route: " +
          item.outreach
        );
      })
      .join("\n"),
    "",
    request.request_note ? "User note:\n" + request.request_note : "",
    "Share link:\n" + request.share_link,
  ]
    .filter(Boolean)
    .join("\n");
}

function scrollToConciergePanel() {
  var panel = document.getElementById("conciergePanel");
  if (!panel) {
    return;
  }

  panel.scrollIntoView({ behavior: "smooth", block: "start" });
  window.setTimeout(function () {
    var field = document.getElementById("concierge_name");
    if (field) {
      field.focus();
    }
  }, 250);
}

function bindConciergePanel(entries) {
  var form = document.getElementById("conciergeForm");
  var copyButton = document.getElementById("copyConciergeBrief");
  var saveButton = document.getElementById("saveConciergeRequest");
  var status = document.getElementById("conciergeStatus");

  if (!form || !copyButton || !saveButton || !status) {
    return;
  }

  function getFormValues() {
    return {
      requester_name: form.elements.requester_name.value,
      follow_up_preference: form.elements.follow_up_preference.value,
      help_topic: form.elements.help_topic.value,
      request_note: form.elements.request_note.value,
    };
  }

  saveButton.addEventListener("click", function () {
    var request = buildConciergeRequestPayload(entries, getFormValues());
    var saved = readConciergeRequests();
    saved.unshift(request);
    writeConciergeRequests(saved.slice(0, 20));
    status.textContent =
      "Concierge request saved on this device. Once live support is connected, this can become a real handoff queue.";
    setActionState(true, "Concierge request saved locally.");
  });

  copyButton.addEventListener("click", async function () {
    var request = buildConciergeRequestPayload(entries, getFormValues());
    var brief = buildConciergeRequestBrief(request);

    try {
      await navigator.clipboard.writeText(brief);
      status.textContent =
        "Concierge brief copied. You can paste it into email, notes, or a future support workflow.";
      setActionState(true, "Concierge brief copied.");
    } catch (_error) {
      status.textContent =
        "Unable to copy automatically on this device. You can still save the request locally.";
      setActionState(true, "Unable to copy concierge brief automatically.");
    }
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
  var contactPlan = buildContactOrderPlan(latestProfile, entries);
  var shortcutInfluence = getShortcutInfluence(latestProfile, entries.slice(0, 3));
  var executionCopy = getExecutionStrategyCopy(latestProfile);
  var gentleStrategyExplanation = getGentleStrategyExplanation(latestProfile);

  root.innerHTML =
    '<section class="match-outreach"><div class="match-outreach-header"><div><h3>' +
    escapeHtml(executionCopy.outreachHeader) +
    "</h3><p>" +
    escapeHtml(executionCopy.outreachBody) +
    '</p><p class="subtle" style="margin-top:0.45rem">' +
    escapeHtml(gentleStrategyExplanation) +
    '</p></div><div class="match-outreach-actions"><button type="button" class="btn-secondary" id="copyOutreachPlan">' +
    escapeHtml(executionCopy.copyPlanLabel) +
    '</button><button type="button" class="btn-primary" id="requestShortlistHelp">' +
    escapeHtml(executionCopy.helpLabel) +
    "</button></div></div>" +
    (contactPlan
      ? '<div class="outreach-plan"><div class="outreach-plan-title">' +
        escapeHtml(executionCopy.contactOrderTitle) +
        '</div><div class="outreach-plan-copy"><strong>Start with:</strong> ' +
        escapeHtml(contactPlan.first.therapist.name) +
        " via " +
        escapeHtml(contactPlan.first.route) +
        '.</div><div class="outreach-plan-copy"><strong>Pivot window:</strong> ' +
        escapeHtml(contactPlan.trigger) +
        '</div><div class="outreach-plan-copy"><strong>Follow up by:</strong> ' +
        escapeHtml(contactPlan.pivotAtLabel) +
        "</div>" +
        (contactPlan.routeRationale
          ? '<div class="outreach-plan-copy"><strong>Why this route first:</strong> ' +
            escapeHtml(contactPlan.routeRationale) +
            "</div>"
          : "") +
        (contactPlan.shortcutRationale
          ? '<div class="outreach-plan-copy"><strong>Why this shortcut logic supports it:</strong> ' +
            escapeHtml(contactPlan.shortcutRationale) +
            "</div>"
          : "") +
        (contactPlan.timingRationale
          ? '<div class="outreach-plan-copy"><strong>Why this timing:</strong> ' +
            escapeHtml(contactPlan.timingRationale) +
            "</div>"
          : "") +
        (contactPlan.fallback
          ? '<div class="outreach-plan-copy"><strong>Backup path:</strong> If the first option stalls, try ' +
            escapeHtml(contactPlan.fallback.therapist.name) +
            " via " +
            escapeHtml(contactPlan.fallback.route) +
            ".</div>"
          : "") +
        '<div class="outreach-plan-actions"><button type="button" class="outreach-link outreach-link-button" id="copyPivotReminder">' +
        escapeHtml(executionCopy.pivotReminderLabel) +
        "</button></div>" +
        "</div>"
      : "") +
    '<div class="outreach-grid">' +
    entries
      .slice(0, 3)
      .map(function (entry) {
        var primaryContact = getPreferredOutreach(entry);
        var responsivenessLabel = getResponsivenessSignalLabel(entry.therapist);
        var segmentCue = getEntrySegmentCue(latestProfile, entry);
        var latestOutcome = getLatestOutreachOutcome(entry.therapist.slug);
        var shortcutSignal = shortcutInfluence[entry.therapist.slug] || null;
        var contactPlanRole = getContactPlanRole(contactPlan, entry.therapist.slug);
        return (
          '<article class="outreach-card"><div class="outreach-card-top"><div><h4>' +
          escapeHtml(entry.therapist.name) +
          "</h4><p>" +
          escapeHtml(entry.therapist.credentials || "") +
          (entry.therapist.title ? " · " + escapeHtml(entry.therapist.title) : "") +
          "</p></div>" +
          (contactPlanRole
            ? '<span class="match-summary-pill">' + escapeHtml(contactPlanRole) + "</span>"
            : entry.evaluation.shortlist_priority
              ? '<span class="match-summary-pill">' +
                escapeHtml(entry.evaluation.shortlist_priority) +
                "</span>"
              : "") +
          "</div>" +
          (entry.evaluation.shortlist_note
            ? '<div class="outreach-note">Your note: ' +
              escapeHtml(entry.evaluation.shortlist_note) +
              "</div>"
            : "") +
          (responsivenessLabel
            ? '<div class="outreach-note">Responsiveness: ' +
              escapeHtml(responsivenessLabel) +
              "</div>"
            : "") +
          (segmentCue
            ? '<div class="outreach-note outreach-note-strong">Suggested emphasis: ' +
              escapeHtml(segmentCue) +
              "</div>"
            : "") +
          (shortcutSignal
            ? '<div class="outreach-note">Shortcut signal: ' +
              escapeHtml(getShortcutInfluenceCopy(shortcutSignal)) +
              "</div>"
            : "") +
          (entry.therapist.contact_guidance
            ? '<div class="outreach-note">Contact note: ' +
              escapeHtml(entry.therapist.contact_guidance) +
              "</div>"
            : "") +
          '<div class="first-contact-tracker"><div class="first-contact-tracker-title">Track what happened</div><div class="first-contact-tracker-actions">' +
          OUTREACH_OUTCOME_OPTIONS.map(function (option) {
            return (
              '<button type="button" class="feedback-btn' +
              (latestOutcome && latestOutcome.outcome === option.value
                ? option.tone === "negative"
                  ? " active-negative"
                  : " active-positive"
                : "") +
              '" data-entry-outreach="' +
              escapeHtml(entry.therapist.slug) +
              '" data-entry-outcome="' +
              escapeHtml(option.value) +
              '">' +
              escapeHtml(option.label) +
              "</button>"
            );
          }).join("") +
          "</div></div>" +
          '<div class="outreach-links">' +
          (primaryContact
            ? '<a class="outreach-link" href="' +
              escapeHtml(primaryContact.href) +
              '"' +
              (primaryContact.external ? ' target="_blank" rel="noopener"' : "") +
              ' data-entry-contact-link="' +
              escapeHtml(entry.therapist.slug) +
              '" data-entry-route-label="' +
              escapeHtml(primaryContact.label) +
              '"' +
              ">" +
              escapeHtml(primaryContact.label) +
              "</a>"
            : '<span class="outreach-link" style="color:var(--muted)">Contact route not listed</span>') +
          '<button type="button" class="outreach-link outreach-link-button" data-copy-entry-draft="' +
          escapeHtml(entry.therapist.slug) +
          '">Copy tailored draft</button>' +
          '<a class="outreach-link" href="therapist.html?slug=' +
          encodeURIComponent(entry.therapist.slug) +
          '" data-match-profile-link="' +
          escapeHtml(entry.therapist.slug) +
          '" data-profile-link-context="outreach-card' +
          '">Review profile</a>' +
          "</div></article>"
        );
      })
      .join("") +
    '</div><div class="concierge-panel" id="conciergePanel"><div class="concierge-panel-top"><div><h4>Want a second set of eyes before reaching out?</h4><p>Save a structured help request here if you want help narrowing the shortlist or deciding who to contact first.</p></div><div class="concierge-pill">Help request</div></div><div class="concierge-shortlist">Focused on: ' +
    entries
      .slice(0, 3)
      .map(function (entry) {
        return escapeHtml(entry.therapist.name);
      })
      .join(" • ") +
    '</div><form class="concierge-form" id="conciergeForm"><div class="concierge-grid"><div class="match-group"><label for="concierge_name">First Name</label><input id="concierge_name" name="requester_name" type="text" placeholder="Optional" /></div><div class="match-group"><label for="concierge_followup">Preferred Follow-Up</label><select id="concierge_followup" name="follow_up_preference"><option value="Email me later">Email me later</option><option value="Text me later">Text me later</option><option value="Call me later">Call me later</option><option value="No follow-up yet">No follow-up yet</option></select></div><div class="match-group"><label for="concierge_topic">What do you want help with?</label><select id="concierge_topic" name="help_topic"><option value="Who should I contact first?">Who should I contact first?</option><option value="Which option seems like the best fit?">Which option seems like the best fit?</option><option value="Help me think through insurance and cost">Help me think through insurance and cost</option><option value="Help me compare availability and practicality">Help me compare availability and practicality</option></select></div><div class="match-group"><label for="concierge_note">What feels uncertain?</label><textarea id="concierge_note" name="request_note" rows="4" placeholder="Examples: I need evening availability, I am unsure about medication support, I only want to contact one person first, I am worried about insurance coverage."></textarea></div></div><div class="concierge-actions"><button type="button" class="btn-secondary" id="saveConciergeRequest">Save help request</button><button type="button" class="btn-primary" id="copyConciergeBrief">Copy help summary</button></div><div class="concierge-status" id="conciergeStatus">Saved on this device so you can come back to it later.</div></form></div></section>';

  var copyButton = document.getElementById("copyOutreachPlan");
  if (copyButton) {
    copyButton.addEventListener("click", async function () {
      try {
        await navigator.clipboard.writeText(buildOutreachPlan(entries));
        trackFunnelEvent("match_outreach_plan_copied", {
          result_count: entries.length,
          top_slug: entries[0] ? entries[0].therapist.slug : "",
          strategy: buildAdaptiveStrategySnapshot(latestProfile),
        });
        setActionState(true, "Outreach plan copied.");
      } catch (_error) {
        setActionState(
          true,
          "Unable to copy automatically. You can still use the contact links below.",
        );
      }
    });
  }

  var reminderButton = document.getElementById("copyPivotReminder");
  if (reminderButton && contactPlan) {
    reminderButton.addEventListener("click", async function () {
      try {
        await navigator.clipboard.writeText(buildPivotReminderText(contactPlan));
        trackFunnelEvent("match_pivot_reminder_copied", {
          therapist_slug:
            contactPlan.first && contactPlan.first.therapist
              ? contactPlan.first.therapist.slug
              : "",
          fallback_slug:
            contactPlan.fallback && contactPlan.fallback.therapist
              ? contactPlan.fallback.therapist.slug
              : "",
          strategy: buildAdaptiveStrategySnapshot(latestProfile),
        });
        setActionState(true, "Pivot reminder copied.");
      } catch (_error) {
        setActionState(true, "Unable to copy the pivot reminder automatically.");
      }
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
    });
  });

  var conciergeButton = document.getElementById("requestShortlistHelp");
  if (conciergeButton) {
    conciergeButton.addEventListener("click", function (event) {
      event.preventDefault();
      scrollToConciergePanel();
      setActionState(
        true,
        "Use the concierge request form below if you want a second set of eyes before reaching out.",
      );
    });
  }

  bindConciergePanel(entries);
}

function renderResults(entries, profile) {
  var root = document.getElementById("matchResults");
  var meta = document.getElementById("resultsMeta");
  var summary = document.getElementById("matchSummary");
  var compare = document.getElementById("matchCompare");
  var outreach = document.getElementById("matchOutreach");
  var adaptiveGuidance = document.getElementById("matchAdaptiveGuidance");
  var firstContact = document.getElementById("matchFirstContact");
  var fallbackContact = document.getElementById("matchFallbackContact");
  var feedbackBar = document.getElementById("matchFeedbackBar");
  var queue = document.getElementById("matchQueue");
  var hasRefinements = hasMeaningfulRefinements(profile);
  var contactPlan = buildContactOrderPlan(profile, entries);
  var primaryEntries = (entries || []).slice(0, PRIMARY_SHORTLIST_LIMIT);
  renderSecondPassControls(profile, entries);

  if (!entries.length) {
    var requestedZip = getRequestedZip(profile);
    var zipSuggestions = getClosestZipSuggestions(
      profile,
      (therapists || []).map(function (therapist) {
        return { therapist: therapist };
      }),
    );
    meta.textContent = hasRefinements
      ? "No good match surfaced from the current constraints."
      : requestedZip && zipSuggestions.length
        ? "No exact reviewed profile is live in ZIP " +
          requestedZip +
          " yet. Try the nearest reviewed ZIPs: " +
          formatZipSuggestionList(zipSuggestions) +
          "."
        : "No strong match surfaced for this location yet.";
    summary.textContent = buildRequestSummary(profile);
    renderMatchLaunchExplainer([], profile);
    setActionState(false, "Try widening your constraints before saving or sharing this result.");
    root.className = "match-empty";
    root.innerHTML = hasRefinements
      ? "No strong match appeared with the current requirements. Try widening care format, insurance, or urgency."
      : requestedZip && zipSuggestions.length
        ? "No exact reviewed profile is live in this ZIP code yet. Try one of the nearest reviewed ZIP codes: " +
          formatZipSuggestionList(zipSuggestions) +
          ", or widen to California telehealth."
        : "No strong match surfaced for this ZIP code yet. Try a nearby ZIP code, California telehealth, or a few optional refinements.";
    outreach.innerHTML = "";
    compare.innerHTML = "";
    adaptiveGuidance.innerHTML = "";
    firstContact.innerHTML = "";
    fallbackContact.innerHTML = "";
    if (queue) {
      queue.hidden = true;
      queue.innerHTML = "";
    }
    if (feedbackBar) {
      feedbackBar.hidden = true;
    }
    renderAdaptiveMatchActions(profile, entries);
    return;
  }

  meta.textContent = buildLocationAwareResultsMeta(profile, entries, hasRefinements);
  summary.textContent = profile
    ? buildRequestSummary(profile) +
      (activeSecondPassMode !== "balanced"
        ? " Second pass is currently leaning toward " +
          ((getSecondPassModeConfig(activeSecondPassMode) || {}).label || "a refined ranking") +
          "."
        : "")
    : "Comparing a shortlist saved from the directory.";
  renderMatchLaunchExplainer(entries, profile);
  if (!currentJourneyId) {
    currentJourneyId = buildJourneyId(profile, entries);
  }
  setActionState(true, getMatchAdaptiveStrategy().match_action_copy.status);
  renderAdaptiveMatchActions(profile, entries);
  renderFirstContactRecommendation(profile, primaryEntries);
  renderFallbackRecommendation(profile, primaryEntries);
  renderAdaptiveGuidance(profile, entries);
  renderShortlistQueue(entries);
  if (feedbackBar) {
    feedbackBar.hidden = false;
  }
  var shortcutInfluence = getShortcutInfluence(profile, primaryEntries);

  root.className = "match-list";
  root.innerHTML =
    (isInternalMode ? renderEditorialShortcuts(entries, profile) : "") +
    primaryEntries
      .map(function (entry, index) {
        var therapist = entry.therapist;
        var evaluation = entry.evaluation;
        var tier = getMatchTier(evaluation);
        var contactReadiness = getContactReadiness(entry);
        var responsivenessLabel = getResponsivenessSignalLabel(therapist);
        var responsivenessNote = getResponsivenessSignalNote(therapist);
        var segmentLearning = getSegmentLearningCopy(evaluation);
        var shortcutSignal = shortcutInfluence[therapist.slug] || null;
        var standoutCopy = buildMatchStandoutCopy(entry);
        var trustSnapshot = buildMatchTrustSnapshot(entry);
        var reachabilitySnapshot = buildMatchReachabilitySnapshot(entry);
        var contactPlanRole = getContactPlanRole(contactPlan, therapist.slug);
        var contactPlanNextMove = getContactPlanNextMove(contactPlan, therapist.slug);
        var showScoredPills =
          Boolean(profile) &&
          (Number(evaluation.confidence_score || 0) > 0 ||
            Number(evaluation.completeness_score || 0) > 0 ||
            Boolean(responsivenessLabel));
        var reasons = (evaluation.reasons || [])
          .map(function (reason) {
            return "<li>" + escapeHtml(reason) + "</li>";
          })
          .join("");
        var cautions = (evaluation.cautions || [])
          .map(function (caution) {
            return "<li>" + escapeHtml(caution) + "</li>";
          })
          .join("");

        return (
          '<article class="match-card">' +
          '<div class="match-card-top">' +
          "<div>" +
          '<div class="match-card-badges"><div class="match-rank">Top ' +
          (index + 1) +
          ' match</div><div class="match-confidence tone-' +
          tier.tone +
          '">' +
          escapeHtml(tier.label) +
          "</div></div>" +
          "<h3>" +
          escapeHtml(therapist.name) +
          "</h3>" +
          '<div class="match-meta">' +
          escapeHtml(therapist.credentials) +
          (therapist.title ? " · " + escapeHtml(therapist.title) : "") +
          " · " +
          escapeHtml(therapist.city) +
          ", " +
          escapeHtml(therapist.state) +
          "</div>" +
          "</div>" +
          '<a href="therapist.html?slug=' +
          encodeURIComponent(therapist.slug) +
          '" class="btn-secondary" style="width:auto">View Profile</a>' +
          "</div>" +
          '<div class="match-summary-pills">' +
          getShortlistSummary(entry) +
          (contactPlanRole
            ? '<span class="match-summary-pill">' + escapeHtml(contactPlanRole) + "</span>"
            : "") +
          "</div>" +
          '<p class="match-explanation">' +
          escapeHtml(
            profile
              ? buildMatchExplanation(entry)
              : "Saved directly from the directory for side-by-side comparison. Use the decision snapshot and contact readiness to judge who feels strongest to contact first.",
          ) +
          "</p>" +
          '<div class="match-section"><h4>Decision snapshot</h4><div class="match-snapshot-grid">' +
          '<div class="match-snapshot-card"><div class="match-snapshot-label">Why this stands out</div><div class="match-snapshot-copy">' +
          escapeHtml(standoutCopy) +
          "</div></div>" +
          '<div class="match-snapshot-card"><div class="match-snapshot-label">Trust snapshot</div><div class="match-snapshot-copy">' +
          escapeHtml(trustSnapshot) +
          "</div></div>" +
          '<div class="match-snapshot-card"><div class="match-snapshot-label">Reachability</div><div class="match-snapshot-copy">' +
          escapeHtml(reachabilitySnapshot) +
          "</div></div>" +
          '<div class="match-snapshot-card"><div class="match-snapshot-label">Contact plan</div><div class="match-snapshot-copy">' +
          escapeHtml(contactPlanNextMove) +
          "</div></div></div></div>" +
          (segmentLearning
            ? '<div class="match-segment-learning">' + escapeHtml(segmentLearning) + "</div>"
            : "") +
          (shortcutSignal
            ? '<div class="match-segment-learning">' +
              escapeHtml(getShortcutInfluenceCopy(shortcutSignal)) +
              "</div>"
            : "") +
          (showScoredPills
            ? '<div class="match-summary-pills">' +
              renderTags([
                "Confidence " + evaluation.confidence_score + "/100",
                "Profile completeness " + evaluation.completeness_score + "/100",
                responsivenessLabel,
              ]) +
              "</div>"
            : "") +
          (contactReadiness
            ? '<div class="match-section"><h4>Contact readiness</h4><div class="contact-readiness-card tone-' +
              escapeHtml(contactReadiness.tone) +
              '"><div class="contact-readiness-item"><div class="contact-readiness-label">Best route</div><div class="contact-readiness-value">' +
              escapeHtml(contactReadiness.route) +
              "</div></div>" +
              (contactReadiness.wait
                ? '<div class="contact-readiness-item"><div class="contact-readiness-label">Timing</div><div class="contact-readiness-value">' +
                  escapeHtml(contactReadiness.wait) +
                  "</div></div>"
                : "") +
              (contactReadiness.guidance
                ? '<div class="contact-readiness-item"><div class="contact-readiness-label">What to include</div><div class="contact-readiness-value">' +
                  escapeHtml(contactReadiness.guidance) +
                  "</div></div>"
                : "") +
              '<div class="contact-readiness-item"><div class="contact-readiness-label">What happens next</div><div class="contact-readiness-value">' +
              escapeHtml(
                contactReadiness.firstStep ||
                  "After first contact, the next step is usually a fit conversation or intake review before a full appointment is scheduled.",
              ) +
              "</div></div>" +
              (responsivenessLabel
                ? '<div class="contact-readiness-item"><div class="contact-readiness-label">Responsiveness signal</div><div class="contact-readiness-value">' +
                  escapeHtml(responsivenessLabel) +
                  (responsivenessNote
                    ? '<div class="contact-readiness-note">' +
                      escapeHtml(responsivenessNote) +
                      "</div>"
                    : "") +
                  "</div></div>"
                : "") +
              "</div></div>"
            : "") +
          (reasons
            ? '<div class="match-section"><h4>Why it rose to the top</h4><ul class="match-reasons">' +
              reasons +
              "</ul></div>"
            : "") +
          (cautions
            ? '<div class="match-section"><h4>Things to double-check</h4><ul class="match-cautions">' +
              cautions +
              "</ul></div>"
            : "") +
          '<div class="match-section"><h4>Feedback signal</h4><div class="match-feedback-actions">' +
          '<button type="button" class="feedback-btn" data-feedback-slug="' +
          escapeHtml(therapist.slug) +
          '" data-feedback-value="positive">This felt right</button>' +
          '<button type="button" class="feedback-btn" data-feedback-slug="' +
          escapeHtml(therapist.slug) +
          '" data-feedback-value="negative">Not a fit</button>' +
          '</div><div class="feedback-reasons" data-reason-scope="' +
          escapeHtml(therapist.slug) +
          '" style="display:none">' +
          FEEDBACK_REASON_OPTIONS.map(function (reason) {
            return (
              '<label class="feedback-reason"><input type="checkbox" value="' +
              escapeHtml(reason) +
              '" /> ' +
              escapeHtml(reason) +
              "</label>"
            );
          }).join("") +
          "</div></div>" +
          (isInternalMode
            ? '<div class="match-section"><h4>Score breakdown</h4><div class="match-summary-pills">' +
              renderTags([
                "Access " + evaluation.score_breakdown.access,
                "Practical " + evaluation.score_breakdown.practical,
                "Clinical " + evaluation.score_breakdown.clinical,
                "Trust " + evaluation.score_breakdown.trust,
                "Uncertainty " + evaluation.score_breakdown.uncertainty,
                "Learning " + evaluation.score_breakdown.learned,
              ]) +
              '</div><p class="match-score-note">' +
              escapeHtml(
                "This rank is built from eligibility, practical fit, clinical fit, reviewed details, uncertainty penalties, and a light feedback-learning layer.",
              ) +
              "</p></div>"
            : '<div class="match-section"><h4>Why the rank looks this way</h4><p class="match-score-note">' +
              escapeHtml(
                profile ? buildPublicRankingCopy(entry) : buildCompareModeRankingCopy(entry),
              ) +
              "</p></div>") +
          "</article>"
        );
      })
      .join("");
  triggerMotion(root, "motion-enter");
  root.querySelectorAll("[data-feedback-slug]").forEach(function (button) {
    button.addEventListener("click", function () {
      recordTherapistFeedback(
        button.getAttribute("data-feedback-slug"),
        button.getAttribute("data-feedback-value"),
      );
    });
  });
  root.querySelectorAll("[data-shortcut-draft]").forEach(function (button) {
    button.addEventListener("click", async function () {
      var slug = button.getAttribute("data-shortcut-draft");
      var shortcutType = button.getAttribute("data-shortcut-type") || "";
      var entry = (entries || []).find(function (item) {
        return item.therapist.slug === slug;
      });
      if (!entry) {
        return;
      }
      try {
        await navigator.clipboard.writeText(
          buildEntryOutreachDraft(entry, profile || latestProfile),
        );
        recordShortcutInteraction(shortcutType, "copy_draft", slug);
        setActionState(true, "Tailored outreach draft copied for " + entry.therapist.name + ".");
      } catch (_error) {
        setActionState(true, "Unable to copy the tailored draft automatically.");
      }
    });
  });
  root.querySelectorAll("[data-shortcut-compare]").forEach(function (button) {
    button.addEventListener("click", function () {
      var slug = button.getAttribute("data-shortcut-compare");
      var shortcutType = button.getAttribute("data-shortcut-type") || "";
      var entry = (entries || []).find(function (item) {
        return item.therapist.slug === slug;
      });
      compareFocusSlug = slug;
      recordShortcutInteraction(shortcutType, "focus_compare", slug);
      renderComparison(entries);
      triggerMotion("#matchCompare", "motion-focus");
      document
        .getElementById("matchCompare")
        .scrollIntoView({ behavior: "smooth", block: "start" });
      if (entry) {
        setActionState(true, "Focused comparison on " + entry.therapist.name + ".");
      }
    });
  });
  renderOutreachPanel(entries);
  renderComparison(entries);
}

function handleSubmit(event) {
  event.preventDefault();
  var profile = readCurrentIntakeProfile();
  var zipStatus = getZipMarketStatus(profile && profile.location_query);

  if (zipStatus.status === "out_of_state") {
    document.getElementById("resultsMeta").textContent =
      zipStatus.message + " We’re currently focused on California ZIP codes.";
    renderIntakeTradeoffPreview(profile);
    return;
  }

  if (zipStatus.status === "unknown") {
    document.getElementById("resultsMeta").textContent =
      "Enter a valid California ZIP code so we can build your shortlist.";
    renderIntakeTradeoffPreview(profile);
    return;
  }

  if (!profile.care_state) {
    document.getElementById("resultsMeta").textContent =
      "Enter a California ZIP code or California telehealth search we can match, like 90025 or Telehealth.";
    renderIntakeTradeoffPreview(profile);
    return;
  }

  activeSecondPassMode = "balanced";
  var entries = rankEntriesForProfile(profile);
  trackFunnelEvent("match_submitted", {
    care_state: profile.care_state,
    care_intent: profile.care_intent,
    urgency: profile.urgency,
    priority_mode: profile.priority_mode,
    result_count: entries.length,
    top_slug: entries[0] ? entries[0].therapist.slug : "",
    strategy: buildAdaptiveStrategySnapshot(profile),
  });
  latestProfile = profile;
  latestEntries = entries;
  serializeProfileToUrl(profile);
  renderResults(entries, profile);
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
  document.getElementById("resultsMeta").textContent =
    "Comparing " + selected.length + " saved therapist" + (selected.length > 1 ? "s" : "") + ".";
  renderResults(selected, null);
  setActionState(
    true,
    "You can compare these saved therapists or run the full intake for ranked recommendations.",
  );
  return true;
}

function resetForm() {
  var form = document.getElementById("matchForm");
  form.reset();
  syncZipResolvedLabel("");
  syncMatchCareSelectTrigger();
  renderAdaptiveIntakeGuidance(readCurrentIntakeProfile());
  renderIntakeTradeoffPreview(readCurrentIntakeProfile());
  document.getElementById("resultsMeta").textContent =
    "Start with your ZIP code first. We will lead with the best 3 options and keep up to 8 in reserve if you want more depth.";
  document.getElementById("matchSummary").textContent =
    "Start with your ZIP code, then add optional refinements only if you want a tighter shortlist.";
  activeSecondPassMode = "balanced";
  latestProfile = null;
  latestEntries = [];
  currentJourneyId = null;
  compareFocusSlug = "";
  window.history.replaceState({}, "", "match.html");
  setActionState(false, "Run a match to save, share, or email your shortlist.");
  document.getElementById("matchResults").className = "match-empty";
  document.getElementById("matchResults").innerHTML =
    "Start with your ZIP code. We’ll turn it into a calmer shortlist with clearer reasons, trust snapshots, and next steps.";
  var queue = document.getElementById("matchQueue");
  if (queue) {
    queue.hidden = true;
    queue.innerHTML = "";
  }
  document.getElementById("matchFirstContact").innerHTML = "";
  document.getElementById("matchFallbackContact").innerHTML = "";
  document.getElementById("matchAdaptiveGuidance").innerHTML = "";
  renderSecondPassControls(null, []);
  renderAdaptiveMatchActions(null, []);
  document.getElementById("matchOutreach").innerHTML = "";
  document.getElementById("matchCompare").innerHTML = "";
  updateShortlistFeedbackUi("");
  document.getElementById("feedbackStatus").textContent =
    "Your feedback helps improve which therapists rise for searches like this over time.";
}

(async function init() {
  therapists = await fetchPublicTherapists();
  latestLearningSignals = buildLearningSignals(readStoredFeedback(), readOutreachOutcomes());
  latestAdaptiveSignals = getMatchAdaptiveStrategy();
  initMatchCareDropdown();
  var matchForm = document.getElementById("matchForm");
  matchForm.addEventListener("submit", handleSubmit);
  matchForm.addEventListener("input", function () {
    var profile = readCurrentIntakeProfile();
    syncZipResolvedLabel(matchForm.elements.location_query.value);
    renderAdaptiveIntakeGuidance(profile);
    renderIntakeTradeoffPreview(profile);
  });
  matchForm.addEventListener("change", function () {
    var profile = readCurrentIntakeProfile();
    syncZipResolvedLabel(matchForm.elements.location_query.value);
    renderAdaptiveIntakeGuidance(profile);
    renderIntakeTradeoffPreview(profile);
  });
  document.getElementById("resetMatch").addEventListener("click", resetForm);
  document.getElementById("saveShortlist").addEventListener("click", function () {
    if (!latestProfile || !latestEntries.length) {
      return;
    }

    var payload = {
      saved_at: new Date().toISOString(),
      profile: latestProfile,
      therapist_slugs: latestEntries.slice(0, SHORTLIST_QUEUE_LIMIT).map(function (entry) {
        return entry.therapist.slug;
      }),
    };

    try {
      window.localStorage.setItem(SAVED_SHORTLIST_KEY, JSON.stringify(payload));
      trackFunnelEvent("match_shortlist_saved", {
        result_count: latestEntries.length,
        top_slug: latestEntries[0] ? latestEntries[0].therapist.slug : "",
        strategy: buildAdaptiveStrategySnapshot(latestProfile),
      });
      setActionState(true, "Shortlist saved on this device.");
    } catch (_error) {
      setActionState(
        true,
        "We could not save locally on this device, but you can still copy the link.",
      );
    }
  });
  document.getElementById("copyShareLink").addEventListener("click", async function () {
    if (!latestProfile || !latestEntries.length) {
      return;
    }

    try {
      await navigator.clipboard.writeText(window.location.href);
      trackFunnelEvent("match_share_link_copied", {
        result_count: latestEntries.length,
        strategy: buildAdaptiveStrategySnapshot(latestProfile),
      });
      setActionState(true, "Share link copied.");
    } catch (_error) {
      setActionState(
        true,
        "Unable to copy automatically. You can still copy the URL in your browser.",
      );
    }
  });
  document.getElementById("emailShortlist").addEventListener("click", function () {
    if (!latestEntries.length) {
      return;
    }
    openEmailShortlist();
    setActionState(true, "Email draft opened with your shortlist.");
  });
  document.getElementById("requestHelp").addEventListener("click", function () {
    if (!latestProfile || !latestEntries.length) {
      return;
    }

    scrollToConciergePanel();
    trackFunnelEvent("match_help_requested", {
      result_count: latestEntries.length,
      top_slug: latestEntries[0] ? latestEntries[0].therapist.slug : "",
      strategy: buildAdaptiveStrategySnapshot(latestProfile),
    });
    setActionState(
      true,
      "Use the help request form below if you want help narrowing the shortlist.",
    );
  });
  document.getElementById("feedbackShortlistPositive").addEventListener("click", function () {
    recordShortlistFeedback("positive");
  });
  document.getElementById("feedbackShortlistNegative").addEventListener("click", function () {
    recordShortlistFeedback("negative");
  });

  var restoredProfile = restoreProfileFromUrl();
  var restoredShortlist = restoreShortlistFromUrl();
  renderAdaptiveIntakeGuidance(readCurrentIntakeProfile());
  renderIntakeTradeoffPreview(readCurrentIntakeProfile());
  if (restoredProfile) {
    hydrateForm(restoredProfile);
    latestProfile = restoredProfile;
    activeSecondPassMode = "balanced";
    latestEntries = rankEntriesForProfile(restoredProfile);
    renderResults(latestEntries, restoredProfile);
  } else if (!restoredProfile && restoredShortlist.length) {
    renderDirectoryShortlist(restoredShortlist);
  } else {
    syncZipResolvedLabel(matchForm.elements.location_query.value);
    setActionState(false, "Run a match to save, share, or email your shortlist.");
    renderAdaptiveMatchActions(null, []);
    updateShortlistFeedbackUi("");
  }
  renderFeedbackInsights();
})();
