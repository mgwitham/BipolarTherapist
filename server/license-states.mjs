// Single source of truth for which US states the platform supports for
// license verification. All geographic assumptions in business logic
// should reference these exports rather than hardcoding "CA".
//
// TO ADD A NEW STATE (e.g. Texas):
//   1. Add "TX" to SUPPORTED_LICENSE_STATES below.
//   2. Add its board info to LICENSE_STATE_BOARD_INFO below.
//   3. Implement a license verification client for that state's board
//      (equivalent to server/dca-license-client.mjs).
//   4. Register it in getLicenseVerifierForState() below.
//   5. Add a state selector to the therapist signup form and remove the
//      DEFAULT_LICENSE_STATE fallback from review-application-routes.mjs.

export const SUPPORTED_LICENSE_STATES = new Set(["CA"]);

// Fallback used by the signup intake form, which currently has no state
// selector (the form is CA-only). Remove this constant and read the value
// from the submitted form body once multi-state signup launches.
export const DEFAULT_LICENSE_STATE = "CA";

// Normalizes an optional license_state form/body value, defaulting to
// DEFAULT_LICENSE_STATE while the CA-only forms omit the field. Used by the
// claim / recovery / listing-removal flows so a license number is always
// resolved within ONE state's namespace — two states can issue the same
// number, and an unscoped lookup would resolve the wrong profile once a
// second state launches.
export function readLicenseStateParam(value) {
  const state = String(value || "")
    .trim()
    .toUpperCase();
  return state || DEFAULT_LICENSE_STATE;
}

// ─── State board info ─────────────────────────────────────────────────────────

const LICENSE_STATE_BOARD_INFO = {
  CA: {
    abbreviation: "CA",
    fullName: "California",
    boardNames: "California Board of Behavioral Sciences / Board of Psychology / Medical Board",
    renewalInstruction:
      "Renew with the California Board of Behavioral Sciences / Board of Psychology / Medical Board (whichever issued your license).",
    freshnessCheckNote: "we re-check CA DCA every week",
  },
};

// Returns display strings for the given license state.
// Falls back to generic language so emails remain accurate even if a
// therapist's licenseState is missing or set to an unsupported value.
export function getLicenseStateBoardInfo(licenseState) {
  return (
    LICENSE_STATE_BOARD_INFO[licenseState] || {
      abbreviation: licenseState || "",
      fullName: licenseState || "your state",
      boardNames: "your state licensing board",
      renewalInstruction:
        "Contact your state licensing board to renew. Once the state shows your license as active, your directory listing will stay live.",
      freshnessCheckNote: "we periodically re-check license status",
    }
  );
}

// ─── License verifier routing ─────────────────────────────────────────────────

// Returns the state's verifier object (the interface documented on
// caLicenseVerifier in dca-license-client.mjs: isConfigured,
// normalizeLicenseNumber, resolveBoardCode, verifyByBoardCode,
// verifyByNumber, interCallDelayMs), or null when no verifier is
// registered for that state.
//
// State clients are imported lazily so contexts that never verify (unit
// tests, non-CA branches) don't load them.
//
// TO ADD A NEW STATE: implement a verifier object with the same shape in
// its own client module (e.g. server/wa-license-client.mjs wrapping the
// data.wa.gov Socrata dataset) and add a case below. The number
// normalizer is PER-STATE — do not reuse CA's digit-only cleanup for
// states whose boards key on alphanumeric license IDs.
export async function getLicenseVerifierForState(licenseState) {
  if (licenseState === "CA") {
    const { caLicenseVerifier } = await import("./dca-license-client.mjs");
    return caLicenseVerifier;
  }
  // No verifier registered for this state yet. Callers must treat this as
  // "cannot verify" (intake: reject; cron: count as unmonitoredState).
  return null;
}
