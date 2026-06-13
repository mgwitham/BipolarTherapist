// Canonical email normalizer for the whole codebase. One implementation so
// "is this the same address?" can't drift between layers (the suppression
// list, the referral CRM, dedup, and any future matching all compare on the
// SAME normalized form — lowercased and trimmed). Casing and surrounding
// whitespace must never be the reason a suppressed or duplicate address slips
// through.
//
// Intentionally conservative: it does NOT strip dots or +tags (gmail-style
// canonicalization), because that is provider-specific and would wrongly
// merge distinct addresses on other hosts. Trim + lowercase only.

/**
 * @param {unknown} email
 * @returns {string}
 */
export function normalizeEmail(email) {
  return String(email == null ? "" : email)
    .trim()
    .toLowerCase();
}
