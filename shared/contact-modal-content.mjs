// Content-building for the four-layout contact modal on the match
// page. One layout per preferredContactMethod (booking / website /
// phone / email). Pure functions — return HTML strings — so the
// layout selection and secondary-contact filtering are unit-testable
// without spinning up a DOM.
//
// Field shape: this module accepts therapist data in camelCase
// (bookingUrl, website, phone, email, preferredContactMethod, name).
// Callers that work in snake_case (the frontend match viewmodel)
// should normalize at the boundary.

const HONORIFIC_PATTERN = /^(dr|mr|mrs|ms|mx|prof|professor)\.?$/i;
const CREDENTIAL_PATTERN = /^(phd|psyd|md|lcsw|lmft|mft|lpcc|mscp|msw|ma|ms)\.?$/i;

const CONTACT_METHODS = ["booking", "website", "phone", "email"];

// Secondary contact order per layout. Matches the spec: booking omits
// booking (it's the primary); website omits booking (redundant with a
// primary website); phone shows everything except phone; email shows
// everything except email.
const SECONDARY_ORDER_BY_LAYOUT = {
  booking: ["phone", "email", "website"],
  website: ["phone", "email"],
  phone: ["email", "website", "booking"],
  email: ["phone", "website", "booking"],
};

const SECONDARY_LABEL_BY_LAYOUT = {
  booking: "Prefer to reach out first?",
  website: "Prefer to reach out directly?",
  phone: "Prefer not to call?",
  email: null, // email layout uses a name-interpolated label
};

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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

function phoneHref(phone) {
  return "tel:" + String(phone || "").replace(/[^\d+]/g, "");
}

function normalizeUrlHref(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return /^https?:\/\//i.test(raw) ? raw : "https://" + raw.replace(/^\/+/, "");
}

function getDomainFromUrl(url) {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch (_e) {
    return "";
  }
}

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// Resolves the preferredContactMethod for a therapist. If an explicit
// value is set AND the corresponding field has content, use it.
// Otherwise pick the first non-empty field in booking > website >
// phone > email order. Returns null if the therapist has none of the
// four contact methods (caller should not render a modal in that case).
export function resolvePreferredContactMethod(therapist) {
  const t = therapist || {};
  const has = {
    booking: hasValue(t.bookingUrl),
    website: hasValue(t.website),
    phone: hasValue(t.phone),
    email: hasValue(t.email),
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
    "I'm looking for a bipolar-informed therapist and saw your profile. " +
    "Are you currently accepting new patients?"
  );
}

// Returns the ordered array of { method, label, href, display, external }
// that the given layout should render below its primary CTA. The array
// is already filtered to only include methods the therapist has
// populated.
export function buildSecondaryContacts(layout, therapist) {
  const order = SECONDARY_ORDER_BY_LAYOUT[layout] || [];
  const t = therapist || {};
  const out = [];
  for (const method of order) {
    if (method === "phone" && hasValue(t.phone)) {
      out.push({
        method: "phone",
        label: "Phone",
        href: phoneHref(t.phone),
        display: formatPhoneDisplay(t.phone),
        external: false,
      });
    } else if (method === "email" && hasValue(t.email)) {
      out.push({
        method: "email",
        label: "Email",
        href: "mailto:" + t.email.trim(),
        display: t.email.trim(),
        external: false,
      });
    } else if (method === "website" && hasValue(t.website)) {
      const href = normalizeUrlHref(t.website);
      out.push({
        method: "website",
        label: "Website",
        href,
        display: getDomainFromUrl(href) || "Website",
        external: true,
      });
    } else if (method === "booking" && hasValue(t.bookingUrl)) {
      const href = normalizeUrlHref(t.bookingUrl);
      out.push({
        method: "booking",
        label: "Booking",
        href,
        display: getDomainFromUrl(href) || "Booking page",
        external: true,
      });
    }
  }
  return out;
}

function renderHeading(text) {
  return '<h3 class="mx-contact-name" id="contactDialogTitle">' + escapeHtml(text) + "</h3>";
}

function renderBodyParagraph(text) {
  return '<p class="mx-contact-body-copy">' + escapeHtml(text) + "</p>";
}

function renderSecondaryContactsHtml(layout, therapist, firstName) {
  const contacts = buildSecondaryContacts(layout, therapist);
  if (!contacts.length) return "";
  const labelText = SECONDARY_LABEL_BY_LAYOUT[layout] || "Other ways to reach " + firstName + ":";
  const items = contacts
    .map(function (c) {
      const attrs = c.external ? ' target="_blank" rel="noopener noreferrer"' : "";
      return (
        '<li><a href="' +
        escapeHtml(c.href) +
        '"' +
        attrs +
        ' data-contact-other-route="' +
        escapeHtml(c.method) +
        '"><span class="mx-contact-other-label">' +
        escapeHtml(c.label) +
        ':</span> <span class="mx-contact-other-value">' +
        escapeHtml(c.display) +
        "</span></a></li>"
      );
    })
    .join("");
  return (
    '<div class="mx-contact-others"><div class="mx-contact-others-label">' +
    escapeHtml(labelText) +
    '</div><ul class="mx-contact-others-list">' +
    items +
    "</ul></div>"
  );
}

function renderBookingLayout(therapist, firstName) {
  const href = normalizeUrlHref(therapist.bookingUrl);
  return (
    renderHeading("Book with " + firstName) +
    renderBodyParagraph(
      firstName +
        " takes new client inquiries through their booking page. Head there to see availability and request a time.",
    ) +
    '<div class="mx-contact-actions">' +
    '<a class="mx-btn-primary" href="' +
    escapeHtml(href) +
    '" target="_blank" rel="noopener noreferrer" data-contact-primary="booking">Open booking page →</a>' +
    "</div>" +
    renderSecondaryContactsHtml("booking", therapist, firstName)
  );
}

function renderWebsiteLayout(therapist, firstName) {
  const href = normalizeUrlHref(therapist.website);
  return (
    renderHeading("Visit " + firstName + "'s website") +
    renderBodyParagraph(
      firstName +
        " points new clients to their practice website. Head there to learn more and find the best way to get in touch.",
    ) +
    '<div class="mx-contact-actions">' +
    '<a class="mx-btn-primary" href="' +
    escapeHtml(href) +
    '" target="_blank" rel="noopener noreferrer" data-contact-primary="website">Open practice site →</a>' +
    "</div>" +
    renderSecondaryContactsHtml("website", therapist, firstName)
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
    '<p class="mx-contact-phone-subcopy">Mention you found them through BipolarTherapyHub.</p>' +
    renderSecondaryContactsHtml("phone", therapist, firstName)
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
    "</div></div>" +
    renderSecondaryContactsHtml("email", therapist, firstName)
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
