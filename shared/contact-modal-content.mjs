// Content-building for the four-layout contact modal on the match
// page. One layout per preferredContactMethod (booking / website /
// phone / email). Pure functions that return HTML strings, so the
// layout selection is unit-testable without spinning up a DOM.
//
// Field shape: this module accepts therapist data in camelCase
// (bookingUrl, website, phone, email, preferredContactMethod, name).
// Callers that work in snake_case (the frontend match viewmodel)
// should normalize at the boundary.

import {
  phoneHref,
  emailHref,
  publicHttpUrl as normalizeUrlHref,
  withReferralAttribution,
} from "./contact-href.mjs";
import { escapeHtml } from "./escape-html.mjs";

const HONORIFIC_PATTERN = /^(dr|mr|mrs|ms|mx|prof|professor)\.?$/i;
const CREDENTIAL_PATTERN = /^(phd|psyd|md|lcsw|lmft|mft|lpcc|mscp|msw|ma|ms)\.?$/i;

const CONTACT_METHODS = ["booking", "website", "phone", "email"];

export function extractFirstName(name) {
  const raw = String(name || "").trim();
  if (!raw) return "";
  const beforeComma = raw.split(",")[0];
  const tokens = beforeComma.split(/\s+/).filter(Boolean);
  while (tokens.length && HONORIFIC_PATTERN.test(tokens[0])) {
    tokens.shift();
  }
  while (tokens.length && CREDENTIAL_PATTERN.test(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  const first = tokens[0] || "";
  if (!first || HONORIFIC_PATTERN.test(first) || CREDENTIAL_PATTERN.test(first)) {
    return "";
  }
  return first;
}

function firstNameOrFallback(name) {
  return extractFirstName(name) || "your therapist";
}

export function formatPhoneDisplay(phone) {
  let digits = String(phone || "").replace(/[^\d]/g, "");
  if (digits.length === 11 && digits.charAt(0) === "1") {
    digits = digits.slice(1);
  }
  if (digits.length === 10) {
    return "(" + digits.slice(0, 3) + ") " + digits.slice(3, 6) + "-" + digits.slice(6);
  }
  return String(phone || "").trim();
}

// Resolves the preferredContactMethod for a therapist. If an explicit
// value is set AND the corresponding field has content, use it.
// Otherwise pick the first non-empty field in booking > website >
// phone > email order. Returns null if the therapist has none of the
// four contact methods (caller should not render a modal in that case).
export function resolvePreferredContactMethod(therapist) {
  const t = therapist || {};
  // Validated presence: a field only counts as a usable contact method if it
  // produces a real, clickable href. This keeps the picker from selecting a
  // method (e.g. a junk phone like "+") whose layout would then render a dead
  // link instead of falling through to a method that actually works.
  const has = {
    booking: normalizeUrlHref(t.bookingUrl) !== "",
    website: normalizeUrlHref(t.website) !== "",
    phone: phoneHref(t.phone) !== "",
    email: emailHref(t.email) !== "",
  };
  const explicit = String(t.preferredContactMethod || "").trim();
  if (explicit && has[explicit]) {
    return explicit;
  }
  for (const method of CONTACT_METHODS) {
    if (has[method]) return method;
  }
  return null;
}

export function buildContactDraftMessage(therapist) {
  const first = extractFirstName(therapist && therapist.name);
  const greeting = first ? "Hi " + first + "," : "Hi there,";
  return (
    greeting +
    " I found you through BipolarTherapyHub. " +
    "I'm looking for a bipolar informed therapist and saw your profile. " +
    "Are you currently accepting new patients?"
  );
}

function renderHeading(text) {
  return '<h3 class="mx-contact-name" id="contactDialogTitle">' + escapeHtml(text) + "</h3>";
}

function renderBodyParagraph(text) {
  return '<p class="mx-contact-body-copy">' + escapeHtml(text) + "</p>";
}

function renderBookingLayout(therapist, firstName) {
  const href = withReferralAttribution(normalizeUrlHref(therapist.bookingUrl), {
    campaign: "match",
  });
  return (
    renderHeading("Book with " + firstName) +
    renderBodyParagraph(
      firstName +
        " takes new client inquiries through their booking page. Head there to see availability and request a time.",
    ) +
    '<div class="mx-contact-actions">' +
    '<a class="mx-btn-primary" href="' +
    escapeHtml(href) +
    '" target="_blank" rel="noopener" data-contact-primary="booking">Open booking page →</a>' +
    "</div>"
  );
}

function renderWebsiteLayout(therapist, firstName) {
  const href = withReferralAttribution(normalizeUrlHref(therapist.website), { campaign: "match" });
  return (
    renderHeading("Contact " + firstName) +
    renderBodyParagraph(
      firstName +
        "'s practice website has the best options for reaching out and booking a first session.",
    ) +
    '<div class="mx-contact-actions">' +
    '<a class="mx-btn-primary" href="' +
    escapeHtml(href) +
    '" target="_blank" rel="noopener" data-contact-primary="website">Continue to ' +
    escapeHtml(firstName) +
    "'s site →</a>" +
    "</div>"
  );
}

function renderPhoneLayout(therapist, firstName, isMobile) {
  const display = formatPhoneDisplay(therapist.phone);
  const href = phoneHref(therapist.phone);
  const phoneIcon = '<span class="mx-contact-phone-icon" aria-hidden="true">☎</span>';
  const primaryHtml = isMobile
    ? '<a class="mx-btn-primary mx-contact-phone-cta" href="' +
      escapeHtml(href) +
      '" data-contact-primary="phone">' +
      phoneIcon +
      '<span class="mx-contact-phone-number">' +
      escapeHtml(display) +
      "</span></a>"
    : '<button type="button" class="mx-btn-primary mx-contact-phone-cta" data-contact-copy="phone" data-contact-copy-value="' +
      escapeHtml(display) +
      '" data-contact-primary="phone">' +
      phoneIcon +
      '<span class="mx-contact-phone-number">' +
      escapeHtml(display) +
      "</span></button>";
  return (
    renderHeading("Call " + firstName) +
    renderBodyParagraph(
      firstName +
        " prefers a phone call for new client inquiries. If they don't pick up, leave a brief voicemail with your name and a good time to reach you.",
    ) +
    '<div class="mx-contact-actions">' +
    primaryHtml +
    "</div>" +
    '<p class="mx-contact-phone-subcopy">Mention you found them through BipolarTherapyHub.</p>'
  );
}

function renderEmailLayout(therapist, firstName) {
  const draft = buildContactDraftMessage(therapist);
  const emailTrimmed = String(therapist.email || "").trim();
  return (
    renderHeading("Email " + firstName) +
    renderBodyParagraph(
      "Here's a starter message you can send. Edit anything before you send it.",
    ) +
    '<div class="mx-contact-draft">' +
    '<label for="contactDraftMessage" class="mx-contact-draft-label">Message</label>' +
    '<textarea id="contactDraftMessage" class="mx-contact-draft-textarea" rows="6">' +
    escapeHtml(draft) +
    "</textarea>" +
    '<div class="mx-contact-draft-actions">' +
    '<button type="button" class="mx-btn-primary" data-contact-send-email="' +
    escapeHtml(emailTrimmed) +
    '">Open in email app</button>' +
    '<button type="button" class="mx-btn-secondary" data-contact-copy-message>Copy message</button>' +
    "</div></div>"
  );
}

// Returns { layout, html } where layout is one of the four method
// names (or null) and html is the inner HTML string to inject into
// #contactDialogBody. Returns { layout: null, html: "" } if no
// contact methods are available.
export function buildContactModalContent(therapist, options) {
  const t = therapist || {};
  const opts = options || {};
  const layout = resolvePreferredContactMethod(t);
  if (!layout) {
    return { layout: null, html: "" };
  }
  const firstName = firstNameOrFallback(t.name);
  let html = "";
  if (layout === "booking") {
    html = renderBookingLayout(t, firstName);
  } else if (layout === "website") {
    html = renderWebsiteLayout(t, firstName);
  } else if (layout === "phone") {
    html = renderPhoneLayout(t, firstName, Boolean(opts.isMobile));
  } else {
    html = renderEmailLayout(t, firstName);
  }
  return { layout, html };
}
