// Canonical localStorage store for patient outreach outcomes (one source
// of truth). The reader was previously duplicated in match.js, admin.js,
// therapist-page.js, and responsiveness-signal.js, each redeclaring the
// storage key — a drift risk where renaming the key in one file would
// silently orphan the others' data.
export const OUTREACH_OUTCOMES_KEY = "bth_outreach_outcomes_v1";

// Newest-first list capped so the cache can't grow unbounded.
export const OUTREACH_OUTCOMES_CAP = 150;

export function readOutreachOutcomes() {
  try {
    return JSON.parse(window.localStorage.getItem(OUTREACH_OUTCOMES_KEY) || "[]");
  } catch (_error) {
    return [];
  }
}

// Persists the list (capped). Returns false when storage is unavailable
// (private mode, quota) so callers can skip dependent work.
export function writeOutreachOutcomes(list) {
  try {
    window.localStorage.setItem(
      OUTREACH_OUTCOMES_KEY,
      JSON.stringify((Array.isArray(list) ? list : []).slice(0, OUTREACH_OUTCOMES_CAP)),
    );
    return true;
  } catch (_error) {
    return false;
  }
}
