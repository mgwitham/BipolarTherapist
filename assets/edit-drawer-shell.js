// Shared profile-edit drawer markup. Source of truth for the drawer's
// DOM — both admin.html and outreach.html mount this at runtime so a
// profile edit on either surface uses the same form, validations, and
// visual treatment. Binding logic lives in admin-candidate-edit.js.

import "./edit-drawer.css";

const EDIT_DRAWER_HTML = `
<div
  class="candidate-edit-drawer"
  id="candidateEditDrawer"
  role="dialog"
  aria-modal="true"
  aria-label="Edit profile"
>
  <div class="edit-drawer-panel">
    <div class="edit-drawer-header">
      <div class="edit-drawer-header-copy">
        <div class="edit-drawer-meta">
          <span class="edit-drawer-badge is-clean" id="editDrawerDirty">All changes saved</span>
        </div>
        <div class="edit-drawer-title" id="editDrawerTitle">Edit profile</div>
        <p class="edit-drawer-context" id="editDrawerContext">
          Editing mode keeps full profile changes separate from queue scanning.
        </p>
      </div>
      <button class="edit-drawer-close" aria-label="Close">&times;</button>
    </div>
    <div class="edit-drawer-body">
      <aside
        class="edit-live-panel"
        id="editLivePanel"
        role="region"
        aria-label="Live status"
        hidden
      >
        <div class="edit-live-panel-head">
          <span>Live status (preview)</span>
          <span class="ps-badge ps-badge--hidden" id="editLivePanelBadge">Hidden</span>
        </div>
        <div class="edit-live-panel-transition" id="editLivePanelTransition" hidden></div>
        <ul class="edit-live-panel-gates" id="editLivePanelGates"></ul>
      </aside>
      <form class="edit-drawer-form" id="candidateEditForm" novalidate>
        <div class="edit-section-title">Identity</div>
        <div class="edit-field-grid">
          <div class="edit-field" style="grid-column: 1 / -1">
            <label for="editName">Full name</label>
            <input type="text" id="editName" autocomplete="off" />
          </div>
          <div class="edit-field">
            <label for="editCredentials">Credentials</label>
            <input type="text" id="editCredentials" placeholder="e.g. LMFT, PhD" autocomplete="off" />
          </div>
          <div class="edit-field">
            <label for="editTitle">Professional title</label>
            <input type="text" id="editTitle" autocomplete="off" />
          </div>
          <div class="edit-field" style="grid-column: 1 / -1">
            <label for="editPracticeName">Practice name</label>
            <input type="text" id="editPracticeName" autocomplete="off" />
          </div>
          <div class="edit-field edit-field--radio-group" style="grid-column: 1 / -1">
            <span class="edit-field-radio-label">Gender</span>
            <div class="edit-radio-options">
              <label class="edit-radio"><input type="radio" name="editGender" value="" /> Not set</label>
              <label class="edit-radio"><input type="radio" name="editGender" value="male" /> Male</label>
              <label class="edit-radio"><input type="radio" name="editGender" value="female" /> Female</label>
              <label class="edit-radio"><input type="radio" name="editGender" value="non_binary" /> Non-binary</label>
            </div>
          </div>
        </div>

        <div class="edit-section-title">Location</div>
        <div class="edit-field-grid">
          <div class="edit-field">
            <label for="editCity">City</label>
            <input type="text" id="editCity" autocomplete="off" />
          </div>
          <div class="edit-field">
            <label for="editState">State</label>
            <input type="text" id="editState" placeholder="e.g. CA" autocomplete="off" />
          </div>
          <div class="edit-field">
            <label for="editZip">ZIP</label>
            <input type="text" id="editZip" autocomplete="off" />
          </div>
        </div>

        <div class="edit-section-title">License</div>
        <div class="edit-field-grid">
          <div class="edit-field">
            <label for="editLicenseState">License state</label>
            <input type="text" id="editLicenseState" placeholder="e.g. CA" autocomplete="off" />
          </div>
          <div class="edit-field">
            <label for="editLicenseNumber">License number</label>
            <input type="text" id="editLicenseNumber" autocomplete="off" />
          </div>
        </div>

        <div class="edit-section-title">Contact</div>
        <div class="edit-field-grid">
          <div class="edit-field">
            <label for="editEmail">Email</label>
            <input type="email" id="editEmail" autocomplete="off" />
          </div>
          <div class="edit-field">
            <label for="editPhone">Phone</label>
            <input type="tel" id="editPhone" autocomplete="off" />
          </div>
          <div class="edit-field">
            <label for="editWebsite">Website</label>
            <input type="url" id="editWebsite" placeholder="https://" autocomplete="off" />
          </div>
          <div class="edit-field">
            <label for="editBookingUrl">Booking URL</label>
            <input type="url" id="editBookingUrl" placeholder="https://" autocomplete="off" />
          </div>
          <div class="edit-field">
            <label for="editPreferredContactMethod">Preferred contact method</label>
            <select id="editPreferredContactMethod">
              <option value="">— Not set —</option>
              <option value="email">Email</option>
              <option value="phone">Phone</option>
              <option value="website">Website</option>
              <option value="booking">Booking link</option>
            </select>
          </div>
          <div class="edit-field is-full">
            <label for="editPreferredContactLabel">Primary contact CTA label</label>
            <input type="text" id="editPreferredContactLabel" placeholder="e.g. Book a consultation" autocomplete="off" />
            <div class="edit-hint">Optional. Overrides the default button label on the public profile.</div>
          </div>
          <div class="edit-field is-full">
            <label for="editContactGuidance">Contact guidance</label>
            <textarea id="editContactGuidance" rows="2" placeholder="What patients should include or expect when reaching out"></textarea>
          </div>
          <div class="edit-field is-full">
            <label for="editFirstStepExpectation">What happens after outreach</label>
            <textarea id="editFirstStepExpectation" rows="2" placeholder="Describe the first step after someone reaches out"></textarea>
          </div>
        </div>

        <div class="edit-section-title">Care approach</div>
        <div class="edit-field-grid is-full">
          <div class="edit-field">
            <label for="editBio">Bio</label>
            <textarea id="editBio" rows="4" placeholder="What patients see on the public profile"></textarea>
          </div>
          <div class="edit-field">
            <label for="editCareApproach">How they help bipolar clients</label>
            <textarea id="editCareApproach" rows="3"></textarea>
          </div>
          <div class="edit-field">
            <label for="editSpecialties">Specialties</label>
            <input type="text" id="editSpecialties" autocomplete="off" />
            <div class="edit-hint">Comma-separated, e.g. Bipolar I, Anxiety, CBT</div>
          </div>
          <div class="edit-field">
            <label for="editTreatmentModalities">Treatment modalities</label>
            <input type="text" id="editTreatmentModalities" autocomplete="off" />
            <div class="edit-hint">Comma-separated</div>
          </div>
          <div class="edit-field">
            <label for="editClientPopulations">Populations served</label>
            <input type="text" id="editClientPopulations" autocomplete="off" />
            <div class="edit-hint">Comma-separated</div>
          </div>
          <div class="edit-field">
            <label for="editInsuranceAccepted">Insurance accepted</label>
            <input type="text" id="editInsuranceAccepted" autocomplete="off" />
            <div class="edit-hint">Comma-separated</div>
          </div>
          <div class="edit-field">
            <label for="editLanguages">Languages</label>
            <input type="text" id="editLanguages" autocomplete="off" placeholder="English, Spanish" />
            <div class="edit-hint">Comma-separated</div>
          </div>
        </div>

        <div class="edit-section-title">Experience</div>
        <div class="edit-field-grid">
          <div class="edit-field">
            <label for="editBipolarYearsExperience">Years treating bipolar</label>
            <input type="number" id="editBipolarYearsExperience" min="0" step="1" />
            <div class="edit-hint">Drives directory ranking and patient-facing trust.</div>
          </div>
          <div class="edit-field">
            <label for="editYearsExperience">Total years in practice</label>
            <input type="number" id="editYearsExperience" min="0" step="1" />
          </div>
        </div>

        <div class="edit-section-title">Availability &amp; fees</div>
        <div class="edit-check-row">
          <label class="edit-check-item">
            <input type="checkbox" id="editAcceptsTelehealth" />
            Telehealth
          </label>
          <label class="edit-check-item">
            <input type="checkbox" id="editAcceptsInPerson" />
            In-person
          </label>
          <label class="edit-check-item">
            <input type="checkbox" id="editAcceptingNewPatients" />
            Accepting new patients
          </label>
          <label class="edit-check-item">
            <input type="checkbox" id="editSlidingScale" />
            Sliding scale
          </label>
          <label class="edit-check-item">
            <input type="checkbox" id="editMedicationManagement" />
            Prescribes medication
          </label>
        </div>
        <div class="edit-field-grid" style="margin-top: 0.65rem">
          <div class="edit-field">
            <label for="editEstimatedWaitTime">Estimated wait time</label>
            <input type="text" id="editEstimatedWaitTime" autocomplete="off" placeholder="e.g. 1–2 weeks" />
          </div>
          <div class="edit-field">
            <label for="editTelehealthStates">Telehealth states</label>
            <input type="text" id="editTelehealthStates" autocomplete="off" placeholder="CA, NY" />
            <div class="edit-hint">Comma-separated state codes</div>
          </div>
          <div class="edit-field">
            <label for="editSessionFeeMin">Fee min ($)</label>
            <input type="number" id="editSessionFeeMin" min="0" step="5" />
          </div>
          <div class="edit-field">
            <label for="editSessionFeeMax">Fee max ($)</label>
            <input type="number" id="editSessionFeeMax" min="0" step="5" />
          </div>
        </div>

        <div class="edit-section-title" id="editStatusSectionTitle">Status &amp; visibility</div>
        <div class="edit-field-grid" id="editStatusSectionFields">
          <div class="edit-field">
            <label for="editLifecycle">Lifecycle</label>
            <select id="editLifecycle">
              <option value="draft">Draft</option>
              <option value="in_review">In review</option>
              <option value="awaiting_confirmation">Awaiting confirmation</option>
              <option value="approved">Approved</option>
              <option value="paused">Paused</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <div class="edit-field">
            <label for="editVisibilityIntent">Visibility</label>
            <select id="editVisibilityIntent">
              <option value="listed">Listed</option>
              <option value="hidden">Hidden</option>
            </select>
            <div class="edit-hint">
              Set to Hidden to take a profile down without changing its lifecycle stage.
            </div>
          </div>
        </div>

        <div class="edit-section-title">Internal notes</div>
        <div class="edit-field-grid is-full">
          <div class="edit-field">
            <textarea id="editNotes" rows="3" placeholder="Notes visible only to the review team"></textarea>
          </div>
        </div>

        <div class="edit-section-title" id="editAuditSectionTitle">Audit log</div>
        <div class="edit-audit-log" id="editAuditLog">
          <p class="edit-audit-log-empty">No history yet.</p>
        </div>

        <div class="edit-danger-zone" id="editDangerZone" hidden>
          <div class="edit-danger-title">Danger zone</div>
          <div class="edit-danger-body">
            Deleting removes this therapist from the public directory and search. The Sanity document, outreach history, and email log are preserved, so this is reversible from Sanity Studio if needed.
          </div>
          <button id="editDeleteBtn" type="button" class="edit-delete-btn">Delete therapist</button>
        </div>
      </form>
    </div>
    <div class="edit-drawer-footer">
      <button type="submit" form="candidateEditForm" class="btn-primary edit-save-btn">
        Save changes
      </button>
      <span class="edit-save-status"></span>
      <div class="edit-visibility-note" id="editDrawerVisibility">
        Saved changes update the current record with a clear success or failure state.
      </div>
    </div>
  </div>
</div>

<div class="edit-confirm-overlay" id="editConfirmOverlay" role="dialog" aria-modal="true" aria-label="Confirm delete"></div>
`;

// Inject the drawer into the document body if not already present.
// Idempotent — safe to call multiple times. Returns the drawer element.
export function mountEditDrawer() {
  let drawer = document.getElementById("candidateEditDrawer");
  if (drawer) return drawer;
  const wrap = document.createElement("div");
  wrap.innerHTML = EDIT_DRAWER_HTML.trim();
  while (wrap.firstChild) {
    document.body.appendChild(wrap.firstChild);
  }
  return document.getElementById("candidateEditDrawer");
}

export { EDIT_DRAWER_HTML };
