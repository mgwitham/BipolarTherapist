// TD-B: Profile completeness — the unified editor.
//
// Replaces Phase 1 and Phase 2 with a single accordion of every editable
// field, organised into four sections (Essential / Profile / Practice /
// Who you help). One open at a time. Each row collapses to a status
// circle + name + hint + badge + chevron. Save advances the score and
// updates the patient preview in the right column.
//
// Score header lives at the top of the panel and stays in sync with the
// TD-A header badge — both compute from the same inputs.
//
// TD-B scope: shell + score + accordion + the 5 fields that already had
// working forms in the prior Phase 2 (insurance, fees, modalities,
// populations, years). Bio + contact route + headshot + name/creds +
// location render as rows but expand to a placeholder until TD-C / TD-D
// ship the inline forms for each.

import { renderPortalCardPreview, updatePortalCardPreview } from "./portal-card-preview.js";
import { patchTherapistProfile } from "./review-api.js";
import { trackFunnelEvent } from "./funnel-analytics.js";

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
    if (ch === "&") return "&amp;";
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    if (ch === '"') return "&quot;";
    return "&#39;";
  });
}

// ─── Score model (mirrors TD-A header) ────────────────────────────────

// 100-point system per the TF-final spec.
// Base = 40 (signup baseline: name + location + credentials + format).
// Optional points sum to 99; capped at 100. Typical signup with format
// auto-true + specialties pre-filled lands ~50 ("Needs work") and a
// fully-populated profile hits 100 ("Complete").
//
//   Headshot                +15
//   Treatment modalities    +10
//   Session fee             +10
//   Populations             +8
//   Full bio                +8
//   Insurance               +7
//   Bipolar specialties     +6
//   Session format          +5
//   Years treating bipolar  +5
//   Languages               +4
//   Wait time               +4
//   Contact guidance        +4
//   First step              +4
//   Practice name           +3
//   Website                 +3
//   Total years             +3
function computeScore(t) {
  if (!t) return 0;
  var score = 40; // signup baseline
  if (t.photo_url) score += 15;
  if (Array.isArray(t.treatment_modalities) && t.treatment_modalities.filter(Boolean).length)
    score += 10;
  if (Number(t.session_fee_min) > 0 || Number(t.session_fee_max) > 0 || t.sliding_scale)
    score += 10;
  if (Array.isArray(t.client_populations) && t.client_populations.filter(Boolean).length)
    score += 8;
  if (String(t.bio || "").trim()) score += 8;
  if (Array.isArray(t.insurance_accepted) && t.insurance_accepted.filter(Boolean).length)
    score += 7;
  if (Array.isArray(t.specialties) && t.specialties.filter(Boolean).length) score += 6;
  if (t.accepts_in_person || t.accepts_telehealth) score += 5;
  if (Number(t.bipolar_years_experience) > 0) score += 5;
  if (Array.isArray(t.languages) && t.languages.filter(Boolean).length) score += 4;
  if (String(t.estimated_wait_time || "").trim()) score += 4;
  if (String(t.first_step_expectation || "").trim()) score += 4;
  if (String(t.practice_name || "").trim()) score += 3;
  if (String(t.website || "").trim()) score += 3;
  if (Number(t.years_experience) > 0) score += 3;
  if (score > 100) score = 100;
  if (score < 0) score = 0;
  return score;
}

// ─── Field completion predicates ─────────────────────────────────────

// "Your card bio" — short bipolar-specific paragraph that powers the
// patient match-card voice slot. Required, ≥50 chars to gate going-live.
// NOT the same as t.bio (the long-form full profile body — see
// isFullBioComplete below).
function isCardBioComplete(t) {
  return Boolean(t && String(t.care_approach || "").trim().length >= 50);
}
// "Full bio" — long-form text shown on the public profile page. Optional,
// no char minimum.
function isFullBioComplete(t) {
  return Boolean(t && String(t.bio || "").trim());
}
function isContactRouteComplete(t) {
  if (!t) return false;
  var method = String(t.preferred_contact_method || "").toLowerCase();
  if (method === "email") return Boolean(String(t.email || "").trim());
  if (method === "phone") return Boolean(String(t.phone || "").trim());
  if (method === "booking") return Boolean(String(t.booking_url || "").trim());
  return false;
}
function isHeadshotComplete(t) {
  return Boolean(t && t.photo_url);
}
function isNameComplete(t) {
  return Boolean(t && String(t.name || "").trim());
}
function isLocationComplete(t) {
  return Boolean(t && String(t.city || "").trim() && String(t.state || "").trim());
}
function isFeeComplete(t) {
  if (!t) return false;
  return Number(t.session_fee_min) > 0 || Number(t.session_fee_max) > 0 || Boolean(t.sliding_scale);
}
function isModalitiesComplete(t) {
  return (
    t && Array.isArray(t.treatment_modalities) && t.treatment_modalities.filter(Boolean).length > 0
  );
}
function isFormatComplete(t) {
  return Boolean(t && (t.accepts_in_person || t.accepts_telehealth));
}
function isInsuranceComplete(t) {
  return (
    t && Array.isArray(t.insurance_accepted) && t.insurance_accepted.filter(Boolean).length > 0
  );
}
function isPopulationsComplete(t) {
  return (
    t && Array.isArray(t.client_populations) && t.client_populations.filter(Boolean).length > 0
  );
}
function isYearsComplete(t) {
  return Number(t && t.bipolar_years_experience) > 0;
}
// TF-B new fields
function isPracticeNameComplete(t) {
  return Boolean(t && String(t.practice_name || "").trim());
}
function isWebsiteComplete(t) {
  return Boolean(t && String(t.website || "").trim());
}
function isLanguagesComplete(t) {
  return Boolean(t && Array.isArray(t.languages) && t.languages.filter(Boolean).length > 0);
}
function isWaitTimeComplete(t) {
  return Boolean(t && String(t.estimated_wait_time || "").trim());
}
function isFirstStepComplete(t) {
  return Boolean(t && String(t.first_step_expectation || "").trim());
}
function isSpecialtiesComplete(t) {
  return Boolean(t && Array.isArray(t.specialties) && t.specialties.filter(Boolean).length > 0);
}
function isTotalYearsComplete(t) {
  return Number(t && t.years_experience) > 0;
}

// ─── Field registry ──────────────────────────────────────────────────

var FIELD_REGISTRY = [
  {
    key: "card_bio",
    section: "essential",
    title: "Your card bio",
    badge: "Required",
    hint: "This is the first thing patients read — watch your listing come alive as you type",
    isComplete: isCardBioComplete,
  },
  {
    key: "contact",
    section: "essential",
    title: "Contact route",
    badge: "Required",
    hint: "Required — patients cannot reach you without this",
    isComplete: isContactRouteComplete,
  },
  {
    key: "headshot",
    section: "profile",
    title: "Headshot",
    badge: "+15 pts",
    hint: "Profiles with photos earn 3× more clicks",
    isComplete: isHeadshotComplete,
  },
  {
    key: "name",
    section: "profile",
    title: "Name & credentials",
    badge: "Done",
    hint: "Pre-populated from signup — edit any time.",
    isComplete: isNameComplete,
  },
  {
    key: "location",
    section: "profile",
    title: "Location",
    badge: "Done",
    hint: "Pre-populated from signup — edit any time.",
    isComplete: isLocationComplete,
  },
  {
    // Years treating bipolar lives in "Your profile" rather than the
    // generic "Who you help" section because it surfaces directly on
    // patient match cards and the public profile hero — it's a critical
    // signal for matching, not a back-of-house demographic field.
    key: "years",
    section: "profile",
    title: "Years treating bipolar",
    badge: "+5 pts",
    hint: "Shown on your patient cards. 8+ years unlocks a search ranking boost in your area.",
    isComplete: isYearsComplete,
  },
  {
    key: "full_bio",
    section: "profile",
    title: "Full bio",
    badge: "+8 pts",
    hint: "Long-form profile body shown on your full public profile page",
    isComplete: isFullBioComplete,
  },
  {
    key: "practice_name",
    section: "profile",
    title: "Practice name",
    badge: "+3 pts",
    hint: "If you practice under a group or clinic name",
    isComplete: isPracticeNameComplete,
  },
  {
    key: "website",
    section: "profile",
    title: "Website",
    badge: "+3 pts",
    hint: "Links from your profile to your practice site",
    isComplete: isWebsiteComplete,
  },
  {
    key: "languages",
    section: "profile",
    title: "Languages",
    badge: "+4 pts",
    hint: "Patients filter by language — bilingual therapists are in high demand",
    isComplete: isLanguagesComplete,
  },
  {
    key: "fee",
    section: "practice",
    title: "Session fee",
    badge: "+10 pts",
    hint: "Filters out price mismatches before they reach your inbox",
    isComplete: isFeeComplete,
  },
  {
    key: "modalities",
    section: "practice",
    title: "Treatment modalities",
    badge: "+10 pts",
    hint: "CBT, IPSRT, and DBT are high-signal for patients in your specialty",
    isComplete: isModalitiesComplete,
  },
  {
    key: "format",
    section: "practice",
    title: "Session format",
    badge: "+5 pts",
    hint: "In-person, telehealth, or both",
    isComplete: isFormatComplete,
  },
  {
    key: "insurance",
    section: "practice",
    title: "Insurance accepted",
    badge: "+7 pts",
    hint: "Patients filter by insurance before they even browse",
    isComplete: isInsuranceComplete,
  },
  {
    key: "wait_time",
    section: "practice",
    title: "Estimated wait time",
    badge: "+4 pts",
    hint: "Helps patients plan — especially those in crisis",
    isComplete: isWaitTimeComplete,
  },
  {
    key: "first_step",
    section: "practice",
    title: "First step expectation",
    badge: "+4 pts",
    hint: "What happens after a patient contacts you — reduces anxiety for new patients",
    isComplete: isFirstStepComplete,
  },
  {
    key: "specialties",
    section: "audience",
    title: "Bipolar specialties",
    badge: "+6 pts",
    hint: "Specific bipolar presentations you treat",
    isComplete: isSpecialtiesComplete,
  },
  {
    key: "populations",
    section: "audience",
    title: "Populations served",
    badge: "+8 pts",
    hint: "Patients filter heavily by these",
    isComplete: isPopulationsComplete,
  },
  {
    key: "total_years",
    section: "audience",
    title: "Total years in practice",
    badge: "+3 pts",
    hint: "General experience shown on your full profile",
    isComplete: isTotalYearsComplete,
  },
];

var SECTIONS = [
  { key: "essential", title: "Essential — required to go live" },
  { key: "profile", title: "Your profile" },
  { key: "practice", title: "Your practice" },
  { key: "audience", title: "Who you help" },
];

// Pre-set picker options (matching what Phase 2 was using).
var INSURANCE_OPTIONS = [
  "Aetna",
  "BlueCross",
  "Cigna",
  "United",
  "Blue Shield",
  "Magellan",
  "Out of pocket only",
];
var MODALITY_OPTIONS = [
  "CBT",
  "DBT",
  "IPSRT",
  "ACT",
  "EMDR",
  "Psychodynamic",
  "Mindfulness",
  "Family therapy",
  "Medication mgmt",
];
var POPULATION_OPTIONS = [
  "Adults",
  "Adolescents",
  "Children",
  "Couples",
  "Families",
  "LGBTQ+",
  "BIPOC",
  "Veterans",
  "Seniors",
];
var FORMAT_OPTIONS = ["In-person", "Telehealth"];

// ─── Markup builders ─────────────────────────────────────────────────

function getScoreBand(score) {
  if (score >= 100) return { label: "Complete", tone: "complete" };
  if (score >= 80) return { label: "Looking good", tone: "good" };
  if (score >= 60) return { label: "Getting there", tone: "fair" };
  return { label: "Needs work", tone: "needs" };
}

function renderProgressHeader(score, fieldsRemaining) {
  var band = getScoreBand(score);
  var subline =
    fieldsRemaining > 0
      ? fieldsRemaining +
        " field" +
        (fieldsRemaining === 1 ? "" : "s") +
        " remaining — each one increases your inquiry rate."
      : "Profile complete — your listing is fully optimized.";
  return (
    '<div class="td-completeness-header">' +
    '<div class="td-completeness-meta">' +
    '<p class="td-completeness-label">Profile completeness</p>' +
    '<p class="td-completeness-subline" id="tdcSubline">' +
    escapeHtml(subline) +
    "</p>" +
    "</div>" +
    '<p class="td-completeness-score td-completeness-score-' +
    band.tone +
    '" id="tdcScore">' +
    score +
    "/100</p>" +
    "</div>" +
    '<div class="td-completeness-track" aria-hidden="true">' +
    '<div class="td-completeness-fill" id="tdcFill" style="width:' +
    score +
    '%"></div>' +
    "</div>"
  );
}

function renderStatusCircle(complete) {
  if (complete) {
    return (
      '<span class="td-row-status td-row-status-done" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">' +
      '<polyline points="20 6 9 17 4 12"></polyline></svg></span>'
    );
  }
  return '<span class="td-row-status td-row-status-empty" aria-hidden="true"></span>';
}

function renderBadge(field, complete, isEssential) {
  if (complete) return '<span class="td-row-badge td-row-badge-done">Done</span>';
  if (isEssential) return '<span class="td-row-badge td-row-badge-required">Required</span>';
  return '<span class="td-row-badge td-row-badge-points">' + escapeHtml(field.badge) + "</span>";
}

function renderChevron() {
  return (
    '<svg class="td-row-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
    '<polyline points="9 6 15 12 9 18"></polyline></svg>'
  );
}

function buildHint(field, therapist) {
  if (!field.isComplete(therapist)) return field.hint;
  // When complete, surface a preview of the saved value
  var t = therapist || {};
  if (field.key === "card_bio") {
    var cardBio = String(t.care_approach || "").trim();
    return cardBio.length > 90 ? cardBio.slice(0, 87) + "…" : cardBio;
  }
  if (field.key === "full_bio") {
    var fullBio = String(t.bio || "").trim();
    return fullBio.length > 90 ? fullBio.slice(0, 87) + "…" : fullBio;
  }
  if (field.key === "contact") {
    var m = String(t.preferred_contact_method || "").toLowerCase();
    if (m === "email") return "Email · " + (t.email || "");
    if (m === "phone") return "Phone · " + (t.phone || "");
    if (m === "booking") return "Booking link · " + (t.booking_url || "");
    return field.hint;
  }
  if (field.key === "headshot") return "Photo on file";
  if (field.key === "name") {
    return [t.name, t.credentials].filter(Boolean).join(", ");
  }
  if (field.key === "location") {
    var locParts = [t.city, t.state].filter(Boolean).join(", ");
    return t.zip ? locParts + " · ZIP on file" : locParts;
  }
  if (field.key === "fee") {
    var min = Number(t.session_fee_min);
    var max = Number(t.session_fee_max);
    var line = "";
    if (min > 0 && max > 0 && min !== max) line = "$" + min + "–$" + max + "/session";
    else if (min > 0) line = "$" + min + "/session";
    else if (max > 0) line = "$" + max + "/session";
    if (t.sliding_scale) line += (line ? " · " : "") + "sliding scale";
    return line || field.hint;
  }
  if (field.key === "modalities") {
    return (t.treatment_modalities || []).slice(0, 4).join(" · ");
  }
  if (field.key === "format") {
    var formats = [];
    if (t.accepts_in_person) formats.push("In-person");
    if (t.accepts_telehealth) formats.push("Telehealth");
    return formats.join(" · ");
  }
  if (field.key === "insurance") {
    return (t.insurance_accepted || []).slice(0, 4).join(" · ");
  }
  if (field.key === "populations") {
    return (t.client_populations || []).slice(0, 4).join(" · ");
  }
  if (field.key === "years") {
    var yrs = Number(t.bipolar_years_experience);
    return yrs > 0 ? yrs + " year" + (yrs === 1 ? "" : "s") + " treating bipolar" : field.hint;
  }
  if (field.key === "total_years") {
    var totalYrs = Number(t.years_experience);
    return totalYrs > 0
      ? totalYrs + " year" + (totalYrs === 1 ? "" : "s") + " in practice"
      : field.hint;
  }
  if (field.key === "practice_name") return String(t.practice_name || "");
  if (field.key === "website") return String(t.website || "").replace(/^https?:\/\//, "");
  if (field.key === "languages") return (t.languages || []).slice(0, 4).join(" · ");
  if (field.key === "wait_time") return String(t.estimated_wait_time || "");
  if (field.key === "first_step") {
    var fs = String(t.first_step_expectation || "").trim();
    return fs.length > 90 ? fs.slice(0, 87) + "…" : fs;
  }
  if (field.key === "specialties") return (t.specialties || []).slice(0, 4).join(" · ");
  return field.hint;
}

function renderRow(field, therapist) {
  var complete = field.isComplete(therapist);
  var isEssential = field.section === "essential";
  return (
    '<article class="td-row' +
    (isEssential && !complete ? " td-row-urgent" : "") +
    (complete ? " is-complete" : "") +
    '" data-tdc-row="' +
    escapeHtml(field.key) +
    '">' +
    '<button type="button" class="td-row-trigger" data-tdc-toggle="' +
    escapeHtml(field.key) +
    '">' +
    renderStatusCircle(complete) +
    '<span class="td-row-text">' +
    '<span class="td-row-title">' +
    escapeHtml(field.title) +
    "</span>" +
    '<span class="td-row-hint">' +
    escapeHtml(buildHint(field, therapist)) +
    "</span>" +
    "</span>" +
    renderBadge(field, complete, isEssential) +
    renderChevron() +
    "</button>" +
    '<div class="td-row-body" data-tdc-body="' +
    escapeHtml(field.key) +
    '" hidden></div>' +
    "</article>"
  );
}

function renderSection(sectionKey, therapist) {
  var section = SECTIONS.find(function (s) {
    return s.key === sectionKey;
  });
  var fields = FIELD_REGISTRY.filter(function (f) {
    return f.section === sectionKey;
  });
  if (!fields.length) return "";
  return (
    '<section class="td-section">' +
    '<h3 class="td-section-title">' +
    escapeHtml(section.title) +
    "</h3>" +
    '<div class="td-section-rows">' +
    fields
      .map(function (f) {
        return renderRow(f, therapist);
      })
      .join("") +
    "</div>" +
    "</section>"
  );
}

function isLive(t) {
  return isCardBioComplete(t) && isContactRouteComplete(t);
}

function renderNotLiveBar(therapist) {
  if (isLive(therapist)) return "";
  return (
    '<div class="td-not-live-bar" id="tdcNotLive" role="status">' +
    "<strong>Not live yet ·</strong> Complete your bio and contact route below to publish. " +
    "Your listing goes live the moment both are saved." +
    "</div>"
  );
}

function renderShell(therapist, score, fieldsRemaining) {
  return (
    '<div id="tdcNotLiveSlot">' +
    renderNotLiveBar(therapist) +
    "</div>" +
    '<section class="portal-card td-completeness" id="portalTdCompleteness">' +
    '<div class="td-completeness-grid">' +
    '<div class="td-completeness-main">' +
    renderProgressHeader(score, fieldsRemaining) +
    SECTIONS.map(function (s) {
      return renderSection(s.key, therapist);
    }).join("") +
    "</div>" +
    '<aside class="td-completeness-preview-column">' +
    '<p class="td-completeness-preview-label">Patient preview · live</p>' +
    '<div id="tdcPreview">' +
    renderPortalCardPreview(therapist) +
    "</div>" +
    "</aside>" +
    "</div>" +
    "</section>"
  );
}

// ─── Form renderers (TD-B subset; others stub to TD-C/D) ─────────────

function renderPickerRow(options, selected, attr) {
  return options
    .map(function (label) {
      var on = selected.indexOf(label) !== -1;
      return (
        '<button type="button" class="td-pick' +
        (on ? " is-selected" : "") +
        '" data-' +
        attr +
        '="' +
        escapeHtml(label) +
        '">' +
        escapeHtml(label) +
        "</button>"
      );
    })
    .join("");
}

// "Add other" pills — for fields that allow free-text entry beyond the
// canonical option list. Renders any selected values that aren't in
// `options` as already-selected pills sitting alongside the canonical
// row, so a clinician's previously-saved custom plan / modality stays
// visible when they reopen the form.
function renderCustomPills(options, selected, attr) {
  var canonical = {};
  options.forEach(function (o) {
    canonical[o] = true;
  });
  return selected
    .filter(function (label) {
      return !canonical[label];
    })
    .map(function (label) {
      return (
        '<button type="button" class="td-pick is-selected td-pick-custom" data-' +
        attr +
        '="' +
        escapeHtml(label) +
        '">' +
        escapeHtml(label) +
        "</button>"
      );
    })
    .join("");
}

function renderAddOtherRow(attr, placeholder) {
  return (
    '<div class="td-other-row">' +
    '<input type="text" class="td-input td-input-other" data-tdc-other-input="' +
    attr +
    '" placeholder="' +
    escapeHtml(placeholder) +
    '" maxlength="60" />' +
    '<button type="button" class="td-add-other" data-tdc-other-add="' +
    attr +
    '">+ Add</button>' +
    "</div>"
  );
}

var CARD_BIO_MIN = 50;

function renderCardBioForm(t) {
  var cardBio = String(t.care_approach || "");
  var len = cardBio.length;
  return (
    '<div class="td-form td-form-bio">' +
    '<label class="td-form-row">' +
    '<span class="td-form-label">Tell patients how you work with bipolar clients</span>' +
    '<textarea class="td-input td-textarea-bio" id="tdcCardBio" rows="4" placeholder="Describe your approach in a few sentences. What can a patient expect from working with you?">' +
    escapeHtml(cardBio) +
    "</textarea>" +
    "</label>" +
    '<p class="td-form-counter" id="tdcCardBioCounter">' +
    len +
    " / " +
    CARD_BIO_MIN +
    " minimum" +
    "</p>" +
    '<div class="td-form-actions">' +
    '<button type="button" class="td-save" data-tdc-save="card_bio">Save card bio</button>' +
    "</div>" +
    "</div>"
  );
}

function renderFullBioForm(t) {
  return (
    '<div class="td-form td-form-bio">' +
    '<label class="td-form-row">' +
    '<span class="td-form-label">Long-form bio for your full public profile</span>' +
    '<textarea class="td-input td-textarea-bio td-textarea-full-bio" id="tdcFullBio" rows="6" placeholder="Tell patients more about your training, philosophy, and what working with you looks like over time.">' +
    escapeHtml(String(t.bio || "")) +
    "</textarea>" +
    "</label>" +
    '<p class="td-form-helper">Shown on your full public profile page. Doesn’t affect the patient match card.</p>' +
    '<div class="td-form-actions">' +
    '<button type="button" class="td-save" data-tdc-save="full_bio">Save full bio</button>' +
    "</div>" +
    "</div>"
  );
}

function renderContactRouteForm(t) {
  var method = String(t.preferred_contact_method || "").toLowerCase();
  var routes = [
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "booking", label: "Booking link" },
  ];
  var pillsHtml = routes
    .map(function (r) {
      return (
        '<button type="button" class="td-route-pill' +
        (method === r.key ? " is-selected" : "") +
        '" data-tdc-route="' +
        r.key +
        '">' +
        escapeHtml(r.label) +
        "</button>"
      );
    })
    .join("");
  // Capture all three values on render so switching pills doesn't lose
  // the value the clinician already had on file.
  var cur = {
    email: String(t.email || ""),
    phone: String(t.phone || ""),
    booking: String(t.booking_url || ""),
  };
  function inputBlock(key, visible) {
    var labels = {
      email: "Your intake email",
      phone: "Your phone number",
      booking: "Your booking URL",
    };
    var placeholders = {
      email: "intake@yourpractice.com",
      phone: "(310) 555-0100",
      booking: "calendly.com/yourname",
    };
    var helpers = {
      email: "Not shown publicly. Patient messages route through the platform.",
      phone: "Displayed publicly on your listing.",
      booking: "Any booking URL works (Calendly, SimplePractice, Acuity, etc.).",
    };
    return (
      '<div class="td-route-input" data-tdc-route-input="' +
      key +
      '"' +
      (visible ? "" : " hidden") +
      ">" +
      '<label class="td-form-row">' +
      '<span class="td-form-label">' +
      escapeHtml(labels[key]) +
      "</span>" +
      '<input type="' +
      (key === "email" ? "email" : key === "phone" ? "tel" : "url") +
      '" class="td-input td-input-route" data-tdc-route-value="' +
      key +
      '" placeholder="' +
      escapeHtml(placeholders[key]) +
      '" value="' +
      escapeHtml(cur[key]) +
      '" />' +
      "</label>" +
      '<p class="td-form-helper">' +
      escapeHtml(helpers[key]) +
      "</p>" +
      "</div>"
    );
  }
  return (
    '<div class="td-form td-form-route">' +
    '<p class="td-form-label">Pick how patients reach you first</p>' +
    '<div class="td-route-pills">' +
    pillsHtml +
    "</div>" +
    inputBlock("email", method === "email") +
    inputBlock("phone", method === "phone") +
    inputBlock("booking", method === "booking") +
    '<p class="td-form-error" data-tdc-route-error hidden></p>' +
    '<div class="td-form-actions">' +
    '<button type="button" class="td-save" data-tdc-save="contact">Save contact route</button>' +
    "</div>" +
    "</div>"
  );
}

function renderHeadshotForm(t) {
  var has = Boolean(t.photo_url);
  return (
    '<div class="td-form td-form-headshot">' +
    '<div class="td-headshot-row">' +
    '<div class="td-headshot-preview' +
    (has ? " has-photo" : "") +
    '">' +
    (has
      ? '<img src="' + escapeHtml(t.photo_url) + '" alt="" />'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">' +
        '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/>' +
        '<path d="M4 21a8 8 0 0 1 16 0"/></svg>') +
    "</div>" +
    '<div class="td-headshot-copy">' +
    '<button type="button" class="td-headshot-drop" data-tdc-headshot-pick>' +
    '<span class="td-headshot-drop-title">' +
    (has ? "Replace photo" : "Click to upload") +
    "</span>" +
    '<span class="td-headshot-drop-sub">JPG, PNG or WebP · up to 4MB</span>' +
    "</button>" +
    "</div>" +
    "</div>" +
    '<p class="td-form-helper">A clear, square headshot with eyes visible earns the most patient trust.</p>' +
    "</div>"
  );
}

function renderNameForm(t) {
  return (
    '<div class="td-form td-form-name">' +
    '<label class="td-form-row">' +
    '<span class="td-form-label">Display name</span>' +
    '<input type="text" class="td-input" id="tdcName" value="' +
    escapeHtml(String(t.name || "")) +
    '" placeholder="Anthony Pham" />' +
    "</label>" +
    '<label class="td-form-row">' +
    '<span class="td-form-label">Credentials</span>' +
    '<input type="text" class="td-input" id="tdcCredentials" value="' +
    escapeHtml(String(t.credentials || "")) +
    '" placeholder="LMFT, PhD" />' +
    "</label>" +
    '<p class="td-form-helper">Use the abbreviation patients see — full title lives on the profile page.</p>' +
    '<div class="td-form-actions">' +
    '<button type="button" class="td-save" data-tdc-save="name">Save</button>' +
    "</div>" +
    "</div>"
  );
}

function renderLocationForm(t) {
  return (
    '<div class="td-form td-form-location">' +
    '<label class="td-form-row">' +
    '<span class="td-form-label">City</span>' +
    '<input type="text" class="td-input" id="tdcCity" value="' +
    escapeHtml(String(t.city || "")) +
    '" placeholder="San Francisco" />' +
    "</label>" +
    '<label class="td-form-row">' +
    '<span class="td-form-label">State</span>' +
    '<input type="text" class="td-input" id="tdcState" value="' +
    escapeHtml(String(t.state || "California")) +
    '" placeholder="California" />' +
    "</label>" +
    '<label class="td-form-row">' +
    '<span class="td-form-label">Practice ZIP <span class="td-form-label-muted">(optional)</span></span>' +
    '<input type="text" inputmode="numeric" pattern="[0-9]{5}" maxlength="5" class="td-input td-input-zip" id="tdcZip" value="' +
    escapeHtml(String(t.zip || "")) +
    '" placeholder="94110" />' +
    "</label>" +
    '<p class="td-form-helper">' +
    "Used to show patients approximate distance from their search ZIP. " +
    "We never display your raw ZIP or street address — only “~X mi” rounded to the nearest mile. " +
    "Leave blank if you’d rather not share, and we’ll fall back to city-level distance." +
    "</p>" +
    '<div class="td-form-actions">' +
    '<button type="button" class="td-save" data-tdc-save="location">Save</button>' +
    "</div>" +
    "</div>"
  );
}

function renderFeeForm(t) {
  var min = Number(t.session_fee_min) > 0 ? t.session_fee_min : "";
  var sliding = Boolean(t.sliding_scale);
  return (
    '<div class="td-form">' +
    '<label class="td-form-row"><span class="td-form-label">Fee per session</span>' +
    '<span class="td-form-input-wrap"><span class="td-form-prefix">$</span>' +
    '<input type="number" min="0" class="td-input td-input-fee" id="tdcFee" value="' +
    escapeHtml(String(min)) +
    '" placeholder="150" /></span></label>' +
    '<div class="td-form-row">' +
    '<span class="td-form-label">Sliding scale available?</span>' +
    '<div class="td-form-segments">' +
    '<button type="button" class="td-pick' +
    (sliding ? " is-selected" : "") +
    '" data-tdc-sliding="yes">Yes</button>' +
    '<button type="button" class="td-pick' +
    (!sliding ? " is-selected" : "") +
    '" data-tdc-sliding="no">No</button>' +
    "</div>" +
    "</div>" +
    '<div class="td-form-actions"><button type="button" class="td-save" data-tdc-save="fee">Save</button></div>' +
    "</div>"
  );
}

function renderModalitiesForm(t) {
  var current = Array.isArray(t.treatment_modalities) ? t.treatment_modalities.filter(Boolean) : [];
  return (
    '<div class="td-form">' +
    '<div class="td-pick-grid" data-tdc-pick-grid="tdc-modality">' +
    renderPickerRow(MODALITY_OPTIONS, current, "tdc-modality") +
    renderCustomPills(MODALITY_OPTIONS, current, "tdc-modality") +
    "</div>" +
    renderAddOtherRow("tdc-modality", "Other modality (e.g. Schema therapy)") +
    '<div class="td-form-actions"><button type="button" class="td-save" data-tdc-save="modalities">Save</button></div>' +
    "</div>"
  );
}

function renderFormatForm(t) {
  var current = [];
  if (t.accepts_in_person) current.push("In-person");
  if (t.accepts_telehealth) current.push("Telehealth");
  var teleStates = Array.isArray(t.telehealth_states) ? t.telehealth_states.filter(Boolean) : [];
  var teleSelected = current.indexOf("Telehealth") !== -1;
  return (
    '<div class="td-form">' +
    '<div class="td-pick-grid">' +
    renderPickerRow(FORMAT_OPTIONS, current, "tdc-format") +
    "</div>" +
    // Telehealth states inline reveal — only visible when Telehealth is
    // among the selected formats. Click toggles. The pills mirror the
    // current state on render and sync via the Telehealth pill click
    // handler.
    '<div class="td-format-states" data-tdc-format-states' +
    (teleSelected ? "" : " hidden") +
    ">" +
    '<p class="td-form-label" style="margin-top:0.6rem">States licensed for telehealth</p>' +
    '<div class="td-pick-grid">' +
    renderPickerRow(TELEHEALTH_STATE_OPTIONS, teleStates, "tdc-tele-state") +
    "</div>" +
    '<p class="td-form-helper">Required to appear in cross-state telehealth searches.</p>' +
    "</div>" +
    '<div class="td-form-actions"><button type="button" class="td-save" data-tdc-save="format">Save</button></div>' +
    "</div>"
  );
}

function renderInsuranceForm(t) {
  var current = Array.isArray(t.insurance_accepted) ? t.insurance_accepted.filter(Boolean) : [];
  return (
    '<div class="td-form">' +
    '<div class="td-pick-grid" data-tdc-pick-grid="tdc-insurance">' +
    renderPickerRow(INSURANCE_OPTIONS, current, "tdc-insurance") +
    renderCustomPills(INSURANCE_OPTIONS, current, "tdc-insurance") +
    "</div>" +
    renderAddOtherRow("tdc-insurance", "Other plan (e.g. Kaiser, Anthem PPO)") +
    '<div class="td-form-actions"><button type="button" class="td-save" data-tdc-save="insurance">Save</button></div>' +
    "</div>"
  );
}

function renderPopulationsForm(t) {
  var current = Array.isArray(t.client_populations) ? t.client_populations.filter(Boolean) : [];
  return (
    '<div class="td-form">' +
    '<div class="td-pick-grid">' +
    renderPickerRow(POPULATION_OPTIONS, current, "tdc-population") +
    "</div>" +
    '<div class="td-form-actions"><button type="button" class="td-save" data-tdc-save="populations">Save</button></div>' +
    "</div>"
  );
}

function renderYearsForm(t) {
  var yrs = Number(t.bipolar_years_experience);
  return (
    '<div class="td-form">' +
    '<label class="td-form-row"><span class="td-form-label">Years specifically treating bipolar</span>' +
    '<span class="td-form-input-wrap"><input type="number" min="0" max="80" class="td-input td-input-years" id="tdcYears" value="' +
    escapeHtml(String(yrs > 0 ? yrs : "")) +
    '" placeholder="e.g. 12" /></span></label>' +
    '<p class="td-form-helper">8+ years unlocks a search ranking boost.</p>' +
    '<div class="td-form-actions"><button type="button" class="td-save" data-tdc-save="years">Save</button></div>' +
    "</div>"
  );
}

// ─── TF-B new fields ─────────────────────────────────────────────────

var LANGUAGE_OPTIONS = [
  "Spanish",
  "Mandarin",
  "Cantonese",
  "French",
  "Arabic",
  "Tagalog",
  "Korean",
  "Portuguese",
];
var WAIT_TIME_OPTIONS = ["Same week", "1–2 weeks", "2–4 weeks", "1–2 months", "Waitlist"];
var SPECIALTY_OPTIONS = [
  "Bipolar I",
  "Bipolar II",
  "Cyclothymia",
  "Mixed episodes",
  "Rapid cycling",
  "Mood stabilization",
  "Maintenance",
  "Co-occurring anxiety",
  "Psychosis",
];
var TELEHEALTH_STATE_OPTIONS = ["CA", "NY", "TX", "FL", "WA", "CO", "IL", "MA", "OR", "AZ", "NV"];

function renderPracticeNameForm(t) {
  return (
    '<div class="td-form">' +
    '<label class="td-form-row"><span class="td-form-label">Practice or clinic name</span>' +
    '<input type="text" class="td-input" id="tdcPracticeName" value="' +
    escapeHtml(String(t.practice_name || "")) +
    '" placeholder="Sunset Mood Clinic" /></label>' +
    '<p class="td-form-helper">If you practice under a group or clinic name. Leave blank if you’re solo.</p>' +
    '<div class="td-form-actions"><button type="button" class="td-save" data-tdc-save="practice_name">Save</button></div>' +
    "</div>"
  );
}

function renderWebsiteForm(t) {
  return (
    '<div class="td-form">' +
    '<label class="td-form-row"><span class="td-form-label">Practice website URL</span>' +
    '<input type="url" class="td-input" id="tdcWebsite" value="' +
    escapeHtml(String(t.website || "")) +
    '" placeholder="https://yourpractice.com" /></label>' +
    '<p class="td-form-helper">Linked from your public profile. We’ll add https:// for you if you forget.</p>' +
    '<div class="td-form-actions"><button type="button" class="td-save" data-tdc-save="website">Save</button></div>' +
    "</div>"
  );
}

function renderLanguagesForm(t) {
  var current = Array.isArray(t.languages) ? t.languages.filter(Boolean) : [];
  return (
    '<div class="td-form">' +
    '<div class="td-pick-grid">' +
    renderPickerRow(LANGUAGE_OPTIONS, current, "tdc-language") +
    "</div>" +
    '<p class="td-form-helper">Add any language you can run a full session in. English is implicit.</p>' +
    '<div class="td-form-actions"><button type="button" class="td-save" data-tdc-save="languages">Save</button></div>' +
    "</div>"
  );
}

function renderWaitTimeForm(t) {
  var current = String(t.estimated_wait_time || "");
  return (
    '<div class="td-form">' +
    '<div class="td-pick-grid">' +
    WAIT_TIME_OPTIONS.map(function (label) {
      return (
        '<button type="button" class="td-pick' +
        (current === label ? " is-selected" : "") +
        '" data-tdc-wait="' +
        escapeHtml(label) +
        '">' +
        escapeHtml(label) +
        "</button>"
      );
    }).join("") +
    "</div>" +
    '<p class="td-form-helper">Patients in crisis triage on this — be honest, not aspirational.</p>' +
    '<div class="td-form-actions"><button type="button" class="td-save" data-tdc-save="wait_time">Save</button></div>' +
    "</div>"
  );
}

function renderFirstStepForm(t) {
  return (
    '<div class="td-form">' +
    '<label class="td-form-row"><span class="td-form-label">What happens after a patient contacts you</span>' +
    '<textarea class="td-input td-textarea-bio" id="tdcFirstStep" rows="3" placeholder="I\'ll respond within 1–2 business days to schedule a free 15-minute phone consultation...">' +
    escapeHtml(String(t.first_step_expectation || "")) +
    "</textarea></label>" +
    '<p class="td-form-helper">Reduces anxiety for new patients. Also shown in the match modal.</p>' +
    '<div class="td-form-actions"><button type="button" class="td-save" data-tdc-save="first_step">Save</button></div>' +
    "</div>"
  );
}

function renderSpecialtiesForm(t) {
  var current = Array.isArray(t.specialties) ? t.specialties.filter(Boolean) : [];
  return (
    '<div class="td-form">' +
    '<div class="td-pick-grid">' +
    renderPickerRow(SPECIALTY_OPTIONS, current, "tdc-specialty") +
    "</div>" +
    '<div class="td-form-actions"><button type="button" class="td-save" data-tdc-save="specialties">Save</button></div>' +
    "</div>"
  );
}

function renderTotalYearsForm(t) {
  var yrs = Number(t.years_experience);
  return (
    '<div class="td-form">' +
    '<label class="td-form-row"><span class="td-form-label">Total years in practice</span>' +
    '<span class="td-form-input-wrap"><input type="number" min="0" max="80" class="td-input td-input-years" id="tdcTotalYears" value="' +
    escapeHtml(String(yrs > 0 ? yrs : "")) +
    '" placeholder="e.g. 18" /></span></label>' +
    '<p class="td-form-helper">General experience shown on your full profile. Separate from years treating bipolar.</p>' +
    '<div class="td-form-actions"><button type="button" class="td-save" data-tdc-save="total_years">Save</button></div>' +
    "</div>"
  );
}

function renderPlaceholderForm(field) {
  return (
    '<div class="td-form td-form-placeholder">' +
    "<p>Inline editing for <strong>" +
    escapeHtml(field.title) +
    "</strong> ships in the next update. Use the existing editor below for now.</p>" +
    '<div class="td-form-actions"><a class="td-save td-save-secondary" href="#portalEditProfile" data-portal-editor-jump="1">Open editor ↓</a></div>' +
    "</div>"
  );
}

function renderFormBody(field, therapist) {
  if (field.placeholder) return renderPlaceholderForm(field);
  if (field.key === "card_bio") return renderCardBioForm(therapist);
  if (field.key === "full_bio") return renderFullBioForm(therapist);
  if (field.key === "contact") return renderContactRouteForm(therapist);
  if (field.key === "headshot") return renderHeadshotForm(therapist);
  if (field.key === "name") return renderNameForm(therapist);
  if (field.key === "location") return renderLocationForm(therapist);
  if (field.key === "fee") return renderFeeForm(therapist);
  if (field.key === "modalities") return renderModalitiesForm(therapist);
  if (field.key === "format") return renderFormatForm(therapist);
  if (field.key === "insurance") return renderInsuranceForm(therapist);
  if (field.key === "populations") return renderPopulationsForm(therapist);
  if (field.key === "years") return renderYearsForm(therapist);
  if (field.key === "practice_name") return renderPracticeNameForm(therapist);
  if (field.key === "website") return renderWebsiteForm(therapist);
  if (field.key === "languages") return renderLanguagesForm(therapist);
  if (field.key === "wait_time") return renderWaitTimeForm(therapist);
  if (field.key === "first_step") return renderFirstStepForm(therapist);
  if (field.key === "specialties") return renderSpecialtiesForm(therapist);
  if (field.key === "total_years") return renderTotalYearsForm(therapist);
  return "";
}

// ─── Public API ──────────────────────────────────────────────────────

export function shouldShowCompleteness(therapist) {
  // Always show for any verified clinician — the panel IS the editor.
  return Boolean(therapist);
}

export function mountPortalTdCompleteness(container, therapist, options) {
  if (!container) return;
  var opts = options || {};
  var localTherapist = Object.assign({}, therapist);

  function fieldsRemaining() {
    return FIELD_REGISTRY.filter(function (f) {
      return !f.isComplete(localTherapist);
    }).length;
  }

  function refreshPreview() {
    var preview = container.querySelector("#tdcPreview");
    if (preview) updatePortalCardPreview(preview, localTherapist);
  }

  function refreshScore() {
    var score = computeScore(localTherapist);
    var subline = container.querySelector("#tdcSubline");
    var scoreEl = container.querySelector("#tdcScore");
    var fillEl = container.querySelector("#tdcFill");
    var remaining = fieldsRemaining();
    if (subline) {
      subline.textContent =
        remaining > 0
          ? remaining +
            " field" +
            (remaining === 1 ? "" : "s") +
            " remaining — each one increases your inquiry rate."
          : "Profile complete — your listing is fully optimized.";
    }
    if (scoreEl) {
      var band = getScoreBand(score);
      scoreEl.textContent = score + "/100";
      scoreEl.className = "td-completeness-score td-completeness-score-" + band.tone;
    }
    if (fillEl) fillEl.style.width = score + "%";
    // Tell the host page so the TD-A header can update its own badge.
    if (typeof opts.onScoreChange === "function") opts.onScoreChange(score);
  }

  function refreshNotLiveBar() {
    var slot = container.querySelector("#tdcNotLiveSlot");
    if (slot) slot.innerHTML = renderNotLiveBar(localTherapist);
  }

  function refreshRow(key) {
    var field = FIELD_REGISTRY.find(function (f) {
      return f.key === key;
    });
    if (!field) return;
    var article = container.querySelector('[data-tdc-row="' + key + '"]');
    if (!article) return;
    var newHtml = renderRow(field, localTherapist);
    var wrapper = document.createElement("div");
    wrapper.innerHTML = newHtml;
    if (article.parentElement)
      article.parentElement.replaceChild(wrapper.firstElementChild, article);
    bindRowEvents();
  }

  // Per-form draft state. Reset whenever a row is opened.
  var formDraft = {};

  function bindRowEvents() {
    container.querySelectorAll("[data-tdc-toggle]").forEach(function (btn) {
      // Avoid double-binding when refreshRow re-attaches.
      if (btn.dataset.tdcBound === "1") return;
      btn.dataset.tdcBound = "1";
      btn.addEventListener("click", function () {
        var key = btn.getAttribute("data-tdc-toggle");
        var body = container.querySelector('[data-tdc-body="' + key + '"]');
        var alreadyOpen = body && !body.hidden;
        // Close all bodies + collapse all rows.
        container.querySelectorAll(".td-row-body").forEach(function (b) {
          b.hidden = true;
          b.innerHTML = "";
        });
        container.querySelectorAll(".td-row").forEach(function (r) {
          r.classList.remove("is-open");
        });
        if (!alreadyOpen && body) {
          var field = FIELD_REGISTRY.find(function (f) {
            return f.key === key;
          });
          if (!field) return;
          body.innerHTML = renderFormBody(field, localTherapist);
          body.hidden = false;
          var article = body.closest(".td-row");
          if (article) article.classList.add("is-open");
          bindFormHandlers(key, body);
        }
      });
    });
    container.querySelectorAll("[data-tdc-save]").forEach(function (btn) {
      if (btn.dataset.tdcBound === "1") return;
      btn.dataset.tdcBound = "1";
      btn.addEventListener("click", function () {
        saveItem(btn.getAttribute("data-tdc-save"));
      });
    });
  }

  function bindFormHandlers(key, bodyEl) {
    formDraft = {};

    if (key === "modalities") {
      formDraft.list = (
        Array.isArray(localTherapist.treatment_modalities)
          ? localTherapist.treatment_modalities.filter(Boolean)
          : []
      ).slice();
      bodyEl.querySelectorAll("[data-tdc-modality]").forEach(function (b) {
        b.addEventListener("click", function () {
          toggleListPick(b, "tdc-modality");
        });
      });
      wireAddOther(bodyEl, "tdc-modality");
    } else if (key === "format") {
      formDraft.list = [];
      if (localTherapist.accepts_in_person) formDraft.list.push("In-person");
      if (localTherapist.accepts_telehealth) formDraft.list.push("Telehealth");
      formDraft.teleStates = (
        Array.isArray(localTherapist.telehealth_states)
          ? localTherapist.telehealth_states.filter(Boolean)
          : []
      ).slice();
      var statesWrap = bodyEl.querySelector("[data-tdc-format-states]");
      bodyEl.querySelectorAll("[data-tdc-format]").forEach(function (b) {
        b.addEventListener("click", function () {
          toggleListPick(b, "tdc-format");
          // Reveal/hide the telehealth-states block when Telehealth is
          // toggled on/off.
          if (statesWrap) {
            statesWrap.hidden = formDraft.list.indexOf("Telehealth") === -1;
          }
        });
      });
      bodyEl.querySelectorAll("[data-tdc-tele-state]").forEach(function (b) {
        b.addEventListener("click", function () {
          var label = b.getAttribute("data-tdc-tele-state");
          var idx = formDraft.teleStates.indexOf(label);
          if (idx === -1) formDraft.teleStates.push(label);
          else formDraft.teleStates.splice(idx, 1);
          b.classList.toggle("is-selected");
        });
      });
    } else if (key === "insurance") {
      formDraft.list = (
        Array.isArray(localTherapist.insurance_accepted)
          ? localTherapist.insurance_accepted.filter(Boolean)
          : []
      ).slice();
      bodyEl.querySelectorAll("[data-tdc-insurance]").forEach(function (b) {
        b.addEventListener("click", function () {
          toggleListPick(b, "tdc-insurance");
        });
      });
      wireAddOther(bodyEl, "tdc-insurance");
    } else if (key === "populations") {
      formDraft.list = (
        Array.isArray(localTherapist.client_populations)
          ? localTherapist.client_populations.filter(Boolean)
          : []
      ).slice();
      bodyEl.querySelectorAll("[data-tdc-population]").forEach(function (b) {
        b.addEventListener("click", function () {
          toggleListPick(b, "tdc-population");
        });
      });
    } else if (key === "languages") {
      formDraft.list = (
        Array.isArray(localTherapist.languages) ? localTherapist.languages.filter(Boolean) : []
      ).slice();
      bodyEl.querySelectorAll("[data-tdc-language]").forEach(function (b) {
        b.addEventListener("click", function () {
          toggleListPick(b, "tdc-language");
        });
      });
    } else if (key === "wait_time") {
      formDraft.value = String(localTherapist.estimated_wait_time || "");
      bodyEl.querySelectorAll("[data-tdc-wait]").forEach(function (b) {
        b.addEventListener("click", function () {
          formDraft.value = b.getAttribute("data-tdc-wait");
          bodyEl.querySelectorAll("[data-tdc-wait]").forEach(function (sib) {
            sib.classList.toggle(
              "is-selected",
              sib.getAttribute("data-tdc-wait") === formDraft.value,
            );
          });
        });
      });
    } else if (key === "specialties") {
      formDraft.list = (
        Array.isArray(localTherapist.specialties) ? localTherapist.specialties.filter(Boolean) : []
      ).slice();
      bodyEl.querySelectorAll("[data-tdc-specialty]").forEach(function (b) {
        b.addEventListener("click", function () {
          toggleListPick(b, "tdc-specialty");
        });
      });
    } else if (key === "headshot") {
      // Defer to the existing portalPhotoInput hidden file picker.
      // bindPortalPhotoUpload() handles validation, encoding, and the
      // PATCH; on success the page reloads with the new photo_url.
      var pickBtn = bodyEl.querySelector("[data-tdc-headshot-pick]");
      if (pickBtn) {
        pickBtn.addEventListener("click", function () {
          var hiddenInput = document.getElementById("portalPhotoInput");
          if (hiddenInput) hiddenInput.click();
        });
      }
    } else if (key === "card_bio") {
      // Card bio is the only field whose preview updates on every
      // keystroke. The card's voice slot mirrors what the therapist is
      // typing in real time so they see the patient-facing impact
      // immediately. Full bio (key === "full_bio") doesn't get this
      // treatment because it doesn't show on the match card.
      var cardBioEl = bodyEl.querySelector("#tdcCardBio");
      var cardBioCounter = bodyEl.querySelector("#tdcCardBioCounter");
      if (cardBioEl) {
        cardBioEl.addEventListener("input", function () {
          var v = cardBioEl.value;
          if (cardBioCounter) {
            cardBioCounter.textContent = v.length + " / " + CARD_BIO_MIN + " minimum";
            cardBioCounter.classList.toggle("is-short", v.length > 0 && v.length < CARD_BIO_MIN);
          }
          // Live-update the patient preview voice slot. This is a
          // throwaway state update — the actual care_approach field
          // only changes on save.
          var previewState = Object.assign({}, localTherapist, {
            care_approach: v,
            claim_status: "claimed",
          });
          var preview = container.querySelector("#tdcPreview");
          if (preview) updatePortalCardPreview(preview, previewState);
        });
      }
    } else if (key === "contact") {
      var initialMethod = String(localTherapist.preferred_contact_method || "").toLowerCase();
      formDraft.method =
        ["email", "phone", "booking"].indexOf(initialMethod) !== -1 ? initialMethod : "";
      bodyEl.querySelectorAll("[data-tdc-route]").forEach(function (pill) {
        pill.addEventListener("click", function () {
          formDraft.method = pill.getAttribute("data-tdc-route");
          bodyEl.querySelectorAll("[data-tdc-route]").forEach(function (sib) {
            sib.classList.toggle(
              "is-selected",
              sib.getAttribute("data-tdc-route") === formDraft.method,
            );
          });
          bodyEl.querySelectorAll("[data-tdc-route-input]").forEach(function (block) {
            block.hidden = block.getAttribute("data-tdc-route-input") !== formDraft.method;
          });
          var errEl = bodyEl.querySelector("[data-tdc-route-error]");
          if (errEl) {
            errEl.hidden = true;
            errEl.textContent = "";
          }
        });
      });
    } else if (key === "fee") {
      formDraft.sliding = Boolean(localTherapist.sliding_scale);
      bodyEl.querySelectorAll("[data-tdc-sliding]").forEach(function (b) {
        b.addEventListener("click", function () {
          formDraft.sliding = b.getAttribute("data-tdc-sliding") === "yes";
          bodyEl.querySelectorAll("[data-tdc-sliding]").forEach(function (sib) {
            sib.classList.toggle(
              "is-selected",
              sib.getAttribute("data-tdc-sliding") === (formDraft.sliding ? "yes" : "no"),
            );
          });
        });
      });
    }
  }

  function toggleListPick(btn, attr) {
    var label = btn.getAttribute("data-" + attr);
    var idx = formDraft.list.indexOf(label);
    if (idx === -1) formDraft.list.push(label);
    else formDraft.list.splice(idx, 1);
    btn.classList.toggle("is-selected");
  }

  // "+ Add" handler shared by Insurance + Modalities. Pulls the value
  // from the matching input, deduplicates, appends a selected pill to
  // the grid, and wires it for toggle so the clinician can also remove
  // their custom value.
  function wireAddOther(bodyEl, attr) {
    var addBtn = bodyEl.querySelector('[data-tdc-other-add="' + attr + '"]');
    var input = bodyEl.querySelector('[data-tdc-other-input="' + attr + '"]');
    var grid = bodyEl.querySelector('[data-tdc-pick-grid="' + attr + '"]');
    if (!addBtn || !input || !grid) return;

    function commit() {
      var value = String(input.value || "").trim();
      if (!value) return;
      // Case-insensitive dedup against the current list.
      var existing = formDraft.list.find(function (label) {
        return String(label).toLowerCase() === value.toLowerCase();
      });
      if (existing) {
        // Already there — flash the existing pill instead of duplicating.
        var existingBtn = grid.querySelector("[data-" + attr + '="' + existing + '"]');
        if (existingBtn) {
          existingBtn.classList.add("td-pick-flash");
          window.setTimeout(function () {
            existingBtn.classList.remove("td-pick-flash");
          }, 600);
        }
        input.value = "";
        return;
      }
      formDraft.list.push(value);
      input.value = "";
      var pill = document.createElement("button");
      pill.type = "button";
      pill.className = "td-pick is-selected td-pick-custom";
      pill.setAttribute("data-" + attr, value);
      pill.textContent = value;
      pill.addEventListener("click", function () {
        toggleListPick(pill, attr);
      });
      grid.appendChild(pill);
    }

    addBtn.addEventListener("click", commit);
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
      }
    });
  }

  async function saveItem(key) {
    var bodyEl = container.querySelector('[data-tdc-body="' + key + '"]');
    if (!bodyEl) return;
    var saveBtn = bodyEl.querySelector("[data-tdc-save]");

    var payload = {};
    if (key === "card_bio") {
      var cardBioInput = bodyEl.querySelector("#tdcCardBio");
      var cardBioVal = cardBioInput ? String(cardBioInput.value || "").trim() : "";
      if (cardBioVal.length < CARD_BIO_MIN) {
        var cardCounterEl = bodyEl.querySelector("#tdcCardBioCounter");
        if (cardCounterEl) {
          cardCounterEl.classList.add("is-short");
          cardCounterEl.textContent =
            "Your card bio is " + cardBioVal.length + " / " + CARD_BIO_MIN + " minimum.";
        }
        return;
      }
      payload.care_approach = cardBioVal;
    } else if (key === "full_bio") {
      var fullBioInput = bodyEl.querySelector("#tdcFullBio");
      payload.bio = fullBioInput ? String(fullBioInput.value || "").trim() : "";
    } else if (key === "contact") {
      var method = formDraft.method;
      var routeErr = bodyEl.querySelector("[data-tdc-route-error]");
      if (!method) {
        if (routeErr) {
          routeErr.textContent = "Pick how patients should reach you first.";
          routeErr.hidden = false;
        }
        return;
      }
      var inputEl = bodyEl.querySelector('[data-tdc-route-value="' + method + '"]');
      var rawValue = inputEl ? String(inputEl.value || "").trim() : "";
      if (!rawValue) {
        if (routeErr) {
          routeErr.textContent = "Enter your " + method + " value before saving.";
          routeErr.hidden = false;
        }
        return;
      }
      payload.preferred_contact_method = method;
      if (method === "email") payload.email = rawValue;
      else if (method === "phone") payload.phone = rawValue;
      else if (method === "booking") payload.booking_url = rawValue;
    } else if (key === "name") {
      var nameVal = String(bodyEl.querySelector("#tdcName").value || "").trim();
      var credsVal = String(bodyEl.querySelector("#tdcCredentials").value || "").trim();
      if (!nameVal) {
        var nameErr = bodyEl.querySelector(".td-form-error");
        if (!nameErr) {
          nameErr = document.createElement("p");
          nameErr.className = "td-form-error";
          bodyEl.querySelector(".td-form").appendChild(nameErr);
        }
        nameErr.textContent = "Display name can't be empty.";
        return;
      }
      payload.name = nameVal;
      payload.credentials = credsVal;
    } else if (key === "location") {
      var cityVal = String(bodyEl.querySelector("#tdcCity").value || "").trim();
      var stateVal = String(bodyEl.querySelector("#tdcState").value || "").trim();
      var zipInputEl = bodyEl.querySelector("#tdcZip");
      var zipRaw = zipInputEl ? String(zipInputEl.value || "").trim() : "";
      // Normalize: strip non-digits, pad/trim to 5. Empty string means
      // the clinician opted out — fallback city-centroid will run.
      var zipDigits = zipRaw.replace(/\D+/g, "").slice(0, 5);
      if (!cityVal || !stateVal) {
        var locErr = bodyEl.querySelector(".td-form-error");
        if (!locErr) {
          locErr = document.createElement("p");
          locErr.className = "td-form-error";
          bodyEl.querySelector(".td-form").appendChild(locErr);
        }
        locErr.textContent = "Both city and state are required.";
        return;
      }
      if (zipDigits && zipDigits.length !== 5) {
        var zipErr = bodyEl.querySelector(".td-form-error");
        if (!zipErr) {
          zipErr = document.createElement("p");
          zipErr.className = "td-form-error";
          bodyEl.querySelector(".td-form").appendChild(zipErr);
        }
        zipErr.textContent = "ZIP must be 5 digits, or leave it blank.";
        return;
      }
      payload.city = cityVal;
      payload.state = stateVal;
      payload.zip = zipDigits; // empty string is a valid "opt out" signal
    } else if (key === "modalities") payload.treatment_modalities = (formDraft.list || []).slice();
    else if (key === "format") {
      var formats = formDraft.list || [];
      payload.accepts_in_person = formats.indexOf("In-person") !== -1;
      payload.accepts_telehealth = formats.indexOf("Telehealth") !== -1;
      // Only save telehealth states when Telehealth is currently
      // selected; otherwise clear them so a clinician toggling
      // telehealth off doesn't leave stale state coverage on file.
      payload.telehealth_states = payload.accepts_telehealth
        ? (formDraft.teleStates || []).slice()
        : [];
    } else if (key === "insurance") payload.insurance_accepted = (formDraft.list || []).slice();
    else if (key === "populations") payload.client_populations = (formDraft.list || []).slice();
    else if (key === "languages") payload.languages = (formDraft.list || []).slice();
    else if (key === "specialties") payload.specialties = (formDraft.list || []).slice();
    else if (key === "wait_time") payload.estimated_wait_time = String(formDraft.value || "");
    else if (key === "fee") {
      var fee = Number(bodyEl.querySelector("#tdcFee").value) || 0;
      payload.session_fee_min = fee || null;
      payload.session_fee_max = fee || null;
      payload.sliding_scale = Boolean(formDraft.sliding);
    } else if (key === "years") {
      payload.bipolar_years_experience = Number(bodyEl.querySelector("#tdcYears").value) || 0;
    } else if (key === "total_years") {
      payload.years_experience = Number(bodyEl.querySelector("#tdcTotalYears").value) || 0;
    } else if (key === "practice_name") {
      payload.practice_name = String(bodyEl.querySelector("#tdcPracticeName").value || "").trim();
    } else if (key === "website") {
      payload.website = String(bodyEl.querySelector("#tdcWebsite").value || "").trim();
    } else if (key === "first_step") {
      payload.first_step_expectation = String(
        bodyEl.querySelector("#tdcFirstStep").value || "",
      ).trim();
    }

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving…";
    }

    try {
      var result = await patchTherapistProfile(payload);
      if (result && result.therapist) {
        Object.assign(localTherapist, result.therapist);
        if (typeof opts.onSaved === "function") opts.onSaved(result.therapist);
      } else {
        Object.assign(localTherapist, payload);
      }
      refreshPreview();
      refreshRow(key);
      refreshScore();
      refreshNotLiveBar();
      // Auto-collapse on success.
      var refreshedBody = container.querySelector('[data-tdc-body="' + key + '"]');
      if (refreshedBody) {
        refreshedBody.hidden = true;
        refreshedBody.innerHTML = "";
      }
      var article = container.querySelector('[data-tdc-row="' + key + '"]');
      if (article) article.classList.remove("is-open");
      trackFunnelEvent("portal_td_field_saved", {
        slug: localTherapist.slug,
        field_key: key,
        score: computeScore(localTherapist),
      });
    } catch (err) {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = "Try again";
      }
      var existingErr = bodyEl.querySelector(".td-form-error");
      if (!existingErr) {
        existingErr = document.createElement("p");
        existingErr.className = "td-form-error";
        bodyEl.querySelector(".td-form").appendChild(existingErr);
      }
      existingErr.textContent = (err && err.message) || "Couldn't save. Try again in a moment.";
    }
  }

  // First render
  var score = computeScore(localTherapist);
  var remaining = fieldsRemaining();
  container.innerHTML = renderShell(localTherapist, score, remaining);
  bindRowEvents();
  trackFunnelEvent("portal_td_completeness_shown", {
    slug: localTherapist.slug,
    score: score,
    fields_remaining: remaining,
  });
}
