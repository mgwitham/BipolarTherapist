import { updateTherapistCandidate } from "./review-api.js";

let _drawerEl = null;
let _onSaved = null;

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

export function openCandidateEditDrawer(candidate, onSaved) {
  const drawer = getDrawer();
  if (!drawer) return;

  _onSaved = onSaved || null;
  drawer.dataset.candidateId = candidate.id || candidate._id || "";

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

  // Reset status
  const statusEl = drawer.querySelector(".edit-save-status");
  if (statusEl) statusEl.textContent = "";

  drawer.classList.add("is-open");
  document.body.classList.add("drawer-open");
}

export function closeCandidateEditDrawer() {
  const drawer = getDrawer();
  if (!drawer) return;
  drawer.classList.remove("is-open");
  document.body.classList.remove("drawer-open");
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

  // Save button
  const form = drawer.querySelector(".edit-drawer-form");
  const statusEl = drawer.querySelector(".edit-save-status");
  if (!form) return;

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    const candidateId = drawer.dataset.candidateId;
    if (!candidateId) return;

    const saveBtn = form.querySelector(".edit-save-btn");
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving…";
    }
    if (statusEl) statusEl.textContent = "";

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

    // Strip undefined
    Object.keys(updates).forEach(function (k) {
      if (updates[k] === undefined) delete updates[k];
    });

    try {
      const saved = await updateTherapistCandidate(candidateId, updates);
      if (statusEl) {
        statusEl.textContent = "Saved.";
        statusEl.className = "edit-save-status is-success";
      }
      if (_onSaved) _onSaved(saved);
      window.setTimeout(closeCandidateEditDrawer, 900);
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = "Save failed — " + (err && err.message ? err.message : "try again");
        statusEl.className = "edit-save-status is-error";
      }
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save changes";
      }
    }
  });
}
