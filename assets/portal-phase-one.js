// Phase 1 onboarding — "Get your card live."
//
// Mounted only when the clinician hasn't yet satisfied the minimum
// go-live requirements: at least one specialty AND a practice mode.
// Renders a focused 5-field flow with a sticky live preview of the
// patient-facing card, updating in real time as fields change.
//
// On "Go live", saves the Phase 1 fields via PATCH /portal/therapist
// and calls options.onSaved(updatedTherapist) so the parent can swap
// the dashboard into Phase 2 without a page reload.

import { renderPortalCardPreview, updatePortalCardPreview } from "./portal-card-preview.js";
import { patchTherapistProfile } from "./review-api.js";

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
    if (ch === "&") return "&amp;";
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    if (ch === '"') return "&quot;";
    return "&#39;";
  });
}

// Spec'd specialty options (Step 5, Field 4). Order matches the spec.
var SPECIALTY_OPTIONS = [
  "Bipolar I",
  "Bipolar II",
  "Mood stabilization",
  "First-episode care",
  "Med management",
  "Rapid cycling",
  "Anxiety",
  "Trauma",
  "ADHD",
];

var CARE_APPROACH_LIMIT = 120;
var CARE_APPROACH_EXAMPLE =
  "I specialize in Bipolar II for high-functioning adults who've struggled to find the right medication fit.";

// ─── State helpers ────────────────────────────────────────────────────

function deriveInitialState(therapist) {
  var t = therapist || {};
  var practiceMode = "";
  if (t.accepts_in_person && t.accepts_telehealth) practiceMode = "both";
  else if (t.accepts_in_person) practiceMode = "in-person";
  else if (t.accepts_telehealth) practiceMode = "telehealth";

  return {
    name: t.name || "",
    credentials: t.credentials || "",
    photo_url: t.photo_url || "",
    care_approach: t.care_approach || "",
    practice_mode: practiceMode,
    accepts_in_person: Boolean(t.accepts_in_person),
    accepts_telehealth: Boolean(t.accepts_telehealth),
    city: t.city || "",
    state: t.state || "California",
    zip: t.zip || "",
    specialties: Array.isArray(t.specialties) ? t.specialties.filter(Boolean) : [],
    preferred_contact_method: t.preferred_contact_method || "email",
    accepting_new_patients: t.accepting_new_patients,
    estimated_wait_time: t.estimated_wait_time || "",
    insurance_accepted: Array.isArray(t.insurance_accepted) ? t.insurance_accepted : [],
    session_fee_min: t.session_fee_min,
    session_fee_max: t.session_fee_max,
    sliding_scale: Boolean(t.sliding_scale),
    client_populations: Array.isArray(t.client_populations) ? t.client_populations : [],
    treatment_modalities: Array.isArray(t.treatment_modalities) ? t.treatment_modalities : [],
    languages: Array.isArray(t.languages) ? t.languages : [],
    claim_status: t.claim_status || "claimed",
    slug: t.slug || "",
  };
}

function applyPracticeMode(state, mode) {
  state.practice_mode = mode;
  state.accepts_in_person = mode === "in-person" || mode === "both";
  state.accepts_telehealth = mode === "telehealth" || mode === "both";
  if (mode === "telehealth") state.zip = "";
  return state;
}

function isReadyToGoLive(state) {
  return Boolean(state.specialties.length) && Boolean(state.practice_mode);
}

function getMissingForLive(state) {
  var missing = [];
  if (!state.specialties.length) missing.push("specialties");
  if (!state.practice_mode) missing.push("practice mode");
  return missing;
}

// ─── Markup builders ──────────────────────────────────────────────────

function renderSpecialtyPicker(state) {
  return SPECIALTY_OPTIONS.map(function (label) {
    var selected = state.specialties.indexOf(label) !== -1;
    return (
      '<button type="button" class="ph1-pick' +
      (selected ? " is-selected" : "") +
      '" data-ph1-specialty="' +
      escapeHtml(label) +
      '">' +
      escapeHtml(label) +
      "</button>"
    );
  }).join("");
}

function renderModeSegments(state) {
  var modes = [
    { value: "in-person", label: "In-person" },
    { value: "telehealth", label: "Telehealth" },
    { value: "both", label: "Both" },
  ];
  return modes
    .map(function (m) {
      return (
        '<button type="button" class="ph1-segment' +
        (state.practice_mode === m.value ? " is-selected" : "") +
        '" data-ph1-mode="' +
        escapeHtml(m.value) +
        '">' +
        escapeHtml(m.label) +
        "</button>"
      );
    })
    .join("");
}

function renderCtaSegments(state) {
  var ctas = [
    { value: "email", label: "Email" },
    { value: "phone", label: "Phone" },
    { value: "booking", label: "Booking link" },
  ];
  return ctas
    .map(function (c) {
      return (
        '<button type="button" class="ph1-segment' +
        (state.preferred_contact_method === c.value ? " is-selected" : "") +
        '" data-ph1-cta="' +
        escapeHtml(c.value) +
        '">' +
        escapeHtml(c.label) +
        "</button>"
      );
    })
    .join("");
}

function renderGoLiveButton(state) {
  var ready = isReadyToGoLive(state);
  var missing = getMissingForLive(state);
  var helperText = ready ? "" : "Add " + missing.join(" and ") + " to go live";
  return (
    '<button type="button" class="ph1-go-live' +
    (ready ? " is-ready" : " is-locked") +
    '" id="ph1GoLive"' +
    (ready ? "" : ' aria-disabled="true"') +
    ">Go live →</button>" +
    (helperText
      ? '<p class="ph1-go-live-helper" id="ph1GoLiveHelper">' + escapeHtml(helperText) + "</p>"
      : '<p class="ph1-go-live-helper" id="ph1GoLiveHelper" hidden></p>')
  );
}

function renderShell(state) {
  var modeId = "ph1Mode";
  var zipShown = state.practice_mode === "in-person" || state.practice_mode === "both";

  return (
    '<section class="portal-card ph1-shell" id="portalPhaseOne">' +
    '<header class="ph1-header">' +
    '<p class="portal-eyebrow">Get your card live</p>' +
    '<h2 class="ph1-heading">Get your card live</h2>' +
    '<p class="portal-subtle">5 fields. Your card updates as you type.</p>' +
    "</header>" +
    '<div class="ph1-grid">' +
    '<div class="ph1-fields">' +
    // Field 1 — Photo
    '<div class="ph1-field ph1-photo-field">' +
    '<label class="ph1-label">Headshot</label>' +
    '<div class="ph1-photo-row">' +
    '<div class="ph1-photo-avatar' +
    (state.photo_url ? " has-photo" : "") +
    '" id="ph1PhotoAvatar">' +
    (state.photo_url
      ? '<img src="' + escapeHtml(state.photo_url) + '" alt="" />'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>') +
    "</div>" +
    '<div class="ph1-photo-copy">' +
    '<button type="button" class="ph1-photo-cta" id="ph1PhotoCta">' +
    (state.photo_url ? "Update headshot" : "Add a headshot") +
    "</button>" +
    '<p class="ph1-helper">Profiles with photos earn 3× more clicks</p>' +
    "</div>" +
    "</div>" +
    "</div>" +
    // Field 2 — Care approach
    '<div class="ph1-field">' +
    '<label class="ph1-label" for="ph1CareApproach">How you help bipolar clients</label>' +
    '<div class="ph1-callout">' +
    '<em>"' +
    escapeHtml(CARE_APPROACH_EXAMPLE) +
    '"</em>' +
    "</div>" +
    '<textarea id="ph1CareApproach" class="ph1-textarea" rows="3" maxlength="' +
    CARE_APPROACH_LIMIT +
    '" placeholder="Your sentence about how you work with bipolar clients">' +
    escapeHtml(state.care_approach || "") +
    "</textarea>" +
    '<p class="ph1-counter" id="ph1CareApproachCounter">' +
    String((state.care_approach || "").length) +
    " / " +
    CARE_APPROACH_LIMIT +
    " · becomes the italic line on your card</p>" +
    "</div>" +
    // Field 3 — Practice mode + ZIP
    '<div class="ph1-field">' +
    '<label class="ph1-label">How do you see clients?</label>' +
    '<div class="ph1-segments" id="' +
    modeId +
    '">' +
    renderModeSegments(state) +
    "</div>" +
    '<div class="ph1-zip-wrap" id="ph1ZipWrap"' +
    (zipShown ? "" : " hidden") +
    ">" +
    '<label class="ph1-label ph1-label-secondary" for="ph1Zip">Practice ZIP code</label>' +
    '<p class="ph1-helper">Shows approximate distance on your card for nearby patients.</p>' +
    '<input type="text" id="ph1Zip" class="ph1-input ph1-zip-input" inputmode="numeric" pattern="[0-9]{5}" maxlength="5" value="' +
    escapeHtml(state.zip || "") +
    '" placeholder="94102" />' +
    "</div>" +
    "</div>" +
    // Field 4 — Specialties
    '<div class="ph1-field">' +
    '<label class="ph1-label">Bipolar specialties</label>' +
    '<p class="ph1-helper">Tap to add — appear as pills on your card.</p>' +
    '<div class="ph1-pick-grid" id="ph1Specialties">' +
    renderSpecialtyPicker(state) +
    "</div>" +
    "</div>" +
    // Field 5 — Primary CTA
    '<div class="ph1-field">' +
    '<label class="ph1-label">How should patients reach you first?</label>' +
    '<div class="ph1-segments" id="ph1Cta">' +
    renderCtaSegments(state) +
    "</div>" +
    "</div>" +
    // Go live button
    '<div class="ph1-go-live-wrap">' +
    renderGoLiveButton(state) +
    '<p class="ph1-feedback" id="ph1Feedback" aria-live="polite"></p>' +
    "</div>" +
    "</div>" +
    // Right column — sticky preview
    '<aside class="ph1-preview-column">' +
    '<p class="ph1-preview-label">Patient preview</p>' +
    '<div class="ph1-preview-mount" id="ph1Preview">' +
    renderPortalCardPreview(state) +
    "</div>" +
    "</aside>" +
    "</div>" +
    "</section>"
  );
}

// ─── Public API ────────────────────────────────────────────────────────

export function shouldShowPhaseOne(therapist) {
  var t = therapist || {};
  var hasSpecialties = Array.isArray(t.specialties) && t.specialties.filter(Boolean).length > 0;
  var hasMode = Boolean(t.accepts_in_person || t.accepts_telehealth);
  return !(hasSpecialties && hasMode);
}

export function mountPortalPhaseOne(container, therapist, options) {
  if (!container) return;
  var opts = options || {};
  var state = deriveInitialState(therapist);

  container.innerHTML = renderShell(state);

  var preview = container.querySelector("#ph1Preview");
  var feedback = container.querySelector("#ph1Feedback");
  var goLiveBtn = container.querySelector("#ph1GoLive");
  var goLiveHelper = container.querySelector("#ph1GoLiveHelper");

  function refreshPreview() {
    if (preview) updatePortalCardPreview(preview, state);
  }

  function refreshGoLive() {
    if (!goLiveBtn) return;
    var ready = isReadyToGoLive(state);
    goLiveBtn.classList.toggle("is-ready", ready);
    goLiveBtn.classList.toggle("is-locked", !ready);
    if (ready) goLiveBtn.removeAttribute("aria-disabled");
    else goLiveBtn.setAttribute("aria-disabled", "true");
    if (goLiveHelper) {
      var missing = getMissingForLive(state);
      if (missing.length) {
        goLiveHelper.textContent = "Add " + missing.join(" and ") + " to go live";
        goLiveHelper.hidden = false;
      } else {
        goLiveHelper.textContent = "";
        goLiveHelper.hidden = true;
      }
    }
  }

  // Care approach textarea — live preview update + counter
  var textarea = container.querySelector("#ph1CareApproach");
  var counter = container.querySelector("#ph1CareApproachCounter");
  if (textarea) {
    textarea.addEventListener("input", function () {
      state.care_approach = textarea.value;
      if (counter) {
        counter.textContent =
          textarea.value.length +
          " / " +
          CARE_APPROACH_LIMIT +
          " · becomes the italic line on your card";
      }
      refreshPreview();
    });
  }

  // Practice mode segments
  var modeWrap = container.querySelector("#ph1Mode");
  if (modeWrap) {
    modeWrap.addEventListener("click", function (event) {
      var btn = event.target.closest("[data-ph1-mode]");
      if (!btn) return;
      var mode = btn.getAttribute("data-ph1-mode");
      applyPracticeMode(state, mode);
      // Re-render the segment row
      modeWrap.innerHTML = renderModeSegments(state);
      // Show/hide the ZIP field
      var zipWrap = container.querySelector("#ph1ZipWrap");
      if (zipWrap) zipWrap.hidden = !(mode === "in-person" || mode === "both");
      refreshPreview();
      refreshGoLive();
    });
  }

  // ZIP input
  var zipInput = container.querySelector("#ph1Zip");
  if (zipInput) {
    zipInput.addEventListener("input", function () {
      state.zip = zipInput.value.replace(/\D+/g, "").slice(0, 5);
      if (zipInput.value !== state.zip) zipInput.value = state.zip;
      refreshPreview();
    });
  }

  // Specialties grid
  var specWrap = container.querySelector("#ph1Specialties");
  if (specWrap) {
    specWrap.addEventListener("click", function (event) {
      var btn = event.target.closest("[data-ph1-specialty]");
      if (!btn) return;
      var label = btn.getAttribute("data-ph1-specialty");
      var idx = state.specialties.indexOf(label);
      if (idx === -1) state.specialties.push(label);
      else state.specialties.splice(idx, 1);
      btn.classList.toggle("is-selected");
      refreshPreview();
      refreshGoLive();
    });
  }

  // Primary CTA segments
  var ctaWrap = container.querySelector("#ph1Cta");
  if (ctaWrap) {
    ctaWrap.addEventListener("click", function (event) {
      var btn = event.target.closest("[data-ph1-cta]");
      if (!btn) return;
      state.preferred_contact_method = btn.getAttribute("data-ph1-cta");
      ctaWrap.innerHTML = renderCtaSegments(state);
      refreshPreview();
    });
  }

  // Headshot upload — defer to existing portal handler. We expose a
  // hook on options so the host page can wire this to its own upload
  // flow without us re-implementing it.
  var photoCta = container.querySelector("#ph1PhotoCta");
  if (photoCta && typeof opts.onRequestPhotoUpload === "function") {
    photoCta.addEventListener("click", function () {
      opts.onRequestPhotoUpload(function onUploaded(newPhotoUrl) {
        state.photo_url = newPhotoUrl || "";
        var avatarEl = container.querySelector("#ph1PhotoAvatar");
        if (avatarEl) {
          avatarEl.classList.toggle("has-photo", Boolean(newPhotoUrl));
          avatarEl.innerHTML = newPhotoUrl
            ? '<img src="' + escapeHtml(newPhotoUrl) + '" alt="" />'
            : avatarEl.innerHTML; // keep the silhouette svg
        }
        refreshPreview();
      });
    });
  }

  // Go live → save Phase 1 fields, transition to Phase 2
  if (goLiveBtn) {
    goLiveBtn.addEventListener("click", async function () {
      if (!isReadyToGoLive(state)) return;
      goLiveBtn.disabled = true;
      goLiveBtn.classList.add("is-saving");
      if (feedback) {
        feedback.textContent = "Going live…";
        feedback.style.color = "";
      }
      var payload = {
        care_approach: state.care_approach,
        accepts_in_person: state.accepts_in_person,
        accepts_telehealth: state.accepts_telehealth,
        zip: state.zip,
        specialties: state.specialties,
        preferred_contact_method: state.preferred_contact_method,
      };
      try {
        var result = await patchTherapistProfile(payload);
        if (feedback) {
          feedback.textContent = "Your card is live.";
          feedback.style.color = "#0f6e56";
        }
        // Brief teal flash on the preview as the success signal
        var previewCard = container.querySelector(".bth-card-preview");
        if (previewCard) {
          previewCard.classList.add("ph1-pulse");
          window.setTimeout(function () {
            previewCard.classList.remove("ph1-pulse");
          }, 900);
        }
        if (typeof opts.onSaved === "function") {
          opts.onSaved((result && result.therapist) || null);
        }
      } catch (err) {
        if (feedback) {
          feedback.textContent =
            (err && err.message) || "Something went wrong. Try again in a moment.";
          feedback.style.color = "#b03636";
        }
        goLiveBtn.disabled = false;
        goLiveBtn.classList.remove("is-saving");
      }
    });
  }
}
