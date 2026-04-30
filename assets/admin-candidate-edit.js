import { updateTherapistCandidate, updateTherapist } from "./review-api.js";
import { trackFunnelEvent } from "./funnel-analytics.js";
import { isProfileLive } from "../shared/profile-live-status.mjs";

let _drawerEl = null;
let _onSaved = null;
let _editMode = "candidate"; // "candidate" | "therapist"
let _editId = null;
let _initialSnapshot = "";
let _isDirty = false;
// Snapshot of the therapist record passed to openTherapistEditDrawer. Used
// by the live-status preview to fill in fields the form doesn't expose
// (e.g. bipolar_years_experience, license verification metadata) and to
// detect high-impact transitions (approved → paused, listed → hidden).
let _initialTherapist = null;

function getDrawer() {
  if (!_drawerEl) {
    _drawerEl = document.getElementById("candidateEditDrawer");
  }
  return _drawerEl;
}

function tagsToArray(str) {
  return str
    .split(",")
    .map(function (s) {
      return s.trim();
    })
    .filter(Boolean);
}

function arrayToTags(arr) {
  return Array.isArray(arr) ? arr.join(", ") : "";
}

function setVal(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.type === "checkbox") {
    el.checked = Boolean(value);
  } else {
    el.value = value == null ? "" : String(value);
  }
}

function getVal(id) {
  const el = document.getElementById(id);
  if (!el) return "";
  if (el.type === "checkbox") return el.checked;
  return el.value;
}

function setDrawerTitle(label) {
  const titleEl = document.getElementById("editDrawerTitle");
  if (titleEl) titleEl.textContent = label;
}

function getForm() {
  const drawer = getDrawer();
  return drawer ? drawer.querySelector(".edit-drawer-form") : null;
}

function serializeForm(form) {
  if (!form) return "";
  const payload = [];
  form.querySelectorAll("input, textarea, select").forEach(function (field) {
    if (!field.id) return;
    payload.push(
      field.id +
        ":" +
        (field.type === "checkbox" ? String(Boolean(field.checked)) : String(field.value || "")),
    );
  });
  return payload.join("|");
}

function syncDirtyState() {
  const drawer = getDrawer();
  const dirtyBadge = document.getElementById("editDrawerDirty");
  const contextNote = document.getElementById("editDrawerContext");
  const visibilityNote = document.getElementById("editDrawerVisibility");
  if (!drawer || !dirtyBadge) return;

  _isDirty = serializeForm(getForm()) !== _initialSnapshot;
  drawer.setAttribute("data-edit-dirty", _isDirty ? "true" : "false");
  document.body.setAttribute(
    "data-admin-mode",
    drawer.classList.contains("is-open") ? "editing" : "workspace",
  );
  dirtyBadge.textContent = _isDirty ? "Unsaved changes" : "All changes saved";
  dirtyBadge.className = "edit-drawer-badge " + (_isDirty ? "is-dirty" : "is-clean");

  if (contextNote) {
    contextNote.textContent =
      _editMode === "therapist"
        ? "Editing mode for a live listing. Review carefully before saving."
        : "Editing mode for a queued listing. Save keeps your review context in place.";
  }
  if (visibilityNote) {
    visibilityNote.textContent =
      _editMode === "therapist"
        ? "Saved therapist changes can affect the public listing immediately."
        : "Saved candidate changes update the review record and do not publish by themselves.";
  }
}

function markSavedState() {
  _initialSnapshot = serializeForm(getForm());
  syncDirtyState();
}

function setSectionVisibility(showStatusAndAudit) {
  [
    "editLivePanel",
    "editStatusSectionTitle",
    "editStatusSectionFields",
    "editAuditSectionTitle",
  ].forEach(function (id) {
    const el = document.getElementById(id);
    if (!el) return;
    if (showStatusAndAudit) {
      el.removeAttribute("hidden");
    } else {
      el.setAttribute("hidden", "");
    }
  });
  const auditLog = document.getElementById("editAuditLog");
  if (auditLog) {
    if (showStatusAndAudit) auditLog.removeAttribute("hidden");
    else auditLog.setAttribute("hidden", "");
  }
}

function buildPreviewTherapist() {
  // Merge the form's current values into the therapist snapshot so the
  // live-status preview reflects what the doc would look like after save.
  // Form-only fields override snapshot fields; snapshot supplies anything
  // the form doesn't surface (license verification metadata, etc).
  const base = _initialTherapist || {};
  const formInsurance = tagsToArray(getVal("editInsuranceAccepted") || "");
  return {
    ...base,
    name: getVal("editName") || base.name,
    email: getVal("editEmail") || base.email,
    license_number: getVal("editLicenseNumber") || base.license_number,
    insurance_accepted: formInsurance.length ? formInsurance : base.insurance_accepted || [],
    lifecycle: getVal("editLifecycle") || base.lifecycle,
    visibility_intent: getVal("editVisibilityIntent") || base.visibility_intent,
    // listingActive and status are derived server-side at save time. For
    // preview, simulate that derivation so the panel doesn't show a stale
    // "listingActive=true" gate when admin toggles to paused.
    listing_active:
      getVal("editLifecycle") === "approved" && getVal("editVisibilityIntent") === "listed"
        ? true
        : false,
    status:
      getVal("editLifecycle") === "approved" && getVal("editVisibilityIntent") === "listed"
        ? "active"
        : base.status === "active"
          ? "active"
          : base.status,
  };
}

function renderLivePanel() {
  const panel = document.getElementById("editLivePanel");
  const badge = document.getElementById("editLivePanelBadge");
  const gatesEl = document.getElementById("editLivePanelGates");
  const transitionEl = document.getElementById("editLivePanelTransition");
  if (!panel || !badge || !gatesEl) return;

  const previewDoc = buildPreviewTherapist();
  const preview = isProfileLive(previewDoc);
  const before = isProfileLive(_initialTherapist || {});

  badge.textContent = preview.isLive ? "Live" : "Hidden";
  badge.className = preview.isLive ? "ps-badge ps-badge--live" : "ps-badge ps-badge--hidden";

  // Transition callout — only when the save would flip Live state.
  if (transitionEl) {
    if (before.isLive && !preview.isLive) {
      transitionEl.textContent = "Saving will hide this profile from patients.";
      transitionEl.className = "edit-live-panel-transition is-going-hidden";
      transitionEl.removeAttribute("hidden");
    } else if (!before.isLive && preview.isLive) {
      transitionEl.textContent = "Saving will make this profile Live.";
      transitionEl.className = "edit-live-panel-transition is-going-live";
      transitionEl.removeAttribute("hidden");
    } else {
      transitionEl.setAttribute("hidden", "");
    }
  }

  // Render every gate. Pass-text mirrors blocker text so admins see exactly
  // what each gate is checking.
  const gateChecks = [
    {
      label: "Lifecycle is approved",
      fail: preview.blockers.find((b) => b.startsWith("Lifecycle is")),
    },
    {
      label: "Visibility set to listed",
      fail: preview.blockers.find((b) => b.startsWith("Visibility intent")),
    },
    {
      label: "Document is published (not a draft)",
      fail: preview.blockers.find((b) => b.includes("Sanity draft")),
    },
    {
      label: "Status is active",
      fail: preview.blockers.find((b) => b.startsWith("Status is")),
    },
    {
      label: "Trust gate: license number on file",
      fail: preview.blockers.find((b) => b.includes("license number")),
    },
    {
      label: "Trust gate: insurance accepted listed",
      fail: preview.blockers.find((b) => b.includes("insurance accepted")),
    },
    {
      label: "Trust gate: bipolar years experience set",
      fail: preview.blockers.find((b) => b.includes("bipolar years")),
    },
    {
      label: "No duplicate documents detected",
      fail: preview.blockers.find((b) => b.startsWith("Duplicate detected")),
    },
  ];

  gatesEl.innerHTML = gateChecks
    .map(function (g) {
      const passing = !g.fail;
      const mark = passing
        ? '<span class="gate-mark is-pass" aria-label="passes">&check;</span>'
        : '<span class="gate-mark is-fail" aria-label="fails">&times;</span>';
      const text = passing ? g.label : g.fail;
      return "<li>" + mark + "<span>" + escapeHtml(text) + "</span></li>";
    })
    .join("");
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderAuditLog(entries) {
  const container = document.getElementById("editAuditLog");
  if (!container) return;
  const list = Array.isArray(entries) ? entries.slice() : [];
  if (!list.length) {
    container.innerHTML = '<p class="edit-audit-log-empty">No history yet.</p>';
    return;
  }
  // Newest first. Sanity stores them in append order; reverse for display.
  list.reverse();
  const top = list.slice(0, 10);
  container.innerHTML = top
    .map(function (entry) {
      const ts = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : "";
      const actor = entry.actor || "system";
      const action = entry.action || "edit";
      const reason = entry.reason
        ? '<div class="edit-audit-log-entry-reason">Reason: ' + escapeHtml(entry.reason) + "</div>"
        : "";
      const before = entry.before || "";
      const after = entry.after || "";
      const diff =
        before || after
          ? '<div class="edit-audit-log-entry-diff">' +
            escapeHtml(before) +
            "  →  " +
            escapeHtml(after) +
            "</div>"
          : "";
      return (
        '<div class="edit-audit-log-entry">' +
        '<div class="edit-audit-log-entry-head">' +
        escapeHtml(action) +
        '<span class="edit-audit-log-entry-meta">' +
        escapeHtml(actor) +
        " · " +
        escapeHtml(ts) +
        "</span></div>" +
        reason +
        diff +
        "</div>"
      );
    })
    .join("");
}

export function openCandidateEditDrawer(candidate, onSaved) {
  const drawer = getDrawer();
  if (!drawer) return;

  _editMode = "candidate";
  _editId = candidate.id || candidate._id || "";
  _onSaved = onSaved || null;
  _initialTherapist = null;
  drawer.dataset.candidateId = _editId;

  setDrawerTitle("Edit candidate profile");
  // Hide the therapist-only sections — Live status, lifecycle, audit log
  // don't apply to candidate documents.
  setSectionVisibility(false);

  // Identity
  setVal("editName", candidate.name);
  setVal("editCredentials", candidate.credentials);
  setVal("editTitle", candidate.title);
  setVal("editPracticeName", candidate.practice_name);

  // Location
  setVal("editCity", candidate.city);
  setVal("editState", candidate.state);
  setVal("editZip", candidate.zip);

  // License
  setVal("editLicenseState", candidate.license_state);
  setVal("editLicenseNumber", candidate.license_number);

  // Contact
  setVal("editEmail", candidate.email);
  setVal("editPhone", candidate.phone);
  setVal("editWebsite", candidate.website);
  setVal("editBookingUrl", candidate.booking_url);

  // Care
  setVal("editCareApproach", candidate.care_approach);
  setVal("editSpecialties", arrayToTags(candidate.specialties));
  setVal("editTreatmentModalities", arrayToTags(candidate.treatment_modalities));
  setVal("editClientPopulations", arrayToTags(candidate.client_populations));
  setVal("editInsuranceAccepted", arrayToTags(candidate.insurance_accepted));

  // Availability
  setVal("editAcceptsTelehealth", candidate.accepts_telehealth !== false);
  setVal("editAcceptsInPerson", candidate.accepts_in_person !== false);
  setVal("editAcceptingNewPatients", candidate.accepting_new_patients);
  setVal("editSlidingScale", candidate.sliding_scale);
  setVal("editSessionFeeMin", candidate.session_fee_min);
  setVal("editSessionFeeMax", candidate.session_fee_max);

  // Notes
  setVal("editNotes", candidate.notes);

  const statusEl = drawer.querySelector(".edit-save-status");
  if (statusEl) statusEl.textContent = "";

  drawer.classList.add("is-open");
  document.body.classList.add("drawer-open");
  document.body.setAttribute("data-admin-mode", "editing");
  trackFunnelEvent("admin_profile_edit_opened", {
    mode: "candidate",
    record_id: _editId,
  });
  markSavedState();
}

export function openTherapistEditDrawer(therapist, onSaved) {
  const drawer = getDrawer();
  if (!drawer) return;

  _editMode = "therapist";
  _editId = therapist.id || therapist._id || "";
  _onSaved = onSaved || null;
  _initialTherapist = therapist;
  drawer.dataset.candidateId = _editId;

  setDrawerTitle("Edit therapist profile");
  setSectionVisibility(true);

  // fetchPublicTherapists emits snake_case; fall back to camelCase for any
  // caller still passing a raw Sanity doc.
  const read = (snake, camel) =>
    therapist[snake] !== undefined ? therapist[snake] : therapist[camel];

  // Identity
  setVal("editName", read("name", "name"));
  setVal("editCredentials", read("credentials", "credentials"));
  setVal("editTitle", read("title", "title"));
  setVal("editPracticeName", read("practice_name", "practiceName"));

  // Location
  setVal("editCity", read("city", "city"));
  setVal("editState", read("state", "state"));
  setVal("editZip", read("zip", "zip"));

  // License
  setVal("editLicenseState", read("license_state", "licenseState"));
  setVal("editLicenseNumber", read("license_number", "licenseNumber"));

  // Contact
  setVal("editEmail", read("email", "email"));
  setVal("editPhone", read("phone", "phone"));
  setVal("editWebsite", read("website", "website"));
  setVal("editBookingUrl", read("booking_url", "bookingUrl"));

  // Care
  setVal("editCareApproach", read("care_approach", "careApproach"));
  setVal("editSpecialties", arrayToTags(read("specialties", "specialties")));
  setVal(
    "editTreatmentModalities",
    arrayToTags(read("treatment_modalities", "treatmentModalities")),
  );
  setVal("editClientPopulations", arrayToTags(read("client_populations", "clientPopulations")));
  setVal("editInsuranceAccepted", arrayToTags(read("insurance_accepted", "insuranceAccepted")));

  // Availability
  setVal("editAcceptsTelehealth", read("accepts_telehealth", "acceptsTelehealth") !== false);
  setVal("editAcceptsInPerson", read("accepts_in_person", "acceptsInPerson") !== false);
  setVal("editAcceptingNewPatients", read("accepting_new_patients", "acceptingNewPatients"));
  setVal("editSlidingScale", read("sliding_scale", "slidingScale"));
  setVal("editSessionFeeMin", read("session_fee_min", "sessionFeeMin"));
  setVal("editSessionFeeMax", read("session_fee_max", "sessionFeeMax"));

  // Lifecycle / visibility
  setVal("editLifecycle", read("lifecycle", "lifecycle") || "draft");
  setVal("editVisibilityIntent", read("visibility_intent", "visibilityIntent") || "listed");

  // Notes
  setVal("editNotes", read("notes", "notes") || "");

  const statusEl = drawer.querySelector(".edit-save-status");
  if (statusEl) statusEl.textContent = "";

  renderAuditLog(read("audit_log", "auditLog"));
  renderLivePanel();

  drawer.classList.add("is-open");
  document.body.classList.add("drawer-open");
  document.body.setAttribute("data-admin-mode", "editing");
  trackFunnelEvent("admin_profile_edit_opened", {
    mode: "therapist",
    record_id: _editId,
  });
  markSavedState();
}

export function closeCandidateEditDrawer() {
  const drawer = getDrawer();
  if (!drawer) return;
  if (_isDirty && typeof window !== "undefined" && typeof window.confirm === "function") {
    const shouldClose = window.confirm(
      "You have unsaved changes in editing mode. Close without saving?",
    );
    if (!shouldClose) return;
  }
  drawer.classList.remove("is-open");
  document.body.classList.remove("drawer-open");
  document.body.setAttribute("data-admin-mode", "workspace");
  _isDirty = false;
}

// Determine whether a save crosses a high-impact threshold that requires a
// reason. The two cases the spec calls out:
//   - lifecycle changing to archived or paused (regardless of from-state),
//     since that's an explicit takedown signal
//   - visibilityIntent flipping to hidden on a profile that was Live
function needsReasonForSave(prevTherapist, nextLifecycle, nextVisibility) {
  const prevLifecycle = (prevTherapist && (prevTherapist.lifecycle || "")) || "";
  const prevVisibility =
    (prevTherapist && (prevTherapist.visibility_intent || prevTherapist.visibilityIntent || "")) ||
    "";
  const wasLive = prevTherapist ? isProfileLive(prevTherapist).isLive : false;
  if (
    (nextLifecycle === "archived" || nextLifecycle === "paused") &&
    nextLifecycle !== prevLifecycle
  ) {
    return true;
  }
  if (nextVisibility === "hidden" && prevVisibility === "listed" && wasLive) {
    return true;
  }
  return false;
}

export function bindCandidateEditDrawer() {
  const drawer = getDrawer();
  if (!drawer) return;

  // Close on backdrop click
  drawer.addEventListener("click", function (e) {
    if (e.target === drawer) closeCandidateEditDrawer();
  });

  // Close button
  const closeBtn = drawer.querySelector(".edit-drawer-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", closeCandidateEditDrawer);
  }

  // Save
  const form = drawer.querySelector(".edit-drawer-form");
  const statusEl = drawer.querySelector(".edit-save-status");
  if (!form) return;

  ["input", "change"].forEach(function (eventName) {
    form.addEventListener(eventName, function () {
      syncDirtyState();
      if (_editMode === "therapist") {
        renderLivePanel();
      }
      if (statusEl && statusEl.classList.contains("is-success")) {
        statusEl.textContent = "";
        statusEl.className = "edit-save-status";
      }
    });
  });

  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    const saveBtn = form.querySelector(".edit-save-btn");
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving…";
    }
    if (statusEl) statusEl.textContent = "";

    try {
      let saved;

      if (_editMode === "therapist") {
        const lifecycle = getVal("editLifecycle");
        const visibilityIntent = getVal("editVisibilityIntent");

        // Reason prompt for high-impact transitions. Cancel aborts save.
        let reason = "";
        if (needsReasonForSave(_initialTherapist, lifecycle, visibilityIntent)) {
          reason =
            window.prompt(
              "This change will hide or pause the profile. Briefly note why (one line — stored in the audit log):",
              "",
            ) || "";
          if (reason === null) {
            // User cancelled.
            if (saveBtn) {
              saveBtn.disabled = false;
              saveBtn.textContent = "Save changes";
            }
            return;
          }
        }

        const updates = {
          name: getVal("editName"),
          credentials: getVal("editCredentials"),
          title: getVal("editTitle"),
          practiceName: getVal("editPracticeName"),
          city: getVal("editCity"),
          state: getVal("editState"),
          zip: getVal("editZip"),
          licenseState: getVal("editLicenseState"),
          licenseNumber: getVal("editLicenseNumber"),
          email: getVal("editEmail"),
          phone: getVal("editPhone"),
          website: getVal("editWebsite"),
          bookingUrl: getVal("editBookingUrl"),
          careApproach: getVal("editCareApproach"),
          specialties: tagsToArray(getVal("editSpecialties")),
          treatmentModalities: tagsToArray(getVal("editTreatmentModalities")),
          clientPopulations: tagsToArray(getVal("editClientPopulations")),
          insuranceAccepted: tagsToArray(getVal("editInsuranceAccepted")),
          acceptsTelehealth: getVal("editAcceptsTelehealth"),
          acceptsInPerson: getVal("editAcceptsInPerson"),
          acceptingNewPatients: getVal("editAcceptingNewPatients"),
          slidingScale: getVal("editSlidingScale"),
          lifecycle,
          visibilityIntent,
        };
        if (reason) updates.reason = reason;
        Object.keys(updates).forEach(function (k) {
          if (updates[k] === undefined) delete updates[k];
        });
        saved = await updateTherapist(_editId, updates);
      } else {
        const updates = {
          name: getVal("editName"),
          credentials: getVal("editCredentials"),
          title: getVal("editTitle"),
          practice_name: getVal("editPracticeName"),
          city: getVal("editCity"),
          state: getVal("editState"),
          zip: getVal("editZip"),
          license_state: getVal("editLicenseState"),
          license_number: getVal("editLicenseNumber"),
          email: getVal("editEmail"),
          phone: getVal("editPhone"),
          website: getVal("editWebsite"),
          booking_url: getVal("editBookingUrl"),
          care_approach: getVal("editCareApproach"),
          specialties: tagsToArray(getVal("editSpecialties")),
          treatment_modalities: tagsToArray(getVal("editTreatmentModalities")),
          client_populations: tagsToArray(getVal("editClientPopulations")),
          insurance_accepted: tagsToArray(getVal("editInsuranceAccepted")),
          accepts_telehealth: getVal("editAcceptsTelehealth"),
          accepts_in_person: getVal("editAcceptsInPerson"),
          accepting_new_patients: getVal("editAcceptingNewPatients"),
          sliding_scale: getVal("editSlidingScale"),
          session_fee_min:
            getVal("editSessionFeeMin") !== "" ? Number(getVal("editSessionFeeMin")) : undefined,
          session_fee_max:
            getVal("editSessionFeeMax") !== "" ? Number(getVal("editSessionFeeMax")) : undefined,
          notes: getVal("editNotes"),
        };
        Object.keys(updates).forEach(function (k) {
          if (updates[k] === undefined) delete updates[k];
        });
        saved = await updateTherapistCandidate(_editId, updates);
      }

      if (statusEl) {
        statusEl.textContent = "Saved. The latest changes are now the working version.";
        statusEl.className = "edit-save-status is-success";
      }
      // Refresh in-drawer state from the server response so the audit log
      // and live-status panel reflect the new entry without a reload.
      if (_editMode === "therapist" && saved && saved.therapist) {
        _initialTherapist = {
          ..._initialTherapist,
          lifecycle: saved.therapist.lifecycle || "",
          visibility_intent: saved.therapist.visibilityIntent || "",
          listing_active: saved.therapist.listingActive !== false,
          status: saved.therapist.status || "active",
          audit_log: Array.isArray(saved.therapist.auditLog) ? saved.therapist.auditLog : [],
        };
        renderAuditLog(_initialTherapist.audit_log);
        renderLivePanel();
      }
      markSavedState();
      trackFunnelEvent("admin_profile_changes_saved", {
        mode: _editMode,
        record_id: _editId,
      });
      if (_onSaved) _onSaved(saved);
      window.setTimeout(closeCandidateEditDrawer, 900);
    } catch (err) {
      if (statusEl) {
        statusEl.textContent =
          err && err.status === 409
            ? "Save blocked because this record changed elsewhere. Reload the latest version and try again."
            : "Save failed — " + (err && err.message ? err.message : "try again");
        statusEl.className = "edit-save-status is-error";
      }
      trackFunnelEvent("admin_profile_save_failed", {
        mode: _editMode,
        record_id: _editId,
        status: err && err.status ? err.status : 0,
      });
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save changes";
      }
    }
  });
}
