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
  const settings = options || {};
  const therapists = Array.isArray(settings.therapists) ? settings.therapists : [];
  const stateMap = settings.stateMap || {};
  const normalized = normalizeLocationQuery(value);
  if (!normalized) {
    return "";
  }

  const upper = normalized.toUpperCase();
  if (/^\d{5}$/.test(normalized)) {
    const zipStatus = getZipMarketStatus(normalized);
    return zipStatus.place ? zipStatus.place.state : "";
  }
  if (/^[A-Z]{2}$/.test(upper)) {
    return upper;
  }

  if (stateMap[upper]) {
    return stateMap[upper];
  }

  const cityMatch = therapists.find(function (therapist) {
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

  const knownState = Object.keys(stateMap).find(function (stateName) {
    return upper.indexOf(stateName) !== -1;
  });
  return knownState ? stateMap[knownState] : "";
}

export function syncZipResolvedLabel(value) {
  const resolvedNodes = Array.from(document.querySelectorAll(".match-zip-resolved"));
  if (!resolvedNodes.length) {
    return;
  }

  const zipStatus = getZipMarketStatus(value);
  if (zipStatus.status === "invalid") {
    const invalidMessage = String(value || "").trim() ? "Enter a valid 5-digit ZIP code." : "";
    resolvedNodes.forEach(function (resolved) {
      resolved.textContent = invalidMessage;
      resolved.classList.toggle("is-visible", Boolean(String(value || "").trim()));
    });
    return;
  }

  if (!zipStatus.place) {
    resolvedNodes.forEach(function (resolved) {
      resolved.textContent = "";
      resolved.classList.remove("is-visible");
    });
    return;
  }

  const resolvedText =
    zipStatus.status === "live" ? "- " + zipStatus.place.label : zipStatus.message;
  resolvedNodes.forEach(function (resolved) {
    resolved.textContent = resolvedText;
    resolved.classList.add("is-visible");
  });
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
  const settings = options || {};
  const form = settings.form || document.getElementById("matchForm");
  const button = settings.button || document.getElementById("matchSearchButton");
  const helper = settings.helper || document.getElementById("matchStartHelper");
  const careField = settings.careField || document.querySelector("[data-match-care-field]");
  const escapeHtml =
    settings.escapeHtml ||
    function (value) {
      return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
        return ch === "&"
          ? "&amp;"
          : ch === "<"
            ? "&lt;"
            : ch === ">"
              ? "&gt;"
              : ch === '"'
                ? "&quot;"
                : "&#39;";
      });
    };

  if (!form) {
    return;
  }

  const careIntent = String(
    form.elements.care_intent ? form.elements.care_intent.value : "",
  ).trim();
  const hasZip = Boolean(
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
  const hasRefinements = hasMeaningfulRefinements(profile);
  const summary = [
    profile.location_query ? "Location: " + profile.location_query : "",
    !profile.location_query && profile.care_state ? "State: " + profile.care_state : "",
    profile.care_format && profile.care_format !== "Either" ? "Format: " + profile.care_format : "",
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

// Keyed pill items so surfaces can offer per-pill removal. `key` names the
// intake field behind the pill; `removable: false` marks constraints the
// user cannot drop (the CA-statewide floor of the MVP directory).
export function buildAppliedAnswerPillItems(profile) {
  if (!profile) {
    return [];
  }

  const pills = [];

  if (profile.care_intent && profile.care_intent !== "Either") {
    pills.push({
      key: "care_intent",
      label: profile.care_intent === "Psychiatry" ? "Medication support" : "Talk therapy",
      removable: true,
    });
  }

  if (profile.location_query) {
    pills.push({ key: "location_query", label: "ZIP " + profile.location_query, removable: true });
  } else if (profile.care_state) {
    pills.push({
      key: "care_state",
      label: profile.care_state + " statewide",
      removable: false,
    });
  }

  if (profile.care_format && profile.care_format !== "Either") {
    pills.push({ key: "care_format", label: profile.care_format, removable: true });
  }

  if (
    profile.needs_medication_management &&
    profile.needs_medication_management !== "Open to either"
  ) {
    pills.push({
      key: "needs_medication_management",
      label:
        profile.needs_medication_management === "Yes"
          ? "Medication management needed"
          : "No medication management",
      removable: true,
    });
  }

  if (profile.insurance) {
    pills.push({ key: "insurance", label: "Insurance: " + profile.insurance, removable: true });
  }

  if (profile.priority_mode && profile.priority_mode !== "Best overall fit") {
    pills.push({ key: "priority_mode", label: profile.priority_mode, removable: true });
  }

  return pills.slice(0, 6);
}

export function buildAppliedAnswerPills(profile) {
  return buildAppliedAnswerPillItems(profile).map(function (pill) {
    return pill.label;
  });
}

export function hasMeaningfulRefinements(profile) {
  if (!profile) {
    return false;
  }

  return Boolean(
    (profile.care_format && profile.care_format !== "Either") ||
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
  const settings = options || {};
  const form = settings.form || document.getElementById("matchForm");
  if (!form) {
    return null;
  }
  function readFieldValue(name) {
    const nodes = Array.from(form.querySelectorAll('[name="' + name + '"]'));
    if (!nodes.length) {
      return "";
    }
    const firstNode = nodes[0];
    if (firstNode.type === "radio") {
      const checkedNode = nodes.find(function (node) {
        return node.checked;
      });
      return checkedNode ? checkedNode.value : "";
    }
    if (firstNode.type === "checkbox") {
      const checkedBox = nodes.find(function (node) {
        return node.checked;
      });
      return checkedBox ? checkedBox.value : "";
    }
    const activeNode =
      typeof document !== "undefined" && document.activeElement
        ? nodes.find(function (node) {
            return node === document.activeElement;
          })
        : null;
    if (activeNode) {
      return activeNode.value;
    }
    for (let i = nodes.length - 1; i >= 0; i--) {
      const value = String(nodes[i].value || "").trim();
      if (value) {
        return nodes[i].value;
      }
    }
    return firstNode.value || "";
  }
  const urgencyField = form.elements.urgency;
  const locationQuery = normalizeLocationQuery(readFieldValue("location_query"));
  const profile = settings.buildUserMatchProfile({
    care_state: settings.deriveStateFromLocation(locationQuery),
    care_format: readFieldValue("care_format"),
    care_intent: readFieldValue("care_intent"),
    needs_medication_management: readFieldValue("needs_medication_management"),
    insurance: readFieldValue("insurance"),
    budget_max: readFieldValue("budget_max"),
    urgency: urgencyField ? urgencyField.value : "ASAP",
    priority_mode: readFieldValue("priority_mode"),
    bipolar_focus: settings.collectCheckedValues(form, "bipolar_focus"),
    preferred_modalities: settings.collectCheckedValues(form, "preferred_modalities"),
    population_fit: settings.collectCheckedValues(form, "population_fit"),
    language_preferences: settings.splitCommaSeparated(readFieldValue("language_preferences")),
    therapist_gender_preference: readFieldValue("therapist_gender_preference"),
  });
  profile.location_query = locationQuery;
  return profile;
}

export function serializeProfileToUrl(profile) {
  const params = new URLSearchParams();
  Object.keys(profile || {}).forEach(function (key) {
    const value = profile[key];
    if (!value || (Array.isArray(value) && !value.length)) {
      return;
    }
    if (Array.isArray(value)) {
      params.set(key, value.join(","));
      return;
    }
    params.set(key, String(value));
  });
  const next = params.toString() ? "match.html?" + params.toString() : "match.html";
  window.history.replaceState({}, "", next);
}

export function restoreProfileFromUrl(options) {
  const settings = options || {};
  const params = new URLSearchParams(window.location.search);
  if (!params.toString()) {
    return null;
  }

  const intakeKeys = [
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
    "therapist_gender_preference",
  ];

  const hasIntakeParams = intakeKeys.some(function (key) {
    return String(params.get(key) || "").trim() !== "";
  });

  if (!hasIntakeParams) {
    return null;
  }

  const locationQuery = params.get("location_query") || "";
  const profile = settings.buildUserMatchProfile({
    care_state: settings.deriveStateFromLocation(locationQuery) || params.get("care_state") || "",
    // Default to "" (Any) when not specified. Previously defaulted to
    // "In-Person", which silently narrowed every home-form-originated
    // search to in-person providers and biased ranking by ZIP-distance
    // before the user told us their format preference. Empty = neutral
    // (form has a radio with value="" labeled Any).
    care_format: params.get("care_format") || "",
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
    therapist_gender_preference: params.get("therapist_gender_preference") || "",
  });
  profile.location_query = locationQuery;
  return profile;
}

export function restoreShortlistFromUrl(splitCommaSeparated) {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("shortlist") || "";
  if (!raw) {
    return [];
  }

  return splitCommaSeparated(raw);
}

export function hydrateForm(profile, options) {
  if (!profile) {
    return;
  }

  const settings = options || {};
  const form = settings.form || document.getElementById("matchForm");
  function setFieldValue(name, value) {
    const nodes = form.querySelectorAll('[name="' + name + '"], [data-sync-key="' + name + '"]');
    nodes.forEach(function (node) {
      if (node.type === "radio") {
        node.checked = node.value === value;
        return;
      }
      if (node.type === "checkbox") {
        node.checked = Array.isArray(value)
          ? value.indexOf(node.value) !== -1
          : node.value === value;
        return;
      }
      node.value = value;
    });
  }
  const locationValue = profile.location_query || profile.care_state || "";
  setFieldValue("location_query", locationValue);
  settings.syncZipResolvedLabel(locationValue);
  // "Either" is the model's internal default for "no format preference";
  // the form uses value="" for the "Any" radio, so normalize on hydration.
  setFieldValue("care_format", profile.care_format === "Either" ? "" : profile.care_format || "");
  setFieldValue("care_intent", profile.care_intent || "");
  setFieldValue(
    "needs_medication_management",
    profile.needs_medication_management || "Open to either",
  );
  setFieldValue("insurance", profile.insurance || "");
  setFieldValue("budget_max", profile.budget_max || "");
  if (form.elements.urgency) {
    setFieldValue("urgency", profile.urgency || "ASAP");
  }
  setFieldValue("priority_mode", profile.priority_mode || "Best overall fit");
  setFieldValue("language_preferences", (profile.language_preferences || []).join(", "));
  setFieldValue("therapist_gender_preference", profile.therapist_gender_preference || "");

  ["bipolar_focus", "preferred_modalities", "population_fit"].forEach(function (name) {
    const selected = new Set(profile[name] || []);
    form.querySelectorAll('input[name="' + name + '"]').forEach(function (input) {
      input.checked = selected.has(input.value);
    });
  });
}
