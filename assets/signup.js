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
let draftSaveTimer = 0;
let draftStatusMessage = "";
let draftStatusAt = "";
let draftSavePending = false;
let lastValidationTarget = "";
let lastValidationSection = "";
let lastHighlightedField = null;
let highlightTimer = 0;
let lastFieldCallout = null;
let lastFieldCalloutTarget = "";
let formBannerTimer = 0;

var SIGNUP_DRAFT_KEY_PREFIX = "bt_signup_draft_v1";

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

function canUseDraftStorage() {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch (_error) {
    return false;
  }
}

function getSignupDraftKey() {
  if (revisionApplicationId) {
    return SIGNUP_DRAFT_KEY_PREFIX + "::revise::" + revisionApplicationId;
  }
  if (confirmationTherapistSlug) {
    return SIGNUP_DRAFT_KEY_PREFIX + "::confirm::" + confirmationTherapistSlug;
  }
  return SIGNUP_DRAFT_KEY_PREFIX + "::new";
}

function readSignupDraft() {
  if (!canUseDraftStorage()) {
    return null;
  }

  try {
    var raw = window.localStorage.getItem(getSignupDraftKey());
    return raw ? JSON.parse(raw) : null;
  } catch (_error) {
    return null;
  }
}

function writeSignupDraft(payload) {
  if (!canUseDraftStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(getSignupDraftKey(), JSON.stringify(payload));
  } catch (_error) {
    // Ignore storage failures so the form stays usable.
  }
}

function clearSignupDraft() {
  if (!canUseDraftStorage()) {
    return;
  }

  try {
    window.localStorage.removeItem(getSignupDraftKey());
  } catch (_error) {
    // Ignore storage failures so the form stays usable.
  }
}

function setDraftStatus(message) {
  draftStatusMessage = message || "";
  draftStatusAt = draftStatusMessage ? new Date().toISOString() : "";
}

function getDraftStatusSuffix() {
  if (draftSavePending) {
    return " Saving draft...";
  }

  if (!draftStatusMessage) {
    return "";
  }

  var label = draftStatusMessage;
  if (draftStatusAt) {
    var savedAt = new Date(draftStatusAt);
    if (!Number.isNaN(savedAt.getTime())) {
      label += " (" + savedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + ")";
    }
  }

  return " " + label + ".";
}

function showErr(msg) {
  showFormBanner(msg, "error");
}

function showFormBanner(message, tone) {
  var element = document.getElementById("formError");
  if (!element) {
    return;
  }

  element.textContent = message;
  element.style.display = "block";

  if (formBannerTimer) {
    window.clearTimeout(formBannerTimer);
    formBannerTimer = 0;
  }

  if (tone === "success") {
    element.style.background = "rgba(58, 170, 122, 0.12)";
    element.style.borderColor = "rgba(58, 170, 122, 0.28)";
    element.style.color = "#246b4d";
  } else if (tone === "info") {
    element.style.background = "rgba(232, 245, 248, 0.92)";
    element.style.borderColor = "rgba(26, 122, 143, 0.22)";
    element.style.color = "var(--teal-dark)";
  } else {
    element.style.background = "#fff5f5";
    element.style.borderColor = "#feb2b2";
    element.style.color = "var(--red)";
  }

  element.scrollIntoView({ behavior: "smooth", block: "center" });

  if (tone === "success" || tone === "info") {
    formBannerTimer = window.setTimeout(
      function () {
        element.style.display = "none";
        formBannerTimer = 0;
      },
      tone === "success" ? 2600 : 3200,
    );
  }
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

  highlightFieldTarget(field);
  renderFieldCallout(field, name);

  field.scrollIntoView({ behavior: "smooth", block: "center" });
  if (typeof field.focus === "function") {
    field.focus({ preventScroll: true });
  }
}

function highlightFieldTarget(input) {
  if (!input) {
    return;
  }

  var field = input.closest(".field") || input.closest(".check-label") || input;
  if (!field) {
    return;
  }

  if (lastHighlightedField && lastHighlightedField !== field) {
    lastHighlightedField.style.boxShadow = "";
    lastHighlightedField.style.background = "";
    lastHighlightedField.style.transition = "";
  }

  lastHighlightedField = field;
  field.style.transition = "box-shadow 180ms ease, background 180ms ease";
  field.style.boxShadow = "0 0 0 3px rgba(26, 122, 143, 0.18)";
  field.style.background = "rgba(232, 245, 248, 0.72)";

  if (highlightTimer) {
    window.clearTimeout(highlightTimer);
  }

  highlightTimer = window.setTimeout(function () {
    if (lastHighlightedField === field) {
      field.style.boxShadow = "";
      field.style.background = "";
      field.style.transition = "";
    }
  }, 1800);
}

function renderFieldCallout(input, fieldName) {
  var container = input.closest(".field") || input.closest(".check-label") || input.parentElement;
  if (!container || !container.parentElement) {
    return;
  }

  if (lastFieldCallout && lastFieldCallout.parentElement) {
    lastFieldCallout.remove();
  }

  var callout = document.createElement("div");
  callout.style.marginTop = "0.45rem";
  callout.style.fontSize = "0.76rem";
  callout.style.color = "var(--teal-dark)";
  callout.style.background = "rgba(232, 245, 248, 0.9)";
  callout.style.border = "1px solid rgba(26, 122, 143, 0.16)";
  callout.style.borderRadius = "8px";
  callout.style.padding = "0.45rem 0.6rem";
  callout.style.lineHeight = "1.45";

  var label = getFieldGuidanceLabel(fieldName);
  if (lastValidationTarget === fieldName) {
    callout.textContent = "Current blocker: finish " + label + " to keep this submission moving.";
  } else if (activeRequestedFields.includes(fieldName)) {
    callout.textContent = "Reviewer focus: this field is one of the requested updates.";
  } else {
    callout.textContent =
      "Next best step: finishing " + label + " will improve this profile fastest.";
  }

  if (container.classList && container.classList.contains("check-label")) {
    container.insertAdjacentElement("afterend", callout);
  } else {
    container.appendChild(callout);
  }

  lastFieldCallout = callout;
  lastFieldCalloutTarget = fieldName || "";
}

function clearFieldCallout() {
  if (lastFieldCallout && lastFieldCallout.parentElement) {
    lastFieldCallout.remove();
  }
  lastFieldCallout = null;
  lastFieldCalloutTarget = "";
}

function handleFieldCalloutProgress(event) {
  var target = event && event.target ? event.target : null;
  if (!target || !lastFieldCalloutTarget) {
    return;
  }

  var fieldName = target.name || "";
  if (!fieldName || fieldName !== lastFieldCalloutTarget) {
    return;
  }

  var form = document.getElementById("applyForm");
  if (!form) {
    return;
  }

  var data = collectFormData(form);
  if (isSignupFieldFilled(data, fieldName)) {
    clearResolvedValidationState(data);
    if (getSignupFocusField() === fieldName) {
      updateSignupFocusParam("");
    }
    clearFieldCallout();
    refreshSignupGuidance();
    return;
  }

  renderFieldCallout(target, fieldName);
}

function showValidationError(msg, fieldName, shouldOpenFullProfile) {
  lastValidationTarget = fieldName || "";
  lastValidationSection = getFieldSectionTitle(fieldName);
  if (shouldOpenFullProfile) {
    openFullProfileDisclosure();
  }
  showErr(msg);
  jumpToSignupField(fieldName);
}

function getSignupFocusField() {
  var params = new URLSearchParams(window.location.search);
  return String(params.get("focus") || "").trim();
}

function updateSignupFocusParam(fieldName) {
  if (typeof window === "undefined" || !window.history || !window.history.replaceState) {
    return;
  }

  var url = new URL(window.location.href);
  if (fieldName) {
    url.searchParams.set("focus", fieldName);
  } else {
    url.searchParams.delete("focus");
  }
  window.history.replaceState({}, "", url.toString());
}

function clearResolvedSignupFocus(data) {
  var focusField = getSignupFocusField();
  if (!focusField) {
    return;
  }

  if (isSignupFieldFilled(data, focusField)) {
    updateSignupFocusParam("");
  }
}

function getSignupFocusLabel(fieldName) {
  if (fieldName === "bio") return "your professional bio";
  if (fieldName === "care_approach") return "how you help bipolar clients";
  if (fieldName === "specialties") return "your specialties";
  if (fieldName === "treatment_modalities") return "your treatment modalities";
  if (fieldName === "contact_guidance") return "your contact guidance";
  if (fieldName === "first_step_expectation") return "what happens after outreach";
  if (fieldName === "preferred_contact_label") return "your primary contact button";
  if (fieldName === "estimated_wait_time") return "your wait-time details";
  if (fieldName === "telehealth_states") return "your telehealth states";
  return "your profile details";
}

function applySignupFocusField() {
  var fieldName = getSignupFocusField();
  if (!fieldName) {
    return;
  }

  var field = document.querySelector('[name="' + fieldName + '"]');
  if (!field) {
    return;
  }

  var stepTwoFieldNames = [
    "city",
    "state",
    "practice_name",
    "preferred_contact_method",
    "preferred_contact_label",
    "contact_guidance",
    "first_step_expectation",
    "booking_url",
    "bio",
    "care_approach",
    "specialties",
    "treatment_modalities",
    "estimated_wait_time",
    "telehealth_states",
    "insurance_accepted",
    "session_fee_min",
    "session_fee_max",
    "accepts_telehealth",
    "accepts_in_person",
  ];

  if (stepTwoFieldNames.includes(fieldName)) {
    openFullProfileDisclosure();
  }

  var formError = document.getElementById("formError");
  if (formError) {
    showFormBanner(
      "Resume here: finish " + getSignupFocusLabel(fieldName) + " to keep your profile moving.",
      "info",
    );
  }

  window.setTimeout(function () {
    jumpToSignupField(fieldName);
  }, 120);
}

function getSuccessStateDetails(intent, isRevision, isConfirmation, isClaimConversion, source) {
  var isSanity = source === "sanity";

  if (isConfirmation) {
    return {
      title: "Confirmation Update Received!",
      message: isSanity
        ? "Your confirmation update has been sent into the real review queue. We will review the updated operational details before they replace the live profile."
        : "Your confirmation update has been saved locally in this working app and is ready for review before the live profile is refreshed.",
      nextTitle: "What happens next",
      nextSteps: [
        "We review the updated operational details before replacing the live profile.",
        "If anything still needs clarification, the next request will point to the exact field.",
        "If everything looks right, the live profile can be refreshed without rebuilding the whole listing.",
      ],
      adminLabel: "Open Review Queue →",
      footer:
        "This update stays tied to the existing live profile, so the next step is review rather than a brand-new listing pass.",
    };
  }

  if (intent === "claim") {
    return {
      title: "Claim Received!",
      message: isSanity
        ? "Your free claim has been sent into the real review queue. Once ownership is verified, you can come back to complete the richer profile details and decide whether to upgrade later."
        : "Your free claim has been saved locally in this working app. Next, review and verify ownership before completing the rest of the profile.",
      nextTitle: "What happens next",
      nextSteps: [
        "First, ownership gets reviewed so the listing can be safely associated with the practice.",
        "After claim approval, the fuller profile becomes the next high-value step.",
        "Nothing else is required right now unless the review team asks for a clarification.",
      ],
      adminLabel: "Open Claim Review →",
      footer:
        "A free claim secures accuracy and ownership first. The richer profile can come after that.",
    };
  }

  if (isClaimConversion) {
    return {
      title: "Full Profile Received!",
      message: isSanity
        ? "Your fuller profile has been sent in after claim approval. It is now back in the review queue so we can assess trust, fit, and listing readiness."
        : "Your fuller profile has been saved locally after claim approval. It is now ready to move through review as a real listing candidate.",
      nextTitle: "What happens next",
      nextSteps: [
        "The profile goes through a fuller trust and listing-readiness review.",
        "If the review team needs anything else, they can request a focused revision instead of restarting the process.",
        "If the profile clears review, it can move toward publish readiness.",
      ],
      adminLabel: "Open Full Profile Review →",
      footer: "This is the handoff from ownership verification into listing-quality review.",
    };
  }

  if (isRevision) {
    return {
      title: "Revision Received!",
      message: isSanity
        ? "Your revised profile has been sent back into the real review queue. The review request has been cleared and the updated version is ready for another review pass."
        : "Your revised profile has been saved locally in this working app. It is now back in review so the updated version can be checked and published.",
      nextTitle: "What happens next",
      nextSteps: [
        "The review team checks the revised fields against the earlier request.",
        "If the requested fixes are covered, the profile can move forward without another full restart.",
        "If anything is still unclear, the next request should stay focused on the remaining gaps.",
      ],
      adminLabel: "Open Revision Review →",
      footer:
        "A revision submission is meant to tighten specific gaps, not send you back to the beginning.",
    };
  }

  return {
    title: "Application Received!",
    message: isSanity
      ? "Your application has been sent into the real review queue. Open the admin review page or Sanity Studio to approve and publish it."
      : "Your practice has been saved locally in this working app. Next, review and publish it from the admin page to make it appear in the directory and matching flow.",
    nextTitle: "What happens next",
    nextSteps: [
      "The profile goes through review for trust, fit, and listing readiness.",
      "If anything important is missing, the next step can come back as a focused revision request.",
      "If the profile clears review, it can move toward publishing across search, matching, and the public profile.",
    ],
    adminLabel: "Open Admin Review →",
    footer:
      "The strongest next step from here is review and publish, not more form-filling unless a revision is requested.",
  };
}

function showSuccess(application, source) {
  updateSignupFocusParam("");
  clearSignupDraft();
  draftSavePending = false;
  setDraftStatus("");
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
  var details = getSuccessStateDetails(
    intent,
    isRevision,
    isConfirmation,
    isClaimConversion,
    source,
  );

  document.getElementById("formCard").innerHTML =
    '<div class="success-state"><div class="success-icon">🎉</div><h2>' +
    details.title +
    "</h2><p>" +
    details.message +
    '</p><div style="margin: 0 auto 1.1rem; max-width: 440px; text-align: left; border: 1px solid var(--border); border-radius: 14px; background: #fbfdfe; padding: 0.95rem 1rem;"><div style="font-size: .73rem; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin-bottom: .3rem;">Current status</div><div style="font-size: .98rem; font-weight: 700; color: var(--navy); margin-bottom: .25rem;">' +
    portalLabel +
    '</div><div style="font-size: .82rem; color: var(--slate); line-height: 1.6;">' +
    portalNextStep +
    '</div></div><div style="margin: 0 auto 1rem; max-width: 440px; text-align: left; border: 1px solid var(--border); border-radius: 14px; background: #fff; padding: 0.95rem 1rem;"><div style="font-size: .73rem; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin-bottom: .45rem;">' +
    details.nextTitle +
    '</div><ul style="margin:0;padding-left:1rem;color:var(--slate);font-size:.82rem;line-height:1.65"><li>' +
    details.nextSteps.join("</li><li>") +
    '</li></ul></div><a href="admin.html" class="btn-pay">' +
    details.adminLabel +
    '</a><br/><p style="font-size:.8rem;color:var(--muted);margin-top:.5rem">Saved as <strong>' +
    application.name +
    "</strong> with status <strong>" +
    portalLabel +
    "</strong>.<br/>" +
    details.footer +
    "</p></div>";
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
            '<button type="button" class="revision-pill requested" data-revision-focus="' +
            fieldName +
            '" style="cursor:pointer">' +
            REVISION_FIELD_CONFIG[fieldName].label +
            "</button>"
          );
        })
        .join("")
    : '<span class="revision-empty">The reviewer message is broad, so focus on the highlighted coaching and fit clarity.</span>';

  improvedEl.innerHTML = changedFields.length
    ? changedFields
        .map(function (fieldName) {
          return (
            '<button type="button" class="revision-pill improved" data-revision-focus="' +
            fieldName +
            '" style="cursor:pointer">' +
            REVISION_FIELD_CONFIG[fieldName].label +
            "</button>"
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

  notice.querySelectorAll("[data-revision-focus]").forEach(function (button) {
    button.addEventListener("click", function () {
      var fieldName = button.getAttribute("data-revision-focus") || "";
      if (!fieldName) {
        return;
      }
      lastValidationTarget = fieldName;
      lastValidationSection = getFieldSectionTitle(fieldName);
      jumpToSignupField(fieldName);
      refreshSignupGuidance();
    });
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

function collectDraftData(form) {
  if (!form) {
    return null;
  }

  return {
    saved_at: new Date().toISOString(),
    submission_intent:
      form.elements.submission_intent && form.elements.submission_intent.value
        ? form.elements.submission_intent.value
        : "full_profile",
    full_profile_open: Boolean(
      document.getElementById("fullProfileDetails") &&
      document.getElementById("fullProfileDetails").open,
    ),
    fields: collectFormData(form),
  };
}

function saveSignupDraft() {
  var form = document.getElementById("applyForm");
  if (!form) {
    return;
  }

  writeSignupDraft(collectDraftData(form));
  draftSavePending = false;
  setDraftStatus("Draft saved in this browser");
  renderCompletionNudges();
}

function scheduleSignupDraftSave() {
  if (draftSaveTimer) {
    window.clearTimeout(draftSaveTimer);
  }
  draftSavePending = true;
  renderCompletionNudges();
  draftSaveTimer = window.setTimeout(function () {
    saveSignupDraft();
  }, 250);
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

function getClaimMissingFields(data) {
  var missing = [];

  if (!data.name) {
    missing.push({ field: "name", label: "your name" });
  }
  if (!data.credentials) {
    missing.push({ field: "credentials", label: "your credentials" });
  }
  if (!data.email || !data.email.includes("@")) {
    missing.push({ field: "email", label: "a valid email" });
  }
  if (!data.license_state) {
    missing.push({ field: "license_state", label: "your license state" });
  }
  if (!data.license_number) {
    missing.push({ field: "license_number", label: "your license number" });
  }

  return missing;
}

function getFullProfileMissingFields(data) {
  var missing = getClaimMissingFields(data).slice();

  if (!data.city) {
    missing.push({ field: "city", label: "your city" });
  }
  if (!data.state) {
    missing.push({ field: "state", label: "your state" });
  }
  if (!data.bio || data.bio.length < 50) {
    missing.push({ field: "bio", label: "a professional bio" });
  }
  if (!data.care_approach || data.care_approach.length < 40) {
    missing.push({ field: "care_approach", label: "how you help bipolar clients" });
  }
  if (!data.specialties.length) {
    missing.push({ field: "specialties", label: "at least one specialty" });
  }
  if (!data.treatment_modalities.length) {
    missing.push({ field: "treatment_modalities", label: "at least one treatment modality" });
  }
  if (!data.accepts_telehealth && !data.accepts_in_person) {
    missing.push({ field: "accepts_telehealth", label: "a session format" });
  }
  if (!data.therapist_reported_fields.length) {
    missing.push({
      field: "therapist_reported_fields",
      label: "at least one therapist-confirmed field",
    });
  }

  return missing;
}

function buildMissingFieldMessage(items, fallback) {
  var labels = (Array.isArray(items) ? items : [])
    .slice(0, 3)
    .map(function (item) {
      return item.label;
    })
    .filter(Boolean);

  if (!labels.length) {
    return fallback || "Please complete the required details.";
  }

  if (labels.length === 1) {
    return "Start with " + labels[0] + ".";
  }

  if (labels.length === 2) {
    return "Start with " + labels[0] + ", then add " + labels[1] + ".";
  }

  return "Start with " + labels[0] + ", then add " + labels[1] + " and " + labels[2] + ".";
}

function getRequestedFieldLabel(fieldName) {
  if (REVISION_FIELD_CONFIG[fieldName] && REVISION_FIELD_CONFIG[fieldName].label) {
    return REVISION_FIELD_CONFIG[fieldName].label.toLowerCase();
  }
  return getSignupFocusLabel(fieldName).replace(/^your /, "");
}

function getFieldGuidanceLabel(fieldName) {
  if (!fieldName) {
    return "the next detail";
  }

  if (REVISION_FIELD_CONFIG[fieldName] && REVISION_FIELD_CONFIG[fieldName].label) {
    return REVISION_FIELD_CONFIG[fieldName].label.toLowerCase();
  }

  if (fieldName === "name") return "your name";
  if (fieldName === "credentials") return "your credentials";
  if (fieldName === "email") return "your email";
  if (fieldName === "license_state") return "your license state";
  if (fieldName === "license_number") return "your license number";
  if (fieldName === "city") return "your city";
  if (fieldName === "state") return "your state";
  if (fieldName === "specialties") return "your specialties";
  if (fieldName === "treatment_modalities") return "your treatment modalities";
  if (fieldName === "therapist_reported_fields") return "therapist-confirmed fields";
  if (fieldName === "therapist_reported_confirmed_at") return "the last confirmed date";
  if (fieldName === "session_fee_min") return "a fee range";
  if (fieldName === "sliding_scale") return "sliding-scale availability";
  if (fieldName === "accepts_telehealth" || fieldName === "accepts_in_person") {
    return "your session format";
  }

  return getSignupFocusLabel(fieldName).replace(/^your /, "");
}

function isFieldCoveredForReview(data, fieldName) {
  if (!data || !fieldName) {
    return false;
  }

  if (fieldName === "session_fee_min") {
    return Boolean(data.session_fee_min || data.session_fee_max || data.sliding_scale);
  }

  var value = data[fieldName];
  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === "boolean") {
    return value;
  }

  return String(value == null ? "" : value).trim().length > 0;
}

function getRevisionProgressStats(data) {
  var requestedFields = activeRequestedFields.length
    ? activeRequestedFields
    : getRevisionRequestedFields(revisionBaseline && revisionBaseline.review_request_message);
  var improvedFields = getChangedRevisionFields(data);
  var coveredFields = requestedFields.filter(function (fieldName) {
    return isFieldCoveredForReview(data, fieldName);
  });

  return {
    requested: requestedFields.length,
    improved: improvedFields.length,
    covered: coveredFields.length,
  };
}

function getConfirmationProgressStats(data) {
  var confirmationFields = activeRequestedFields.slice();
  var coveredFields = confirmationFields.filter(function (fieldName) {
    return isFieldCoveredForReview(data, fieldName);
  });

  return {
    requested: confirmationFields.length,
    covered: coveredFields.length,
  };
}

function clearResolvedValidationState(data) {
  if (!lastValidationTarget) {
    return;
  }

  if (!isSignupFieldFilled(data, lastValidationTarget)) {
    return;
  }

  lastValidationTarget = "";
  lastValidationSection = "";
}

function refreshSignupGuidance() {
  renderCompletionNudges();
  renderSectionProgressSnapshot();
}

function refreshSignupWorkspace() {
  renderProgressSnapshot();
  renderSectionProgressSnapshot();
  renderActionStack();
}

function getNextRecommendedField(data) {
  if (lastValidationTarget) {
    clearResolvedValidationState(data);
    if (lastValidationTarget) {
      return {
        field: lastValidationTarget,
        label: getFieldGuidanceLabel(lastValidationTarget),
        shouldOpenFullProfile: shouldFieldOpenFullProfile(lastValidationTarget),
      };
    }
  }

  var claimMissing = getClaimMissingFields(data);
  var fullMissing = getFullProfileMissingFields(data);
  var mode = getSignupProgressMode();

  if (mode === "revision" && activeRequestedFields.length) {
    var requestedField = activeRequestedFields.find(function (fieldName) {
      return fullMissing.some(function (item) {
        return item.field === fieldName;
      });
    });
    if (requestedField) {
      return {
        field: requestedField,
        label: getRequestedFieldLabel(requestedField),
        shouldOpenFullProfile: true,
      };
    }
  }

  if (claimMissing.length) {
    return {
      field: claimMissing[0].field,
      label: claimMissing[0].label,
      shouldOpenFullProfile: false,
    };
  }

  if (mode === "confirmation" && fullMissing.length) {
    return {
      field: fullMissing[0].field,
      label: fullMissing[0].label,
      shouldOpenFullProfile: true,
    };
  }

  if (fullMissing.length) {
    return {
      field: fullMissing[0].field,
      label: fullMissing[0].label,
      shouldOpenFullProfile: true,
    };
  }

  return null;
}

function formatMissingFieldSummary(items, limit) {
  var labels = (Array.isArray(items) ? items : []).slice(0, limit || 3).map(function (item) {
    return item.label;
  });

  if (!labels.length) {
    return "";
  }

  if (labels.length === 1) {
    return labels[0];
  }

  if (labels.length === 2) {
    return labels[0] + " and " + labels[1];
  }

  return labels.slice(0, -1).join(", ") + ", and " + labels[labels.length - 1];
}

function getClaimCompletionStats(missing) {
  var total = 5;
  return {
    completed: Math.max(0, total - (Array.isArray(missing) ? missing.length : 0)),
    total: total,
  };
}

function getFullProfileCompletionStats(missing) {
  var total = 13;
  return {
    completed: Math.max(0, total - (Array.isArray(missing) ? missing.length : 0)),
    total: total,
  };
}

function getSectionProgressConfig() {
  return [
    {
      title: "Your Information",
      fields: ["name", "credentials", "email", "license_state", "license_number"],
    },
    {
      title: "Practice Details",
      fields: ["city", "state", "preferred_contact_label", "contact_guidance"],
    },
    {
      title: "About Your Practice",
      fields: ["bio", "care_approach"],
    },
    {
      title: "Specialties",
      fields: ["specialties"],
    },
    {
      title: "Clinical Fit",
      fields: ["treatment_modalities", "estimated_wait_time", "telehealth_states"],
    },
    {
      title: "Trust & Source Clarity",
      fields: ["therapist_reported_fields", "therapist_reported_confirmed_at"],
    },
    {
      title: "Insurance & Fees",
      fields: ["insurance_accepted", "session_fee_min", "session_fee_max", "sliding_scale"],
    },
    {
      title: "Session Format",
      fields: ["accepts_telehealth", "accepts_in_person"],
    },
  ];
}

function getFieldSectionTitle(fieldName) {
  if (!fieldName) {
    return "";
  }

  var section = getSectionProgressConfig().find(function (item) {
    return item.fields.includes(fieldName);
  });
  return section ? section.title : "";
}

function getSectionPriorityMeta(section, data) {
  var fields = Array.isArray(section && section.fields) ? section.fields : [];
  var nextField = fields.find(function (fieldName) {
    return !isSignupFieldFilled(data, fieldName);
  });
  var requestedField = fields.find(function (fieldName) {
    return activeRequestedFields.includes(fieldName) && !isFieldCoveredForReview(data, fieldName);
  });

  if (lastValidationSection === section.title && lastValidationTarget) {
    return {
      rank: 0,
      badge: "Blocked",
      actionLabel: "Fix blocker",
      badgeBg: "#fff1f1",
      badgeBorder: "rgba(229, 62, 62, 0.22)",
      badgeColor: "var(--red)",
      helper: "Blocked on: " + getFieldGuidanceLabel(lastValidationTarget),
      reason: "This section is the current submission blocker.",
    };
  }

  if (requestedField) {
    return {
      rank: 1,
      badge: "Reviewer focus",
      actionLabel: "Open requested fix",
      badgeBg: "rgba(232, 245, 248, 0.88)",
      badgeBorder: "rgba(26, 122, 143, 0.18)",
      badgeColor: "var(--teal-dark)",
      helper: "Requested: " + getFieldGuidanceLabel(requestedField),
      reason: "A reviewer explicitly asked for this part of the profile to be tightened.",
    };
  }

  if (nextField) {
    return {
      rank: 2,
      badge: "Next",
      actionLabel: "Open next step",
      badgeBg: "#f8fafc",
      badgeBorder: "var(--border)",
      badgeColor: "var(--slate)",
      helper: "Next: " + getFieldGuidanceLabel(nextField),
      reason: "This is the clearest next unlock for making the profile stronger.",
    };
  }

  return {
    rank: 3,
    badge: "Covered",
    actionLabel: "",
    badgeBg: "#f7faf7",
    badgeBorder: "rgba(58, 170, 122, 0.16)",
    badgeColor: "#246b4d",
    helper: "Section looks covered",
    reason: "Nothing urgent is missing in this section right now.",
  };
}

function getSectionNextField(section, data) {
  var fields = Array.isArray(section && section.fields) ? section.fields : [];
  return (
    fields.find(function (fieldName) {
      return !isSignupFieldFilled(data, fieldName);
    }) || ""
  );
}

function getRemainingSectionCount(config, data) {
  return (Array.isArray(config) ? config : []).filter(function (entry) {
    return Boolean(getSectionNextField(entry.section, data));
  }).length;
}

function getRemainingSectionMessage(remainingSections) {
  var mode = getSignupProgressMode();

  if (remainingSections <= 1) {
    if (mode === "revision") {
      return "This looks like the last major section to tighten before sending the revision back for review.";
    }
    if (mode === "confirmation") {
      return "This looks like the last major confirmation section to tighten before the next review step.";
    }
    return "This looks like the last major section to tighten before the next review step.";
  }

  if (remainingSections === 2) {
    if (mode === "revision") {
      return "After this, there is one more meaningful revision section still worth tightening.";
    }
    if (mode === "confirmation") {
      return "After this, there is one more meaningful confirmation section still worth tightening.";
    }
    return "After this, there is one more meaningful section still worth tightening.";
  }

  if (mode === "revision") {
    return (
      "After this, there are " +
      (remainingSections - 1) +
      " more meaningful revision sections still in the queue."
    );
  }
  if (mode === "confirmation") {
    return (
      "After this, there are " +
      (remainingSections - 1) +
      " more meaningful confirmation sections still in the queue."
    );
  }
  return (
    "After this, there are " +
    (remainingSections - 1) +
    " more meaningful sections still in the queue."
  );
}

function getFollowOnSectionMessage(entry) {
  if (!entry || !entry.section || !entry.meta) {
    return "";
  }

  var mode = getSignupProgressMode();
  var helper = String(entry.meta.helper || "").replace(/^Blocked on: |^Requested: |^Next: /, "");

  if (mode === "revision") {
    return "After this: next revision section is " + entry.section.title + " (" + helper + ")";
  }

  if (mode === "confirmation") {
    return "After this: next confirmation section is " + entry.section.title + " (" + helper + ")";
  }

  return "After this: " + entry.section.title + " (" + helper + ")";
}

function shouldFieldOpenFullProfile(fieldName) {
  return [
    "city",
    "state",
    "practice_name",
    "preferred_contact_method",
    "preferred_contact_label",
    "contact_guidance",
    "first_step_expectation",
    "booking_url",
    "bio",
    "care_approach",
    "specialties",
    "treatment_modalities",
    "estimated_wait_time",
    "telehealth_states",
    "insurance_accepted",
    "session_fee_min",
    "session_fee_max",
    "accepts_telehealth",
    "accepts_in_person",
    "therapist_reported_fields",
    "therapist_reported_confirmed_at",
    "sliding_scale",
  ].includes(fieldName);
}

function isSignupFieldFilled(data, fieldName) {
  if (!data || !fieldName) {
    return false;
  }

  if (fieldName === "session_fee_min") {
    return Boolean(data.session_fee_min || data.session_fee_max);
  }

  if (fieldName === "sliding_scale") {
    return Boolean(data.sliding_scale);
  }

  var value = data[fieldName];
  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === "boolean") {
    return value;
  }

  return String(value == null ? "" : value).trim().length > 0;
}

function ensureSectionProgressSnapshot() {
  var readinessSection = Array.from(document.querySelectorAll(".form-section")).find(
    function (section) {
      var heading = section.querySelector("h2");
      return (
        heading && heading.textContent && heading.textContent.indexOf("Match Readiness") !== -1
      );
    },
  );

  if (!readinessSection) {
    return null;
  }

  var existing = document.getElementById("signupSectionProgress");
  if (existing) {
    return existing;
  }

  var container = document.createElement("div");
  container.id = "signupSectionProgress";
  container.style.marginTop = "1rem";
  container.style.display = "grid";
  container.style.gap = "0.45rem";

  var priority = document.createElement("div");
  priority.id = "signupSectionPriority";
  priority.style.display = "none";
  priority.style.padding = "0.65rem 0.75rem";
  priority.style.borderRadius = "12px";
  priority.style.border = "1px solid var(--border)";
  priority.style.background = "#fbfdfe";
  priority.style.color = "var(--navy)";
  container.appendChild(priority);

  var list = document.createElement("div");
  list.id = "signupSectionProgressList";
  list.style.display = "grid";
  list.style.gap = "0.45rem";
  container.appendChild(list);

  readinessSection.appendChild(container);
  return container;
}

function renderSectionProgressSnapshot() {
  var form = document.getElementById("applyForm");
  var container = ensureSectionProgressSnapshot();
  if (!form || !container) {
    return;
  }

  var priority = document.getElementById("signupSectionPriority");
  var list = document.getElementById("signupSectionProgressList");
  if (!priority || !list) {
    return;
  }

  var data = collectFormData(form);
  clearResolvedSignupFocus(data);
  var config = getSectionProgressConfig()
    .map(function (section, index) {
      return {
        section: section,
        index: index,
        meta: getSectionPriorityMeta(section, data),
      };
    })
    .sort(function (left, right) {
      if (left.meta.rank !== right.meta.rank) {
        return left.meta.rank - right.meta.rank;
      }
      return left.index - right.index;
    });

  var topSection = config[0];
  if (topSection) {
    var topNextField = getSectionNextField(topSection.section, data);
    var followOnSection = config.find(function (entry, index) {
      return index > 0 && getSectionNextField(entry.section, data);
    });
    var remainingSections = getRemainingSectionCount(config, data);
    priority.style.display = "block";
    priority.style.borderColor = topSection.meta.badgeBorder;
    priority.style.background =
      topSection.meta.rank === 0
        ? "#fff8f8"
        : topSection.meta.rank === 1
          ? "rgba(232, 245, 248, 0.72)"
          : "#fbfdfe";
    priority.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem"><div><div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:' +
      topSection.meta.badgeColor +
      '">' +
      topSection.meta.badge +
      '</div><div style="font-size:0.92rem;font-weight:700;color:var(--navy);margin-top:0.12rem">' +
      topSection.section.title +
      '</div><div style="font-size:0.78rem;color:var(--slate);margin-top:0.18rem">' +
      topSection.meta.helper +
      '</div><div style="font-size:0.74rem;color:var(--muted);margin-top:0.16rem">' +
      topSection.meta.reason +
      "</div>" +
      '<div style="font-size:0.73rem;color:var(--muted);margin-top:0.22rem">' +
      getRemainingSectionMessage(remainingSections) +
      "</div>" +
      (followOnSection
        ? '<div style="font-size:0.73rem;color:var(--muted);margin-top:0.22rem">' +
          getFollowOnSectionMessage(followOnSection) +
          "</div>"
        : "") +
      "</div></div>" +
      (topNextField
        ? '<button type="button" id="signupSectionPriorityJump" class="btn-secondary" style="padding:0.45rem 0.7rem;font-size:0.76rem;white-space:nowrap">' +
          (topSection.meta.actionLabel || "Open section") +
          "</button>"
        : '<span style="font-size:0.76rem;font-weight:700;color:' +
          topSection.meta.badgeColor +
          ';white-space:nowrap">Covered</span>') +
      "</div>";
  } else {
    priority.style.display = "none";
    priority.innerHTML = "";
  }

  list.innerHTML = config
    .map(function (entry) {
      var section = entry.section;
      var meta = entry.meta;
      var completed = section.fields.filter(function (fieldName) {
        return isSignupFieldFilled(data, fieldName);
      }).length;
      var total = section.fields.length;
      var nextField = section.fields.find(function (fieldName) {
        return !isSignupFieldFilled(data, fieldName);
      });

      return (
        '<button type="button" data-section-focus="' +
        section.title +
        '" data-section-next-field="' +
        (nextField || "") +
        '" style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;width:100%;padding:0.6rem 0.75rem;border:1px solid ' +
        (lastValidationSection === section.title ? "rgba(229, 62, 62, 0.32)" : meta.badgeBorder) +
        ";border-radius:10px;background:" +
        (lastValidationSection === section.title ? "#fff8f8" : "#fff") +
        ';color:var(--navy);font:inherit;text-align:left;cursor:pointer;">' +
        '<span><strong style="font-size:0.82rem">' +
        section.title +
        '</strong><span style="display:block;font-size:0.76rem;color:var(--muted);margin-top:0.1rem">' +
        meta.helper +
        "</span></span>" +
        '<span style="display:flex;align-items:center;gap:0.55rem;justify-content:flex-end"><span style="display:inline-flex;align-items:center;padding:0.2rem 0.45rem;border-radius:999px;border:1px solid ' +
        meta.badgeBorder +
        ";background:" +
        meta.badgeBg +
        ";color:" +
        meta.badgeColor +
        ';font-size:0.68rem;font-weight:700;letter-spacing:0.03em;text-transform:uppercase">' +
        meta.badge +
        '</span><span style="font-size:0.78rem;color:var(--slate)">' +
        completed +
        "/" +
        total +
        "</span></span></button>"
      );
    })
    .join("");

  var priorityButton = document.getElementById("signupSectionPriorityJump");
  if (priorityButton && topSection) {
    priorityButton.addEventListener("click", function () {
      var nextField = getSectionNextField(topSection.section, data);
      if (!nextField) {
        return;
      }
      jumpToSignupField(nextField);
      refreshSignupWorkspace();
    });
  }

  list.querySelectorAll("[data-section-next-field]").forEach(function (button) {
    button.addEventListener("click", function () {
      var nextField = button.getAttribute("data-section-next-field");
      if (!nextField) {
        return;
      }
      jumpToSignupField(nextField);
      refreshSignupWorkspace();
    });
  });
}

function ensureProgressSnapshot() {
  var formSubmit = document.querySelector(".form-submit");
  var submitNote = document.querySelector(".submit-note");
  if (!formSubmit || !submitNote) {
    return null;
  }

  var snapshot = document.getElementById("signupProgressSnapshot");
  if (snapshot) {
    return snapshot;
  }

  snapshot = document.createElement("div");
  snapshot.id = "signupProgressSnapshot";
  snapshot.style.marginTop = "0.55rem";
  snapshot.style.display = "flex";
  snapshot.style.flexWrap = "wrap";
  snapshot.style.alignItems = "center";
  snapshot.style.gap = "0.65rem";
  snapshot.style.fontSize = "0.78rem";
  snapshot.style.color = "var(--slate)";

  var summary = document.createElement("div");
  summary.id = "signupProgressSnapshotSummary";
  snapshot.appendChild(summary);

  var jumpButton = document.createElement("button");
  jumpButton.type = "button";
  jumpButton.id = "signupProgressJump";
  jumpButton.className = "btn-secondary";
  jumpButton.style.padding = "0.45rem 0.7rem";
  jumpButton.style.fontSize = "0.78rem";
  jumpButton.textContent = "Jump to next field";
  jumpButton.addEventListener("click", function () {
    var form = document.getElementById("applyForm");
    var nextField = form ? getNextRecommendedField(collectFormData(form)) : null;
    if (!nextField) {
      return;
    }
    jumpToSignupField(nextField.field);
  });
  snapshot.appendChild(jumpButton);

  submitNote.insertAdjacentElement("afterend", snapshot);
  return snapshot;
}

function jumpToSignupField(fieldName) {
  if (!fieldName) {
    return;
  }

  updateSignupFocusParam(fieldName);

  if (shouldFieldOpenFullProfile(fieldName)) {
    openFullProfileDisclosure();
  }

  lastValidationSection = getFieldSectionTitle(fieldName);
  revealField(fieldName);
}

function getRequestedFocusField(data) {
  if (!activeRequestedFields.length) {
    return null;
  }

  var requestedField = activeRequestedFields.find(function (fieldName) {
    return !isFieldCoveredForReview(data, fieldName);
  });
  if (!requestedField) {
    return null;
  }

  return {
    field: requestedField,
    label: getRequestedFieldLabel(requestedField),
  };
}

function ensureActionStack() {
  var snapshot = ensureProgressSnapshot();
  if (!snapshot) {
    return null;
  }

  var stack = document.getElementById("signupActionStack");
  if (stack) {
    return stack;
  }

  stack = document.createElement("div");
  stack.id = "signupActionStack";
  stack.style.display = "flex";
  stack.style.flexWrap = "wrap";
  stack.style.gap = "0.45rem";
  stack.style.marginTop = "0.1rem";

  snapshot.insertAdjacentElement("afterend", stack);
  return stack;
}

function getSignupProgressMode() {
  if (revisionApplicationId) {
    return "revision";
  }
  if (confirmationTherapistSlug && !revisionApplicationId) {
    return "confirmation";
  }
  return "default";
}

function isNearReadyState(claimMissing, fullMissing) {
  return fullMissing.length <= 2 && claimMissing.length === 0;
}

function getActionStackState(claimMissing, fullMissing) {
  var mode = getSignupProgressMode();

  if (lastValidationTarget) {
    return "blocked";
  }

  if (fullMissing.length === 0) {
    return "ready";
  }

  if (isNearReadyState(claimMissing, fullMissing)) {
    if (mode === "revision") {
      return "revision_almost_ready";
    }
    if (mode === "confirmation") {
      return "confirmation_almost_ready";
    }
    return "almost_ready";
  }

  if (mode === "revision") {
    return "revision_building";
  }
  if (mode === "confirmation") {
    return "confirmation_building";
  }
  return "building";
}

function renderActionStack() {
  var form = document.getElementById("applyForm");
  var stack = ensureActionStack();
  if (!form || !stack) {
    return;
  }

  var data = collectFormData(form);
  clearResolvedSignupFocus(data);
  var claimMissing = getClaimMissingFields(data);
  var fullMissing = getFullProfileMissingFields(data);
  var nextField = getNextRecommendedField(data);
  var requestedFocus = getRequestedFocusField(data);
  var stackState = getActionStackState(claimMissing, fullMissing);
  var readiness = getProgressReadinessSignal(claimMissing, fullMissing);
  var actions = [];

  if (lastValidationTarget && !isSignupFieldFilled(data, lastValidationTarget)) {
    actions.push({
      label: "Fix blocker",
      detail: getFieldGuidanceLabel(lastValidationTarget),
      field: lastValidationTarget,
      accent: "#fff5f5",
      border: "rgba(229, 62, 62, 0.22)",
      color: "var(--red)",
    });
  }

  if (
    requestedFocus &&
    !actions.some(function (action) {
      return action.field === requestedFocus.field;
    })
  ) {
    actions.push({
      label:
        stackState === "revision_almost_ready"
          ? "Finish requested fix"
          : stackState === "ready"
            ? "Review requested fix"
            : "Reviewer focus",
      detail: (readiness.readyFor ? readiness.readyFor + ": " : "") + requestedFocus.label,
      field: requestedFocus.field,
      accent: "rgba(232, 245, 248, 0.88)",
      border: "rgba(26, 122, 143, 0.2)",
      color: "var(--teal-dark)",
    });
  }

  if (
    nextField &&
    !actions.some(function (action) {
      return action.field === nextField.field;
    })
  ) {
    actions.push({
      label:
        stackState === "almost_ready" ||
        stackState === "revision_almost_ready" ||
        stackState === "confirmation_almost_ready"
          ? "Final unlock"
          : stackState === "ready"
            ? "Ready to review"
            : "Best next step",
      detail: (readiness.readyFor ? readiness.readyFor + ": " : "") + nextField.label,
      field: nextField.field,
      accent:
        stackState === "almost_ready" ||
        stackState === "revision_almost_ready" ||
        stackState === "confirmation_almost_ready"
          ? "rgba(232, 245, 248, 0.88)"
          : "#f8fafc",
      border:
        stackState === "almost_ready" ||
        stackState === "revision_almost_ready" ||
        stackState === "confirmation_almost_ready"
          ? "rgba(26, 122, 143, 0.16)"
          : "var(--border)",
      color:
        stackState === "almost_ready" ||
        stackState === "revision_almost_ready" ||
        stackState === "confirmation_almost_ready"
          ? "var(--teal-dark)"
          : "var(--navy)",
    });
  }

  stack.innerHTML = actions
    .slice(0, 3)
    .map(function (action) {
      return (
        '<button type="button" data-action-field="' +
        action.field +
        '" style="display:inline-flex;align-items:flex-start;gap:0.45rem;padding:0.5rem 0.65rem;border:1px solid ' +
        action.border +
        ";border-radius:999px;background:" +
        action.accent +
        ";color:" +
        action.color +
        ';font:inherit;font-size:0.76rem;line-height:1.3;cursor:pointer;text-align:left;"><strong style="font-size:0.73rem;text-transform:uppercase;letter-spacing:0.03em">' +
        action.label +
        '</strong><span style="color:inherit;opacity:0.88">' +
        action.detail +
        "</span></button>"
      );
    })
    .join("");

  if (!actions.length) {
    stack.innerHTML =
      '<div style="display:inline-flex;align-items:center;gap:0.45rem;padding:0.5rem 0.7rem;border:1px solid ' +
      readiness.border +
      ";border-radius:999px;background:" +
      readiness.background +
      ";color:" +
      readiness.color +
      ';font-size:0.76rem;line-height:1.35"><strong style="font-size:0.73rem;text-transform:uppercase;letter-spacing:0.03em">' +
      readiness.label +
      '</strong><span style="color:inherit;opacity:0.9">' +
      (readiness.passiveMessage || readiness.readyFor || "No urgent fixes right now.") +
      "</span></div>";
  }

  stack.style.display = "flex";

  stack.querySelectorAll("[data-action-field]").forEach(function (button) {
    button.addEventListener("click", function () {
      jumpToSignupField(button.getAttribute("data-action-field"));
      refreshSignupWorkspace();
    });
  });
}

function getProgressPrioritySummary(data) {
  var nextField = getNextRecommendedField(data);
  var requestedFocus = getRequestedFocusField(data);
  var mode = getSignupProgressMode();

  if (lastValidationTarget && !isSignupFieldFilled(data, lastValidationTarget)) {
    return {
      tone: "Blocked right now",
      detail: "Finish " + getFieldGuidanceLabel(lastValidationTarget) + " to keep this moving.",
      actionLabel: "Fix blocker",
    };
  }

  if (requestedFocus) {
    return {
      tone: mode === "revision" ? "Reviewer focus" : "Priority field",
      detail: "Tighten " + requestedFocus.label + " next.",
      actionLabel: mode === "revision" ? "Jump to requested fix" : "Jump to priority field",
    };
  }

  if (nextField) {
    return {
      tone: mode === "confirmation" ? "Best confirmation step" : "Best next step",
      detail: "Finish " + nextField.label + " next.",
      actionLabel: "Jump to next field",
    };
  }

  return {
    tone: mode === "confirmation" ? "Confirmation looks covered" : "Profile looks covered",
    detail: "This draft looks ready for the next review step.",
    actionLabel: "",
  };
}

function getProgressReadinessSignal(claimMissing, fullMissing) {
  var mode = getSignupProgressMode();
  var hasBlocker = Boolean(lastValidationTarget);

  if (hasBlocker) {
    return {
      label: "Needs attention",
      readyFor: "",
      passiveMessage: "There is still an active blocker to resolve.",
      color: "var(--red)",
      background: "#fff5f5",
      border: "rgba(229, 62, 62, 0.18)",
    };
  }

  if (fullMissing.length === 0) {
    return {
      label:
        mode === "revision"
          ? "Revision ready"
          : mode === "confirmation"
            ? "Confirmation ready"
            : "Review-ready",
      readyFor:
        mode === "revision"
          ? "Ready for re-review"
          : mode === "confirmation"
            ? "Ready for confirmation review"
            : "Ready for review",
      passiveMessage:
        mode === "revision"
          ? "No urgent fixes left. This revision can go back for review."
          : mode === "confirmation"
            ? "No urgent fixes left. This confirmation update can go into review."
            : "No urgent fixes left. This profile looks ready for review.",
      color: "#246b4d",
      background: "#f3fbf6",
      border: "rgba(58, 170, 122, 0.18)",
    };
  }

  if (isNearReadyState(claimMissing, fullMissing)) {
    return {
      label:
        mode === "revision"
          ? "Almost ready to resubmit"
          : mode === "confirmation"
            ? "Almost ready to confirm"
            : "Almost ready",
      readyFor:
        mode === "revision"
          ? "Close to re-review"
          : mode === "confirmation"
            ? "Close to confirmation review"
            : "Close to review",
      passiveMessage:
        mode === "revision"
          ? "Only a small amount of revision work still stands between this draft and re-review."
          : mode === "confirmation"
            ? "Only a small amount of confirmation work still stands between this draft and review."
            : "Only a small amount of profile work still stands between this draft and review.",
      color: "var(--teal-dark)",
      background: "rgba(232, 245, 248, 0.88)",
      border: "rgba(26, 122, 143, 0.16)",
    };
  }

  return {
    label:
      mode === "revision"
        ? "Still tightening revision"
        : mode === "confirmation"
          ? "Still building confirmation"
          : "Still building",
    readyFor:
      mode === "revision"
        ? "Working toward re-review"
        : mode === "confirmation"
          ? "Working toward confirmation review"
          : "Working toward review",
    passiveMessage:
      mode === "revision"
        ? "Progress is saved and the revision is in a stable working state."
        : mode === "confirmation"
          ? "Progress is saved and the confirmation update is in a stable working state."
          : "Progress is saved and the profile is in a stable working state.",
    color: "var(--slate)",
    background: "#f8fafc",
    border: "var(--border)",
  };
}

function renderProgressSnapshot() {
  var form = document.getElementById("applyForm");
  var snapshot = ensureProgressSnapshot();
  if (!form || !snapshot) {
    return;
  }

  var summary = document.getElementById("signupProgressSnapshotSummary");
  var jumpButton = document.getElementById("signupProgressJump");
  if (!summary || !jumpButton) {
    return;
  }

  var data = collectFormData(form);
  clearResolvedSignupFocus(data);
  var claimMissing = getClaimMissingFields(data);
  var fullMissing = getFullProfileMissingFields(data);
  var claimStats = getClaimCompletionStats(claimMissing);
  var fullStats = getFullProfileCompletionStats(fullMissing);
  var nextField = getNextRecommendedField(data);
  var mode = getSignupProgressMode();
  var priority = getProgressPrioritySummary(data);
  var readiness = getProgressReadinessSignal(claimMissing, fullMissing);

  var parts = [
    "Claim basics " + claimStats.completed + "/" + claimStats.total,
    "Full profile " + fullStats.completed + "/" + fullStats.total,
  ];

  if (mode === "revision") {
    var revisionStats = getRevisionProgressStats(data);
    parts.push(
      "Requested review items " +
        revisionStats.improved +
        "/" +
        Math.max(revisionStats.requested, 1),
    );
  } else if (mode === "confirmation") {
    var confirmationStats = getConfirmationProgressStats(data);
    parts.push(
      "Confirmation targets " +
        confirmationStats.covered +
        "/" +
        Math.max(confirmationStats.requested, 1),
    );
  }

  summary.innerHTML =
    '<span style="display:inline-flex;align-items:center;padding:0.16rem 0.45rem;border-radius:999px;border:1px solid ' +
    readiness.border +
    ";background:" +
    readiness.background +
    ";color:" +
    readiness.color +
    ';font-size:0.7rem;font-weight:700;letter-spacing:0.03em;text-transform:uppercase;margin-right:0.4rem">' +
    readiness.label +
    "</span>" +
    (readiness.readyFor
      ? '<span style="color:var(--muted);font-size:0.76rem;margin-right:0.4rem">' +
        readiness.readyFor +
        "</span>"
      : "") +
    '<strong style="color:var(--navy)">' +
    priority.tone +
    ":</strong> " +
    priority.detail +
    '<span style="display:block;margin-top:0.18rem">' +
    parts.join("  •  ") +
    "</span>";
  jumpButton.style.display = nextField ? "inline-flex" : "none";
  jumpButton.textContent = priority.actionLabel || "Jump to next field";
  jumpButton.title = nextField ? priority.detail : "Everything currently looks covered";
}

function configureSecondaryAction() {
  var claimButton = document.getElementById("claimBtn");
  if (!claimButton) {
    return;
  }

  var mode = getSignupProgressMode();

  if (mode !== "default") {
    claimButton.type = "button";
    claimButton.dataset.secondaryMode = "save-draft";
    claimButton.removeAttribute("data-submit-intent");
  } else {
    claimButton.type = "submit";
    claimButton.dataset.secondaryMode = "submit-claim";
    claimButton.dataset.submitIntent = "claim";
  }
}

function renderCompletionNudges() {
  var form = document.getElementById("applyForm");
  var submitNote = document.querySelector(".submit-note");
  var claimButton = document.getElementById("claimBtn");
  var submitButton = document.getElementById("submitBtn");
  if (!form || !submitNote || !claimButton || !submitButton) {
    return;
  }

  var data = collectFormData(form);
  clearResolvedSignupFocus(data);
  var claimMissing = getClaimMissingFields(data);
  var fullMissing = getFullProfileMissingFields(data);
  var claimReady = claimMissing.length === 0;
  var fullReady = fullMissing.length === 0;
  var claimStats = getClaimCompletionStats(claimMissing);
  var fullStats = getFullProfileCompletionStats(fullMissing);
  var mode = getSignupProgressMode();
  var requestedField = activeRequestedFields.length ? activeRequestedFields[0] : "";
  var requestedLabel = requestedField ? getRequestedFieldLabel(requestedField) : "";
  var revisionStats = mode === "revision" ? getRevisionProgressStats(data) : null;
  var confirmationStats = mode === "confirmation" ? getConfirmationProgressStats(data) : null;
  var nextField = getNextRecommendedField(data);
  var nextFieldLabel = nextField ? nextField.label : "";

  configureSecondaryAction();
  refreshSignupWorkspace();

  if (mode === "revision") {
    submitNote.textContent = requestedLabel
      ? fullReady
        ? "Requested revisions look covered. This update is ready to send back for review."
        : "Reviewer focus: tighten " +
          requestedLabel +
          " next. Progress: " +
          revisionStats.improved +
          "/" +
          Math.max(revisionStats.requested, 1) +
          " requested review items improved, " +
          fullStats.completed +
          "/" +
          fullStats.total +
          " fuller-profile checkpoints covered."
      : fullReady
        ? "This revision looks ready to send back for review."
        : "Keep working through the requested profile details so this revision is ready for another pass. Progress: " +
          revisionStats.improved +
          "/" +
          Math.max(revisionStats.requested, 1) +
          " requested review items improved, " +
          fullStats.completed +
          "/" +
          fullStats.total +
          " fuller-profile checkpoints covered.";
    if (lastValidationTarget && nextFieldLabel) {
      submitNote.textContent += " Current blocker: " + nextFieldLabel + ".";
    }
    submitNote.textContent += getDraftStatusSuffix();
    claimButton.textContent = "Save Progress";
    submitButton.textContent = fullReady ? "Submit Updated Profile" : "Keep Tightening Revision";
    claimButton.title = "Save your current revision progress in this browser";
    submitButton.title = fullReady
      ? "Submit the updated profile for review"
      : requestedLabel
        ? "Reviewer focus: " + requestedLabel
        : "Best next unlock: " + fullMissing[0].label;
    return;
  }

  if (mode === "confirmation") {
    submitNote.textContent = fullReady
      ? "Confirmation update looks ready. This version clearly covers the higher-value operational details."
      : "For this confirmation update, the next highest-value detail is " +
        fullMissing[0].label +
        ". Progress: " +
        confirmationStats.covered +
        "/" +
        Math.max(confirmationStats.requested, 1) +
        " confirmation targets covered, " +
        fullStats.completed +
        "/" +
        fullStats.total +
        " fuller-profile checkpoints covered.";
    if (lastValidationTarget && nextFieldLabel) {
      submitNote.textContent += " Current blocker: " + nextFieldLabel + ".";
    }
    submitNote.textContent += getDraftStatusSuffix();
    claimButton.textContent = "Save Progress";
    submitButton.textContent = fullReady
      ? "Submit Confirmation Update"
      : "Keep Building Confirmation Update";
    claimButton.title = "Save your current confirmation progress in this browser";
    submitButton.title = fullReady
      ? "Submit this confirmation update"
      : "Best next unlock: " + fullMissing[0].label;
    return;
  }

  if (fullReady) {
    submitNote.textContent =
      "Full profile looks ready to submit. This version has the core trust, fit, and contact details needed for review.";
  } else if (claimReady) {
    submitNote.textContent =
      "Free claim is ready now (" +
      claimStats.completed +
      "/" +
      claimStats.total +
      "). Best next unlock for the full profile: " +
      fullMissing[0].label +
      ". Full profile progress: " +
      fullStats.completed +
      "/" +
      fullStats.total +
      ".";
  } else {
    submitNote.textContent =
      "Best next step for the free claim: " +
      claimMissing[0].label +
      ". Claim progress: " +
      claimStats.completed +
      "/" +
      claimStats.total +
      ". After that, the next fuller-profile unlocks are " +
      formatMissingFieldSummary(fullMissing, 2) +
      ".";
  }
  if (lastValidationTarget && nextFieldLabel) {
    submitNote.textContent += " Current blocker: " + nextFieldLabel + ".";
  }
  submitNote.textContent += getDraftStatusSuffix();

  claimButton.textContent = claimReady ? "Save Free Claim" : "Finish Claim Basics";
  submitButton.textContent = fullReady ? "Submit Full Profile" : "Keep Building Full Profile";

  claimButton.title = claimReady ? "Save the free claim" : "Still needed: " + claimMissing[0].label;
  submitButton.title = fullReady
    ? "Submit the full profile for review"
    : "Best next unlock: " + fullMissing[0].label;
}

function getBlockingValidationIssue(data, submitIntent) {
  var isClaim = submitIntent === "claim";
  var mode = getSignupProgressMode();
  var claimMissing = getClaimMissingFields(data);
  var fullMissing = getFullProfileMissingFields(data);

  if (claimMissing.length) {
    return {
      message:
        (mode === "revision" ? "Claim basics still need attention. " : "") +
        buildMissingFieldMessage(claimMissing, "Complete the claim basics."),
      fieldName: claimMissing[0].field,
      shouldOpenFullProfile: false,
    };
  }

  if (!isClaim && fullMissing.length) {
    return {
      message:
        (mode === "revision"
          ? "This revision still needs a few profile details before it is ready for another review pass. "
          : mode === "confirmation"
            ? "This confirmation update still needs a few higher-value details. "
            : "This fuller profile still needs a few details before it is review-ready. ") +
        buildMissingFieldMessage(fullMissing, "Complete the next profile details."),
      fieldName: fullMissing[0].field,
      shouldOpenFullProfile: true,
    };
  }

  return null;
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
  lastValidationTarget = "";
  lastValidationSection = "";
  if (form.elements.submission_intent) {
    form.elements.submission_intent.value = submitIntent === "claim" ? "claim" : "full_profile";
  }

  var data = collectFormData(form);
  var blockingIssue = getBlockingValidationIssue(data, submitIntent);

  if (blockingIssue) {
    return showValidationError(
      blockingIssue.message,
      blockingIssue.fieldName,
      blockingIssue.shouldOpenFullProfile,
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
    renderCompletionNudges();
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

function applyDraftData(form, draft) {
  if (!form || !draft || !draft.fields) {
    return false;
  }

  var fields = draft.fields;
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
    "photo_source_type",
    "therapist_reported_confirmed_at",
  ].forEach(function (fieldName) {
    setFieldValue(form, fieldName, fields[fieldName]);
  });

  setFieldValue(form, "languages", (fields.languages || []).join(", "));
  setFieldValue(form, "telehealth_states", (fields.telehealth_states || []).join(", "));
  setCheckedValues(form, "specialties", fields.specialties);
  setCheckedValues(form, "treatment_modalities", fields.treatment_modalities);
  setCheckedValues(form, "client_populations", fields.client_populations);
  setCheckedValues(form, "insurance_accepted", fields.insurance_accepted);
  setCheckedValues(form, "therapist_reported_fields", fields.therapist_reported_fields);
  setFieldValue(form, "sliding_scale", fields.sliding_scale);
  setFieldValue(form, "accepts_telehealth", fields.accepts_telehealth);
  setFieldValue(form, "accepts_in_person", fields.accepts_in_person);
  setFieldValue(form, "medication_management", fields.medication_management);
  setFieldValue(form, "photo_usage_permission_confirmed", fields.photo_usage_permission_confirmed);

  if (draft.submission_intent && form.elements.submission_intent) {
    form.elements.submission_intent.value = draft.submission_intent;
  }

  if (draft.full_profile_open) {
    openFullProfileDisclosure();
  }

  return true;
}

function restoreSignupDraft() {
  var form = document.getElementById("applyForm");
  var draft = readSignupDraft();
  if (!form || !draft) {
    return;
  }

  if (!applyDraftData(form, draft)) {
    return;
  }

  setDraftStatus("Draft restored");

  var nextField = getNextRecommendedField(collectFormData(form));

  var formError = document.getElementById("formError");
  if (formError) {
    showFormBanner(
      "Restored your saved draft from this browser" +
        (draft.saved_at ? " (" + new Date(draft.saved_at).toLocaleString() + ")." : ".") +
        (nextField
          ? " Best next step: " + nextField.label + "."
          : " This draft looks ready to submit."),
      "info",
    );
  }

  if (nextField) {
    window.setTimeout(function () {
      jumpToSignupField(nextField.field);
    }, 120);
  }
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

var claimButton = document.getElementById("claimBtn");
if (claimButton) {
  claimButton.addEventListener("click", function (event) {
    if (claimButton.dataset.secondaryMode !== "save-draft") {
      return;
    }

    event.preventDefault();
    saveSignupDraft();
    renderCompletionNudges();

    var formError = document.getElementById("formError");
    if (formError) {
      showFormBanner(
        "Progress saved in this browser. You can come back and finish this later.",
        "success",
      );
    }
  });
}

async function initSignupContext() {
  await loadRevisionContext();
  await loadConfirmationContext();
  restoreSignupDraft();
}

initSignupContext();
var fullProfileDisclosure = document.getElementById("fullProfileDetails");
if (fullProfileDisclosure) {
  fullProfileDisclosure.addEventListener("toggle", syncFullProfileDisclosure);
  syncFullProfileDisclosure();
}
applySignupFocusField();
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
document.getElementById("applyForm").addEventListener("input", renderCompletionNudges);
document.getElementById("applyForm").addEventListener("change", renderCompletionNudges);
document.getElementById("applyForm").addEventListener("input", scheduleSignupDraftSave);
document.getElementById("applyForm").addEventListener("change", scheduleSignupDraftSave);
document.getElementById("applyForm").addEventListener("input", handleFieldCalloutProgress);
document.getElementById("applyForm").addEventListener("change", handleFieldCalloutProgress);
renderReadiness();
renderFieldCoaching();
renderPhotoUploadStatus();
renderCompletionNudges();
refreshSignupWorkspace();

window.addEventListener("beforeunload", saveSignupDraft);
document.addEventListener("visibilitychange", function () {
  if (document.visibilityState === "hidden") {
    saveSignupDraft();
  }
});

window.handleSubmit = handleSubmit;
