import { fetchPublicTherapistBySlug, cmsEnabled } from "./cms.js";
import {
  fetchTherapistApplicationRevision,
  submitTherapistApplication,
  submitTherapistApplicationRevision,
} from "./review-api.js";
import {
  getApplicationById,
  getTherapistBySlug,
  reviseApplication,
  submitApplication,
} from "./store.js";
import { getTherapistConfirmationAgenda, getTherapistMatchReadiness } from "./matching-model.js";

let revisionApplicationId = "";
let revisionBaseline = null;
let confirmationTherapistSlug = "";
let confirmationTherapistId = "";
let activeRequestedFields = [];

var REVISION_FIELD_CONFIG = {
  license_number: {
    label: "License number",
    type: "text",
    keywords: ["license number", "license"],
  },
  bio: {
    label: "Professional bio",
    type: "text",
    keywords: ["bio", "background", "trust", "credibility"],
  },
  care_approach: {
    label: "How you help bipolar clients",
    type: "text",
    keywords: ["care approach", "how you help", "bipolar care", "approach", "modalities"],
  },
  contact_guidance: {
    label: "Contact guidance",
    type: "text",
    keywords: ["contact guidance", "reply time", "response time", "what to send", "reach out"],
  },
  first_step_expectation: {
    label: "What happens after outreach",
    type: "text",
    keywords: ["first step", "after outreach", "consult", "intake", "what happens next"],
  },
  insurance_accepted: {
    label: "Insurance details",
    type: "array",
    keywords: ["insurance", "coverage", "self-pay", "out-of-network"],
  },
  session_fee_min: {
    label: "Pricing clarity",
    type: "pricing",
    keywords: ["fee", "pricing", "cost", "budget", "sliding scale"],
  },
  estimated_wait_time: {
    label: "Wait time",
    type: "text",
    keywords: ["wait time", "availability", "urgent", "timing"],
  },
  telehealth_states: {
    label: "Telehealth states",
    type: "array",
    keywords: ["telehealth states", "telehealth", "virtual eligibility", "states"],
  },
  preferred_contact_label: {
    label: "Primary contact button",
    type: "text",
    keywords: ["cta", "button label", "contact button"],
  },
};

function collectCheckedValues(form, name) {
  return Array.from(form.querySelectorAll(`input[name="${name}"]:checked`)).map(function (input) {
    return input.value;
  });
}

function splitCommaSeparated(value) {
  return String(value || "")
    .split(",")
    .map(function (item) {
      return item.trim();
    })
    .filter(Boolean);
}

function readFileAsDataUrl(file) {
  return new Promise(function (resolve, reject) {
    var reader = new window.FileReader();
    reader.onload = function () {
      resolve(String(reader.result || ""));
    };
    reader.onerror = function () {
      reject(new Error("Could not read the selected headshot."));
    };
    reader.readAsDataURL(file);
  });
}

function getTodayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function showErr(msg) {
  var element = document.getElementById("formError");
  element.textContent = msg;
  element.style.display = "block";
  element.scrollIntoView({ behavior: "smooth", block: "center" });
}

function syncFullProfileDisclosure() {
  var disclosure = document.getElementById("fullProfileDetails");
  var toggleLabel = document.getElementById("fullProfileToggleLabel");
  if (!disclosure || !toggleLabel) {
    return;
  }

  toggleLabel.textContent = disclosure.open ? "Hide profile details" : "Open profile details";
}

function openFullProfileDisclosure() {
  var disclosure = document.getElementById("fullProfileDetails");
  if (!disclosure) {
    return;
  }

  if (!disclosure.open) {
    disclosure.open = true;
    syncFullProfileDisclosure();
  }
}

function revealField(name) {
  if (!name) {
    return;
  }

  var field = document.querySelector('[name="' + name + '"]');
  if (!field) {
    return;
  }

  field.scrollIntoView({ behavior: "smooth", block: "center" });
  if (typeof field.focus === "function") {
    field.focus({ preventScroll: true });
  }
}

function showValidationError(msg, fieldName, shouldOpenFullProfile) {
  if (shouldOpenFullProfile) {
    openFullProfileDisclosure();
  }
  showErr(msg);
  revealField(fieldName);
}

function showSuccess(application, source) {
  var intent =
    application && application.submission_intent ? application.submission_intent : "full_profile";
  var isRevision = Boolean(revisionApplicationId || (application && application.revision_count));
  var isConfirmation = Boolean(confirmationTherapistSlug && !revisionApplicationId);
  var portalLabel =
    application && application.portal_state_label
      ? application.portal_state_label
      : "Pending review";
  var portalNextStep =
    application && application.portal_next_step
      ? application.portal_next_step
      : "We will review the submission and confirm the next step.";
  var isClaimConversion =
    application &&
    application.portal_state &&
    ["profile_submitted_after_claim", "profile_in_review_after_claim"].includes(
      application.portal_state,
    );
  var message =
    source === "sanity"
      ? isConfirmation
        ? "Your confirmation update has been sent into the real review queue. We will review the updated operational details before they replace the live profile."
        : intent === "claim"
          ? "Your free claim has been sent into the real review queue. Once ownership is verified, you can come back to complete the richer profile details and decide whether to upgrade later."
          : isClaimConversion
            ? "Your fuller profile has been sent in after claim approval. It is now back in the review queue so we can assess trust, fit, and listing readiness."
            : isRevision
              ? "Your revised profile has been sent back into the real Sanity review queue. The review request has been cleared and the updated version is ready for another review pass."
              : "Your application has been sent into the real Sanity review queue. Open the admin review page or Sanity Studio to approve and publish it."
      : isConfirmation
        ? "Your confirmation update has been saved locally in this working app and is ready for review before the live profile is refreshed."
        : intent === "claim"
          ? "Your free claim has been saved locally in this working app. Next, review and verify ownership before completing the rest of the profile."
          : isClaimConversion
            ? "Your fuller profile has been saved locally after claim approval. It is now ready to move through review as a real listing candidate."
            : isRevision
              ? "Your revised profile has been saved locally in this working app. It is now back in review so the updated version can be checked and published."
              : "Your practice has been saved locally in this working app. Next, review and publish it from the admin page to make it appear in the directory and matching flow.";

  document.getElementById("formCard").innerHTML =
    '<div class="success-state"><div class="success-icon">🎉</div><h2>' +
    (isConfirmation
      ? "Confirmation Update Received!"
      : intent === "claim"
        ? "Claim Received!"
        : "Application Received!") +
    "</h2><p>" +
    message +
    '</p><div style="margin: 0 auto 1.1rem; max-width: 440px; text-align: left; border: 1px solid var(--border); border-radius: 14px; background: #fbfdfe; padding: 0.95rem 1rem;"><div style="font-size: .73rem; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin-bottom: .3rem;">Current status</div><div style="font-size: .98rem; font-weight: 700; color: var(--navy); margin-bottom: .25rem;">' +
    portalLabel +
    '</div><div style="font-size: .82rem; color: var(--slate); line-height: 1.6;">' +
    portalNextStep +
    '</div></div><a href="admin.html" class="btn-pay">Open Admin Review →</a><br/><p style="font-size:.8rem;color:var(--muted);margin-top:.5rem">Saved as <strong>' +
    application.name +
    "</strong> with status <strong>" +
    portalLabel +
    "</strong>.<br/>Once published, the listing will appear in search, guided matching, and public profile pages.</p></div>";
  window.scrollTo(0, 0);
}

function normalizeValue(value, type) {
  if (type === "array") {
    return (Array.isArray(value) ? value : [])
      .map(function (item) {
        return String(item || "")
          .trim()
          .toLowerCase();
      })
      .filter(Boolean)
      .sort()
      .join("|");
  }

  if (type === "pricing") {
    return [
      value && value.session_fee_min,
      value && value.session_fee_max,
      value && value.sliding_scale,
    ]
      .map(function (item) {
        return String(item == null ? "" : item)
          .trim()
          .toLowerCase();
      })
      .join("|");
  }

  return String(value == null ? "" : value)
    .trim()
    .toLowerCase();
}

function getRevisionRequestedFields(message) {
  var text = String(message || "").toLowerCase();
  return Object.keys(REVISION_FIELD_CONFIG).filter(function (fieldName) {
    return REVISION_FIELD_CONFIG[fieldName].keywords.some(function (keyword) {
      return text.includes(keyword);
    });
  });
}

function setActiveRequestedFields(fields) {
  activeRequestedFields = Array.from(
    new Set((Array.isArray(fields) ? fields : []).filter(Boolean)),
  );
}

function getChangedRevisionFields(data) {
  if (!revisionBaseline) {
    return [];
  }

  return Object.keys(REVISION_FIELD_CONFIG).filter(function (fieldName) {
    var config = REVISION_FIELD_CONFIG[fieldName];
    if (config.type === "pricing") {
      return normalizeValue(data, "pricing") !== normalizeValue(revisionBaseline, "pricing");
    }

    return (
      normalizeValue(data[fieldName], config.type) !==
      normalizeValue(revisionBaseline[fieldName], config.type)
    );
  });
}

function renderRevisionWorkspace(data) {
  var notice = document.getElementById("revisionNotice");
  var requestedEl = document.getElementById("revisionRequestedFields");
  var improvedEl = document.getElementById("revisionImprovedFields");
  if (
    !notice ||
    notice.style.display === "none" ||
    !revisionBaseline ||
    !requestedEl ||
    !improvedEl
  ) {
    return;
  }

  var requestedFields = activeRequestedFields.length
    ? activeRequestedFields
    : getRevisionRequestedFields(revisionBaseline.review_request_message);
  var changedFields = getChangedRevisionFields(data);

  requestedEl.innerHTML = requestedFields.length
    ? requestedFields
        .map(function (fieldName) {
          return (
            '<span class="revision-pill requested">' +
            REVISION_FIELD_CONFIG[fieldName].label +
            "</span>"
          );
        })
        .join("")
    : '<span class="revision-empty">The reviewer message is broad, so focus on the highlighted coaching and fit clarity.</span>';

  improvedEl.innerHTML = changedFields.length
    ? changedFields
        .map(function (fieldName) {
          return (
            '<span class="revision-pill improved">' +
            REVISION_FIELD_CONFIG[fieldName].label +
            "</span>"
          );
        })
        .join("")
    : '<span class="revision-empty">As you update the form, your improved sections will appear here.</span>';

  Object.keys(REVISION_FIELD_CONFIG).forEach(function (fieldName) {
    var input = document.querySelector('[name="' + fieldName + '"]');
    var field = input ? input.closest(".field") : null;
    if (!field) {
      return;
    }

    field.classList.toggle("field-requested", requestedFields.includes(fieldName));
    field.classList.toggle("field-improved", changedFields.includes(fieldName));
  });
}

function collectFormData(form) {
  var applicationIntakeType = confirmationTherapistSlug ? "confirmation_update" : "new_listing";
  var intentInput = form.elements.submission_intent;
  return {
    submission_intent: intentInput ? String(intentInput.value || "full_profile") : "full_profile",
    application_intake_type: applicationIntakeType,
    target_therapist_slug: confirmationTherapistSlug || "",
    target_therapist_id: confirmationTherapistId || "",
    slug: confirmationTherapistSlug || "",
    published_therapist_id: confirmationTherapistId || "",
    name: form.elements.name.value.trim(),
    credentials: form.elements.credentials.value.trim(),
    title: form.elements.title.value.trim(),
    years_experience: form.elements.years_experience.value,
    bipolar_years_experience: form.elements.bipolar_years_experience.value,
    email: form.elements.email.value.trim(),
    phone: form.elements.phone.value.trim(),
    photo_source_type: form.elements.photo_source_type.value,
    photo_usage_permission_confirmed: !!form.querySelector(
      'input[name="photo_usage_permission_confirmed"]:checked',
    ),
    practice_name: form.elements.practice_name.value.trim(),
    city: form.elements.city.value.trim(),
    state: form.elements.state.value,
    zip: form.elements.zip.value.trim(),
    website: form.elements.website.value.trim(),
    preferred_contact_method: form.elements.preferred_contact_method.value,
    preferred_contact_label: form.elements.preferred_contact_label.value.trim(),
    contact_guidance: form.elements.contact_guidance.value.trim(),
    first_step_expectation: form.elements.first_step_expectation.value.trim(),
    booking_url: form.elements.booking_url.value.trim(),
    license_state: form.elements.license_state.value.trim(),
    license_number: form.elements.license_number.value.trim(),
    languages: splitCommaSeparated(form.elements.languages.value),
    telehealth_states: splitCommaSeparated(form.elements.telehealth_states.value),
    estimated_wait_time: form.elements.estimated_wait_time.value.trim(),
    bio: form.elements.bio.value.trim(),
    care_approach: form.elements.care_approach.value.trim(),
    source_url: form.elements.website.value.trim(),
    supporting_source_urls: [],
    source_reviewed_at: "",
    specialties: collectCheckedValues(form, "specialties"),
    treatment_modalities: collectCheckedValues(form, "treatment_modalities"),
    client_populations: collectCheckedValues(form, "client_populations"),
    insurance_accepted: collectCheckedValues(form, "insurance_accepted"),
    therapist_reported_fields: collectCheckedValues(form, "therapist_reported_fields"),
    therapist_reported_confirmed_at:
      form.elements.therapist_reported_confirmed_at.value.trim() || getTodayDateString(),
    session_fee_min: form.elements.session_fee_min.value,
    session_fee_max: form.elements.session_fee_max.value,
    sliding_scale: !!form.querySelector('input[name="sliding_scale"]:checked'),
    accepts_telehealth: !!form.querySelector('input[name="accepts_telehealth"]:checked'),
    accepts_in_person: !!form.querySelector('input[name="accepts_in_person"]:checked'),
    medication_management: !!form.querySelector('input[name="medication_management"]:checked'),
    verification_status: "under_review",
    notes: confirmationTherapistSlug
      ? "Confirmation update submitted for live therapist slug " + confirmationTherapistSlug + "."
      : "",
  };
}

async function collectPhotoUploadData(form) {
  var input = form.elements.photo_file;
  var file = input && input.files ? input.files[0] : null;
  if (!file) {
    return {};
  }

  if (!/^image\/(jpeg|png|webp)$/i.test(file.type || "")) {
    throw new Error("Headshot must be a JPG, PNG, or WebP image.");
  }

  if (file.size > 4 * 1024 * 1024) {
    throw new Error("Headshot image is too large. Keep it under 4 MB.");
  }

  return {
    photo_upload_base64: await readFileAsDataUrl(file),
    photo_filename: file.name || "therapist-headshot",
  };
}

function renderPhotoUploadStatus() {
  var form = document.getElementById("applyForm");
  var status = document.getElementById("photoUploadStatus");
  if (!form || !status) {
    return;
  }

  var input = form.elements.photo_file;
  var file = input && input.files ? input.files[0] : null;
  var sourceType = form.elements.photo_source_type.value;
  var permissionConfirmed = !!form.querySelector(
    'input[name="photo_usage_permission_confirmed"]:checked',
  );

  if (!file) {
    status.textContent =
      "Uploaded headshots are preferred over public-source images because they are clearer, easier to trust, and easier to keep current.";
    return;
  }

  var sourceLabel =
    sourceType === "therapist_uploaded"
      ? "therapist-uploaded"
      : sourceType === "practice_uploaded"
        ? "practice-uploaded"
        : sourceType === "public_source"
          ? "public-source fallback"
          : "source not yet selected";

  status.textContent =
    file.name +
    " selected (" +
    Math.round(file.size / 1024) +
    " KB). Current source: " +
    sourceLabel +
    (permissionConfirmed
      ? ". Usage permission confirmed."
      : ". Confirm usage permission before submitting.");
}

function renderReadiness() {
  var form = document.getElementById("applyForm");
  var scoreEl = document.getElementById("readinessScore");
  var labelEl = document.getElementById("readinessLabel");
  var strengthsEl = document.getElementById("readinessStrengths");
  var missingEl = document.getElementById("readinessMissing");

  if (!form || !scoreEl || !labelEl || !strengthsEl || !missingEl) {
    return;
  }

  var readiness = getTherapistMatchReadiness(collectFormData(form));
  scoreEl.textContent = readiness.score + "/100";
  labelEl.textContent = readiness.label;
  labelEl.className = "readiness-label tone-" + readiness.label.toLowerCase().replace(/\s+/g, "-");

  strengthsEl.innerHTML = readiness.strengths.length
    ? readiness.strengths
        .map(function (item) {
          return '<span class="readiness-pill positive">' + item + "</span>";
        })
        .join("")
    : '<span class="readiness-empty">Add a few more details and your strengths will show up here.</span>';

  missingEl.innerHTML = readiness.missing_items.length
    ? readiness.missing_items
        .map(function (item) {
          return '<span class="readiness-pill">' + item + "</span>";
        })
        .join("")
    : '<span class="readiness-empty">This profile is in strong shape for high-quality matching.</span>';

  renderRevisionWorkspace(collectFormData(form));
}

function setCoachMessage(id, message, tone) {
  var element = document.getElementById(id);
  if (!element) {
    return;
  }

  element.textContent = message;
  element.className = "field-coach" + (tone ? " " + tone : "");
}

function renderFieldCoaching() {
  var form = document.getElementById("applyForm");
  if (!form) {
    return;
  }

  var contactGuidance = form.elements.contact_guidance.value.trim();
  var firstStep = form.elements.first_step_expectation.value.trim();
  var careApproach = form.elements.care_approach.value.trim();
  var insurance = collectCheckedValues(form, "insurance_accepted");
  var minFee = form.elements.session_fee_min.value.trim();
  var maxFee = form.elements.session_fee_max.value.trim();

  if (!contactGuidance) {
    setCoachMessage(
      "contactGuidanceCoach",
      "Best practice: mention reply time, what the person should include, and any insurance or state details you want upfront.",
      "",
    );
  } else if (contactGuidance.length < 80) {
    setCoachMessage(
      "contactGuidanceCoach",
      "This is a start. It will be stronger if you include response timing plus the 2-3 details you want someone to send.",
      "warn",
    );
  } else {
    setCoachMessage(
      "contactGuidanceCoach",
      "Strong: this gives people enough structure to reach out with confidence.",
      "strong",
    );
  }

  if (!firstStep) {
    setCoachMessage(
      "firstStepCoach",
      "Best practice: explain the first interaction, how long it usually takes, and what you are assessing for fit.",
      "",
    );
  } else if (firstStep.length < 90) {
    setCoachMessage(
      "firstStepCoach",
      "Add a bit more detail about timeline or what happens after the initial consult so the next step feels concrete.",
      "warn",
    );
  } else {
    setCoachMessage(
      "firstStepCoach",
      "Strong: this reduces uncertainty and makes the first step easier to picture.",
      "strong",
    );
  }

  if (!careApproach) {
    setCoachMessage(
      "careApproachCoach",
      "Best practice: name the bipolar populations you help, how you work, and what your care looks like in practice.",
      "",
    );
  } else if (careApproach.length < 120) {
    setCoachMessage(
      "careApproachCoach",
      "Good start. Make this more match-ready by naming specific modalities, client needs, or how you coordinate care.",
      "warn",
    );
  } else {
    setCoachMessage(
      "careApproachCoach",
      "Strong: this gives users concrete reasons you may fit their needs.",
      "strong",
    );
  }

  if (!insurance.length && !minFee && !maxFee) {
    setCoachMessage(
      "pricingCoach",
      "Add either accepted insurance or a typical fee range so users can quickly tell whether contacting you is realistic.",
      "warn",
    );
  } else if (!insurance.length && (minFee || maxFee)) {
    setCoachMessage(
      "pricingCoach",
      "Clear pricing helps. If you are private-pay, consider also clarifying out-of-network reimbursement expectations in contact guidance.",
      "",
    );
  } else if (insurance.length && !minFee && !maxFee) {
    setCoachMessage(
      "pricingCoach",
      "Insurance clarity is helpful. Adding a typical fee range can still improve trust for out-of-pocket or uncovered services.",
      "",
    );
  } else {
    setCoachMessage(
      "pricingCoach",
      "Strong: this gives users both coverage clarity and a realistic cost range.",
      "strong",
    );
  }
}

async function handleSubmit(event) {
  event.preventDefault();

  var form = document.getElementById("applyForm");
  var button = document.getElementById("submitBtn");
  var claimButton = document.getElementById("claimBtn");
  var submitter = event.submitter || button;
  var submitIntent =
    submitter && submitter.dataset && submitter.dataset.submitIntent
      ? submitter.dataset.submitIntent
      : "full";
  document.getElementById("formError").style.display = "none";
  if (form.elements.submission_intent) {
    form.elements.submission_intent.value = submitIntent === "claim" ? "claim" : "full_profile";
  }

  var data = collectFormData(form);

  if (!data.name) return showValidationError("Please enter your name.", "name", false);
  if (!data.credentials)
    return showValidationError("Please enter your credentials or license.", "credentials", false);
  if (!data.email || !data.email.includes("@"))
    return showValidationError("Please enter a valid email address.", "email", false);
  if (!data.license_state)
    return showValidationError(
      "Please enter the state where your license is issued.",
      "license_state",
      false,
    );
  if (!data.license_number)
    return showValidationError(
      "Please enter your license number so we can review the listing.",
      "license_number",
      false,
    );
  if (submitIntent !== "claim") {
    if (!data.city) return showValidationError("Please enter your city.", "city", true);
    if (!data.state) return showValidationError("Please select your state.", "state", true);
    if (!data.bio || data.bio.length < 50)
      return showValidationError("Please write a bio of at least 50 characters.", "bio", true);
    if (!data.care_approach || data.care_approach.length < 40)
      return showValidationError(
        "Please add a short statement about how you help bipolar clients.",
        "care_approach",
        true,
      );
    if (!data.specialties.length)
      return showValidationError("Please choose at least one specialty.", "specialties", true);
    if (!data.treatment_modalities.length)
      return showValidationError(
        "Please choose at least one treatment modality.",
        "treatment_modalities",
        true,
      );
    if (!data.accepts_telehealth && !data.accepts_in_person)
      return showValidationError("Choose at least one session format.", "accepts_telehealth", true);
    if (!data.therapist_reported_fields.length)
      return showValidationError(
        "Please choose at least one therapist-confirmed field so the trust layer can separate your submitted operational details from reviewed facts.",
        "therapist_reported_fields",
        true,
      );
  }
  if (form.elements.photo_file.files && form.elements.photo_file.files[0]) {
    if (!data.photo_source_type) {
      return showValidationError(
        "Choose the source for the uploaded headshot.",
        "photo_source_type",
        false,
      );
    }
    if (!data.photo_usage_permission_confirmed) {
      return showValidationError(
        "Please confirm that the uploaded headshot can be used on the live profile.",
        "photo_usage_permission_confirmed",
        false,
      );
    }
  }

  button.disabled = true;
  if (claimButton) {
    claimButton.disabled = true;
  }
  submitter.textContent = submitIntent === "claim" ? "Saving claim..." : "Submitting...";

  try {
    data = {
      ...data,
      ...(await collectPhotoUploadData(form)),
    };
    let application;
    let source = "sanity";

    try {
      application = revisionApplicationId
        ? await submitTherapistApplicationRevision(revisionApplicationId, data)
        : await submitTherapistApplication(data);
    } catch (error) {
      if (error && error.status) {
        throw error;
      }
      application = revisionApplicationId
        ? reviseApplication(revisionApplicationId, data)
        : submitApplication(data);
      source = "local";
    }

    showSuccess(application, source);
  } catch (error) {
    button.disabled = false;
    if (claimButton) {
      claimButton.disabled = false;
    }
    button.textContent = "Submit Full Profile";
    if (claimButton) {
      claimButton.textContent = "Save Free Claim";
    }
    showErr(
      error && error.message
        ? error.message
        : "Something went wrong while saving the application. Please try again.",
    );
  }
}

function setFieldValue(form, name, value) {
  if (!form.elements[name]) {
    return;
  }

  if (form.elements[name].type === "checkbox") {
    form.elements[name].checked = !!value;
    return;
  }

  form.elements[name].value = value == null ? "" : value;
}

function setCheckedValues(form, name, values) {
  var selected = new Set(Array.isArray(values) ? values : []);
  form.querySelectorAll('input[name="' + name + '"]').forEach(function (input) {
    input.checked = selected.has(input.value);
    input.closest(".check-label").classList.toggle("checked-style", input.checked);
  });
}

function applyRevisionContext(application) {
  var form = document.getElementById("applyForm");
  var notice = document.getElementById("revisionNotice");
  var message = document.getElementById("revisionMessage");

  if (!application || !form) {
    return;
  }

  revisionApplicationId = application.id;
  revisionBaseline = application;
  confirmationTherapistSlug = "";
  confirmationTherapistId = application.published_therapist_id || "";
  setActiveRequestedFields(getRevisionRequestedFields(application.review_request_message));
  [
    "name",
    "credentials",
    "title",
    "years_experience",
    "bipolar_years_experience",
    "email",
    "phone",
    "practice_name",
    "city",
    "state",
    "zip",
    "website",
    "preferred_contact_method",
    "preferred_contact_label",
    "contact_guidance",
    "first_step_expectation",
    "booking_url",
    "license_state",
    "license_number",
    "estimated_wait_time",
    "bio",
    "care_approach",
    "session_fee_min",
    "session_fee_max",
    "therapist_reported_confirmed_at",
  ].forEach(function (fieldName) {
    setFieldValue(form, fieldName, application[fieldName]);
  });

  setFieldValue(form, "languages", (application.languages || []).join(", "));
  setFieldValue(form, "telehealth_states", (application.telehealth_states || []).join(", "));
  setCheckedValues(form, "specialties", application.specialties);
  setCheckedValues(form, "treatment_modalities", application.treatment_modalities);
  setCheckedValues(form, "client_populations", application.client_populations);
  setCheckedValues(form, "insurance_accepted", application.insurance_accepted);
  setCheckedValues(form, "therapist_reported_fields", application.therapist_reported_fields);
  setFieldValue(form, "sliding_scale", application.sliding_scale);
  setFieldValue(form, "accepts_telehealth", application.accepts_telehealth);
  setFieldValue(form, "accepts_in_person", application.accepts_in_person);
  setFieldValue(form, "medication_management", application.medication_management);
  setFieldValue(form, "photo_source_type", application.photo_source_type || "");
  setFieldValue(
    form,
    "photo_usage_permission_confirmed",
    application.photo_usage_permission_confirmed,
  );
  renderPhotoUploadStatus();

  if (notice) {
    notice.style.display = "block";
  }
  var title = document.getElementById("revisionTitle");
  if (title) {
    title.textContent = "Revision requested";
  }
  if (message) {
    message.textContent =
      application.review_request_message ||
      "This profile was sent back for revisions. Tighten the requested details and resubmit this version for review.";
  }

  var button = document.getElementById("submitBtn");
  if (button) {
    button.textContent = "Submit Updated Profile →";
  }

  renderReadiness();
  renderFieldCoaching();
}

function applyConfirmationContext(therapist) {
  var form = document.getElementById("applyForm");
  var notice = document.getElementById("revisionNotice");
  var title = document.getElementById("revisionTitle");
  var message = document.getElementById("revisionMessage");

  if (!therapist || !form) {
    return;
  }

  var agenda = getTherapistConfirmationAgenda(therapist);
  revisionApplicationId = "";
  revisionBaseline = therapist;
  confirmationTherapistSlug = therapist.slug || "";
  confirmationTherapistId = therapist.id || "";
  setActiveRequestedFields(agenda.unknown_fields);

  [
    "name",
    "credentials",
    "title",
    "years_experience",
    "bipolar_years_experience",
    "email",
    "phone",
    "practice_name",
    "city",
    "state",
    "zip",
    "website",
    "preferred_contact_method",
    "preferred_contact_label",
    "contact_guidance",
    "first_step_expectation",
    "booking_url",
    "license_state",
    "license_number",
    "estimated_wait_time",
    "bio",
    "care_approach",
    "session_fee_min",
    "session_fee_max",
    "therapist_reported_confirmed_at",
  ].forEach(function (fieldName) {
    setFieldValue(form, fieldName, therapist[fieldName]);
  });

  setFieldValue(form, "languages", (therapist.languages || []).join(", "));
  setFieldValue(form, "telehealth_states", (therapist.telehealth_states || []).join(", "));
  setCheckedValues(form, "specialties", therapist.specialties);
  setCheckedValues(form, "treatment_modalities", therapist.treatment_modalities);
  setCheckedValues(form, "client_populations", therapist.client_populations);
  setCheckedValues(form, "insurance_accepted", therapist.insurance_accepted);
  setCheckedValues(form, "therapist_reported_fields", therapist.therapist_reported_fields);
  setFieldValue(form, "sliding_scale", therapist.sliding_scale);
  setFieldValue(form, "accepts_telehealth", therapist.accepts_telehealth);
  setFieldValue(form, "accepts_in_person", therapist.accepts_in_person);
  setFieldValue(form, "medication_management", therapist.medication_management);
  setFieldValue(form, "photo_source_type", therapist.photo_source_type || "");
  setFieldValue(
    form,
    "photo_usage_permission_confirmed",
    therapist.photo_usage_permission_confirmed,
  );
  renderPhotoUploadStatus();

  if (notice) {
    notice.style.display = "block";
  }
  if (title) {
    title.textContent = "Confirmation requested";
  }
  if (message) {
    message.textContent =
      "Please confirm the highlighted operational details for your live profile. Only confirm what is current and accurate. If something is uncertain, it is better to leave it blank than overstate it.";
  }

  var button = document.getElementById("submitBtn");
  if (button) {
    button.textContent = "Submit Confirmation Update →";
  }

  renderReadiness();
  renderFieldCoaching();
}

async function loadRevisionContext() {
  var params = new URLSearchParams(window.location.search);
  var revisionId = params.get("revise");

  if (!revisionId || !document.getElementById("applyForm")) {
    return;
  }

  try {
    var remoteApplication = await fetchTherapistApplicationRevision(revisionId);
    if (remoteApplication && remoteApplication.status === "requested_changes") {
      applyRevisionContext(remoteApplication);
      return;
    }
  } catch (_error) {
    // Fall back to local demo data when the review API is unavailable.
  }

  var application = getApplicationById(revisionId);
  if (application && application.status === "requested_changes") {
    applyRevisionContext(application);
  }
}

async function loadConfirmationContext() {
  var params = new URLSearchParams(window.location.search);
  var slug = params.get("confirm");

  if (!slug || !document.getElementById("applyForm") || revisionApplicationId) {
    return;
  }

  try {
    var therapist = cmsEnabled ? await fetchPublicTherapistBySlug(slug) : getTherapistBySlug(slug);
    if (therapist) {
      applyConfirmationContext(therapist);
      return;
    }
  } catch (_error) {
    // Fall back to local data if CMS fetch fails.
  }

  var localTherapist = getTherapistBySlug(slug);
  if (localTherapist) {
    applyConfirmationContext(localTherapist);
  }
}

document.querySelectorAll('.check-label input[type="checkbox"]').forEach(function (checkbox) {
  checkbox.addEventListener("change", function () {
    this.closest(".check-label").classList.toggle("checked-style", this.checked);
  });
  if (checkbox.checked) {
    checkbox.closest(".check-label").classList.add("checked-style");
  }
});

async function initSignupContext() {
  await loadRevisionContext();
  await loadConfirmationContext();
}

initSignupContext();
var fullProfileDisclosure = document.getElementById("fullProfileDetails");
if (fullProfileDisclosure) {
  fullProfileDisclosure.addEventListener("toggle", syncFullProfileDisclosure);
  syncFullProfileDisclosure();
}
if (
  document.getElementById("applyForm") &&
  document.getElementById("applyForm").elements.therapist_reported_confirmed_at &&
  !document.getElementById("applyForm").elements.therapist_reported_confirmed_at.value
) {
  document.getElementById("applyForm").elements.therapist_reported_confirmed_at.value =
    getTodayDateString();
}
document.getElementById("applyForm").addEventListener("input", renderReadiness);
document.getElementById("applyForm").addEventListener("change", renderReadiness);
document.getElementById("applyForm").addEventListener("input", renderFieldCoaching);
document.getElementById("applyForm").addEventListener("change", renderFieldCoaching);
document.getElementById("applyForm").addEventListener("change", renderPhotoUploadStatus);
renderReadiness();
renderFieldCoaching();
renderPhotoUploadStatus();

window.handleSubmit = handleSubmit;
