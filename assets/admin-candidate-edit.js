import { updateTherapistCandidate, updateTherapist } from "./review-api.js";
import { trackFunnelEvent } from "./funnel-analytics.js";

let _drawerEl = null;
let _onSaved = null;
let _editMode = "candidate"; // "candidate" | "therapist"
let _editId = null;
let _initialSnapshot = "";
let _isDirty = false;

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

export function openCandidateEditDrawer(candidate, onSaved) {
  const drawer = getDrawer();
  if (!drawer) return;

  _editMode = "candidate";
  _editId = candidate.id || candidate._id || "";
  _onSaved = onSaved || null;
  drawer.dataset.candidateId = _editId;

  setDrawerTitle("Edit candidate profile");

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
  drawer.dataset.candidateId = _editId;

  setDrawerTitle("Edit therapist profile");

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

  // Notes
  setVal("editNotes", read("notes", "notes") || "");

  const statusEl = drawer.querySelector(".edit-save-status");
  if (statusEl) statusEl.textContent = "";

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
      saveBtn.textContent = "Saving\u2026";
    }
    if (statusEl) statusEl.textContent = "";

    try {
      let saved;

      if (_editMode === "therapist") {
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
        };
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
