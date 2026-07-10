// Per-referrer attribution. Pure (no DOM, no storage, no I/O) — shared by the
// outreach send path (which stamps a code onto the links in a referral email),
// the browser capture hook (which reads it back off the landing URL), and the
// match persistence layer (which stores it on the matchRequest document).
//
// The question this answers: "did Dr. Kennedy's referral email produce a
// patient who completed match intake?" A code is therefore stable per contact
// (so a follow-up email carries the same code as the intro) and readable at a
// glance in a URL, an admin table, and a server log.
//
// Codes are NOT secrets and NOT personal data: `nkennedy-3f2a` identifies a
// professional outreach contact, not a patient. They are, however, the join key
// for the whole funnel, so `sanitizeReferralCode` is deliberately strict —
// anything arriving from a URL is untrusted input headed for a Sanity document.

import { contactIdentityKey } from "./referral-contact-domain.mjs";

/** The query parameter carrying the code on referral links. */
export const REFERRAL_PARAM = "ref";

/** Hard cap on a stored/accepted code. Keeps URLs and documents bounded. */
export const REFERRAL_CODE_MAX_LENGTH = 40;

/**
 * Lowercase, collapse to [a-z0-9-], trim separators.
 *
 * @param {unknown} value
 * @returns {string}
 */
function slugify(value) {
  return String(value == null ? "" : value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * FNV-1a, base36. Deterministic across Node and the browser (no crypto, no
 * Math.random) so a code minted at send time matches the one parsed at landing.
 *
 * @param {string} value
 * @returns {string}
 */
function shortHash(value) {
  let hash = 0x811c9dc5;
  const input = String(value || "");
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    // Multiply by the FNV prime (16777619) with 32-bit overflow semantics.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).slice(0, 4).padStart(4, "0");
}

/**
 * Validate/normalize a code arriving from an untrusted source (a URL, a stored
 * value from a previous release, an admin filter box). Returns "" when the
 * input can't be trusted, so callers can treat "" as "no attribution" without
 * a second check.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function sanitizeReferralCode(value) {
  const slug = slugify(value);
  if (!slug) return "";
  return slug.slice(0, REFERRAL_CODE_MAX_LENGTH).replace(/-+$/, "");
}

/**
 * Deterministic, human-readable code for a referral contact:
 * `<name-or-org-slug>-<4-char hash of the identity key>`.
 *
 * The name half makes the code legible ("who is nkennedy?"); the hash half
 * disambiguates two clinicians with the same name and survives a rename of the
 * practice. Keyed off {@link contactIdentityKey} so it is stable for the life
 * of the contact and identical across the intro and every follow-up.
 *
 * Returns "" when the contact has no identity to key on — the send path must
 * treat that as "send an unattributed link" rather than inventing a code.
 *
 * @param {{ email?: unknown, orgName?: unknown, contactName?: unknown, role?: unknown }} contact
 * @returns {string}
 */
export function referralCodeForContact(contact) {
  const identity = contactIdentityKey(contact || {});
  if (!identity) return "";

  const record = contact || {};
  const name = String(record.contactName || "").trim();
  // "Nigel Kennedy" -> "nkennedy"; falls back to the org for shared inboxes.
  let label = "";
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    const last = slugify(parts[parts.length - 1]);
    const firstInitial = slugify(parts[0]).slice(0, 1);
    label = parts.length > 1 && firstInitial && last ? `${firstInitial}${last}` : slugify(name);
  }
  if (!label) label = slugify(record.orgName);
  if (!label) label = "contact";

  const hash = shortHash(identity);
  // Reserve room for "-" + 4-char hash so the whole code stays within the cap.
  const room = REFERRAL_CODE_MAX_LENGTH - (hash.length + 1);
  return sanitizeReferralCode(`${label.slice(0, room)}-${hash}`);
}

/**
 * Append `?ref=<code>` (or `&ref=`) to a URL. No-ops on an empty url or code,
 * and never appends a second `ref`. Hash fragments are preserved.
 *
 * Implemented with string surgery rather than `new URL()` because callers pass
 * bare placeholders like "[directory]" in template previews, which `URL` throws
 * on.
 *
 * @param {unknown} url
 * @param {unknown} code
 * @returns {string}
 */
export function appendReferralCode(url, code) {
  const href = String(url == null ? "" : url).trim();
  const safe = sanitizeReferralCode(code);
  if (!href || !safe) return href;

  const [beforeHash, ...hashParts] = href.split("#");
  const hash = hashParts.length ? `#${hashParts.join("#")}` : "";
  if (new RegExp(`[?&]${REFERRAL_PARAM}=`).test(beforeHash)) return href;

  const separator = beforeHash.includes("?") ? "&" : "?";
  return `${beforeHash}${separator}${REFERRAL_PARAM}=${safe}${hash}`;
}

/**
 * Read the code out of a URL query string. Accepts a full URL, a bare search
 * string ("?ref=abc"), or a `URLSearchParams`-like value. Always sanitized.
 *
 * @param {unknown} search
 * @returns {string}
 */
export function parseReferralCode(search) {
  const raw = String(search == null ? "" : search);
  const query = raw.includes("?") ? raw.slice(raw.indexOf("?") + 1) : raw;
  const stripped = query.split("#")[0];
  for (const pair of stripped.split("&")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    if (decodeURIComponent(pair.slice(0, eq)) !== REFERRAL_PARAM) continue;
    let value = pair.slice(eq + 1);
    try {
      value = decodeURIComponent(value);
    } catch {
      // Malformed percent-encoding: fall through to sanitize the raw value.
    }
    return sanitizeReferralCode(value);
  }
  return "";
}
