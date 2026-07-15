// Canonical sessionStorage availability check (one source of truth).
// Wrapped in try/catch because accessing window.sessionStorage throws in
// some privacy modes (Safari ITP, blocked third-party contexts).
// Previously duplicated verbatim in cms.js, signup-quick-claim.js, and
// review-api.js.
export function canUseSessionStorage() {
  try {
    return typeof window !== "undefined" && !!window.sessionStorage;
  } catch (_error) {
    return false;
  }
}
