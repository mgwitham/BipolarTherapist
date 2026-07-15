// Client-side URL safety helpers.
//
// Two distinct jobs:
//   - safeExternalUrl: sanitize a URL before putting it in an <a href>.
//     Blocks dangerous schemes (javascript:, data:, vbscript:, …) that
//     would execute on click, while preserving ordinary http(s) and
//     relative/same-origin links unchanged.
//   - safeStripeRedirectUrl: validate a URL we received from our own API
//     before handing it to window.location. Used for Stripe
//     checkout/billing redirects, the only API-provided navigation
//     targets, so it allow-lists https Stripe domains (and our own
//     origin) and rejects everything else — closing any open-redirect
//     even if the URL were ever attacker-influenced upstream.

function originBase() {
  try {
    return window.location.origin;
  } catch (_error) {
    return undefined;
  }
}

// Returns the original string when it resolves to an http(s) URL
// (absolute or relative), otherwise "". Returning the raw value keeps
// relative links relative; only the effective scheme is validated, which
// the browser parses the same way when it follows the href.
export function safeExternalUrl(value) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw) return "";
  try {
    const url = new URL(raw, originBase());
    return url.protocol === "http:" || url.protocol === "https:" ? raw : "";
  } catch (_error) {
    return "";
  }
}

// Strict variant: absolute http(s) URLs ONLY — relative and protocol-less
// values (e.g. "www.foo.com") are rejected rather than resolved against
// our origin, and the normalized url.href is returned. Use for
// therapist-submitted external targets (website, booking_url) and API-
// provided asset URLs (photo_url), where a "relative" value is always a
// data problem, never a real link. Consolidated from identical inline
// copies in portal.js, portal-td-completeness.js, and therapist-page.js.
export function safeAbsoluteExternalUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch (_error) {
    return "";
  }
}

export function safeStripeRedirectUrl(value) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw) return "";
  try {
    const url = new URL(raw, originBase());
    if (url.protocol !== "https:") return "";
    const host = url.hostname.toLowerCase();
    const isStripe = host === "stripe.com" || host.endsWith(".stripe.com");
    let selfHost = "";
    try {
      selfHost = window.location.hostname.toLowerCase();
    } catch (_error) {
      selfHost = "";
    }
    const isSelf = Boolean(selfHost) && host === selfHost;
    return isStripe || isSelf ? url.href : "";
  } catch (_error) {
    return "";
  }
}
