// Portal-side live card preview. Wraps the shared match-card primitives
// from card-content.js with empty-state placeholder treatment so the
// preview can render meaningfully even when the clinician has only
// partially filled their listing.
//
// Public API:
//   renderPortalCardPreview(state)  -> HTML string
//   updatePortalCardPreview(root, state)  -> swap innerHTML
//
// `state` is shaped like the public therapist object so it can be passed
// straight to the card-content primitives. Fields used:
//   name, credentials, photo_url
//   care_approach, claim_status (always "claimed" in portal)
//   specialties (array)
//   accepts_in_person, accepts_telehealth, city, state, zip, telehealth_states
//   accepting_new_patients, estimated_wait_time
//   insurance_accepted, session_fee_min, session_fee_max, sliding_scale
//   preferred_contact_method, phone, email, booking_url, website
//   client_populations, treatment_modalities, languages

import {
  renderRoundAvatar,
  renderVoiceCascade,
  getLocationModalityLabel,
  getCostLabel,
  renderAvailabilityBadge,
} from "./card-content.js";

// Portal-specific specialty-pill renderer. Unlike the patient-facing
// match card (which filters out generic terms like "Bipolar disorder"
// and "Psychosis" so the listing reads less clinical), the portal
// preview shows the clinician exactly what they selected — they need
// full transparency about what they've added to their listing.
function renderPortalSpecialtyPills(specialties) {
  var list = Array.isArray(specialties) ? specialties.filter(Boolean) : [];
  if (!list.length) return "";
  var visible = list.slice(0, 3);
  var overflow = list.length - visible.length;
  var html = visible
    .map(function (label) {
      return '<span class="bth-pill">' + escapeHtml(label) + "</span>";
    })
    .join("");
  if (overflow > 0) {
    html += '<span class="bth-pill bth-pill-overflow">+' + overflow + "</span>";
  }
  return '<div class="bth-pill-row">' + html + "</div>";
}

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
    if (ch === "&") return "&amp;";
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    if (ch === '"') return "&quot;";
    return "&#39;";
  });
}

// ─── Empty-state predicates ───────────────────────────────────────────

function hasSpecialties(state) {
  return Array.isArray(state && state.specialties) && state.specialties.length > 0;
}

function hasPracticeMode(state) {
  return Boolean(state && (state.accepts_in_person || state.accepts_telehealth));
}

function hasCareApproach(state) {
  return Boolean(state && String(state.care_approach || "").trim());
}

function hasCostInfo(state) {
  if (!state) return false;
  if (Array.isArray(state.insurance_accepted) && state.insurance_accepted.length) return true;
  if (Number(state.session_fee_min) > 0 || Number(state.session_fee_max) > 0) return true;
  if (state.sliding_scale) return true;
  return false;
}

// ─── Placeholder fragments ─────────────────────────────────────────────

function renderPlaceholderPills() {
  return (
    '<div class="bth-pill-row">' +
    '<span class="bth-pill bth-pill-placeholder">Specialty</span>' +
    '<span class="bth-pill bth-pill-placeholder">Specialty</span>' +
    "</div>"
  );
}

function renderPlaceholderVoice() {
  return '<p class="bth-voice bth-voice-placeholder">Your approach will appear here</p>';
}

function renderPlaceholderInfoLine(label) {
  return (
    '<span class="bth-card-info-item bth-card-info-placeholder">' + escapeHtml(label) + "</span>"
  );
}

// ─── CTA ladder for portal preview ─────────────────────────────────────

function getCtaLabel(state) {
  var method = String((state && state.preferred_contact_method) || "").toLowerCase();
  if (method === "phone") return "Call now";
  if (method === "booking") return "Book a consult";
  if (method === "website") return "Visit practice site";
  if (method === "email") return "Send an email";
  // Default first-load: spec calls Email the default if no preference
  return "Send an email";
}

// ─── Card render ───────────────────────────────────────────────────────

export function renderPortalCardPreview(state) {
  var s = state || {};

  // Avatar — when no photo, the round-avatar primitive renders a colored
  // initials circle. That's already a reasonable placeholder, so we don't
  // need a separate empty-state for it.
  var avatarHtml =
    '<div class="bth-card-avatar-slot">' +
    renderRoundAvatar(
      {
        name: s.name || "",
        photo_url: s.photo_url || "",
        slug: s.slug || "",
        id: s.id || s._id || "",
      },
      "card",
    ) +
    "</div>";

  // Name + credentials
  var nameHtml =
    '<h3 class="bth-card-name">' +
    escapeHtml(s.name || "Your name") +
    (s.credentials
      ? ', <span class="bth-card-creds">' + escapeHtml(s.credentials) + "</span>"
      : "") +
    "</h3>";

  // Specialty pills (Zone 1) — placeholder when empty
  var pillsHtml = hasSpecialties(s)
    ? renderPortalSpecialtyPills(s.specialties)
    : renderPlaceholderPills();

  // Voice cascade (Zone 2) — placeholder when no care_approach AND no
  // populations / languages / modalities to fall through to. We force
  // the placeholder when the user simply hasn't filled the voice yet,
  // since that's the spec'd portal behavior.
  var voiceHtml = hasCareApproach(s) ? renderVoiceCascade(s) : renderPlaceholderVoice();

  // Info row — location / cost / availability
  var infoParts = [];

  if (hasPracticeMode(s)) {
    var locationLabel = getLocationModalityLabel(s);
    if (locationLabel) {
      infoParts.push('<span class="bth-card-info-item">' + escapeHtml(locationLabel) + "</span>");
    }
  } else {
    infoParts.push(renderPlaceholderInfoLine("Set how you see clients"));
  }

  if (hasCostInfo(s)) {
    var costLabel = getCostLabel(s);
    if (costLabel) {
      infoParts.push('<span class="bth-card-info-item">' + escapeHtml(costLabel) + "</span>");
    }
  }

  var availabilityHtml = renderAvailabilityBadge(s);
  if (availabilityHtml) {
    infoParts.push('<span class="bth-card-info-item">' + availabilityHtml + "</span>");
  }

  var infoRowHtml = infoParts.length
    ? '<div class="bth-card-info">' +
      infoParts.join('<span class="bth-card-info-dot" aria-hidden="true">·</span>') +
      "</div>"
    : "";

  // Actions — always render the spec'd CTA labels so the clinician can
  // see what patients will see. These are non-functional in the preview.
  var ctaLabel = getCtaLabel(s);
  var actionsHtml =
    '<div class="bth-card-actions">' +
    '<span class="bth-btn-primary bth-btn-primary-preview" aria-disabled="true">' +
    escapeHtml(ctaLabel) +
    " →</span>" +
    '<span class="bth-btn-secondary" aria-disabled="true">View profile →</span>' +
    "</div>";

  return (
    '<article class="bth-card bth-card-preview">' +
    '<div class="bth-card-header">' +
    avatarHtml +
    '<div class="bth-card-ident">' +
    nameHtml +
    "</div>" +
    "</div>" +
    pillsHtml +
    voiceHtml +
    infoRowHtml +
    actionsHtml +
    "</article>"
  );
}

export function updatePortalCardPreview(root, state) {
  if (!root) return;
  root.innerHTML = renderPortalCardPreview(state);
}
