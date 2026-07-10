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
 * The clean, share-style link a referral email points at: `<base>/r/<code>`.
 * A short path reads like a shared link, not a `?ref=` tracking param, so it
 * doesn't look spammy or depress clicks. The /r/ endpoint resolves the code to
 * the referrer's city page and re-applies the code server-side, so attribution
 * survives. With no code, returns the bare base URL (an unattributed link).
 *
 * @param {unknown} baseUrl
 * @param {unknown} code
 * @returns {string}
 */
export function referralLandingUrl(baseUrl, code) {
  const base = String(baseUrl == null ? "" : baseUrl)
    .trim()
    .replace(/\/+$/, "");
  const safe = sanitizeReferralCode(code);
  if (!base) return "";
  return safe ? `${base}/r/${safe}` : base;
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

/**
 * Roll up match intakes by the clinician who referred them.
 *
 * Reads durable `matchRequest` documents rather than the funnel event ring
 * buffer, so a referral that landed months ago still shows up. `contacts` are
 * `referralContact` documents; their codes are derived here (the code is not
 * stored on the contact, it is a function of identity).
 *
 * Every contact that has been emailed appears in the report, including those
 * with zero intakes — "we emailed 30 prescribers and got 0 intakes" is the
 * finding that matters most early, and a table that hides the zeros can't
 * show it. A code with no matching contact (a renamed or deleted contact,
 * or a hand-shared link) is reported as `unmatched` rather than dropped.
 *
 * @param {Array<{ referralCode?: unknown, createdAt?: unknown, _createdAt?: unknown }>} matchRequests
 * @param {Array<Record<string, unknown>>} contacts
 * @returns {{ rows: Array<object>, totals: { totalIntakes: number, attributedIntakes: number, organicIntakes: number, referrersWithIntake: number, referrersEmailed: number } }}
 */
export function buildReferralAttributionReport(matchRequests, contacts) {
  const requests = Array.isArray(matchRequests) ? matchRequests : [];
  const contactList = Array.isArray(contacts) ? contacts : [];

  /** @type {Map<string, { intakes: number, firstIntakeAt: string, lastIntakeAt: string }>} */
  const byCode = new Map();
  let organicIntakes = 0;

  for (const request of requests) {
    const code = sanitizeReferralCode(request && request.referralCode);
    if (!code) {
      organicIntakes += 1;
      continue;
    }
    const at = String((request && (request.createdAt || request._createdAt)) || "");
    const bucket = byCode.get(code) || { intakes: 0, firstIntakeAt: "", lastIntakeAt: "" };
    bucket.intakes += 1;
    if (at && (!bucket.firstIntakeAt || at < bucket.firstIntakeAt)) bucket.firstIntakeAt = at;
    if (at && (!bucket.lastIntakeAt || at > bucket.lastIntakeAt)) bucket.lastIntakeAt = at;
    byCode.set(code, bucket);
  }

  const rows = [];
  const claimed = new Set();

  for (const contact of contactList) {
    const code = referralCodeForContact(contact);
    if (!code) continue;
    const emailsSent = Number((contact && contact.emailsSent) || 0);
    const bucket = byCode.get(code);
    // Not yet emailed and no intakes: nothing to report on this contact.
    if (!bucket && emailsSent <= 0) continue;
    claimed.add(code);
    rows.push({
      code,
      orgName: String((contact && contact.orgName) || ""),
      contactName: String((contact && contact.contactName) || ""),
      email: String((contact && contact.email) || ""),
      segment: String((contact && contact.segment) || ""),
      city: String((contact && contact.city) || ""),
      status: String((contact && contact.status) || ""),
      emailsSent,
      intakes: bucket ? bucket.intakes : 0,
      firstIntakeAt: bucket ? bucket.firstIntakeAt : "",
      lastIntakeAt: bucket ? bucket.lastIntakeAt : "",
      unmatched: false,
    });
  }

  // Codes we saw on intakes but can't tie to a live contact. Never drop these:
  // silently discarding a real intake would understate the channel.
  for (const [code, bucket] of byCode) {
    if (claimed.has(code)) continue;
    rows.push({
      code,
      orgName: "",
      contactName: "",
      email: "",
      segment: "",
      city: "",
      status: "",
      emailsSent: 0,
      intakes: bucket.intakes,
      firstIntakeAt: bucket.firstIntakeAt,
      lastIntakeAt: bucket.lastIntakeAt,
      unmatched: true,
    });
  }

  rows.sort((a, b) => {
    if (b.intakes !== a.intakes) return b.intakes - a.intakes;
    if (b.emailsSent !== a.emailsSent) return b.emailsSent - a.emailsSent;
    return (a.contactName || a.orgName || a.code).localeCompare(
      b.contactName || b.orgName || b.code,
    );
  });

  const attributedIntakes = rows.reduce((sum, row) => sum + row.intakes, 0);
  return {
    rows,
    totals: {
      totalIntakes: attributedIntakes + organicIntakes,
      attributedIntakes,
      organicIntakes,
      referrersWithIntake: rows.filter((row) => row.intakes > 0).length,
      referrersEmailed: rows.filter((row) => row.emailsSent > 0).length,
    },
  };
}
