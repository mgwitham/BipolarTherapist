// Permanent outreach suppression logic. Pure matching only — the list
// itself lives in data/suppression.json and is loaded by
// server/outreach-suppression.mjs. Suppression is a legal opt-out record
// (e.g. a therapist replied STOP), so matches must hard-block sends and
// nothing (including force re-sends) may override them.

import { normalizeEmail } from "./normalize-email.mjs";

/**
 * Canonical form for suppression matching: lowercased and trimmed, so
 * casing or stray whitespace in either the list or the therapist record
 * can't let a suppressed address slip back into outreach. Thin alias of the
 * shared {@link normalizeEmail} so suppression and the rest of the outreach
 * stack can never disagree on what "the same address" means.
 *
 * @param {unknown} email
 * @returns {string}
 */
export function normalizeSuppressionEmail(email) {
  return normalizeEmail(email);
}

/**
 * Find the suppression entry matching an email address, or null.
 *
 * @param {Array<{ email?: string, reason?: string, date?: string }>} entries
 * @param {unknown} email
 * @returns {{ email?: string, reason?: string, date?: string } | null}
 */
export function findSuppressionEntry(entries, email) {
  const normalized = normalizeSuppressionEmail(email);
  if (!normalized) return null;
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry && normalizeSuppressionEmail(entry.email) === normalized) {
      return entry;
    }
  }
  return null;
}
