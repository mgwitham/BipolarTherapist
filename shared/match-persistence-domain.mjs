function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeEnumValue(value, options) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }

  const directMatch = options[normalized];
  if (directMatch) {
    return directMatch;
  }

  const folded = normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return options[folded] || folded;
}

const CARE_FORMAT_OPTIONS = {
  telehealth: "telehealth",
  in_person: "in_person",
  "in-person": "in_person",
  either: "either",
};

const CARE_INTENT_OPTIONS = {
  therapy: "therapy",
  psychiatry: "psychiatry",
  either: "either",
};

const MEDICATION_OPTIONS = {
  yes: "yes",
  no: "no",
  open: "open",
  open_to_either: "open",
};

const PRIORITY_MODE_OPTIONS = {
  best_overall_fit: "best_overall_fit",
  soonest_availability: "soonest_availability",
  lowest_cost: "lowest_cost",
  highest_specialization: "highest_specialization",
};

const URGENCY_OPTIONS = {
  asap: "asap",
  within_2_weeks: "within_2_weeks",
  within_a_month: "within_a_month",
  flexible: "flexible",
};

const BIPOLAR_FOCUS_OPTIONS = {
  bipolar_i: "bipolar_i",
  bipolar_ii: "bipolar_ii",
  cyclothymia: "cyclothymia",
  rapid_cycling: "rapid_cycling",
  mixed_episodes: "mixed_episodes",
  psychosis: "psychosis",
  medication_management: "medication_management",
  family_support: "family_support",
};

const MODALITY_OPTIONS = {
  cbt: "cbt",
  dbt: "dbt",
  ipsrt: "ipsrt",
  act: "act",
  psychodynamic: "psychodynamic",
  emdr: "emdr",
  family_systems: "family_systems",
};

const POPULATION_OPTIONS = {
  adults: "adults",
  young_adults: "young_adults",
  adolescents: "adolescents",
  couples: "couples",
  families: "families",
  professionals: "professionals",
  college_students: "college_students",
  lgbtq: "lgbtq",
};

const LANGUAGE_OPTIONS = {
  english: "english",
  spanish: "spanish",
  mandarin: "mandarin",
  cantonese: "cantonese",
  hindi: "hindi",
  french: "french",
  korean: "korean",
  vietnamese: "vietnamese",
  tagalog: "tagalog",
  arabic: "arabic",
  portuguese: "portuguese",
  russian: "russian",
  japanese: "japanese",
  german: "german",
};

function normalizeList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(function (item) {
      return normalizeText(item);
    })
    .filter(Boolean);
}

function normalizeControlledList(value, options) {
  return normalizeList(value)
    .map(function (item) {
      return normalizeEnumValue(item, options);
    })
    .filter(Boolean);
}

function stringify(value) {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return String(value);
  }
}

function normalizeIdSegment(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function hashString(value) {
  const input = String(value || "");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function normalizePortableMatchRequest(input) {
  const requestId =
    normalizeText(input.requestId || input.request_id || input.journey_id) ||
    `match-request-${Date.now()}`;

  return {
    request_id: requestId,
    session_id: normalizeText(input.sessionId || input.session_id),
    user_id: normalizeText(input.userId || input.user_id),
    care_state: normalizeText(input.careState || input.care_state),
    care_format: normalizeEnumValue(input.careFormat || input.care_format, CARE_FORMAT_OPTIONS),
    care_intent: normalizeEnumValue(input.careIntent || input.care_intent, CARE_INTENT_OPTIONS),
    needs_medication_management: normalizeEnumValue(
      input.needsMedicationManagement || input.needs_medication_management,
      MEDICATION_OPTIONS,
    ),
    insurance_preference: normalizeText(input.insurancePreference || input.insurance || input.insurance_preference),
    budget_max:
      typeof (input.budgetMax || input.budget_max) === "number"
        ? input.budgetMax || input.budget_max
        : Number(input.budgetMax || input.budget_max || 0) || null,
    priority_mode: normalizeEnumValue(input.priorityMode || input.priority_mode, PRIORITY_MODE_OPTIONS),
    urgency: normalizeEnumValue(input.urgency, URGENCY_OPTIONS),
    bipolar_focus: normalizeControlledList(input.bipolarFocus || input.bipolar_focus, BIPOLAR_FOCUS_OPTIONS),
    preferred_modalities: normalizeControlledList(
      input.preferredModalities || input.preferred_modalities,
      MODALITY_OPTIONS,
    ),
    population_fit: normalizeControlledList(input.populationFit || input.population_fit, POPULATION_OPTIONS),
    language_preferences: normalizeControlledList(
      input.languagePreferences || input.language_preferences,
      LANGUAGE_OPTIONS,
    ),
    cultural_preferences: normalizeText(input.culturalPreferences || input.cultural_preferences),
    request_summary: normalizeText(input.requestSummary || input.request_summary),
    source_surface: normalizeText(input.sourceSurface || input.source_surface) || "match_flow",
    created_at: normalizeText(input.createdAt || input.created_at) || new Date().toISOString(),
  };
}

export function normalizePortableMatchOutcome(input) {
  const outcomeId =
    normalizeText(input.outcomeId || input.outcome_id) ||
    [
      "match-outcome",
      normalizeText(input.requestId || input.request_id || input.journey_id) || "request",
      normalizeText(input.therapistSlug || input.therapist_slug) || "therapist",
      normalizeText(input.recordedAt || input.recorded_at) || Date.now(),
    ].join("-");

  return {
    outcome_id: outcomeId,
    request_id: normalizeText(input.requestId || input.request_id || input.journey_id),
    provider_id: normalizeText(input.providerId || input.provider_id),
    therapist_slug: normalizeText(input.therapistSlug || input.therapist_slug),
    therapist_name: normalizeText(input.therapistName || input.therapist_name),
    rank_position: Number(input.rankPosition || input.rank_position || 0) || null,
    result_count: Number(input.resultCount || input.result_count || 0) || null,
    top_slug: normalizeText(input.topSlug || input.top_slug),
    route_type: normalizeText(input.routeType || input.route_type),
    shortcut_type: normalizeText(input.shortcutType || input.shortcut_type),
    pivot_at: normalizeText(input.pivotAt || input.pivot_at),
    recommended_wait_window: normalizeText(
      input.recommendedWaitWindow || input.recommended_wait_window,
    ),
    outcome: normalizeText(input.outcome),
    request_summary: normalizeText(input.requestSummary || input.request_summary),
    recorded_at: normalizeText(input.recordedAt || input.recorded_at) || new Date().toISOString(),
    context_summary: normalizeText(
      (input.context && input.context.summary) || input.contextSummary || input.context_summary,
    ),
    strategy_snapshot: stringify(
      (input.context && input.context.strategy) || input.strategySnapshot || input.strategy_snapshot,
    ),
  };
}

export function buildMatchRequestDocument(input) {
  const record = normalizePortableMatchRequest(input);
  const idBase = normalizeIdSegment(record.request_id) || hashString(record.request_id);
  return {
    _id: `match-request-${idBase || hashString(JSON.stringify(record))}`,
    _type: "matchRequest",
    requestId: record.request_id,
    sessionId: record.session_id,
    userId: record.user_id,
    careState: record.care_state,
    careFormat: record.care_format,
    careIntent: record.care_intent,
    needsMedicationManagement: record.needs_medication_management,
    insurancePreference: record.insurance_preference,
    budgetMax: record.budget_max == null ? undefined : record.budget_max,
    priorityMode: record.priority_mode,
    urgency: record.urgency,
    bipolarFocus: record.bipolar_focus,
    preferredModalities: record.preferred_modalities,
    populationFit: record.population_fit,
    languagePreferences: record.language_preferences,
    culturalPreferences: record.cultural_preferences,
    createdAt: record.created_at,
    requestSummary: record.request_summary,
    sourceSurface: record.source_surface,
  };
}

export function buildMatchOutcomeDocument(input) {
  const record = normalizePortableMatchOutcome(input);
  const idBase =
    normalizeIdSegment(record.outcome_id) ||
    hashString([record.request_id, record.therapist_slug, record.recorded_at].join("|"));
  return {
    _id: `match-outcome-${idBase}`,
    _type: "matchOutcome",
    outcomeId: record.outcome_id,
    requestId: record.request_id,
    providerId: record.provider_id,
    therapistSlug: record.therapist_slug,
    therapistName: record.therapist_name,
    rankPosition: record.rank_position == null ? undefined : record.rank_position,
    resultCount: record.result_count == null ? undefined : record.result_count,
    topSlug: record.top_slug,
    routeType: record.route_type,
    shortcutType: record.shortcut_type,
    pivotAt: record.pivot_at,
    recommendedWaitWindow: record.recommended_wait_window,
    outcome: record.outcome,
    recordedAt: record.recorded_at,
    requestSummary: record.request_summary,
    contextSummary: record.context_summary,
    strategySnapshot: record.strategy_snapshot,
  };
}
