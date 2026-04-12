import { getZipMarketStatus } from "./zip-lookup.js";

export function normalizeLocationQuery(value) {
  return String(value || "").trim();
}

export function splitCommaSeparated(value) {
  return String(value || "")
    .split(",")
    .map(function (item) {
      return item.trim();
    })
    .filter(Boolean);
}

export function deriveStateFromLocation(value, options) {
  var settings = options || {};
  var therapists = Array.isArray(settings.therapists) ? settings.therapists : [];
  var stateMap = settings.stateMap || {};
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

  if (stateMap[upper]) {
    return stateMap[upper];
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

  var knownState = Object.keys(stateMap).find(function (stateName) {
    return upper.indexOf(stateName) !== -1;
  });
  return knownState ? stateMap[knownState] : "";
}

export function syncZipResolvedLabel(value) {
  var resolved = document.getElementById("matchZipResolved");
  if (!resolved) {
    return;
  }

  var zipStatus = getZipMarketStatus(value);
  if (zipStatus.status === "invalid") {
    resolved.textContent = String(value || "").trim() ? "Enter a valid 5-digit ZIP code." : "";
    resolved.classList.toggle("is-visible", Boolean(String(value || "").trim()));
    return;
  }

  if (!zipStatus.place) {
    resolved.textContent = "";
    resolved.classList.remove("is-visible");
    return;
  }

  resolved.textContent =
    zipStatus.status === "live" ? "- " + zipStatus.place.label : zipStatus.message;
  resolved.classList.add("is-visible");
}

export function getMatchSearchButtonLabel(careIntent) {
  if (!careIntent) {
    return "See my matches";
  }

  if (careIntent === "Psychiatry") {
    return "See psychiatry matches";
  }

  return "See therapy matches";
}

export function getMatchStartHelperCopy(careIntent, hasZip, escapeHtml) {
  if (!careIntent && !hasZip) {
    return "<strong>Next:</strong> choose your care type and California ZIP code to begin.";
  }

  if (careIntent && !hasZip) {
    return (
      "<strong>Next:</strong> add your California ZIP code to see your " +
      escapeHtml(careIntent === "Psychiatry" ? "psychiatry" : "therapy") +
      " matches."
    );
  }

  if (!careIntent && hasZip) {
    return "<strong>Next:</strong> choose therapy or psychiatry so we can narrow the list.";
  }

  return "<strong>Next:</strong> review your first list, then refine only if you need to.";
}

export function syncMatchStartState(options) {
  var settings = options || {};
  var form = settings.form || document.getElementById("matchForm");
  var button = settings.button || document.getElementById("matchSearchButton");
  var helper = settings.helper || document.getElementById("matchStartHelper");
  var careField = settings.careField || document.querySelector("[data-match-care-field]");
  var escapeHtml = settings.escapeHtml || String;

  if (!form) {
    return;
  }

  var careIntent = String(form.elements.care_intent ? form.elements.care_intent.value : "").trim();
  var hasZip = Boolean(
    normalizeLocationQuery(form.elements.location_query ? form.elements.location_query.value : ""),
  );

  if (careField) {
    careField.classList.toggle("has-value", Boolean(careIntent));
  }

  syncZipResolvedLabel(form.elements.location_query ? form.elements.location_query.value : "");

  if (button) {
    button.textContent = getMatchSearchButtonLabel(careIntent);
  }

  if (helper) {
    helper.innerHTML = getMatchStartHelperCopy(careIntent, hasZip, escapeHtml);
  }
}

export function buildRequestSummary(profile, hasMeaningfulRefinements) {
  var hasRefinements = hasMeaningfulRefinements(profile);
  var summary = [
    profile.location_query ? "Location: " + profile.location_query : "",
    !profile.location_query && profile.care_state ? "State: " + profile.care_state : "",
    profile.care_format && profile.care_format !== "In-Person"
      ? "Format: " + profile.care_format
      : "",
    profile.care_intent && profile.care_intent !== "Therapy"
      ? "Looking for: " + profile.care_intent
      : "",
    profile.needs_medication_management === "Yes" ? "Needs medication management" : "",
    profile.insurance ? "Insurance: " + profile.insurance : "",
    profile.priority_mode && profile.priority_mode !== "Best overall fit"
      ? "Priority: " + profile.priority_mode
      : "",
  ].filter(Boolean);

  if (summary.length === 1 && profile.location_query && !hasRefinements) {
    return (
      "Location: " + profile.location_query + " • Broad list with optional refinements still open."
    );
  }

  return summary.length ? summary.join(" • ") : "List based on your current answers.";
}

export function buildAppliedAnswerPills(profile) {
  if (!profile) {
    return [];
  }

  var pills = [];

  if (profile.care_intent) {
    pills.push(profile.care_intent);
  }

  if (profile.location_query) {
    pills.push("ZIP " + profile.location_query);
  } else if (profile.care_state) {
    pills.push(profile.care_state + " statewide");
  }

  if (profile.care_format && profile.care_format !== "In-Person") {
    pills.push(profile.care_format);
  }

  if (
    profile.needs_medication_management &&
    profile.needs_medication_management !== "Open to either"
  ) {
    pills.push(
      profile.needs_medication_management === "Yes"
        ? "Medication management needed"
        : "No medication management",
    );
  }

  if (profile.insurance) {
    pills.push("Insurance: " + profile.insurance);
  }

  if (profile.priority_mode && profile.priority_mode !== "Best overall fit") {
    pills.push(profile.priority_mode);
  }

  return pills.slice(0, 6);
}

export function hasMeaningfulRefinements(profile) {
  if (!profile) {
    return false;
  }

  return Boolean(
    (profile.care_format && profile.care_format !== "In-Person") ||
    (profile.care_intent && profile.care_intent !== "Therapy") ||
    (profile.needs_medication_management &&
      profile.needs_medication_management !== "Open to either") ||
    profile.insurance ||
    profile.budget_max ||
    (profile.priority_mode && profile.priority_mode !== "Best overall fit") ||
    (profile.bipolar_focus && profile.bipolar_focus.length) ||
    (profile.preferred_modalities && profile.preferred_modalities.length) ||
    (profile.population_fit && profile.population_fit.length) ||
    (profile.language_preferences && profile.language_preferences.length),
  );
}

export function readCurrentIntakeProfile(options) {
  var settings = options || {};
  var form = settings.form || document.getElementById("matchForm");
  if (!form) {
    return null;
  }
  var urgencyField = form.elements.urgency;
  var locationQuery = normalizeLocationQuery(form.elements.location_query.value);
  var profile = settings.buildUserMatchProfile({
    care_state: settings.deriveStateFromLocation(locationQuery),
    care_format: form.elements.care_format.value,
    care_intent: form.elements.care_intent.value,
    needs_medication_management: form.elements.needs_medication_management.value,
    insurance: form.elements.insurance.value,
    budget_max: form.elements.budget_max.value,
    urgency: urgencyField ? urgencyField.value : "ASAP",
    priority_mode: form.elements.priority_mode.value,
    bipolar_focus: settings.collectCheckedValues(form, "bipolar_focus"),
    preferred_modalities: settings.collectCheckedValues(form, "preferred_modalities"),
    population_fit: settings.collectCheckedValues(form, "population_fit"),
    language_preferences: settings.splitCommaSeparated(form.elements.language_preferences.value),
  });
  profile.location_query = locationQuery;
  return profile;
}

export function serializeProfileToUrl(profile) {
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

export function restoreProfileFromUrl(options) {
  var settings = options || {};
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
  var profile = settings.buildUserMatchProfile({
    care_state: settings.deriveStateFromLocation(locationQuery) || params.get("care_state") || "",
    care_format: params.get("care_format") || "In-Person",
    care_intent: params.get("care_intent") || "",
    needs_medication_management: params.get("needs_medication_management") || "Open to either",
    insurance: params.get("insurance") || "",
    budget_max: params.get("budget_max") || "",
    urgency: params.get("urgency") || "ASAP",
    priority_mode: params.get("priority_mode") || "Best overall fit",
    bipolar_focus: settings.splitCommaSeparated(params.get("bipolar_focus") || ""),
    preferred_modalities: settings.splitCommaSeparated(params.get("preferred_modalities") || ""),
    population_fit: settings.splitCommaSeparated(params.get("population_fit") || ""),
    language_preferences: settings.splitCommaSeparated(params.get("language_preferences") || ""),
  });
  profile.location_query = locationQuery;
  return profile;
}

export function restoreShortlistFromUrl(splitCommaSeparated) {
  var params = new URLSearchParams(window.location.search);
  var raw = params.get("shortlist") || "";
  if (!raw) {
    return [];
  }

  return splitCommaSeparated(raw);
}

export function hydrateForm(profile, options) {
  if (!profile) {
    return;
  }

  var settings = options || {};
  var form = settings.form || document.getElementById("matchForm");
  form.elements.location_query.value = profile.location_query || profile.care_state || "";
  settings.syncZipResolvedLabel(form.elements.location_query.value);
  form.elements.care_format.value = profile.care_format || "In-Person";
  form.elements.care_intent.value = profile.care_intent || "";
  form.elements.needs_medication_management.value =
    profile.needs_medication_management || "Open to either";
  form.elements.insurance.value = profile.insurance || "";
  form.elements.budget_max.value = profile.budget_max || "";
  if (form.elements.urgency) {
    form.elements.urgency.value = profile.urgency || "ASAP";
  }
  form.elements.priority_mode.value = profile.priority_mode || "Best overall fit";
  form.elements.language_preferences.value = (profile.language_preferences || []).join(", ");

  ["bipolar_focus", "preferred_modalities", "population_fit"].forEach(function (name) {
    var selected = new Set(profile[name] || []);
    form.querySelectorAll('input[name="' + name + '"]').forEach(function (input) {
      input.checked = selected.has(input.value);
    });
  });
}
