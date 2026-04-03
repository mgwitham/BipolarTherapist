import { getTherapistBySlug } from "./store.js";

var slug = new URLSearchParams(window.location.search).get("slug");
var therapist = getTherapistBySlug(slug);

if (!slug) {
  document.getElementById("profileWrap").innerHTML = '<div class="not-found"><h2>No therapist specified</h2><p>Please return to the directory and select a therapist.</p><a href="directory.html" class="back-link">← Back to Directory</a></div>';
} else if (!therapist) {
  document.getElementById("profileWrap").innerHTML = '<div class="not-found"><h2>Therapist not found</h2><p>This profile may no longer be active or the link may be incorrect.</p><a href="directory.html" class="back-link">← Back to Directory</a></div>';
} else {
  renderProfile(therapist);
}

function renderProfile(t) {
  document.title = t.name + " — BipolarTherapists";
  document.getElementById("breadcrumbName").textContent = t.name;

  var initials = (t.name || "").split(" ").map(function (n) { return n[0]; }).join("").substring(0, 2);
  var avatar = t.photo_url ? '<img src="' + t.photo_url + '" alt="' + t.name + '" />' : initials;
  var acceptingBadge = t.accepting_new_patients
    ? '<span class="status-badge badge-accepting">✓ Accepting New Patients</span>'
    : '<span class="status-badge badge-waitlist">Waitlist Only</span>';

  var contactBtns = "";
  if (t.phone) contactBtns += '<a href="tel:' + t.phone + '" class="btn-contact">📞 Call ' + t.phone + "</a>";
  if (t.email && t.email !== "contact@example.com") contactBtns += '<a href="mailto:' + t.email + '" class="btn-contact" style="background:var(--teal-dark)">✉️ Email</a>';
  if (t.website) contactBtns += '<a href="' + t.website + '" target="_blank" rel="noopener" class="btn-website">🌐 Visit Website</a>';

  var specialtyTags = (t.specialties || []).map(function (s) {
    return '<span class="spec-tag">' + s + "</span>";
  }).join("");

  var insTags = (t.insurance_accepted || []).map(function (i) {
    return '<div class="ins-item">' + i + "</div>";
  }).join("");

  var langPills = (t.languages || ["English"]).map(function (l) {
    return '<span class="lang-pill">' + l + "</span>";
  }).join("");

  var feesHtml = "";
  if (t.session_fee_min || t.session_fee_max) {
    feesHtml = '<div class="fee-range">$' + (t.session_fee_min || "") + (t.session_fee_max ? "–$" + t.session_fee_max : "") + "/session</div>";
    if (t.sliding_scale) feesHtml += '<div class="fee-note">✓ Sliding scale available</div>';
  } else if (t.sliding_scale) {
    feesHtml = '<div class="fee-note">Sliding scale available — contact for fees</div>';
  } else {
    feesHtml = '<div class="info-val teal">Contact for fees</div>';
  }

  var html =
    '<div class="profile-header">' +
    '<div class="avatar">' + avatar + "</div>" +
    '<div class="profile-main">' +
    "<h1>" + t.name + "</h1>" +
    (t.credentials ? '<div class="creds">' + t.credentials + "</div>" : "") +
    (t.title ? '<div class="title-text">' + t.title + "</div>" : "") +
    (t.practice_name ? '<div class="title-text" style="color:var(--navy);font-weight:500">' + t.practice_name + "</div>" : "") +
    '<div class="location">📍 ' + t.city + ", " + t.state + (t.zip ? " " + t.zip : "") + "</div>" +
    '<div style="margin-top:.6rem">' + acceptingBadge + "</div>" +
    "</div>" +
    '<div class="profile-actions">' + (contactBtns || '<a href="directory.html" class="btn-website">← Back to Directory</a>') + "</div>" +
    "</div>" +
    '<div class="profile-body">' +
    "<div>" +
    '<div class="profile-section"><h2>About ' + t.name + '</h2><div class="bio-text">' + (t.bio || "No bio provided.") + "</div></div>" +
    (specialtyTags ? '<div class="profile-section"><h2>Specialties & Focus Areas</h2><div class="specialty-grid">' + specialtyTags + "</div></div>" : "") +
    (insTags ? '<div class="profile-section"><h2>Insurance Accepted</h2><div class="ins-list">' + insTags + "</div></div>" : "") +
    "</div>" +
    "<div>" +
    '<div class="sidebar-panel"><h3>Practice Details</h3>' +
    '<div class="info-row"><span class="info-label">Status</span><span class="info-val green">' + (t.accepting_new_patients ? "Accepting Patients" : "Waitlist") + "</span></div>" +
    (t.years_experience ? '<div class="info-row"><span class="info-label">Experience</span><span class="info-val">' + t.years_experience + " years</span></div>" : "") +
    '<div class="info-row"><span class="info-label">Telehealth</span><span class="info-val ' + (t.accepts_telehealth ? "green" : "") + '">' + (t.accepts_telehealth ? "✓ Available" : "Not offered") + "</span></div>" +
    '<div class="info-row"><span class="info-label">In-Person</span><span class="info-val ' + (t.accepts_in_person ? "teal" : "") + '">' + (t.accepts_in_person ? "✓ Available" : "Not offered") + "</span></div>" +
    (langPills ? '<div class="info-row"><span class="info-label">Languages</span><div class="lang-pills">' + langPills + "</div></div>" : "") +
    "</div>" +
    '<div class="sidebar-panel"><h3>Session Fees</h3>' + feesHtml + "</div>" +
    '<div class="contact-section"><h3>📬 Get in Touch</h3>' +
    (t.phone ? '<div class="contact-item"><span class="contact-icon">📞</span><a href="tel:' + t.phone + '">' + t.phone + "</a></div>" : "") +
    (t.email && t.email !== "contact@example.com" ? '<div class="contact-item"><span class="contact-icon">✉️</span><a href="mailto:' + t.email + '">' + t.email + "</a></div>" : "") +
    (t.website ? '<div class="contact-item"><span class="contact-icon">🌐</span><a href="' + t.website + '" target="_blank" rel="noopener">' + t.website.replace(/^https?:\/\//, "") + "</a></div>" : "") +
    (!t.phone && (!t.email || t.email === "contact@example.com") && !t.website ? '<p style="font-size:.85rem;color:var(--muted)">Contact information not provided. Please visit their practice website.</p>' : "") +
    "</div></div></div>" +
    '<div style="text-align:center;margin-top:1rem;padding-top:1rem"><a href="directory.html" style="color:var(--teal);text-decoration:none;font-size:.85rem;font-weight:600">← Back to Directory</a></div>';

  document.getElementById("profileWrap").innerHTML = html;
}
