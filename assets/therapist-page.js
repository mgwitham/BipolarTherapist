import { fetchPublicTherapistBySlug } from "./cms.js";
import { getTherapistMatchReadiness } from "./matching-model.js";
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
    : "Save up to 3 therapists to compare later in the match flow.";

  var priorityWrap = document.getElementById("profileShortlistPriorityWrap");
  var prioritySelect = document.getElementById("profileShortlistPriority");
  var noteInput = document.getElementById("profileShortlistNote");
  if (priorityWrap && prioritySelect && noteInput) {
    priorityWrap.style.display = shortlisted ? "block" : "none";
    prioritySelect.value = shortlistEntry ? shortlistEntry.priority : "";
    noteInput.value = shortlistEntry ? shortlistEntry.note : "";
  }
}

(async function init() {
  if (!slug) {
    document.getElementById("profileWrap").innerHTML =
      '<div class="not-found"><h2>No therapist specified</h2><p>Please return to the directory and select a therapist.</p><a href="directory.html" class="back-link">← Back to Directory</a></div>';
    return;
  }

  var therapist = await fetchPublicTherapistBySlug(slug);
  if (!therapist) {
    document.getElementById("profileWrap").innerHTML =
      '<div class="not-found"><h2>Therapist not found</h2><p>This profile may no longer be active or the link may be incorrect.</p><a href="directory.html" class="back-link">← Back to Directory</a></div>';
    return;
  }

  renderProfile(therapist);
})();

function renderProfile(t) {
  var readiness = getTherapistMatchReadiness(t);
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
    : "Use this profile to compare trust, access, and bipolar-specific fit before deciding on the next step. You should still confirm availability, insurance, and personal fit directly.";
  document.title = t.name + " — BipolarTherapyHub";
  document.getElementById("breadcrumbName").textContent = t.name;

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

  var html =
    '<div class="profile-header">' +
    '<div class="avatar">' +
    avatar +
    "</div>" +
    '<div class="profile-main">' +
    '<div class="eyebrow">Guided bipolar specialist profile</div>' +
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
    '<p class="fit-summary">' +
    escapeHtml(fitSummaryCopy) +
    "</p>" +
    (t.care_approach
      ? '<p class="fit-summary" style="margin-top:0.65rem">' + escapeHtml(t.care_approach) + "</p>"
      : "") +
    '<div class="profile-shortlist-status" id="profileShortlistStatus"></div>' +
    '<div class="profile-shortlist-priority" id="profileShortlistPriorityWrap" style="display:none"><label for="profileShortlistPriority">Shortlist label</label><select id="profileShortlistPriority"><option value="">No label yet</option>' +
    SHORTLIST_PRIORITY_OPTIONS.map(function (option) {
      return '<option value="' + escapeHtml(option) + '">' + escapeHtml(option) + "</option>";
    }).join("") +
    '</select><label for="profileShortlistNote" style="margin-top:0.7rem">Personal note</label><input id="profileShortlistNote" type="text" maxlength="120" placeholder="Add a quick reminder..." /></div>' +
    "</div>" +
    '<div class="profile-actions">' +
    (contactBtns || '<a href="directory.html" class="btn-website">Back to directory</a>') +
    (contactGuidance
      ? '<div class="profile-contact-guidance">' + escapeHtml(contactGuidance) + "</div>"
      : "") +
    "</div>" +
    "</div>" +
    '<div class="profile-body">' +
    "<div>" +
    '<div class="profile-section"><h2>Why this profile may fit</h2><div class="bio-text">' +
    escapeHtml(fitSummaryCopy) +
    "</div></div>" +
    '<div class="profile-section"><h2>About this clinician</h2><div class="bio-text">' +
    escapeHtml(t.bio || "No bio provided.") +
    "</div></div>" +
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
    '<div class="profile-section"><h2>What the first step is likely to feel like</h2><div class="next-step-card">' +
    '<div class="next-step-item"><div class="next-step-label">Best first step</div><div class="next-step-value">' +
    escapeHtml(primaryContactLabel || contactRouteLabel) +
    "</div></div>" +
    (t.estimated_wait_time
      ? '<div class="next-step-item"><div class="next-step-label">Typical timing</div><div class="next-step-value">' +
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
    "<div>" +
    '<div class="sidebar-panel trust-panel"><h3>Trust and fit signals</h3>' +
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
    '<div class="sidebar-panel"><h3>Practical access details</h3>' +
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
      ? '<div class="info-row"><span class="info-label">Typical wait time</span><span class="info-val">' +
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
    '<div class="contact-section"><h3>Best next step</h3>' +
    (contactGuidance
      ? '<p class="contact-guidance-copy">' + escapeHtml(contactGuidance) + "</p>"
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
    "</div></div></div>" +
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
