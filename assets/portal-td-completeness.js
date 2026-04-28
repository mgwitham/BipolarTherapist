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

function computeScore(t) {
  if (!t) return 0;
  var score = 40; // signup baseline
  if (t.photo_url) score += 15;
  if (Array.isArray(t.treatment_modalities) && t.treatment_modalities.filter(Boolean).length)
    score += 10;
  if (Number(t.session_fee_min) > 0 || Number(t.session_fee_max) > 0 || t.sliding_scale)
    score += 10;
  if (Array.isArray(t.insurance_accepted) && t.insurance_accepted.filter(Boolean).length)
    score += 7;
  if (Array.isArray(t.client_populations) && t.client_populations.filter(Boolean).length)
    score += 8;
  if (t.accepts_in_person || t.accepts_telehealth) score += 5;
  if (Number(t.bipolar_years_experience) > 0 || Number(t.years_experience) > 0) score += 5;
  if (score > 100) score = 100;
  if (score < 0) score = 0;
  return score;
}

// ─── Field completion predicates ─────────────────────────────────────

function isBioComplete(t) {
  return Boolean(t && String(t.care_approach || "").trim().length >= 50);
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
  return Number(t && (t.bipolar_years_experience || t.years_experience)) > 0;
}

// ─── Field registry ──────────────────────────────────────────────────

var FIELD_REGISTRY = [
  {
    key: "bio",
    section: "essential",
    title: "Bio",
    badge: "Required",
    hint: "Required — describe how you work with clients (50+ characters)",
    isComplete: isBioComplete,
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
    key: "populations",
    section: "audience",
    title: "Populations served",
    badge: "+8 pts",
    hint: "Patients filter heavily by these",
    isComplete: isPopulationsComplete,
  },
  {
    key: "years",
    section: "audience",
    title: "Years of experience",
    badge: "+5 pts",
    hint: "8+ years unlocks a search ranking boost in your area",
    isComplete: isYearsComplete,
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
  if (field.key === "bio") {
    var bio = String(t.care_approach || "").trim();
    return bio.length > 90 ? bio.slice(0, 87) + "…" : bio;
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
    return [t.city, t.state].filter(Boolean).join(", ");
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
    var yrs = Number(t.bipolar_years_experience || t.years_experience);
    return yrs > 0 ? yrs + " year" + (yrs === 1 ? "" : "s") + " of experience" : field.hint;
  }
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
  return isBioComplete(t) && isContactRouteComplete(t);
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
    '<div id="tdcPreview">' +
    '<p class="td-completeness-preview-label">Patient preview · live</p>' +
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

var BIO_MIN = 50;

function renderBioForm(t) {
  var bio = String(t.care_approach || "");
  var len = bio.length;
  return (
    '<div class="td-form td-form-bio">' +
    '<label class="td-form-row">' +
    '<span class="td-form-label">Tell patients how you work with them</span>' +
    '<textarea class="td-input td-textarea-bio" id="tdcBio" rows="4" placeholder="Describe your approach in a few sentences. What can a patient expect from working with you?">' +
    escapeHtml(bio) +
    "</textarea>" +
    "</label>" +
    '<p class="td-form-counter" id="tdcBioCounter">' +
    len +
    " / " +
    BIO_MIN +
    " minimum" +
    "</p>" +
    '<div class="td-form-actions">' +
    '<button type="button" class="td-save" data-tdc-save="bio">Save bio</button>' +
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
    '<div class="td-pick-grid">' +
    renderPickerRow(MODALITY_OPTIONS, current, "tdc-modality") +
    "</div>" +
    '<div class="td-form-actions"><button type="button" class="td-save" data-tdc-save="modalities">Save</button></div>' +
    "</div>"
  );
}

function renderFormatForm(t) {
  var current = [];
  if (t.accepts_in_person) current.push("In-person");
  if (t.accepts_telehealth) current.push("Telehealth");
  return (
    '<div class="td-form">' +
    '<div class="td-pick-grid">' +
    renderPickerRow(FORMAT_OPTIONS, current, "tdc-format") +
    "</div>" +
    '<div class="td-form-actions"><button type="button" class="td-save" data-tdc-save="format">Save</button></div>' +
    "</div>"
  );
}

function renderInsuranceForm(t) {
  var current = Array.isArray(t.insurance_accepted) ? t.insurance_accepted.filter(Boolean) : [];
  return (
    '<div class="td-form">' +
    '<div class="td-pick-grid">' +
    renderPickerRow(INSURANCE_OPTIONS, current, "tdc-insurance") +
    "</div>" +
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
  var yrs = Number(t.bipolar_years_experience || t.years_experience);
  return (
    '<div class="td-form">' +
    '<label class="td-form-row"><span class="td-form-label">Years of bipolar experience</span>' +
    '<span class="td-form-input-wrap"><input type="number" min="0" max="80" class="td-input td-input-years" id="tdcYears" value="' +
    escapeHtml(String(yrs > 0 ? yrs : "")) +
    '" placeholder="e.g. 12" /></span></label>' +
    '<p class="td-form-helper">8+ years unlocks a search ranking boost.</p>' +
    '<div class="td-form-actions"><button type="button" class="td-save" data-tdc-save="years">Save</button></div>' +
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
  if (field.key === "bio") return renderBioForm(therapist);
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
    } else if (key === "format") {
      formDraft.list = [];
      if (localTherapist.accepts_in_person) formDraft.list.push("In-person");
      if (localTherapist.accepts_telehealth) formDraft.list.push("Telehealth");
      bodyEl.querySelectorAll("[data-tdc-format]").forEach(function (b) {
        b.addEventListener("click", function () {
          toggleListPick(b, "tdc-format");
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
    } else if (key === "bio") {
      // Bio is the only field whose preview updates on every keystroke
      // (per spec). The card's voice slot mirrors what the therapist is
      // typing in real time so they see the patient-facing impact
      // immediately.
      var textarea = bodyEl.querySelector("#tdcBio");
      var counter = bodyEl.querySelector("#tdcBioCounter");
      if (textarea) {
        textarea.addEventListener("input", function () {
          var v = textarea.value;
          if (counter) {
            counter.textContent = v.length + " / " + BIO_MIN + " minimum";
            counter.classList.toggle("is-short", v.length > 0 && v.length < BIO_MIN);
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

  async function saveItem(key) {
    var bodyEl = container.querySelector('[data-tdc-body="' + key + '"]');
    if (!bodyEl) return;
    var saveBtn = bodyEl.querySelector("[data-tdc-save]");

    var payload = {};
    if (key === "bio") {
      var bioEl = bodyEl.querySelector("#tdcBio");
      var bioVal = bioEl ? String(bioEl.value || "").trim() : "";
      if (bioVal.length < BIO_MIN) {
        var counterEl = bodyEl.querySelector("#tdcBioCounter");
        if (counterEl) {
          counterEl.classList.add("is-short");
          counterEl.textContent = "Your bio is " + bioVal.length + " / " + BIO_MIN + " minimum.";
        }
        return;
      }
      payload.care_approach = bioVal;
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
      payload.city = cityVal;
      payload.state = stateVal;
    } else if (key === "modalities") payload.treatment_modalities = (formDraft.list || []).slice();
    else if (key === "format") {
      payload.accepts_in_person = (formDraft.list || []).indexOf("In-person") !== -1;
      payload.accepts_telehealth = (formDraft.list || []).indexOf("Telehealth") !== -1;
    } else if (key === "insurance") payload.insurance_accepted = (formDraft.list || []).slice();
    else if (key === "populations") payload.client_populations = (formDraft.list || []).slice();
    else if (key === "fee") {
      var fee = Number(bodyEl.querySelector("#tdcFee").value) || 0;
      payload.session_fee_min = fee || null;
      payload.session_fee_max = fee || null;
      payload.sliding_scale = Boolean(formDraft.sliding);
    } else if (key === "years") {
      payload.bipolar_years_experience = Number(bodyEl.querySelector("#tdcYears").value) || 0;
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
