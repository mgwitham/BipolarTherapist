// Browser capture for per-referrer attribution.
//
// A clinician's referral email links to /bipolar-therapists/<city>/?ref=<code>.
// The patient then wanders: city page -> profile -> match flow -> submit. The
// code has to survive that walk, so it is stashed on first sight and read back
// when the match request posts.
//
// First write wins, deliberately. If a patient arrives via Dr. Kennedy's link,
// leaves, and returns weeks later through a Google search, the credit stays
// with Kennedy for the attribution window. A later ?ref= from a *different*
// clinician does not overwrite it — first touch is the honest answer to "who
// sent this patient", and it can't be gamed by a second email.
//
// Storage is localStorage under the bth_* convention. The stored value is a
// professional's outreach code, never patient data.

import { parseReferralCode, sanitizeReferralCode } from "../shared/referral-attribution.mjs";

const STORAGE_KEY = "bth_referral_attribution_v1";

// Attribution window. Long enough for a real care decision (patients sit with a
// referral for weeks), short enough that a stale code doesn't credit a
// clinician for a patient who found the site independently months later.
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

function readStore() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const code = sanitizeReferralCode(parsed && parsed.code);
    const firstSeenAt = String((parsed && parsed.firstSeenAt) || "");
    if (!code || !firstSeenAt) return null;
    return { code, firstSeenAt };
  } catch (_error) {
    // Private mode, quota, or corrupt JSON: attribution is best-effort.
    return null;
  }
}

function isExpired(record, nowMs) {
  const seenMs = Date.parse(record.firstSeenAt);
  if (!Number.isFinite(seenMs)) return true;
  return nowMs - seenMs > MAX_AGE_MS;
}

/**
 * Persist a code on first sight. Returns the code now in force (which may be an
 * earlier one — first touch wins).
 *
 * @param {string} rawCode
 * @param {{ nowMs?: number }} [options]
 * @returns {string}
 */
export function captureReferralCode(rawCode, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const code = sanitizeReferralCode(rawCode);
  const existing = readStore();
  const live = existing && !isExpired(existing, nowMs) ? existing : null;

  if (live) return live.code;
  if (!code) return "";

  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ code, firstSeenAt: new Date(nowMs).toISOString() }),
    );
  } catch (_error) {
    // Storage unavailable: this page view stays attributed in-memory only.
  }
  return code;
}

/**
 * The attribution code in force for this visitor, or "" when there is none (or
 * it has aged out of the window).
 *
 * @param {{ nowMs?: number }} [options]
 * @returns {string}
 */
export function getReferralCode(options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const record = readStore();
  if (!record || isExpired(record, nowMs)) return "";
  return record.code;
}

/**
 * Read `?ref=` off the current URL and stash it. Safe to call on every page;
 * a page with no `?ref=` leaves any existing attribution untouched.
 *
 * @param {string} [search]
 * @returns {string}
 */
export function captureReferralFromUrl(search) {
  const query = typeof search === "string" ? search : window.location.search;
  const code = parseReferralCode(query);
  return captureReferralCode(code);
}
