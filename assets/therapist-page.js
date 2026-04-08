import { fetchPublicTherapistBySlug, fetchPublicTherapists } from "./cms.js";
import {
  getDataFreshnessSummary,
  getEditoriallyVerifiedOperationalCount,
  getOperationalTrustSummary,
  getRecentAppliedSummary,
  getRecentConfirmationSummary,
  getTherapistMatchReadiness,
} from "./matching-model.js";
import { getPublicResponsivenessSignal } from "./responsiveness-signal.js";

var slug = new URLSearchParams(window.location.search).get("slug");
var DIRECTORY_SHORTLIST_KEY = "bth_directory_shortlist_v1";
var SHORTLIST_PRIORITY_OPTIONS = ["Best fit", "Best availability", "Best value"];

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderTagList(items, className) {
  return (items || [])
    .filter(Boolean)
    .map(function (item) {
      return '<span class="' + className + '">' + escapeHtml(item) + "</span>";
    })
    .join("");
}

function renderList(items, className) {
  return (items || [])
    .filter(Boolean)
    .map(function (item) {
      return '<div class="' + className + '">' + escapeHtml(item) + "</div>";
    })
    .join("");
}

function formatSourceDate(value) {
  if (!value) {
    return "";
  }

  var date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getSourceHostLabel(value) {
  if (!value) {
    return "";
  }

  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch (_error) {
    return "";
  }
}

function readShortlist() {
  try {
    return normalizeShortlist(
      JSON.parse(window.localStorage.getItem(DIRECTORY_SHORTLIST_KEY) || "[]"),
    );
  } catch (_error) {
    return [];
  }
}

function normalizeShortlist(value) {
  return (Array.isArray(value) ? value : [])
    .map(function (item) {
      if (typeof item === "string") {
        return {
          slug: item,
          priority: "",
          note: "",
        };
      }
      if (!item || !item.slug) {
        return null;
      }
      return {
        slug: String(item.slug),
        priority: String(item.priority || ""),
        note: String(item.note || ""),
      };
    })
    .filter(Boolean)
    .slice(0, 3);
}

function writeShortlist(value) {
  try {
    window.localStorage.setItem(DIRECTORY_SHORTLIST_KEY, JSON.stringify(value));
  } catch (_error) {
    return;
  }
}

function toggleShortlist(slugValue) {
  var shortlist = readShortlist();
  if (
    shortlist.some(function (item) {
      return item.slug === slugValue;
    })
  ) {
    var next = shortlist.filter(function (item) {
      return item.slug !== slugValue;
    });
    writeShortlist(next);
    return false;
  }

  var appended = shortlist.concat({ slug: slugValue, priority: "", note: "" }).slice(0, 3);
  writeShortlist(appended);
  return true;
}

function updateShortlistPriority(slugValue, priority) {
  writeShortlist(
    readShortlist().map(function (item) {
      if (item.slug !== slugValue) {
        return item;
      }
      return {
        slug: item.slug,
        priority: priority,
        note: item.note || "",
      };
    }),
  );
}

function updateShortlistNote(slugValue, note) {
  writeShortlist(
    readShortlist().map(function (item) {
      if (item.slug !== slugValue) {
        return item;
      }
      return {
        slug: item.slug,
        priority: item.priority || "",
        note: String(note || "")
          .trim()
          .slice(0, 120),
      };
    }),
  );
}

function updateShortlistAction(slugValue) {
  var button = document.getElementById("profileShortlistButton");
  var status = document.getElementById("profileShortlistStatus");
  if (!button || !status) {
    return;
  }

  var shortlistEntry = readShortlist().find(function (item) {
    return item.slug === slugValue;
  });
  var shortlisted = !!shortlistEntry;
  button.textContent = shortlisted ? "Saved to shortlist" : "Save to shortlist";
  button.classList.toggle("is-saved", shortlisted);
  status.textContent = shortlisted
    ? "This therapist is saved for comparison in your shortlist."
    : "Save up to 3 therapists to compare later as you narrow toward the right fit.";

  var priorityWrap = document.getElementById("profileShortlistPriorityWrap");
  var prioritySelect = document.getElementById("profileShortlistPriority");
  var noteInput = document.getElementById("profileShortlistNote");
  if (priorityWrap && prioritySelect && noteInput) {
    priorityWrap.style.display = shortlisted ? "block" : "none";
    prioritySelect.value = shortlistEntry ? shortlistEntry.priority : "";
    noteInput.value = shortlistEntry ? shortlistEntry.note : "";
  }
}

async function resolveTherapistForProfile(slugValue) {
  var exact = await fetchPublicTherapistBySlug(slugValue);
  if (exact) {
    return exact;
  }

  var normalizedSlug = String(slugValue || "")
    .trim()
    .toLowerCase();
  if (!normalizedSlug) {
    return null;
  }

  var therapists = await fetchPublicTherapists();
  return (
    therapists.find(function (item) {
      var itemSlug = String((item && item.slug) || "").toLowerCase();
      return itemSlug === normalizedSlug || itemSlug.indexOf(normalizedSlug + "-") === 0;
    }) || null
  );
}

(async function init() {
  if (!slug) {
    document.getElementById("profileWrap").innerHTML =
      '<div class="not-found"><h2>No therapist specified</h2><p>Please return to the directory and choose a bipolar-informed therapist profile to review.</p><a href="directory.html" class="back-link">← Back to Directory</a></div>';
    return;
  }

  var therapist = await resolveTherapistForProfile(slug);
  if (!therapist) {
    document.getElementById("profileWrap").innerHTML =
      '<div class="not-found"><h2>Therapist not found</h2><p>This profile may no longer be active, or the link may be incorrect. You can return to the directory to compare other bipolar-informed options.</p><a href="directory.html" class="back-link">← Back to Directory</a></div>';
    return;
  }

  renderProfile(therapist);
})();

function renderProfile(t) {
  var readiness = getTherapistMatchReadiness(t);
  var freshness = getDataFreshnessSummary(t);
  var recentApplied = getRecentAppliedSummary(t);
  var recentConfirmation = getRecentConfirmationSummary(t);
  var responsivenessSignal = getPublicResponsivenessSignal(t);
  var readinessTitle =
    readiness.score >= 85
      ? "High match confidence"
      : readiness.score >= 65
        ? "Good match confidence"
        : "Profile still being completed";
  var readinessCopy =
    readiness.score >= 85
      ? "This profile includes the details people usually need to make a confident shortlist decision."
      : readiness.score >= 65
        ? "This profile covers most of the practical and clinical details people usually compare."
        : "Some practical details are still limited, so it may be worth double-checking fit before deciding.";
  var fitReasons = [];
  if (t.verification_status === "editorially_verified") {
    fitReasons.push("editorial verification is in place");
  }
  if (getEditoriallyVerifiedOperationalCount(t) >= 2) {
    fitReasons.push("multiple access details have been editor-verified");
  }
  if (Number(t.bipolar_years_experience || 0) >= 8) {
    fitReasons.push("they have substantial bipolar-specific experience");
  }
  if (t.medication_management) {
    fitReasons.push("they offer medication-management support");
  }
  if (t.accepting_new_patients) {
    fitReasons.push("they appear to be accepting new patients");
  }
  if (t.accepts_telehealth) {
    fitReasons.push("they offer telehealth access");
  }
  if (responsivenessSignal && responsivenessSignal.tone === "positive") {
    fitReasons.push("earlier outreach patterns suggest stronger follow-through");
  }
  var fitSummaryCopy = fitReasons.length
    ? "This clinician may be worth shortlisting because " +
      fitReasons.slice(0, 3).join(", ") +
      ". You should still confirm availability, insurance, and personal fit directly."
    : "Use this profile to compare reviewed details, access, and bipolar-related fit before deciding on the next step. You should still confirm availability, insurance, and personal fit directly.";
  var likelyFitAudience = [];
  if (t.medication_management) {
    likelyFitAudience.push("people who may need psychiatry or medication support");
  } else if ((t.client_populations || []).length) {
    likelyFitAudience.push(
      "people looking for " + String(t.client_populations[0] || "").toLowerCase() + " support",
    );
  }
  if ((t.specialties || []).includes("Bipolar I")) {
    likelyFitAudience.push("bipolar I care");
  } else if ((t.specialties || []).includes("Bipolar II")) {
    likelyFitAudience.push("bipolar II care");
  } else if ((t.specialties || []).length) {
    likelyFitAudience.push(String(t.specialties[0] || "").toLowerCase() + " care");
  }
  if (t.accepts_telehealth) {
    likelyFitAudience.push("telehealth access");
  }
  var reviewedDetails = [];
  if (t.verification_status === "editorially_verified") {
    reviewedDetails.push("license and location");
    reviewedDetails.push("care format and availability details");
    reviewedDetails.push("public contact path");
  }
  if (t.contact_guidance || t.first_step_expectation) {
    reviewedDetails.push("first-contact guidance");
  }
  var reviewedDetailsCopy = reviewedDetails.length
    ? "Reviewed details currently include " +
      reviewedDetails.slice(0, 3).join(", ") +
      ". This is a trust and clarity check, not a quality rating."
    : "This profile includes useful reviewed details, but some details may still need direct confirmation.";
  var operationalTrustSummary = getOperationalTrustSummary(t);
  var standoutReasons = [];
  if (t.verification_status === "editorially_verified") {
    standoutReasons.push("editorial review is already in place");
  }
  if (getEditoriallyVerifiedOperationalCount(t) >= 2) {
    standoutReasons.push("multiple operational details are editor-verified");
  }
  if (Number(t.bipolar_years_experience || 0) >= 8) {
    standoutReasons.push("bipolar-specific experience is clearly documented");
  }
  if (t.medication_management) {
    standoutReasons.push("psychiatry or medication support is available");
  }
  if (t.accepting_new_patients && t.estimated_wait_time) {
    standoutReasons.push("availability context is clearer than usual");
  }
  var standoutCopy = standoutReasons.length
    ? "What looks especially strong on this profile right now: " +
      standoutReasons.slice(0, 3).join(", ") +
      "."
    : "This profile is most useful when you want a clearer picture of fit, reachability, and next-step logistics before reaching out.";
  var reachabilityCopy =
    t.accepting_new_patients && t.estimated_wait_time
      ? "Reachability looks relatively strong here: the profile shows a clear contact path, indicates new-patient availability, and includes a recent availability note suggesting " +
        t.estimated_wait_time.toLowerCase() +
        " timing."
      : t.accepting_new_patients
        ? "Reachability looks relatively strong here: the profile suggests this clinician is accepting new patients and gives a clear next step."
        : t.estimated_wait_time
          ? "Reachability is partly clear here: the profile includes availability context, but live openings should still be confirmed directly."
          : "Reachability is moderate here: the contact path is clear, but live timing still needs direct confirmation.";
  document.title = t.name + " — BipolarTherapyHub";
  document.getElementById("breadcrumbName").textContent = t.name;
  var navClaimLink = document.getElementById("navClaimLink");
  var footerClaimLink = document.getElementById("footerClaimLink");
  if (navClaimLink) {
    navClaimLink.href = "signup.html?confirm=" + encodeURIComponent(t.slug);
  }
  if (footerClaimLink) {
    footerClaimLink.href = "signup.html?confirm=" + encodeURIComponent(t.slug);
  }

  var initials = (t.name || "")
    .split(" ")
    .map(function (n) {
      return n[0];
    })
    .join("")
    .substring(0, 2);
  var avatar = t.photo_url
    ? '<img src="' + escapeHtml(t.photo_url) + '" alt="' + escapeHtml(t.name) + '" />'
    : escapeHtml(initials);

  var acceptingBadge = t.accepting_new_patients
    ? '<span class="status-badge badge-accepting">Accepting new patients</span>'
    : '<span class="status-badge badge-waitlist">Waitlist only</span>';

  var trustPills = [
    t.verification_status === "editorially_verified"
      ? "Editorially verified"
      : "Profile under review",
    t.bipolar_years_experience ? t.bipolar_years_experience + " yrs bipolar care" : "",
    readinessTitle,
    t.medication_management ? "Medication management" : "",
    t.accepts_telehealth ? "Telehealth available" : "",
  ]
    .filter(Boolean)
    .map(function (pill) {
      return '<span class="trust-pill">' + escapeHtml(pill) + "</span>";
    })
    .join("");

  var contactBtns = "";
  var primaryContactLabel = String(t.preferred_contact_label || "").trim();
  var contactGuidance = String(t.contact_guidance || "").trim();
  var firstStepExpectation = String(t.first_step_expectation || "").trim();
  var therapistReportedFields = Array.isArray(t.therapist_reported_fields)
    ? t.therapist_reported_fields
    : [];
  var therapistReportedDate = formatSourceDate(t.therapist_reported_confirmed_at);
  var sourceReviewedDate = formatSourceDate(t.source_reviewed_at);
  var sourceHost = getSourceHostLabel(t.source_url);
  var supportingSourceCount = Array.isArray(t.supporting_source_urls)
    ? t.supporting_source_urls.filter(Boolean).length
    : 0;
  var contactRouteLabel =
    t.preferred_contact_method === "booking"
      ? "Use the booking link"
      : t.preferred_contact_method === "website"
        ? "Reach out through the practice website"
        : t.preferred_contact_method === "phone"
          ? "Call the practice"
          : t.preferred_contact_method === "email"
            ? "Email the therapist"
            : "Reach out using the listed contact method";
  function buildPreferredContactButton() {
    if (t.preferred_contact_method === "booking" && t.booking_url) {
      return (
        '<a href="' +
        escapeHtml(t.booking_url) +
        '" target="_blank" rel="noopener" class="btn-contact">' +
        escapeHtml(primaryContactLabel || "Book consultation") +
        "</a>"
      );
    }
    if (t.preferred_contact_method === "website" && t.website) {
      return (
        '<a href="' +
        escapeHtml(t.website) +
        '" target="_blank" rel="noopener" class="btn-contact">' +
        escapeHtml(primaryContactLabel || "Visit website") +
        "</a>"
      );
    }
    if (t.preferred_contact_method === "phone" && t.phone) {
      return (
        '<a href="tel:' +
        escapeHtml(t.phone) +
        '" class="btn-contact">' +
        escapeHtml(primaryContactLabel || "Call " + t.phone) +
        "</a>"
      );
    }
    if (t.email && t.email !== "contact@example.com") {
      return (
        '<a href="mailto:' +
        escapeHtml(t.email) +
        '" class="btn-contact">' +
        escapeHtml(primaryContactLabel || "Email") +
        "</a>"
      );
    }
    return "";
  }
  contactBtns +=
    '<button type="button" class="btn-website shortlist-profile-btn" id="profileShortlistButton">Save to shortlist</button>';
  contactBtns += buildPreferredContactButton();
  contactBtns +=
    '<a href="portal.html?slug=' +
    encodeURIComponent(t.slug) +
    '" class="btn-website btn-contact-secondary">Claim or manage profile</a>';
  if (t.phone && t.preferred_contact_method !== "phone") {
    contactBtns +=
      '<a href="tel:' +
      escapeHtml(t.phone) +
      '" class="btn-contact btn-contact-secondary">Call ' +
      escapeHtml(t.phone) +
      "</a>";
  }
  if (t.email && t.email !== "contact@example.com" && t.preferred_contact_method !== "email") {
    contactBtns +=
      '<a href="mailto:' +
      escapeHtml(t.email) +
      '" class="btn-contact btn-contact-secondary">Email</a>';
  }
  if (t.website && t.preferred_contact_method !== "website") {
    contactBtns +=
      '<a href="' +
      escapeHtml(t.website) +
      '" target="_blank" rel="noopener" class="btn-website">Visit website</a>';
  }
  if (t.booking_url && t.preferred_contact_method !== "booking") {
    contactBtns +=
      '<a href="' +
      escapeHtml(t.booking_url) +
      '" target="_blank" rel="noopener" class="btn-website">Booking link</a>';
  }

  var specialties = renderTagList(t.specialties, "spec-tag");
  var modalities = renderTagList(t.treatment_modalities, "spec-tag");
  var populations = renderTagList(t.client_populations, "spec-tag");
  var insTags = renderList(t.insurance_accepted, "ins-item");
  var langPills = renderTagList(t.languages || ["English"], "lang-pill");
  var telehealthStates = renderTagList(t.telehealth_states, "lang-pill");
  var therapistReportedCopy = therapistReportedFields.length
    ? "Some operational details here were confirmed directly by the specialist" +
      (therapistReportedDate ? " on " + therapistReportedDate : "") +
      ", including " +
      therapistReportedFields.join(", ").replace(/_/g, " ") +
      "."
    : "";
  var sourceReviewCopy = sourceReviewedDate
    ? "This profile was last reviewed against public sources on " +
      sourceReviewedDate +
      (sourceHost ? ", with " + sourceHost + " as the primary source" : "") +
      (supportingSourceCount
        ? " and " +
          supportingSourceCount +
          " supporting source" +
          (supportingSourceCount > 1 ? "s" : "")
        : "") +
      "."
    : "";

  var feesHtml = "";
  if (t.session_fee_min || t.session_fee_max) {
    feesHtml =
      '<div class="fee-range">$' +
      escapeHtml(t.session_fee_min || "") +
      (t.session_fee_max ? "–$" + escapeHtml(t.session_fee_max) : "") +
      "/session</div>";
    if (t.sliding_scale) {
      feesHtml += '<div class="fee-note">Sliding scale available</div>';
    }
  } else if (t.sliding_scale) {
    feesHtml = '<div class="fee-note">Sliding scale available. Contact for fee details.</div>';
  } else {
    feesHtml = '<div class="fee-note">Contact for fee details.</div>';
  }
  var bestNextStepCopy =
    firstStepExpectation ||
    "After first contact, the next step is usually a brief fit conversation or intake review before a full appointment is scheduled.";
  var primaryButton = buildPreferredContactButton();

  var secondaryButtons =
    '<button type="button" class="btn-website shortlist-profile-btn" id="profileShortlistButton">Save to shortlist</button>';
  if (t.phone && t.preferred_contact_method !== "phone") {
    secondaryButtons +=
      '<a href="tel:' + escapeHtml(t.phone) + '" class="btn-website">Call practice</a>';
  }
  if (t.email && t.email !== "contact@example.com" && t.preferred_contact_method !== "email") {
    secondaryButtons +=
      '<a href="mailto:' + escapeHtml(t.email) + '" class="btn-website">Email</a>';
  }
  if (t.website && t.preferred_contact_method !== "website") {
    secondaryButtons +=
      '<a href="' +
      escapeHtml(t.website) +
      '" target="_blank" rel="noopener" class="btn-website">Visit website</a>';
  }
  if (t.booking_url && t.preferred_contact_method !== "booking") {
    secondaryButtons +=
      '<a href="' +
      escapeHtml(t.booking_url) +
      '" target="_blank" rel="noopener" class="btn-website">Booking link</a>';
  }
  secondaryButtons +=
    '<a href="portal.html?slug=' +
    encodeURIComponent(t.slug) +
    '" class="btn-website">Claim or manage profile</a>';

  contactBtns =
    '<div class="profile-actions-header"><div class="profile-actions-kicker">Best next step</div><div class="profile-actions-title">' +
    escapeHtml(primaryContactLabel || contactRouteLabel) +
    "</div></div>" +
    '<div class="profile-primary-action">' +
    (primaryButton || '<a href="directory.html" class="btn-contact">Back to directory</a>') +
    '<div class="profile-primary-caption">' +
    escapeHtml(bestNextStepCopy) +
    "</div></div>" +
    '<div class="profile-secondary-actions"><div class="profile-secondary-label">More ways to act</div>' +
    secondaryButtons +
    "</div>";

  var html =
    '<div class="profile-header">' +
    '<div class="profile-hero-main"><div class="profile-identity"><div class="avatar">' +
    avatar +
    '</div><div class="profile-main"><div class="eyebrow">Bipolar-informed therapist profile</div>' +
    "<h1>" +
    escapeHtml(t.name) +
    "</h1>" +
    (t.credentials ? '<div class="creds">' + escapeHtml(t.credentials) + "</div>" : "") +
    (t.title ? '<div class="title-text">' + escapeHtml(t.title) + "</div>" : "") +
    (t.practice_name
      ? '<div class="title-text practice-line">' + escapeHtml(t.practice_name) + "</div>"
      : "") +
    '<div class="location">📍 ' +
    escapeHtml(t.city) +
    ", " +
    escapeHtml(t.state) +
    (t.zip ? " " + escapeHtml(t.zip) : "") +
    "</div>" +
    '<div class="hero-meta">' +
    acceptingBadge +
    (trustPills ? '<div class="trust-pills">' + trustPills + "</div>" : "") +
    "</div>" +
    '<div class="profile-shortlist-status" id="profileShortlistStatus"></div>' +
    '<div class="profile-shortlist-priority" id="profileShortlistPriorityWrap" style="display:none"><label for="profileShortlistPriority">Shortlist label</label><select id="profileShortlistPriority"><option value="">No label yet</option>' +
    SHORTLIST_PRIORITY_OPTIONS.map(function (option) {
      return '<option value="' + escapeHtml(option) + '">' + escapeHtml(option) + "</option>";
    }).join("") +
    '</select><label for="profileShortlistNote" style="margin-top:0.7rem">Personal note</label><input id="profileShortlistNote" type="text" maxlength="120" placeholder="Add a quick reminder..." /></div>' +
    "</div></div>" +
    '<div class="hero-summary-grid"><div class="hero-summary-card"><div class="hero-summary-label">Why this may be worth considering</div><p>' +
    escapeHtml(fitSummaryCopy) +
    '</p></div><div class="hero-summary-card"><div class="hero-summary-label">Best next step</div><div class="hero-next-step">' +
    escapeHtml(primaryContactLabel || contactRouteLabel) +
    "</div><p>" +
    escapeHtml(bestNextStepCopy) +
    "</p></div></div></div>" +
    '<div class="profile-actions">' +
    contactBtns +
    (contactGuidance
      ? '<div class="action-panel-note">' + escapeHtml(contactGuidance) + "</div>"
      : "") +
    "</div>" +
    "</div>" +
    '<div class="profile-body">' +
    "<div>" +
    '<div class="profile-section"><h2>About this therapist</h2><div class="bio-text">' +
    escapeHtml(t.bio || "No bio provided.") +
    "</div>" +
    (t.care_approach
      ? '<div class="bio-text" style="margin-top:0.8rem;color:var(--teal-dark)">' +
        escapeHtml(t.care_approach) +
        "</div>"
      : "") +
    '</div><div class="profile-section"><h2>What we reviewed</h2><div class="bio-text">' +
    escapeHtml(reviewedDetailsCopy) +
    "</div>" +
    (therapistReportedCopy
      ? '<div class="bio-text" style="margin-top:0.8rem">' +
        escapeHtml(therapistReportedCopy) +
        "</div>"
      : "") +
    (recentApplied
      ? '<div class="bio-text" style="margin-top:0.8rem;color:var(--teal-dark)">' +
        escapeHtml(recentApplied.note) +
        "</div>"
      : "") +
    (recentConfirmation
      ? '<div class="bio-text" style="margin-top:0.8rem;color:var(--teal-dark)">' +
        escapeHtml(recentConfirmation.note) +
        "</div>"
      : "") +
    (sourceReviewCopy
      ? '<div class="bio-text" style="margin-top:0.8rem">' + escapeHtml(sourceReviewCopy) + "</div>"
      : "") +
    (freshness.status !== "fresh"
      ? '<div class="bio-text" style="margin-top:0.8rem">' + escapeHtml(freshness.note) + "</div>"
      : "") +
    (operationalTrustSummary
      ? '<div class="bio-text" style="margin-top:0.8rem;color:var(--teal-dark)">' +
        escapeHtml(operationalTrustSummary) +
        "</div>"
      : "") +
    "</div>" +
    (specialties
      ? '<div class="profile-section"><h2>Conditions and focus areas</h2><div class="specialty-grid">' +
        specialties +
        "</div></div>"
      : "") +
    (modalities
      ? '<div class="profile-section"><h2>Treatment approach</h2><div class="specialty-grid">' +
        modalities +
        "</div></div>"
      : "") +
    (populations
      ? '<div class="profile-section"><h2>Populations served</h2><div class="specialty-grid">' +
        populations +
        "</div></div>"
      : "") +
    (insTags
      ? '<div class="profile-section"><h2>Insurance accepted</h2><div class="ins-list">' +
        insTags +
        "</div></div>"
      : "") +
    '<div class="profile-section"><h2>What to expect after you reach out</h2><div class="next-step-card">' +
    '<div class="next-step-item"><div class="next-step-label">Best first step</div><div class="next-step-value">' +
    escapeHtml(primaryContactLabel || contactRouteLabel) +
    "</div></div>" +
    (t.estimated_wait_time
      ? '<div class="next-step-item"><div class="next-step-label">Recent availability note</div><div class="next-step-value">' +
        escapeHtml(t.estimated_wait_time) +
        "</div></div>"
      : "") +
    (contactGuidance
      ? '<div class="next-step-item"><div class="next-step-label">What to include</div><div class="next-step-value">' +
        escapeHtml(contactGuidance) +
        "</div></div>"
      : "") +
    '<div class="next-step-item"><div class="next-step-label">What usually comes next</div><div class="next-step-value">' +
    escapeHtml(
      firstStepExpectation ||
        "After first contact, the next step is usually a brief fit conversation or intake review before a full appointment is scheduled.",
    ) +
    "</div></div></div></div>" +
    "</div>" +
    '<div class="profile-sidebar-stack">' +
    '<div class="sidebar-panel trust-panel"><h3>Trust and fit</h3>' +
    '<div class="match-confidence-note" style="margin-bottom:0.8rem">' +
    escapeHtml(standoutCopy) +
    "</div>" +
    '<div class="info-row"><span class="info-label">Match confidence</span><span class="info-val green">' +
    escapeHtml(readinessTitle) +
    "</span></div>" +
    '<div class="match-confidence-note">' +
    escapeHtml(readinessCopy) +
    '</div><div class="match-confidence-note">' +
    escapeHtml(
      "This signal reflects how complete and decision-ready the profile appears. It does not guarantee personal chemistry, exact live availability, or clinical quality.",
    ) +
    "</div>" +
    (responsivenessSignal
      ? '<div class="info-row"><span class="info-label">Contact responsiveness</span><span class="info-val ' +
        (responsivenessSignal.tone === "positive" ? "green" : "teal") +
        '">' +
        escapeHtml(responsivenessSignal.label) +
        '</span></div><div class="responsiveness-note">' +
        escapeHtml(responsivenessSignal.note) +
        '</div><div class="responsiveness-note">' +
        escapeHtml(
          "This speaks only to contact follow-through patterns, not care quality or clinical outcomes.",
        ) +
        "</div>"
      : "") +
    '<div class="info-row"><span class="info-label">Verification</span><span class="info-val green">' +
    escapeHtml(
      t.verification_status === "editorially_verified"
        ? "Editorially verified"
        : "Profile under review",
    ) +
    '</span></div><div class="responsiveness-note">' +
    escapeHtml(
      t.verification_status === "editorially_verified"
        ? "Editorial verification means key profile details were reviewed. It is not a rating of therapeutic quality or fit."
        : "A profile under review may still be useful, but some details may need more confirmation before you decide.",
    ) +
    "</div>" +
    (sourceReviewedDate
      ? '<div class="info-row"><span class="info-label">Source review</span><span class="info-val">' +
        escapeHtml(sourceReviewedDate) +
        "</span></div>"
      : "") +
    (recentConfirmation && therapistReportedDate
      ? '<div class="info-row"><span class="info-label">Therapist re-confirmed</span><span class="info-val green">' +
        escapeHtml(therapistReportedDate) +
        '</span></div><div class="responsiveness-note">' +
        escapeHtml(
          "This means key operational details were recently re-confirmed directly by the specialist. It does not guarantee exact live availability or personal fit.",
        ) +
        "</div>"
      : "") +
    (recentApplied
      ? '<div class="info-row"><span class="info-label">Recently updated</span><span class="info-val green">' +
        escapeHtml(recentApplied.label) +
        '</span></div><div class="responsiveness-note">' +
        escapeHtml(recentApplied.note) +
        "</div>"
      : "") +
    '<div class="info-row"><span class="info-label">Freshness</span><span class="info-val ' +
    (freshness.status === "fresh" ? "green" : "teal") +
    '">' +
    escapeHtml(freshness.label) +
    "</span></div>" +
    '<div class="info-row"><span class="info-label">License</span><span class="info-val">' +
    escapeHtml([t.license_state, t.license_number].filter(Boolean).join(" · ") || "Not listed") +
    "</span></div>" +
    (t.preferred_contact_method
      ? '<div class="info-row"><span class="info-label">Preferred contact</span><span class="info-val">' +
        escapeHtml(
          t.preferred_contact_method === "booking" ? "Booking link" : t.preferred_contact_method,
        ) +
        "</span></div>"
      : "") +
    (t.preferred_contact_label
      ? '<div class="info-row"><span class="info-label">Primary CTA</span><span class="info-val">' +
        escapeHtml(t.preferred_contact_label) +
        "</span></div>"
      : "") +
    (t.bipolar_years_experience
      ? '<div class="info-row"><span class="info-label">Bipolar-specific experience</span><span class="info-val">' +
        escapeHtml(t.bipolar_years_experience) +
        " years</span></div>"
      : "") +
    (t.years_experience
      ? '<div class="info-row"><span class="info-label">Total experience</span><span class="info-val">' +
        escapeHtml(t.years_experience) +
        " years</span></div>"
      : "") +
    "</div>" +
    '<div class="sidebar-panel"><h3>Access details</h3>' +
    '<div class="match-confidence-note" style="margin-bottom:0.8rem">' +
    escapeHtml(reachabilityCopy) +
    "</div>" +
    '<div class="info-row"><span class="info-label">Status</span><span class="info-val ' +
    (t.accepting_new_patients ? "green" : "") +
    '">' +
    escapeHtml(t.accepting_new_patients ? "Accepting patients" : "Waitlist") +
    "</span></div>" +
    '<div class="info-row"><span class="info-label">Telehealth</span><span class="info-val ' +
    (t.accepts_telehealth ? "green" : "") +
    '">' +
    escapeHtml(t.accepts_telehealth ? "Available" : "Not offered") +
    "</span></div>" +
    '<div class="info-row"><span class="info-label">In-person</span><span class="info-val ' +
    (t.accepts_in_person ? "teal" : "") +
    '">' +
    escapeHtml(t.accepts_in_person ? "Available" : "Not offered") +
    "</span></div>" +
    '<div class="info-row"><span class="info-label">Medication management</span><span class="info-val">' +
    escapeHtml(t.medication_management ? "Offered" : "No") +
    "</span></div>" +
    (t.estimated_wait_time
      ? '<div class="info-row"><span class="info-label">Availability note</span><span class="info-val">' +
        escapeHtml(t.estimated_wait_time) +
        "</span></div>"
      : "") +
    (langPills
      ? '<div class="info-row"><span class="info-label">Languages</span><div class="lang-pills">' +
        langPills +
        "</div></div>"
      : "") +
    (telehealthStates
      ? '<div class="info-row"><span class="info-label">Telehealth states</span><div class="lang-pills">' +
        telehealthStates +
        "</div></div>"
      : "") +
    "</div>" +
    '<div class="sidebar-panel"><h3>Session fees</h3>' +
    feesHtml +
    "</div>" +
    '<div class="sidebar-panel"><h3>Contact</h3>' +
    (contactGuidance
      ? '<p class="action-panel-note" style="margin-bottom:0.8rem">' +
        escapeHtml(contactGuidance) +
        "</p>"
      : "") +
    (t.phone
      ? '<div class="contact-item"><span class="contact-icon">📞</span><a href="tel:' +
        escapeHtml(t.phone) +
        '">' +
        escapeHtml(t.phone) +
        "</a></div>"
      : "") +
    (t.email && t.email !== "contact@example.com"
      ? '<div class="contact-item"><span class="contact-icon">✉️</span><a href="mailto:' +
        escapeHtml(t.email) +
        '">' +
        escapeHtml(t.email) +
        "</a></div>"
      : "") +
    (t.website
      ? '<div class="contact-item"><span class="contact-icon">🌐</span><a href="' +
        escapeHtml(t.website) +
        '" target="_blank" rel="noopener">' +
        escapeHtml(t.website.replace(/^https?:\/\//, "")) +
        "</a></div>"
      : "") +
    (!t.phone && (!t.email || t.email === "contact@example.com") && !t.website
      ? '<p style="font-size:.85rem;color:var(--muted)">Contact information is not available on this profile yet.</p>'
      : "") +
    "</div></div>" +
    '<div style="text-align:center;margin-top:1rem;padding-top:1rem"><a href="directory.html" style="color:var(--teal);text-decoration:none;font-size:.85rem;font-weight:600">← Back to Directory</a></div>';

  document.getElementById("profileWrap").innerHTML = html;
  updateShortlistAction(t.slug);
  var shortlistButton = document.getElementById("profileShortlistButton");
  if (shortlistButton) {
    shortlistButton.addEventListener("click", function () {
      toggleShortlist(t.slug);
      updateShortlistAction(t.slug);
      if (typeof window.refreshShortlistNav === "function") {
        window.refreshShortlistNav();
      }
    });
  }
  var prioritySelect = document.getElementById("profileShortlistPriority");
  if (prioritySelect) {
    prioritySelect.addEventListener("change", function () {
      updateShortlistPriority(t.slug, prioritySelect.value);
      updateShortlistAction(t.slug);
      if (typeof window.refreshShortlistNav === "function") {
        window.refreshShortlistNav();
      }
    });
  }
  var noteInput = document.getElementById("profileShortlistNote");
  if (noteInput) {
    noteInput.addEventListener("change", function () {
      updateShortlistNote(t.slug, noteInput.value);
      updateShortlistAction(t.slug);
      if (typeof window.refreshShortlistNav === "function") {
        window.refreshShortlistNav();
      }
    });
  }
}
