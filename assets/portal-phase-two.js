// Phase 2 — "Improve your listing."
//
// Mounted only when the clinician has satisfied the Phase 1 minimums
// (specialties + practice mode). Renders the new "Listing strength"
// progress panel + an accordion of up-to-six improvement items, each
// of which saves a single field on click and fades out.
//
// Card preview lives in the right column and re-renders on save (not
// on input — improvements aren't editable until the Save button is
// hit).

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

// Spec'd improvement options.
var INSURANCE_OPTIONS = [
  "Aetna",
  "BCBS",
  "Cigna",
  "Humana",
  "UHC",
  "Medicare",
  "Medicaid",
  "Anthem",
  "Tricare",
];
var MODALITY_OPTIONS = [
  "IPSRT",
  "Family-focused therapy",
  "CBT",
  "DBT",
  "Psychodynamic",
  "ACT",
  "Mindfulness-based",
];
var POPULATION_OPTIONS = [
  "Adults",
  "Adolescents",
  "Young adults",
  "Couples",
  "LGBTQ+ affirming",
  "BIPOC",
  "Veterans",
  "Seniors",
];

// ─── Improvement-completion predicates ────────────────────────────────

function hasHeadshot(t) {
  return Boolean(t && t.photo_url);
}
function hasInsurance(t) {
  return (
    Array.isArray(t && t.insurance_accepted) && t.insurance_accepted.filter(Boolean).length > 0
  );
}
function hasFees(t) {
  if (!t) return false;
  if (Number(t.session_fee_min) > 0 || Number(t.session_fee_max) > 0) return true;
  return Boolean(t.sliding_scale);
}
function hasModalities(t) {
  return (
    Array.isArray(t && t.treatment_modalities) && t.treatment_modalities.filter(Boolean).length > 0
  );
}
function hasYears(t) {
  return Number(t && t.bipolar_years_experience) > 0;
}
function hasPopulations(t) {
  return (
    Array.isArray(t && t.client_populations) && t.client_populations.filter(Boolean).length > 0
  );
}

// ─── Improvement registry ─────────────────────────────────────────────

function buildImprovements(therapist) {
  var items = [];
  if (!hasHeadshot(therapist)) {
    items.push({
      key: "headshot",
      title: "Add a headshot",
      impact: "Profiles with photos earn 3× more clicks",
      complete: false,
    });
  }
  items.push({
    key: "insurance",
    title: "Add insurance accepted",
    impact: "Appear in searches for 60%+ of patients who filter by insurance",
    complete: hasInsurance(therapist),
  });
  items.push({
    key: "fees",
    title: "Set your session fee",
    impact: "Filters out price mismatches before they reach your inbox",
    complete: hasFees(therapist),
  });
  items.push({
    key: "modalities",
    title: "Add treatment modalities",
    impact: "IPSRT and family-focused therapy are high-signal for patients",
    complete: hasModalities(therapist),
  });
  items.push({
    key: "years",
    title: "Add years treating bipolar",
    impact: "8+ years unlocks a search ranking boost in your area",
    complete: hasYears(therapist),
  });
  items.push({
    key: "populations",
    title: "Add populations you serve",
    impact: "Adolescents, LGBTQ+, BIPOC — patients filter heavily by these",
    complete: hasPopulations(therapist),
  });
  return items;
}

// Items that started complete don't render. Only show genuinely empty
// fields plus any that were saved during this session (which are then
// faded out on save).
function pendingImprovements(items) {
  return items.filter(function (item) {
    return !item.complete;
  });
}

// ─── Progress signal ──────────────────────────────────────────────────

function buildProgress(items) {
  // 4 base points are credited the moment Phase 1 minimums are met. Each
  // of the 5 substantive improvements adds 1 point. Headshot is an
  // optional 6th item that doesn't change the denominator (per spec the
  // total is 9 — 4 base + 5 improvements).
  var subItems = items.filter(function (i) {
    return i.key !== "headshot";
  });
  var completed = subItems.filter(function (i) {
    return i.complete;
  }).length;
  var pct = Math.round(((4 + completed) / 9) * 100);
  var remaining = subItems.length - completed;
  var description =
    remaining > 0
      ? remaining +
        " improvement" +
        (remaining === 1 ? "" : "s") +
        " available — adding them could 2–4× your inquiry rate"
      : "All improvements complete — great listing!";
  return { pct: pct, description: description, remaining: remaining };
}

// ─── Markup builders ──────────────────────────────────────────────────

function renderProgress(progress) {
  return (
    '<section class="ph2-progress" id="ph2Progress">' +
    '<div class="ph2-progress-header">' +
    '<div class="ph2-progress-meta">' +
    '<p class="ph2-progress-label">Listing strength</p>' +
    '<p class="ph2-progress-description" id="ph2ProgressDescription">' +
    escapeHtml(progress.description) +
    "</p>" +
    "</div>" +
    '<p class="ph2-progress-pct" id="ph2ProgressPct">' +
    progress.pct +
    "%</p>" +
    "</div>" +
    '<div class="ph2-progress-track" aria-hidden="true"><div class="ph2-progress-fill" id="ph2ProgressFill" style="width:' +
    progress.pct +
    '%"></div></div>' +
    "</section>"
  );
}

function renderStatusIcon(complete) {
  if (complete) {
    return (
      '<span class="ph2-status ph2-status-done" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">' +
      '<polyline points="20 6 9 17 4 12"></polyline></svg></span>'
    );
  }
  return '<span class="ph2-status ph2-status-empty" aria-hidden="true"></span>';
}

function renderChevron() {
  return (
    '<svg class="ph2-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
    '<polyline points="9 6 15 12 9 18"></polyline></svg>'
  );
}

function renderItem(item) {
  return (
    '<article class="ph2-item" data-ph2-item="' +
    escapeHtml(item.key) +
    '">' +
    '<button type="button" class="ph2-item-row" data-ph2-toggle="' +
    escapeHtml(item.key) +
    '">' +
    renderStatusIcon(item.complete) +
    '<span class="ph2-item-text">' +
    '<span class="ph2-item-title">' +
    escapeHtml(item.title) +
    "</span>" +
    '<span class="ph2-item-impact">' +
    escapeHtml(item.impact) +
    "</span>" +
    "</span>" +
    renderChevron() +
    "</button>" +
    '<div class="ph2-item-body" data-ph2-body="' +
    escapeHtml(item.key) +
    '" hidden></div>' +
    "</article>"
  );
}

function renderPickerRow(options, selected, attr) {
  return options
    .map(function (label) {
      var on = selected.indexOf(label) !== -1;
      return (
        '<button type="button" class="ph2-pick' +
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

function renderInsuranceForm(therapist) {
  var current = Array.isArray(therapist.insurance_accepted)
    ? therapist.insurance_accepted.filter(Boolean)
    : [];
  return (
    '<div class="ph2-form">' +
    '<div class="ph2-pick-grid">' +
    renderPickerRow(INSURANCE_OPTIONS, current, "ph2-ins") +
    "</div>" +
    '<div class="ph2-other-row">' +
    '<input type="text" class="ph2-input" id="ph2InsuranceOther" placeholder="Add other plan name" />' +
    '<button type="button" class="ph2-add-other" id="ph2InsuranceOtherAdd">Add</button>' +
    "</div>" +
    '<div class="ph2-form-actions">' +
    '<button type="button" class="ph2-save" data-ph2-save="insurance">Save insurance</button>' +
    "</div>" +
    "</div>"
  );
}

function renderFeesForm(therapist) {
  var min = Number(therapist.session_fee_min) > 0 ? therapist.session_fee_min : "";
  var max = Number(therapist.session_fee_max) > 0 ? therapist.session_fee_max : "";
  var sliding = Boolean(therapist.sliding_scale);
  return (
    '<div class="ph2-form">' +
    '<div class="ph2-fee-row">' +
    '<label class="ph2-fee-label">$<input type="number" min="0" class="ph2-input ph2-input-fee" id="ph2FeeMin" value="' +
    escapeHtml(String(min)) +
    '" placeholder="min" /></label>' +
    '<span class="ph2-fee-dash">–</span>' +
    '<label class="ph2-fee-label">$<input type="number" min="0" class="ph2-input ph2-input-fee" id="ph2FeeMax" value="' +
    escapeHtml(String(max)) +
    '" placeholder="max" /></label>' +
    "</div>" +
    '<label class="ph2-checkbox-row">' +
    '<input type="checkbox" id="ph2Sliding"' +
    (sliding ? " checked" : "") +
    " /> I offer a sliding scale</label>" +
    '<div class="ph2-form-actions">' +
    '<button type="button" class="ph2-save" data-ph2-save="fees">Save fees</button>' +
    "</div>" +
    "</div>"
  );
}

function renderModalitiesForm(therapist) {
  var current = Array.isArray(therapist.treatment_modalities)
    ? therapist.treatment_modalities.filter(Boolean)
    : [];
  return (
    '<div class="ph2-form">' +
    '<div class="ph2-pick-grid">' +
    renderPickerRow(MODALITY_OPTIONS, current, "ph2-modality") +
    "</div>" +
    '<div class="ph2-form-actions">' +
    '<button type="button" class="ph2-save" data-ph2-save="modalities">Save modalities</button>' +
    "</div>" +
    "</div>"
  );
}

function renderYearsForm(therapist) {
  var years =
    Number(therapist.bipolar_years_experience) > 0 ? therapist.bipolar_years_experience : "";
  return (
    '<div class="ph2-form">' +
    '<input type="number" min="0" max="80" class="ph2-input ph2-input-years" id="ph2Years" value="' +
    escapeHtml(String(years)) +
    '" placeholder="e.g. 12" />' +
    '<p class="ph2-helper">8+ years unlocks a search ranking boost.</p>' +
    '<div class="ph2-form-actions">' +
    '<button type="button" class="ph2-save" data-ph2-save="years">Save</button>' +
    "</div>" +
    "</div>"
  );
}

function renderPopulationsForm(therapist) {
  var current = Array.isArray(therapist.client_populations)
    ? therapist.client_populations.filter(Boolean)
    : [];
  return (
    '<div class="ph2-form">' +
    '<div class="ph2-pick-grid">' +
    renderPickerRow(POPULATION_OPTIONS, current, "ph2-population") +
    "</div>" +
    '<div class="ph2-form-actions">' +
    '<button type="button" class="ph2-save" data-ph2-save="populations">Save populations</button>' +
    "</div>" +
    "</div>"
  );
}

function renderHeadshotForm() {
  return (
    '<div class="ph2-form">' +
    '<p class="ph2-helper">A real headshot earns 3× more profile clicks than initials. Upload a square photo, eyes visible, soft lighting.</p>' +
    '<div class="ph2-form-actions">' +
    '<button type="button" class="ph2-save" data-ph2-save="headshot">Open headshot uploader</button>' +
    "</div>" +
    "</div>"
  );
}

function renderItemBody(key, therapist) {
  if (key === "insurance") return renderInsuranceForm(therapist);
  if (key === "fees") return renderFeesForm(therapist);
  if (key === "modalities") return renderModalitiesForm(therapist);
  if (key === "years") return renderYearsForm(therapist);
  if (key === "populations") return renderPopulationsForm(therapist);
  if (key === "headshot") return renderHeadshotForm();
  return "";
}

function renderListingComplete() {
  return (
    '<section class="ph2-complete">' +
    '<span class="ph2-complete-icon" aria-hidden="true">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">' +
    '<polyline points="20 6 9 17 4 12"></polyline></svg></span>' +
    '<h3 class="ph2-complete-title">Listing complete</h3>' +
    '<p class="ph2-complete-body">Your listing has everything patients need to make a confident decision.</p>' +
    "</section>"
  );
}

function renderShell(therapist, items, progress) {
  var pending = pendingImprovements(items);
  var listHtml = pending.length
    ? '<div class="ph2-list" id="ph2List">' + pending.map(renderItem).join("") + "</div>"
    : renderListingComplete();
  return (
    '<section class="portal-card ph2-shell" id="portalPhaseTwo">' +
    '<header class="ph2-header">' +
    '<p class="portal-eyebrow">Improve your listing</p>' +
    '<h2 class="ph2-heading">Improve your listing</h2>' +
    "</header>" +
    '<div class="ph2-grid">' +
    '<div class="ph2-main">' +
    renderProgress(progress) +
    listHtml +
    '<a href="#portalEditProfile" class="ph2-advanced-link" id="ph2AdvancedLink">Advanced settings — edit all profile fields →</a>' +
    "</div>" +
    '<aside class="ph2-preview-column">' +
    '<p class="ph2-preview-label">Patient preview</p>' +
    '<div class="ph2-preview-mount" id="ph2Preview">' +
    renderPortalCardPreview(therapist) +
    "</div>" +
    "</aside>" +
    "</div>" +
    "</section>"
  );
}

// ─── Public API ────────────────────────────────────────────────────────

export function shouldShowPhaseTwo(therapist) {
  var t = therapist || {};
  var hasSpecialties = Array.isArray(t.specialties) && t.specialties.filter(Boolean).length > 0;
  var hasMode = Boolean(t.accepts_in_person || t.accepts_telehealth);
  return hasSpecialties && hasMode;
}

export function mountPortalPhaseTwo(container, therapist, options) {
  if (!container) return;
  var opts = options || {};
  var localTherapist = Object.assign({}, therapist);

  function rerender() {
    var items = buildImprovements(localTherapist);
    var progress = buildProgress(items);
    container.innerHTML = renderShell(localTherapist, items, progress);
    bindEvents();
  }

  function refreshPreview() {
    var preview = container.querySelector("#ph2Preview");
    if (preview) updatePortalCardPreview(preview, localTherapist);
  }

  function refreshProgress() {
    var items = buildImprovements(localTherapist);
    var progress = buildProgress(items);
    var pct = container.querySelector("#ph2ProgressPct");
    var fill = container.querySelector("#ph2ProgressFill");
    var description = container.querySelector("#ph2ProgressDescription");
    if (pct) pct.textContent = progress.pct + "%";
    if (fill) fill.style.width = progress.pct + "%";
    if (description) description.textContent = progress.description;
  }

  function maybeShowComplete() {
    var list = container.querySelector("#ph2List");
    if (list && list.children.length === 0) {
      list.outerHTML = renderListingComplete();
    }
  }

  function bindEvents() {
    // Accordion toggle: only one item open at a time.
    var rows = container.querySelectorAll("[data-ph2-toggle]");
    rows.forEach(function (row) {
      row.addEventListener("click", function () {
        var key = row.getAttribute("data-ph2-toggle");
        var body = container.querySelector('[data-ph2-body="' + key + '"]');
        var alreadyOpen = body && !body.hidden;
        // Close all bodies and reset chevrons
        container.querySelectorAll(".ph2-item-body").forEach(function (b) {
          b.hidden = true;
          b.innerHTML = "";
        });
        container.querySelectorAll(".ph2-item").forEach(function (a) {
          a.classList.remove("is-open");
        });
        if (!alreadyOpen && body) {
          body.innerHTML = renderItemBody(key, localTherapist);
          body.hidden = false;
          var article = body.closest(".ph2-item");
          if (article) article.classList.add("is-open");
          // Wire up the picker buttons inside the freshly mounted body.
          bindFormHandlers(key, body);
        }
      });
    });

    container.querySelectorAll("[data-ph2-save]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        savePhaseTwoItem(btn.getAttribute("data-ph2-save"));
      });
    });
  }

  // Pick state for the currently open form. Resets on collapse.
  var formDraft = {};

  function bindFormHandlers(key, bodyEl) {
    formDraft = {};

    if (key === "insurance") {
      formDraft.insurance = (
        Array.isArray(localTherapist.insurance_accepted)
          ? localTherapist.insurance_accepted.filter(Boolean)
          : []
      ).slice();
      bodyEl.querySelectorAll("[data-ph2-ins]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var label = btn.getAttribute("data-ph2-ins");
          var idx = formDraft.insurance.indexOf(label);
          if (idx === -1) formDraft.insurance.push(label);
          else formDraft.insurance.splice(idx, 1);
          btn.classList.toggle("is-selected");
        });
      });
      var addBtn = bodyEl.querySelector("#ph2InsuranceOtherAdd");
      var addInput = bodyEl.querySelector("#ph2InsuranceOther");
      if (addBtn && addInput) {
        addBtn.addEventListener("click", function () {
          var v = String(addInput.value || "").trim();
          if (!v) return;
          if (formDraft.insurance.indexOf(v) === -1) formDraft.insurance.push(v);
          addInput.value = "";
          // Render an inline pill for the custom plan
          var pill = document.createElement("button");
          pill.type = "button";
          pill.className = "ph2-pick is-selected";
          pill.setAttribute("data-ph2-ins", v);
          pill.textContent = v;
          var grid = bodyEl.querySelector(".ph2-pick-grid");
          if (grid) grid.appendChild(pill);
          pill.addEventListener("click", function () {
            var idx = formDraft.insurance.indexOf(v);
            if (idx === -1) formDraft.insurance.push(v);
            else formDraft.insurance.splice(idx, 1);
            pill.classList.toggle("is-selected");
          });
        });
      }
    } else if (key === "fees") {
      // Read on save — don't track every keystroke.
    } else if (key === "modalities") {
      formDraft.modalities = (
        Array.isArray(localTherapist.treatment_modalities)
          ? localTherapist.treatment_modalities.filter(Boolean)
          : []
      ).slice();
      bodyEl.querySelectorAll("[data-ph2-modality]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var label = btn.getAttribute("data-ph2-modality");
          var idx = formDraft.modalities.indexOf(label);
          if (idx === -1) formDraft.modalities.push(label);
          else formDraft.modalities.splice(idx, 1);
          btn.classList.toggle("is-selected");
        });
      });
    } else if (key === "populations") {
      formDraft.populations = (
        Array.isArray(localTherapist.client_populations)
          ? localTherapist.client_populations.filter(Boolean)
          : []
      ).slice();
      bodyEl.querySelectorAll("[data-ph2-population]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var label = btn.getAttribute("data-ph2-population");
          var idx = formDraft.populations.indexOf(label);
          if (idx === -1) formDraft.populations.push(label);
          else formDraft.populations.splice(idx, 1);
          btn.classList.toggle("is-selected");
        });
      });
    }
  }

  async function savePhaseTwoItem(key) {
    if (key === "headshot") {
      // Defer to the parent-supplied headshot upload handler. We don't
      // own that flow.
      if (typeof opts.onRequestPhotoUpload === "function") {
        opts.onRequestPhotoUpload(function (newPhotoUrl) {
          if (newPhotoUrl) localTherapist.photo_url = newPhotoUrl;
          fadeAndRemove(key);
        });
      }
      return;
    }

    var payload = {};
    var bodyEl = container.querySelector('[data-ph2-body="' + key + '"]');

    if (key === "insurance") {
      payload.insurance_accepted = (formDraft.insurance || []).slice();
    } else if (key === "fees") {
      var min = Number(bodyEl.querySelector("#ph2FeeMin").value) || 0;
      var max = Number(bodyEl.querySelector("#ph2FeeMax").value) || 0;
      var sliding = Boolean(bodyEl.querySelector("#ph2Sliding").checked);
      payload.session_fee_min = min || null;
      payload.session_fee_max = max || null;
      payload.sliding_scale = sliding;
    } else if (key === "modalities") {
      payload.treatment_modalities = (formDraft.modalities || []).slice();
    } else if (key === "years") {
      payload.bipolar_years_experience = Number(bodyEl.querySelector("#ph2Years").value) || 0;
    } else if (key === "populations") {
      payload.client_populations = (formDraft.populations || []).slice();
    }

    var saveBtn = bodyEl.querySelector("[data-ph2-save]");
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
      // Always update the local copy for cost-line concerns even when the
      // server-shaped response shape differs slightly.
      refreshPreview();
      refreshProgress();
      fadeAndRemove(key);
    } catch (err) {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = "Try again";
      }
      // Surface the failure inline so it doesn't disappear silently.
      var err1 = bodyEl.querySelector(".ph2-error");
      if (!err1) {
        err1 = document.createElement("p");
        err1.className = "ph2-error";
        bodyEl.querySelector(".ph2-form").appendChild(err1);
      }
      err1.textContent = (err && err.message) || "Couldn't save. Try again in a moment.";
    }
  }

  function fadeAndRemove(key) {
    var article = container.querySelector('[data-ph2-item="' + key + '"]');
    if (!article) return;
    article.classList.add("is-fading");
    window.setTimeout(function () {
      if (article.parentElement) article.parentElement.removeChild(article);
      maybeShowComplete();
    }, 320);
  }

  rerender();
}
