export const MATCH_INTAKE_QUESTIONS = [
  {
    id: "care_state",
    prompt: "Which state are you seeking care in?",
    type: "text",
    required: true,
    category: "hard_constraint",
  },
  {
    id: "care_format",
    prompt: "Do you want telehealth, in-person, or either?",
    type: "single_select",
    required: true,
    category: "hard_constraint",
    options: ["Telehealth", "In-Person", "Either"],
  },
  {
    id: "care_intent",
    prompt: "Are you looking for therapy, psychiatry, or either?",
    type: "single_select",
    required: true,
    category: "hard_constraint",
    options: ["Either", "Therapy", "Psychiatry"],
  },
  {
    id: "needs_medication_management",
    prompt: "Do you need medication management or prescribing support?",
    type: "single_select",
    required: true,
    category: "hard_constraint",
    options: ["Yes", "No", "Open to either"],
  },
  {
    id: "insurance",
    prompt: "Do you want to use insurance, self-pay, or are you open to either?",
    type: "text",
    required: false,
    category: "hard_constraint",
  },
  {
    id: "budget_max",
    prompt: "What is your approximate max session budget?",
    type: "number",
    required: false,
    category: "hard_constraint",
  },
  {
    id: "priority_mode",
    prompt: "What matters most right now?",
    type: "single_select",
    required: true,
    category: "hard_constraint",
    options: ["Best overall fit", "Soonest availability", "Lowest cost", "Highest specialization"],
  },
  {
    id: "urgency",
    prompt: "How quickly are you hoping to get started?",
    type: "single_select",
    required: true,
    category: "hard_constraint",
    options: ["ASAP", "Within 2 weeks", "Within a month", "Flexible"],
  },
  {
    id: "bipolar_focus",
    prompt: "What bipolar-related concerns matter most right now?",
    type: "multi_select",
    required: false,
    category: "clinical_fit",
    options: [
      "Bipolar I",
      "Bipolar II",
      "Cyclothymia",
      "Rapid Cycling",
      "Mixed Episodes",
      "Psychosis",
      "Medication Management",
      "Family Support",
    ],
  },
  {
    id: "preferred_modalities",
    prompt: "Are there any therapy approaches you already know you want?",
    type: "multi_select",
    required: false,
    category: "clinical_fit",
    options: [
      "CBT",
      "DBT",
      "IPSRT",
      "ACT",
      "Family therapy",
      "Mindfulness-based therapy",
      "Psychoeducation",
    ],
  },
  {
    id: "population_fit",
    prompt: "Which of these best describes you or your care context?",
    type: "multi_select",
    required: false,
    category: "clinical_fit",
    options: [
      "Adults",
      "Young adults",
      "Adolescents",
      "Couples",
      "Families",
      "Professionals",
      "College students",
      "LGBTQ+",
    ],
  },
  {
    id: "language_preferences",
    prompt: "Do you want care in a specific language?",
    type: "text_list",
    required: false,
    category: "clinical_fit",
  },
  {
    id: "cultural_preferences",
    prompt: "Are there cultural or lived-experience preferences that matter to you?",
    type: "text",
    required: false,
    category: "soft_signal",
  },
];

const WAIT_TIME_PRIORITY = {
  "Immediate availability": 0,
  "Within 1 week": 1,
  "Within 2 weeks": 2,
  "2-4 weeks": 3,
  "Within a month": 3,
  "1-2 months": 4,
  "Waitlist only": 5,
};

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeUpper(value) {
  return normalizeText(value).toUpperCase();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

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

function getFieldReviewStates(therapist) {
  var states = therapist && therapist.field_review_states ? therapist.field_review_states : {};
  return {
    estimated_wait_time: states.estimated_wait_time || "therapist_confirmed",
    insurance_accepted: states.insurance_accepted || "therapist_confirmed",
    telehealth_states: states.telehealth_states || "therapist_confirmed",
    bipolar_years_experience: states.bipolar_years_experience || "therapist_confirmed",
  };
}

export function getEditoriallyVerifiedOperationalCount(therapist) {
  var states = getFieldReviewStates(therapist);
  return Object.values(states).filter(function (value) {
    return value === "editorially_verified";
  }).length;
}

export function getOperationalTrustSummary(therapist) {
  var editorialCount = getEditoriallyVerifiedOperationalCount(therapist);
  var therapistConfirmedCount = Array.isArray(therapist && therapist.therapist_reported_fields)
    ? therapist.therapist_reported_fields.length
    : 0;

  if (editorialCount >= 3) {
    return "Several key access details are editor-verified.";
  }
  if (editorialCount >= 1) {
    return (
      editorialCount +
      " key operational detail" +
      (editorialCount > 1 ? "s are" : " is") +
      " editor-verified."
    );
  }
  if (therapistConfirmedCount) {
    return "Includes specialist-confirmed operational details.";
  }
  return "";
}

function daysSince(value) {
  if (!value) {
    return null;
  }

  var date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  var now = new Date();
  var diff = now.getTime() - date.getTime();
  return Math.max(0, Math.round(diff / 86400000));
}

export function getRecentConfirmationSummary(therapist) {
  var fields = Array.isArray(therapist && therapist.therapist_reported_fields)
    ? therapist.therapist_reported_fields.filter(Boolean)
    : [];
  var confirmedDays = daysSince(therapist && therapist.therapist_reported_confirmed_at);

  if (!fields.length || confirmedDays === null) {
    return null;
  }

  if (confirmedDays <= 30) {
    return {
      tone: "fresh",
      label: "Recently re-confirmed",
      short_label: "Recently re-confirmed",
      note:
        fields.length +
        " operational detail" +
        (fields.length > 1 ? "s were" : " was") +
        " reconfirmed directly by the specialist in the last 30 days.",
    };
  }

  if (confirmedDays <= 90) {
    return {
      tone: "recent",
      label: "Specialist-confirmed recently",
      short_label: "Confirmed recently",
      note:
        fields.length +
        " operational detail" +
        (fields.length > 1 ? "s were" : " was") +
        " confirmed directly by the specialist within the last 90 days.",
    };
  }

  return null;
}

export function getRecentAppliedSummary(therapist) {
  var appliedDays = daysSince(therapist && therapist.confirmation_applied_at);
  if (appliedDays === null || appliedDays > 21) {
    return null;
  }

  if (appliedDays <= 7) {
    return {
      tone: "fresh",
      label: "Recently updated",
      short_label: "Recently updated",
      note: "Recent profile updates were applied within the last week, so key operational details may be more current than older profiles.",
    };
  }

  return {
    tone: "recent",
    label: "Updated recently",
    short_label: "Updated recently",
    note: "Recent profile updates were applied within the last few weeks, which can make the operational details more current while the next refresh window is still settling.",
  };
}

export function getDataFreshnessSummary(therapist) {
  var sourceDays = daysSince(therapist && therapist.source_reviewed_at);
  var therapistDays = daysSince(therapist && therapist.therapist_reported_confirmed_at);
  var appliedDays = daysSince(therapist && therapist.confirmation_applied_at);
  var states = getFieldReviewStates(therapist);
  var needsReconfirmation = Object.keys(states).filter(function (key) {
    return states[key] === "needs_reconfirmation";
  });
  var staleReasons = [];
  var recentlyApplied = appliedDays !== null && appliedDays <= 21;

  if (recentlyApplied) {
    needsReconfirmation = [];
  }

  if (sourceDays !== null && sourceDays > 90) {
    staleReasons.push("public-source review is aging");
  }
  if (therapistDays !== null && therapistDays > 60 && !recentlyApplied) {
    staleReasons.push("specialist-confirmed details are aging");
  }
  if (needsReconfirmation.length && !recentlyApplied) {
    staleReasons.push(
      needsReconfirmation.length +
        " operational field" +
        (needsReconfirmation.length > 1 ? "s need" : " needs") +
        " re-confirmation",
    );
  }

  var status = "fresh";
  var label = "Freshly reviewed";
  var note = "Source-backed trust details were reviewed recently.";
  var recentConfirmation = getRecentConfirmationSummary(therapist);
  var recentApplied = getRecentAppliedSummary(therapist);

  if (recentConfirmation && !staleReasons.length) {
    note = recentConfirmation.note;
  }

  if (recentApplied) {
    label = recentApplied.label;
    note = recentApplied.note;
  }

  if (staleReasons.length >= 2 || (sourceDays !== null && sourceDays > 180)) {
    status = "aging";
    label = "Needs refresh soon";
    note = staleReasons.join("; ") + ".";
  } else if (staleReasons.length) {
    status = "watch";
    label = "Review worth scheduling";
    note = staleReasons.join("; ") + ".";
  }

  return {
    status: status,
    label: label,
    note: note,
    source_review_age_days: sourceDays,
    therapist_confirmation_age_days: therapistDays,
    needs_reconfirmation_fields: needsReconfirmation,
  };
}

function hasListedInsurance(therapist) {
  return (
    Array.isArray(therapist && therapist.insurance_accepted) &&
    therapist.insurance_accepted.length > 0
  );
}

function getTelehealthStatesList(therapist) {
  return Array.isArray(therapist && therapist.telehealth_states) ? therapist.telehealth_states : [];
}

export function getTherapistConfirmationAgenda(therapist) {
  var states = getFieldReviewStates(therapist);
  var appliedDays = daysSince(therapist && therapist.confirmation_applied_at);
  if (appliedDays !== null && appliedDays <= 21) {
    return {
      needs_confirmation: false,
      unknown_fields: [],
      asks: [],
      priority: "low",
      summary: "Recently applied confirmation updates are still within the grace window.",
    };
  }
  var unknowns = [];

  if (
    !normalizeText(therapist && therapist.bipolar_years_experience) ||
    states.bipolar_years_experience !== "editorially_verified"
  ) {
    unknowns.push("bipolar_years_experience");
  }
  if (!hasListedInsurance(therapist) || states.insurance_accepted !== "editorially_verified") {
    unknowns.push("insurance_accepted");
  }
  if (
    therapist &&
    therapist.accepts_telehealth &&
    (!getTelehealthStatesList(therapist).length ||
      states.telehealth_states !== "editorially_verified")
  ) {
    unknowns.push("telehealth_states");
  }
  if (!normalizeText(therapist && therapist.license_number)) {
    unknowns.push("license_number");
  }

  var dedupedUnknowns = Array.from(new Set(unknowns));
  var priority =
    dedupedUnknowns.length >= 4 ? "high" : dedupedUnknowns.length >= 2 ? "medium" : "low";
  var askMap = {
    bipolar_years_experience: "bipolar-specific years of experience",
    insurance_accepted: "insurance or superbill reality",
    telehealth_states: "current telehealth coverage",
    license_number: "license number",
  };
  var promptMap = {
    bipolar_years_experience:
      "About how many years have you been treating bipolar-spectrum conditions specifically?",
    insurance_accepted:
      "Which insurance plans do you currently accept, and if you are out of network, do you provide superbills?",
    telehealth_states: "Which states are you currently able to see patients in by telehealth?",
    license_number:
      "What is your current license number for the license you want displayed on your profile?",
  };
  var ask = dedupedUnknowns
    .slice(0, 3)
    .map(function (field) {
      return askMap[field] || field.replace(/_/g, " ");
    })
    .join(", ");

  return {
    needs_confirmation: dedupedUnknowns.length > 0,
    unknown_fields: dedupedUnknowns,
    asks: dedupedUnknowns.map(function (field) {
      return (
        promptMap[field] || "Please confirm " + (askMap[field] || field.replace(/_/g, " ")) + "."
      );
    }),
    priority: priority,
    summary: dedupedUnknowns.length
      ? "Confirm " + ask + "."
      : "No high-value therapist confirmation gaps currently flagged.",
  };
}

function getTherapistConfirmationPromptMap() {
  return {
    bipolar_years_experience:
      "About how many years have you been treating bipolar-spectrum conditions specifically?",
    insurance_accepted:
      "Which insurance plans do you currently accept, and if you are out of network, do you provide superbills?",
    telehealth_states: "Which states are you currently able to see patients in by telehealth?",
    license_number:
      "What is your current license number for the license you want displayed on your profile?",
  };
}

function getTherapistConfirmationAsks(fields) {
  var promptMap = getTherapistConfirmationPromptMap();
  return (Array.isArray(fields) ? fields : [])
    .map(function (field) {
      return promptMap[field];
    })
    .filter(Boolean);
}

export function buildTherapistFieldConfirmationPrompt(therapist, fields, options) {
  var profile = therapist || {};
  var name = normalizeText(profile.name);
  var asks = getTherapistConfirmationAsks(fields);
  if (!asks.length) {
    return "";
  }
  var promptOptions = options || {};
  var intro =
    promptOptions.intro ||
    "We are tightening your BipolarTherapyHub profile so the information people rely on most stays accurate and trustable.";
  var guidance =
    promptOptions.guidance ||
    "Please confirm only the details below that you are comfortable stating directly. If something is not current or you would rather not list it, it is completely fine to leave it blank.";
  var bullets = asks
    .map(function (ask) {
      return "- " + ask;
    })
    .join("\n");
  var close =
    promptOptions.close ||
    "Once you confirm these details, we can update the profile to reflect the latest accurate information.\n\nThank you,\nBipolarTherapyHub";

  return [name ? "Hi " + name + "," : "Hi,", "", intro, "", guidance, "", bullets, "", close].join(
    "\n",
  );
}

export function buildTherapistConfirmationPrompt(therapist) {
  var profile = therapist || {};
  var agenda = getTherapistConfirmationAgenda(profile);

  if (!agenda.needs_confirmation) {
    return "";
  }

  return buildTherapistFieldConfirmationPrompt(profile, agenda.unknown_fields);
}

function listOverlaps(a, b) {
  var left = new Set(
    normalizeList(a).map(function (item) {
      return item.toLowerCase();
    }),
  );

  return normalizeList(b).filter(function (item) {
    return left.has(String(item).toLowerCase());
  });
}

function getWaitPriority(value) {
  if (!value) {
    return 99;
  }
  return Object.prototype.hasOwnProperty.call(WAIT_TIME_PRIORITY, value)
    ? WAIT_TIME_PRIORITY[value]
    : 99;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeInsurance(value) {
  return normalizeLower(value).replace(/[^a-z0-9]+/g, " ");
}

function insuranceMatches(requestedInsurance, acceptedInsurance) {
  var requested = normalizeInsurance(requestedInsurance);
  if (!requested) {
    return false;
  }

  return normalizeList(acceptedInsurance).some(function (item) {
    var normalized = normalizeInsurance(item);
    return (
      normalized === requested || normalized.includes(requested) || requested.includes(normalized)
    );
  });
}

function supportsTelehealthInState(therapist, careState) {
  if (!therapist.accepts_telehealth) {
    return false;
  }

  if (!therapist.telehealth_states || !therapist.telehealth_states.length) {
    return "unknown";
  }

  return therapist.telehealth_states.includes(careState);
}

function supportsInPersonInState(therapist, careState) {
  return Boolean(therapist.accepts_in_person && normalizeUpper(therapist.state) === careState);
}

function getFeeFloor(therapist) {
  return Number(therapist.session_fee_min || therapist.session_fee_max || 0) || null;
}

function getCompletenessScore(therapist) {
  var fields = [
    therapist.license_number,
    therapist.care_approach,
    therapist.treatment_modalities && therapist.treatment_modalities.length,
    therapist.client_populations && therapist.client_populations.length,
    therapist.languages && therapist.languages.length,
    therapist.insurance_accepted && therapist.insurance_accepted.length,
    therapist.session_fee_min || therapist.session_fee_max || therapist.sliding_scale,
    therapist.telehealth_states && therapist.telehealth_states.length,
    therapist.bipolar_years_experience,
  ];

  var present = fields.filter(Boolean).length;
  return Math.round((present / fields.length) * 100);
}

function getMissingReadinessItems(therapist) {
  var items = [];

  if (!therapist.license_number) {
    items.push("Add license number for trust verification.");
  }
  if (!therapist.care_approach) {
    items.push("Add a concise bipolar care approach summary.");
  }
  if (!(therapist.treatment_modalities && therapist.treatment_modalities.length)) {
    items.push("List treatment modalities to improve clinical-fit matching.");
  }
  if (!(therapist.client_populations && therapist.client_populations.length)) {
    items.push("Specify populations served to support better fit decisions.");
  }
  if (!(therapist.insurance_accepted && therapist.insurance_accepted.length)) {
    items.push("Add insurance or self-pay details to reduce practical mismatches.");
  }
  if (!(therapist.languages && therapist.languages.length)) {
    items.push("Add languages offered to improve access and fit.");
  }
  if (
    therapist.accepts_telehealth &&
    !(therapist.telehealth_states && therapist.telehealth_states.length)
  ) {
    items.push("List telehealth states so virtual care eligibility is clear.");
  }
  if (!therapist.bipolar_years_experience) {
    items.push("Add bipolar-specific years of experience for specialization trust.");
  }
  if (!therapist.session_fee_min && !therapist.session_fee_max && !therapist.sliding_scale) {
    items.push("Add fee range or sliding-scale details for budget matching.");
  }

  return items;
}

export function getTherapistMatchReadiness(therapist) {
  var completeness = getCompletenessScore(therapist || {});
  var score = completeness;
  var strengths = [];
  var missingItems = getMissingReadinessItems(therapist || {});

  if (therapist.verification_status === "editorially_verified") {
    score += 8;
    strengths.push("Editorial verification is already in place.");
  }
  if (Number(therapist.bipolar_years_experience || 0) >= 8) {
    score += 6;
    strengths.push("Strong bipolar-specific experience strengthens trust.");
  }
  if (therapist.medication_management) {
    score += 4;
    strengths.push("Medication-management support increases match coverage.");
  }
  if (
    therapist.accepts_telehealth &&
    therapist.telehealth_states &&
    therapist.telehealth_states.length
  ) {
    score += 4;
    strengths.push("Telehealth coverage is clearly specified.");
  }
  if (therapist.insurance_accepted && therapist.insurance_accepted.length >= 3) {
    score += 3;
    strengths.push("Insurance details are strong enough for practical matching.");
  }

  score = clamp(Math.round(score), 0, 100);

  var label = "Needs work";
  if (score >= 85) {
    label = "Match-ready";
  } else if (score >= 65) {
    label = "Close";
  }

  return {
    score: score,
    label: label,
    completeness_score: completeness,
    strengths: strengths.slice(0, 3),
    missing_items: missingItems.slice(0, 5),
  };
}

export function getTherapistReviewCoaching(therapist) {
  var profile = therapist || {};
  var suggestions = [];

  if (!profile.care_approach) {
    suggestions.push(
      "Add a concrete bipolar-care summary that names who they help, how they work, and what treatment looks like in practice.",
    );
  } else if (String(profile.care_approach).trim().length < 120) {
    suggestions.push(
      "Make the bipolar-care approach more specific by naming modalities, populations, or how care is coordinated.",
    );
  }

  if (!profile.contact_guidance) {
    suggestions.push(
      "Add contact guidance that tells users what to send up front, like state, therapy vs. psychiatry need, and insurance questions.",
    );
  } else if (String(profile.contact_guidance).trim().length < 90) {
    suggestions.push(
      "Strengthen contact guidance with expected reply timing and the key details the therapist wants before responding.",
    );
  }

  if (!profile.first_step_expectation) {
    suggestions.push(
      "Explain what happens after first contact so users can picture the consult, intake, or fit-screening step.",
    );
  } else if (String(profile.first_step_expectation).trim().length < 110) {
    suggestions.push(
      "Make the first-step explanation more concrete by describing timeline, what the therapist assesses, and what comes next.",
    );
  }

  if (!(profile.insurance_accepted && profile.insurance_accepted.length)) {
    suggestions.push("Clarify insurance or self-pay status to reduce mismatches before outreach.");
  }

  if (!profile.session_fee_min && !profile.session_fee_max && !profile.sliding_scale) {
    suggestions.push(
      "Add a typical fee range or sliding-scale note so cost fit is easier to judge.",
    );
  }

  if (
    profile.accepts_telehealth &&
    !(profile.telehealth_states && profile.telehealth_states.length)
  ) {
    suggestions.push(
      "List telehealth states so virtual eligibility is clear before someone reaches out.",
    );
  }

  return suggestions.slice(0, 4);
}

export function getTherapistMerchandisingQuality(therapist) {
  var profile = therapist || {};
  var readiness = getTherapistMatchReadiness(profile);
  var freshness = getDataFreshnessSummary(profile);
  var recentConfirmation = getRecentConfirmationSummary(profile);
  var score = Number(readiness.score || 0) || 0;
  var reasons = [];

  if (profile.verification_status === "editorially_verified") {
    score += 10;
    reasons.push("Editorially verified");
  }
  if (profile.accepting_new_patients) {
    score += 8;
    reasons.push("Accepting new patients");
  }
  if (
    profile.preferred_contact_method &&
    (profile.contact_guidance || profile.first_step_expectation)
  ) {
    score += 6;
    reasons.push("Clear outreach path");
  }
  if (profile.contact_guidance) {
    score += 4;
  }
  if (profile.first_step_expectation) {
    score += 4;
  }
  if (profile.estimated_wait_time === "Immediate availability") {
    score += 8;
    reasons.push("Immediate availability");
  } else if (profile.estimated_wait_time === "Within 1 week") {
    score += 6;
    reasons.push("Fast availability");
  } else if (profile.estimated_wait_time === "Within 2 weeks") {
    score += 4;
  }
  if (Number(profile.bipolar_years_experience || 0) >= 8) {
    score += 6;
    reasons.push("Deep bipolar-specific experience");
  } else if (Number(profile.bipolar_years_experience || 0) >= 4) {
    score += 3;
  }
  if (profile.medication_management) {
    score += 4;
    reasons.push("Medication-management support");
  }
  if (profile.accepts_telehealth && profile.telehealth_states && profile.telehealth_states.length) {
    score += 4;
  }
  if (profile.insurance_accepted && profile.insurance_accepted.length >= 3) {
    score += 3;
  }
  if (recentConfirmation) {
    score += recentConfirmation.tone === "fresh" ? 6 : 3;
    reasons.push(recentConfirmation.short_label);
  }
  if (freshness.status === "aging") {
    score -= 8;
  } else if (freshness.status === "watch") {
    score -= 3;
  }

  var label = "Solid profile";
  if (score >= 105) {
    label = "Standout profile";
  } else if (score >= 90) {
    label = "Strong profile";
  }

  return {
    score: Math.round(score),
    label: label,
    reasons: reasons.slice(0, 3),
    readiness: readiness,
  };
}

function sortReasonsByWeight(reasons) {
  return reasons
    .slice()
    .sort(function (a, b) {
      return b.weight - a.weight;
    })
    .map(function (item) {
      return item.text;
    });
}

function getReasonWeight(signals, reason) {
  if (!signals || !signals.reason_weights) {
    return 0;
  }

  return Number(signals.reason_weights[reason] || 0) || 0;
}

function getTherapistFeedbackAdjustment(signals, slug) {
  if (!signals || !signals.therapist_adjustments) {
    return 0;
  }

  return Number(signals.therapist_adjustments[slug] || 0) || 0;
}

function getOutreachAdjustment(signals, slug) {
  if (!signals || !signals.outreach_adjustments) {
    return 0;
  }

  return Number(signals.outreach_adjustments[slug] || 0) || 0;
}

function getLearningSegments(profile) {
  var segments = ["all"];

  if (profile.care_format && profile.care_format !== "Either") {
    segments.push("format:" + profile.care_format.toLowerCase());
  }
  if (profile.care_intent && profile.care_intent !== "Either") {
    segments.push("intent:" + profile.care_intent.toLowerCase());
  }
  if (
    profile.needs_medication_management &&
    profile.needs_medication_management !== "Open to either"
  ) {
    segments.push(
      "medication:" + profile.needs_medication_management.toLowerCase().replace(/\s+/g, "-"),
    );
  }
  if (profile.insurance) {
    segments.push("insurance:user");
  }
  if (profile.urgency && profile.urgency !== "Flexible") {
    segments.push("urgency:" + profile.urgency.toLowerCase().replace(/\s+/g, "-"));
  }

  return segments;
}

function resolveLearningSignals(signals, profile) {
  if (!signals) {
    return {
      reason_weights: {},
      therapist_adjustments: {},
      outreach_adjustments: {},
      active_segments: [],
    };
  }

  var resolved = {
    reason_weights: Object.assign({}, signals.reason_weights || {}),
    therapist_adjustments: Object.assign({}, signals.therapist_adjustments || {}),
    outreach_adjustments: Object.assign({}, signals.outreach_adjustments || {}),
    active_segments: [],
  };

  getLearningSegments(profile).forEach(function (segment) {
    if (segment === "all" || !signals.segments || !signals.segments[segment]) {
      return;
    }

    var overlay = signals.segments[segment];
    resolved.active_segments.push(segment);

    Object.keys(overlay.reason_weights || {}).forEach(function (reason) {
      resolved.reason_weights[reason] =
        (resolved.reason_weights[reason] || 0) + overlay.reason_weights[reason];
    });

    Object.keys(overlay.therapist_adjustments || {}).forEach(function (slug) {
      resolved.therapist_adjustments[slug] =
        (resolved.therapist_adjustments[slug] || 0) + overlay.therapist_adjustments[slug];
    });

    Object.keys(overlay.outreach_adjustments || {}).forEach(function (slug) {
      resolved.outreach_adjustments[slug] =
        (resolved.outreach_adjustments[slug] || 0) + overlay.outreach_adjustments[slug];
    });
  });

  Object.keys(resolved.reason_weights).forEach(function (reason) {
    resolved.reason_weights[reason] = clamp(resolved.reason_weights[reason], 0, 12);
  });

  Object.keys(resolved.therapist_adjustments).forEach(function (slug) {
    resolved.therapist_adjustments[slug] = clamp(resolved.therapist_adjustments[slug], -14, 14);
  });

  Object.keys(resolved.outreach_adjustments).forEach(function (slug) {
    resolved.outreach_adjustments[slug] = clamp(resolved.outreach_adjustments[slug], -8, 10);
  });

  return resolved;
}

function formatLearningSegment(segment) {
  return String(segment || "")
    .split(":")[1]
    .replace(/-/g, " ");
}

export function buildUserMatchProfile(input) {
  return {
    care_state: normalizeUpper(input.care_state),
    care_format: normalizeText(input.care_format) || "Either",
    care_intent: normalizeText(input.care_intent) || "Either",
    needs_medication_management:
      normalizeText(input.needs_medication_management) || "Open to either",
    insurance: normalizeText(input.insurance),
    budget_max: Number(input.budget_max || 0) || null,
    priority_mode: normalizeText(input.priority_mode) || "Best overall fit",
    urgency: normalizeText(input.urgency) || "Flexible",
    bipolar_focus: normalizeList(input.bipolar_focus),
    preferred_modalities: normalizeList(input.preferred_modalities),
    population_fit: normalizeList(input.population_fit),
    language_preferences: normalizeList(input.language_preferences),
    cultural_preferences: normalizeText(input.cultural_preferences),
  };
}

function getProviderKind(therapist) {
  var haystack = [therapist.title, therapist.credentials, therapist.treatment_modalities]
    .flat()
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    haystack.includes("psychiatrist") ||
    haystack.includes("medication management") ||
    haystack.includes("md") ||
    haystack.includes("do")
  ) {
    return "Psychiatry";
  }

  return "Therapy";
}

export function getMatchTier(scoreOrEvaluation) {
  var score = typeof scoreOrEvaluation === "number" ? scoreOrEvaluation : scoreOrEvaluation.score;
  var confidence =
    typeof scoreOrEvaluation === "number"
      ? 70
      : Number(scoreOrEvaluation.confidence_score || 0) || 0;

  if (score >= 105 && confidence >= 78) {
    return {
      label: "Strong fit",
      tone: "high",
    };
  }

  if (score >= 80 && confidence >= 60) {
    return {
      label: "Promising fit",
      tone: "medium",
    };
  }

  return {
    label: "Worth reviewing",
    tone: "light",
  };
}

export function evaluateTherapistAgainstProfile(therapist, userProfile, learningSignals) {
  var profile = buildUserMatchProfile(userProfile || {});
  var resolvedLearning = resolveLearningSignals(learningSignals, profile);
  var freshness = getDataFreshnessSummary(therapist);
  var recentConfirmation = getRecentConfirmationSummary(therapist);
  var reasons = [];
  var cautions = [];
  var hardFailures = [];
  var breakdown = {
    access: 0,
    practical: 0,
    clinical: 0,
    trust: 0,
    uncertainty: 0,
    learned: 0,
  };

  if (!profile.care_state) {
    throw new Error("User match profile must include care_state.");
  }

  var telehealthSupport = supportsTelehealthInState(therapist, profile.care_state);
  var inPersonSupport = supportsInPersonInState(therapist, profile.care_state);
  var completeness = getCompletenessScore(therapist);

  if (profile.care_format === "Telehealth") {
    if (telehealthSupport === false) {
      hardFailures.push("Telehealth is not available in the requested state.");
    } else {
      breakdown.access += 30;
      reasons.push({
        text:
          telehealthSupport === "unknown"
            ? "Offers telehealth, though state coverage should be confirmed."
            : "Offers telehealth in the requested state.",
        weight: 30,
      });
      if (telehealthSupport === "unknown") {
        breakdown.uncertainty -= 8;
        cautions.push("Telehealth state coverage is not fully listed.");
      }
    }
  }

  if (profile.care_format === "In-Person") {
    if (!inPersonSupport) {
      hardFailures.push("In-person care is not available in the requested state.");
    } else {
      breakdown.access += 30;
      reasons.push({
        text: "Offers in-person care in the requested state.",
        weight: 30,
      });
    }
  }

  if (profile.care_format === "Either") {
    if (inPersonSupport) {
      breakdown.access += 12;
    }
    if (telehealthSupport !== false) {
      breakdown.access += telehealthSupport === "unknown" ? 8 : 12;
      if (telehealthSupport === "unknown") {
        breakdown.uncertainty -= 4;
      }
    }
    if (inPersonSupport || telehealthSupport !== false) {
      reasons.push({
        text: "Matches at least one of the requested care formats.",
        weight: 12,
      });
    }
  }

  var providerKind = getProviderKind(therapist);
  if (profile.care_intent !== "Either") {
    if (providerKind !== profile.care_intent) {
      breakdown.clinical -= 14;
      cautions.push("Provider type may not match the requested care style.");
    } else {
      breakdown.clinical += 18;
      reasons.push({
        text: "Matches the requested care type (" + profile.care_intent.toLowerCase() + ").",
        weight: 18,
      });
    }
  }

  if (profile.needs_medication_management === "Yes") {
    if (!therapist.medication_management) {
      hardFailures.push("Does not provide medication management.");
    } else {
      breakdown.practical += 24;
      reasons.push({
        text: "Provides medication management.",
        weight: 24,
      });
    }
  } else if (profile.needs_medication_management === "No" && therapist.medication_management) {
    breakdown.practical += 4;
  }

  if (profile.insurance) {
    if (insuranceMatches(profile.insurance, therapist.insurance_accepted)) {
      breakdown.practical += 22;
      reasons.push({
        text: "Accepts the requested insurance.",
        weight: 22,
      });
    } else if (normalizeLower(profile.insurance) !== "self-pay") {
      breakdown.practical -= 10;
      breakdown.learned -= getReasonWeight(resolvedLearning, "Insurance mismatch");
      cautions.push("Insurance fit is unclear or may not match.");
    }
  }

  if (profile.budget_max) {
    var minFee = getFeeFloor(therapist);
    if (minFee && minFee <= profile.budget_max) {
      breakdown.practical += 12;
      reasons.push({
        text: "Listed fee range fits the stated budget.",
        weight: 12,
      });
    } else if (minFee && minFee > profile.budget_max) {
      breakdown.practical -= 18;
      cautions.push("Listed fee range may be above the stated budget.");
    } else {
      breakdown.uncertainty -= 6;
      cautions.push("Fee fit is uncertain because pricing is incomplete.");
    }
  }

  if (profile.urgency === "ASAP") {
    if (therapist.estimated_wait_time && getWaitPriority(therapist.estimated_wait_time) <= 1) {
      breakdown.practical += 16;
      reasons.push({
        text: "Has relatively fast availability.",
        weight: 16,
      });
    } else if (
      therapist.estimated_wait_time &&
      getWaitPriority(therapist.estimated_wait_time) <= 3
    ) {
      breakdown.practical -= 4;
      breakdown.learned -= getReasonWeight(resolvedLearning, "Availability mismatch");
      cautions.push("Availability may be slower than desired.");
    } else if (therapist.estimated_wait_time) {
      breakdown.practical -= 12;
      breakdown.learned -= getReasonWeight(resolvedLearning, "Availability mismatch") + 2;
      cautions.push("Availability is likely too slow for urgent needs.");
    } else {
      cautions.push("Current openings should be confirmed directly if timing is important.");
    }
  } else if (profile.urgency === "Within 2 weeks") {
    if (therapist.estimated_wait_time && getWaitPriority(therapist.estimated_wait_time) <= 2) {
      breakdown.practical += 10;
      reasons.push({
        text: "Availability fits the preferred timeline.",
        weight: 10,
      });
    } else if (
      therapist.estimated_wait_time &&
      getWaitPriority(therapist.estimated_wait_time) > 3
    ) {
      breakdown.practical -= 8;
      breakdown.learned -= getReasonWeight(resolvedLearning, "Availability mismatch");
      cautions.push("Availability may miss the preferred timeline.");
    } else {
      cautions.push("Current openings should be confirmed directly if timing matters.");
    }
  } else if (profile.urgency === "Within a month") {
    if (therapist.estimated_wait_time && getWaitPriority(therapist.estimated_wait_time) <= 3) {
      breakdown.practical += 6;
    }
  }

  if (profile.priority_mode === "Soonest availability" && therapist.estimated_wait_time) {
    breakdown.practical += Math.max(0, 12 - getWaitPriority(therapist.estimated_wait_time) * 3);
  }
  if (profile.priority_mode === "Lowest cost") {
    var feeFloor = getFeeFloor(therapist);
    if (feeFloor) {
      breakdown.practical += clamp(18 - Math.round(feeFloor / 25), 0, 18);
    }
  }
  if (profile.priority_mode === "Highest specialization") {
    breakdown.clinical += clamp(Number(therapist.bipolar_years_experience || 0), 0, 18);
  }

  if (!therapist.accepting_new_patients) {
    breakdown.practical -= 14;
    breakdown.learned -= Math.max(
      1,
      getReasonWeight(resolvedLearning, "Availability mismatch") - 1,
    );
    cautions.push("May not be accepting new patients.");
  } else {
    breakdown.practical += 6;
  }

  var specialtyMatches = listOverlaps(profile.bipolar_focus, therapist.specialties);
  if (specialtyMatches.length) {
    breakdown.clinical += Math.min(28, specialtyMatches.length * 9);
    reasons.push({
      text: "Focus areas overlap: " + specialtyMatches.slice(0, 3).join(", ") + ".",
      weight: 20,
    });
  }

  var modalityMatches = listOverlaps(profile.preferred_modalities, therapist.treatment_modalities);
  if (modalityMatches.length) {
    breakdown.clinical += Math.min(20, modalityMatches.length * 7);
    reasons.push({
      text: "Uses requested modalities: " + modalityMatches.slice(0, 3).join(", ") + ".",
      weight: 16,
    });
  } else if (profile.preferred_modalities.length) {
    breakdown.clinical -= 5;
    cautions.push("Preferred treatment modalities do not clearly overlap.");
  }

  var populationMatches = listOverlaps(profile.population_fit, therapist.client_populations);
  if (populationMatches.length) {
    breakdown.clinical += Math.min(18, populationMatches.length * 6);
    reasons.push({
      text: "Works with similar populations: " + populationMatches.slice(0, 3).join(", ") + ".",
      weight: 14,
    });
  }

  var languageMatches = listOverlaps(profile.language_preferences, therapist.languages);
  if (languageMatches.length) {
    breakdown.clinical += Math.min(14, languageMatches.length * 7);
    reasons.push({
      text: "Offers care in preferred language(s): " + languageMatches.join(", ") + ".",
      weight: 14,
    });
  } else if (profile.language_preferences.length) {
    breakdown.clinical -= 8;
    cautions.push("Preferred language match is unclear.");
  }

  breakdown.trust += Math.min(Number(therapist.bipolar_years_experience || 0) * 1.6, 24);
  if (Number(therapist.bipolar_years_experience || 0) >= 8) {
    reasons.push({
      text: "Has substantial bipolar-specific experience.",
      weight: 15,
    });
  }

  if (therapist.verification_status === "editorially_verified") {
    breakdown.trust += 12;
    reasons.push({
      text: "Profile is editorially verified.",
      weight: 12,
    });
  }

  if (therapist.license_number) {
    breakdown.trust += 6;
  } else {
    breakdown.uncertainty -= 4;
    cautions.push("License details are incomplete.");
  }

  if (completeness >= 80) {
    breakdown.trust += 8;
  } else if (completeness < 50) {
    breakdown.uncertainty -= 10;
    cautions.push("Several useful profile details are missing.");
  }

  if (profile.cultural_preferences) {
    breakdown.uncertainty -= 2;
    cautions.push("Cultural fit is not yet strongly modeled.");
  }

  var verifiedOperationalCount = getEditoriallyVerifiedOperationalCount(therapist);
  if (verifiedOperationalCount) {
    breakdown.trust += verifiedOperationalCount * 2;
    reasons.push({
      text:
        verifiedOperationalCount +
        " key operational detail" +
        (verifiedOperationalCount > 1 ? "s are" : " is") +
        " editor-verified.",
      weight: 6 + verifiedOperationalCount,
    });
  }

  if (recentConfirmation) {
    breakdown.trust += recentConfirmation.tone === "fresh" ? 5 : 3;
    reasons.push({
      text: recentConfirmation.note,
      weight: recentConfirmation.tone === "fresh" ? 7 : 5,
    });
  }

  if (freshness.status === "aging") {
    breakdown.trust -= 6;
    breakdown.uncertainty -= 3;
    cautions.push("Some operational details may be aging and worth reconfirming.");
  } else if (freshness.status === "watch") {
    breakdown.trust -= 2;
    cautions.push("Some operational details may need a refresh soon.");
  }

  if (profile.needs_medication_management === "Yes" && !therapist.medication_management) {
    breakdown.learned -= getReasonWeight(resolvedLearning, "Needs medication management");
  }

  if (profile.care_intent === "Psychiatry" && providerKind !== "Psychiatry") {
    breakdown.learned -= getReasonWeight(resolvedLearning, "Needs medication management");
  }

  if (profile.care_format === "Either" && !inPersonSupport && telehealthSupport === false) {
    breakdown.learned -= getReasonWeight(resolvedLearning, "Wrong care format");
  }

  if (Number(therapist.bipolar_years_experience || 0) < 5) {
    breakdown.learned -= getReasonWeight(resolvedLearning, "Weak bipolar specialization");
  } else if (getReasonWeight(resolvedLearning, "Weak bipolar specialization") > 0) {
    breakdown.learned += 4;
  }

  var therapistAdjustment = getTherapistFeedbackAdjustment(resolvedLearning, therapist.slug);
  if (therapistAdjustment) {
    breakdown.learned += therapistAdjustment;
  }
  var outreachAdjustment = getOutreachAdjustment(resolvedLearning, therapist.slug);
  if (outreachAdjustment) {
    breakdown.learned += outreachAdjustment;
  }

  var score =
    breakdown.access +
    breakdown.practical +
    breakdown.clinical +
    breakdown.trust +
    breakdown.uncertainty +
    breakdown.learned;
  var hardConstraintFailed = hardFailures.length > 0;
  var confidenceScore = clamp(
    58 +
      Math.round(completeness * 0.22) +
      (therapist.verification_status === "editorially_verified" ? 8 : 0) +
      (recentConfirmation ? (recentConfirmation.tone === "fresh" ? 4 : 2) : 0) +
      (hardConstraintFailed ? -40 : 0) +
      clamp(breakdown.uncertainty, -25, 0) +
      clamp(Math.round(breakdown.learned / 2), -8, 6),
    0,
    100,
  );

  if (therapistAdjustment >= 4) {
    reasons.push({
      text: "Earlier shortlist feedback has trended positively for this profile.",
      weight: 10,
    });
  } else if (therapistAdjustment <= -4) {
    cautions.push("Earlier shortlist feedback has trended mixed for this profile.");
  }

  if (outreachAdjustment >= 3) {
    reasons.push({
      text: "Earlier outreach patterns suggest this profile tends to generate replies or productive next steps.",
      weight: 9,
    });
  } else if (outreachAdjustment <= -3) {
    cautions.push(
      "Earlier outreach patterns suggest follow-through may take more effort or hit practical blockers.",
    );
  }

  if (breakdown.learned <= -6) {
    cautions.push("This match was down-ranked based on earlier mismatch patterns.");
  } else if (breakdown.learned >= 6) {
    reasons.push({
      text: "Earlier feedback patterns slightly reinforce this match.",
      weight: 8,
    });
  }

  if (resolvedLearning.active_segments.length) {
    reasons.push({
      text:
        "This ranking also reflects lessons from similar " +
        resolvedLearning.active_segments.slice(0, 2).map(formatLearningSegment).join(" / ") +
        " searches.",
      weight: 7,
    });
  }

  return {
    therapist_slug: therapist.slug,
    score: hardConstraintFailed ? -1000 : Math.round(score),
    hard_constraint_failed: hardConstraintFailed,
    hard_failures: hardFailures,
    reasons: sortReasonsByWeight(reasons).slice(0, 4),
    cautions: cautions.slice(0, 4),
    confidence_score: confidenceScore,
    completeness_score: completeness,
    score_breakdown: {
      access: Math.round(breakdown.access),
      practical: Math.round(breakdown.practical),
      clinical: Math.round(breakdown.clinical),
      trust: Math.round(breakdown.trust),
      uncertainty: Math.round(breakdown.uncertainty),
      learned: Math.round(breakdown.learned),
    },
    active_segments: resolvedLearning.active_segments.slice(0, 3),
  };
}

export function rankTherapistsForUser(therapists, userProfile, learningSignals) {
  return (therapists || [])
    .map(function (therapist) {
      var evaluation = evaluateTherapistAgainstProfile(therapist, userProfile, learningSignals);
      return {
        therapist: therapist,
        evaluation: evaluation,
      };
    })
    .filter(function (entry) {
      return !entry.evaluation.hard_constraint_failed;
    })
    .sort(function (a, b) {
      return (
        b.evaluation.score - a.evaluation.score ||
        b.evaluation.confidence_score - a.evaluation.confidence_score ||
        a.therapist.name.localeCompare(b.therapist.name)
      );
    });
}

export function buildMatchExplanation(entry) {
  if (!entry || !entry.therapist || !entry.evaluation) {
    return "";
  }

  var reasons = entry.evaluation.reasons || [];
  var confidence = entry.evaluation.confidence_score || 0;
  if (!reasons.length) {
    return (
      entry.therapist.name +
      " appears to fit the requested constraints, though the profile leaves some uncertainty."
    );
  }

  return (
    entry.therapist.name +
    " may be a fit because " +
    reasons.join(" ") +
    (entry.evaluation.active_segments && entry.evaluation.active_segments.length
      ? " Similar " +
        entry.evaluation.active_segments.slice(0, 2).map(formatLearningSegment).join(" / ") +
        " searches are also informing this rank."
      : "") +
    " Confidence signal: " +
    confidence +
    "/100."
  );
}
