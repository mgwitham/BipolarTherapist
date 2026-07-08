// Provider card markup shared by the static SEO page generators (city
// pages, the /directory pre-render, insurance pages). One builder so a
// therapist's photo — uploaded in the portal, by an admin, or published
// from the sourced-photo queue — reaches every statically generated card
// surface the moment the site rebuilds, instead of each generator needing
// its own photo branch.
//
// Pure string-in/string-out (no I/O) so it can live in shared/ and be
// unit-tested without a Sanity fixture.

import { escapeHtml } from "./escape-html.mjs";

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

// Rendered avatar size on the card in CSS pixels; images are requested at
// 2x for retina screens. Matches .city-provider-avatar in
// public/seo-city-pages.css.
const AVATAR_PX = 52;

// Same 4-ramp palette as the client-side avatar component
// (assets/card-content.js AVATAR_RAMPS) so a clinician's initials tile
// looks identical on the static SEO pages and the hydrated directory /
// match cards. Keep the two lists in sync.
const AVATAR_RAMPS = [
  { bg: "#E1F5EE", ink: "#085041", ring: "#9FE1CB" }, // Teal
  { bg: "#EEEDFE", ink: "#3C3489", ring: "#CECBF6" }, // Purple
  { bg: "#FAECE7", ink: "#712B13", ring: "#F5C4B3" }, // Coral
  { bg: "#E6F1FB", ink: "#0C447C", ring: "#B5D4F4" }, // Blue
];

// Two-letter initials from a name. Skips credentials in parens, prefers
// first + last initial.
export function getProviderInitials(name) {
  const parts = String(name || "")
    .replace(/\(.*?\)/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Deterministic ramp per provider (slug preferred, name fallback) so the
// tile color is stable across rebuilds.
function getAvatarRamp(provider) {
  const key = String((provider && (provider.slug || provider.name)) || "");
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return AVATAR_RAMPS[hash % AVATAR_RAMPS.length];
}

// Sanity CDN thumbnail params — mirrors assets/sanity-image.js so the CDN
// serves a small, modern-format crop instead of the original. No-op for
// non-Sanity URLs (some photo_url values are external aggregator links).
function isSanityCdnUrl(raw) {
  try {
    return new URL(raw).hostname === "cdn.sanity.io";
  } catch {
    return false;
  }
}

function providerThumbUrl(url) {
  const raw = String(url || "").trim();
  if (!isSanityCdnUrl(raw)) return raw;
  const size = AVATAR_PX * 2;
  const params = "w=" + size + "&h=" + size + "&fit=crop&auto=format&q=75";
  return raw + (raw.indexOf("?") === -1 ? "?" : "&") + params;
}

// Photo when the therapist has one, initials tile otherwise. The card link
// already carries the clinician's name, so the avatar is decorative
// (empty alt / aria-hidden).
export function buildProviderAvatarHtml(provider) {
  const p = provider || {};
  if (p.photo_url) {
    return (
      '<img class="city-provider-avatar city-provider-avatar--photo" src="' +
      escapeAttribute(providerThumbUrl(p.photo_url)) +
      '" alt="" width="' +
      AVATAR_PX +
      '" height="' +
      AVATAR_PX +
      '" loading="lazy" decoding="async" />'
    );
  }
  const ramp = getAvatarRamp(p);
  const style =
    "background:" +
    ramp.bg +
    ";color:" +
    ramp.ink +
    ";box-shadow:inset 0 0 0 2px " +
    ramp.ring +
    ";";
  return (
    '<div class="city-provider-avatar" style="' +
    style +
    '" aria-hidden="true">' +
    escapeHtml(getProviderInitials(p.name)) +
    "</div>"
  );
}

// One provider card. `metaText` is the generator-specific second line
// (city pages pass the role, directory/insurance pages add city/state).
export function buildProviderCardHtml(provider, metaText) {
  const p = provider || {};
  const fullName = String(p.name || "").trim();
  const credentials = String(p.credentials || "").trim();
  const meta = String(metaText || "").trim();
  const href = "/therapists/" + encodeURIComponent(String(p.slug || "").trim()) + "/";
  return (
    '<a class="city-provider-card" href="' +
    escapeAttribute(href) +
    '">' +
    buildProviderAvatarHtml(p) +
    '<div class="city-provider-body">' +
    '<div class="city-provider-name">' +
    escapeHtml(fullName) +
    (credentials
      ? '<span class="city-provider-creds">' + escapeHtml(credentials) + "</span>"
      : "") +
    "</div>" +
    (meta ? '<div class="city-provider-role">' + escapeHtml(meta) + "</div>" : "") +
    '<div class="city-provider-cta">View profile <span aria-hidden="true">&rarr;</span></div>' +
    "</div>" +
    "</a>"
  );
}
