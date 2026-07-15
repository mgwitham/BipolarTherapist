// Claim-link rate-limit rule: max 3 fresh links per listing per hour.
// The history is stored as an array of ISO timestamps on the therapist
// doc so limiting survives across Vercel serverless cold starts (which
// would reset any in-memory counter). Extracted from
// server/review-claim-routes.mjs; the conflict-safe reservation loop
// (read → evaluate → ifRevisionId patch) stays server-side.
//
// Pure — no I/O. Callers pass `now` explicitly.

export const CLAIM_LINK_WINDOW_MS = 60 * 60 * 1000; // 1 hour
export const CLAIM_LINK_MAX_PER_WINDOW = 3;
export const CLAIM_LINK_HISTORY_CAP = 10;

// Evaluates a listing's claim-link request history at time `now` (ms).
// Returns { exceeded, recentCount, nextHistory } where nextHistory is
// the history to persist if the caller proceeds: in-window entries plus
// a stamp for this request, capped to the newest CLAIM_LINK_HISTORY_CAP.
export function evaluateClaimLinkRateLimit(requestHistory, now) {
  const history = Array.isArray(requestHistory) ? requestHistory : [];
  const cutoff = now - CLAIM_LINK_WINDOW_MS;
  const recent = history.filter(function (iso) {
    const t = new Date(iso).getTime();
    return Number.isFinite(t) && t >= cutoff;
  });
  return {
    exceeded: recent.length >= CLAIM_LINK_MAX_PER_WINDOW,
    recentCount: recent.length,
    nextHistory: recent.concat(new Date(now).toISOString()).slice(-CLAIM_LINK_HISTORY_CAP),
  };
}
