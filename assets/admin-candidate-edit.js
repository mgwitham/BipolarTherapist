import { updateTherapistCandidate, updateTherapist } from "./review-api.js";

let _drawerEl = null;
let _onSaved = null;
let _editMode = "candidate"; // "candidate" | "therapist"
let _editId = null;

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
}

export function openTherapistEditDrawer(therapist, onSaved) {
  const drawer = getDrawer();
  if (!drawer) return;

  _editMode = "therapist";
  _editId = therapist.id || therapist._id || "";
  _onSaved = onSaved || null;
  drawer.dataset.candidateId = _editId;

  setDrawerTitle("Edit therapist profile");

  // Identity — therapist uses camelCase
  setVal("editName", therapist.name);
  setVal("editCredentials", therapist.credentials);
  setVal("editTitle", therapist.title);
  setVal("editPracticeName", therapist.practiceName);

  // Location
  setVal("editCity", therapist.city);
  setVal("editState", therapist.state);
  setVal("editZip", therapist.zip);

  // License
  setVal("editLicenseState", therapist.licenseState);
  setVal("editLicenseNumber", therapist.licenseNumber);

  // Contact
  setVal("editEmail", therapist.email);
  setVal("editPhone", therapist.phone);
  setVal("editWebsite", therapist.website);
  setVal("editBookingUrl", therapist.bookingUrl);

  // Care
  setVal("editCareApproach", therapist.careApproach);
  setVal("editSpecialties", arrayToTags(therapist.specialties));
  setVal("editTreatmentModalities", arrayToTags(therapist.treatmentModalities));
  setVal("editClientPopulations", arrayToTags(therapist.clientPopulations));
  setVal("editInsuranceAccepted", arrayToTags(therapist.insuranceAccepted));

  // Availability
  setVal("editAcceptsTelehealth", therapist.acceptsTelehealth !== false);
  setVal("editAcceptsInPerson", therapist.acceptsInPerson !== false);
  setVal("editAcceptingNewPatients", therapist.acceptingNewPatients);
  setVal("editSlidingScale", therapist.slidingScale);
  setVal("editSessionFeeMin", therapist.sessionFeeMin);
  setVal("editSessionFeeMax", therapist.sessionFeeMax);

  // Notes
  setVal("editNotes", therapist.notes || "");

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

  // Save
  const form = drawer.querySelector(".edit-drawer-form");
  const statusEl = drawer.querySelector(".edit-save-status");
  if (!form) return;

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
        statusEl.textContent = "Saved.";
        statusEl.className = "edit-save-status is-success";
      }
      if (_onSaved) _onSaved(saved);
      window.setTimeout(closeCandidateEditDrawer, 900);
    } catch (err) {
      if (statusEl) {
        statusEl.textContent =
          "Save failed \u2014 " + (err && err.message ? err.message : "try again");
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
