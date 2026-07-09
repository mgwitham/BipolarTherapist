// Canonical builders for patient-facing contact links (tel: / mailto: /
// http(s):). The directory long carried these as private helpers; the guided
// match flow and the contact modal each grew their own weaker copies that
// emitted dead links — `tel:` with no digits, `tel:+`, `mailto:<garbage>`. A
// dead contact link is a lost conversion, so every surface that turns a
// therapist's phone/email/website/booking field into a clickable href should
// route through these.
//
// Each returns "" when the input can't make a safe, dialable/clickable link,
// so callers can treat "" as "no usable route — don't render the button."

// Phone → "tel:<digits>" only when there are enough digits to be a real
// number. Keeps a leading "+" for international numbers; strips formatting.
// Requires >= 7 digits so "+", "123", or stray punctuation never become a link.
export function phoneHref(value) {
  const phone = String(value || "").trim();
  if (!phone) {
    return "";
  }
  const normalized = phone.replace(/[^\d+]/g, "");
  const digitCount = normalized.replace(/\D/g, "").length;
  return digitCount >= 7 ? "tel:" + normalized : "";
}

// Email → "mailto:<email>" only when it looks like an address. Lower-cased
// and trimmed; rejects whitespace and anything without a single @ and a dot.
export function emailHref(value) {
  const email = String(value || "")
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "";
  }
  return "mailto:" + email;
}

// Website / booking URL → a normalized absolute https(s) URL, or "". Adds a
// default https:// scheme, rejects non-http(s) schemes (javascript:, mailto:,
// file:, …), and requires a dotted hostname so bare words / localhost don't
// pass.
export function publicHttpUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : "https://" + raw;
  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }
    if (!url.hostname || url.hostname.indexOf(".") === -1 || /\s/.test(url.hostname)) {
      return "";
    }
    return url.href;
  } catch (_error) {
    return "";
  }
}

// Referral attribution for outbound links to a therapist's OWN site (their
// practice website or booking page). When a real visitor clicks through from
// a BipolarTherapyHub profile, two honest signals let the therapist see us in
// their own analytics:
//
//   1. UTM parameters (added here) — Google Analytics and most tools read
//      utm_source/utm_medium to attribute the session to a referrer.
//   2. A preserved Referer header — the link must use rel="noopener" (NOT
//      "noopener noreferrer"), so the browser still sends the referrer.
//
// This only decorates a link the visitor genuinely clicks; it never
// manufactures traffic. It touches real http(s) practice/booking URLs only —
// tel:/mailto:/relative hrefs and empty values pass through untouched.
export const REFERRAL_UTM_SOURCE = "bipolartherapyhub.com";
export const REFERRAL_UTM_MEDIUM = "referral";

export function withReferralAttribution(href, options = {}) {
  const raw = String(href || "").trim();
  if (!raw) {
    return raw;
  }
  let url;
  try {
    url = new URL(raw);
  } catch (_error) {
    // Not an absolute URL (relative path, tel:, mailto: without host, …) —
    // leave it exactly as-is.
    return raw;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return raw;
  }
  // Non-destructive + idempotent: never override attribution the therapist (or
  // an existing campaign link) already set, and never stack duplicate params.
  if (!url.searchParams.has("utm_source")) {
    url.searchParams.set("utm_source", REFERRAL_UTM_SOURCE);
    url.searchParams.set("utm_medium", REFERRAL_UTM_MEDIUM);
    const campaign = String((options && options.campaign) || "directory").trim();
    if (campaign && !url.searchParams.has("utm_campaign")) {
      url.searchParams.set("utm_campaign", campaign);
    }
  }
  return url.href;
}
