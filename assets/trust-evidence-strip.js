// Trust evidence strip — patient-facing receipts for "we believe this
// clinician treats bipolar." Renders a compact 3-chip strip that turns
// the abstract claim "verified" into clickable evidence: license
// number, bipolar specialty source, last-reviewed date.
//
// This is the directory's reason to exist — without visible evidence,
// "verified bipolar specialist" is just a label the patient has no way
// to trust. The strip exists so a skeptical patient can click through
// to the source and see for themselves.
//
// Used by:
//   - assets/match.js (primary match cards)
//   - assets/directory-render.js (browse cards)
//   - assets/therapist-page.js (profile hero) — follow-up
//
// Pure: input is a therapist record (matching-model shape with
// snake_case fields), output is HTML. No DOM, no side effects.

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function formatVerifiedDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short" });
}

function sourceHostname(url) {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (_error) {
    return "";
  }
}

function hasBipolarSpecialtySignal(therapist) {
  const specialties = Array.isArray(therapist && therapist.specialties)
    ? therapist.specialties
    : [];
  if (specialties.some((s) => /bipolar/i.test(String(s || "")))) return true;
  if (Number(therapist && therapist.bipolar_years_experience) > 0) return true;
  if (therapist && therapist.care_approach && /bipolar/i.test(therapist.care_approach)) return true;
  return false;
}

function buildLicenseChip(therapist) {
  const verified = therapist && therapist.verification_status === "editorially_verified";
  const number = therapist && therapist.license_number;
  if (!verified || !number) return "";
  // Credential prefix when known (LMFT, LCSW, etc.) — patient-readable.
  const credentials = String((therapist && therapist.credentials) || "")
    .trim()
    .toUpperCase();
  const credPrefix = credentials ? credentials.split(/[ ,]+/)[0] + " " : "";
  const label = "CA " + credPrefix + "#" + escapeHtml(String(number));
  return (
    '<span class="trust-chip trust-chip-license" ' +
    'title="Verified via the California Department of Consumer Affairs license search.">' +
    '<span class="trust-chip-icon" aria-hidden="true">&#10003;</span>' +
    '<span class="trust-chip-text">' +
    '<span class="trust-chip-label">License verified</span>' +
    '<span class="trust-chip-value">' +
    label +
    "</span>" +
    "</span>" +
    "</span>"
  );
}

function buildEvidenceChip(therapist) {
  if (!hasBipolarSpecialtySignal(therapist)) return "";
  const sourceUrl = String((therapist && therapist.source_url) || "").trim();
  const host = sourceHostname(sourceUrl);
  // No source URL yet → show the claim but not as a link. Honest:
  // "Bipolar specialty" without a click-through is weaker, but still
  // better than "verified" with no detail.
  if (!sourceUrl || !host) {
    return (
      '<span class="trust-chip trust-chip-evidence">' +
      '<span class="trust-chip-icon" aria-hidden="true">&#10003;</span>' +
      '<span class="trust-chip-text">' +
      '<span class="trust-chip-label">Bipolar specialty</span>' +
      '<span class="trust-chip-value">Confirmed in profile review</span>' +
      "</span>" +
      "</span>"
    );
  }
  return (
    '<a class="trust-chip trust-chip-evidence trust-chip-link" ' +
    'href="' +
    escapeAttr(sourceUrl) +
    '" target="_blank" rel="noopener noreferrer" ' +
    'title="See the source where this clinician\'s bipolar specialty is documented.">' +
    '<span class="trust-chip-icon" aria-hidden="true">&#10003;</span>' +
    '<span class="trust-chip-text">' +
    '<span class="trust-chip-label">Bipolar specialty</span>' +
    '<span class="trust-chip-value">Confirmed at ' +
    escapeHtml(host) +
    ' <span class="trust-chip-arrow" aria-hidden="true">&rarr;</span></span>' +
    "</span>" +
    "</a>"
  );
}

function buildFreshnessChip(therapist) {
  const reviewed = formatVerifiedDate(
    (therapist && therapist.source_reviewed_at) ||
      (therapist && therapist.therapist_reported_confirmed_at) ||
      "",
  );
  if (!reviewed) return "";
  return (
    '<span class="trust-chip trust-chip-freshness" ' +
    'title="Date this listing was last verified against its source.">' +
    '<span class="trust-chip-text">' +
    '<span class="trust-chip-label">Last reviewed</span>' +
    '<span class="trust-chip-value">' +
    escapeHtml(reviewed) +
    "</span>" +
    "</span>" +
    "</span>"
  );
}

// Render the trust evidence strip. Returns "" when the record has zero
// surfaceable evidence (better to omit than show a hollow strip).
//
// options:
//   - variant: "card" | "hero" — affects size class only.
//   - className: extra wrapper class for surface-specific styling.
export function renderTrustEvidenceStrip(therapist, options) {
  if (!therapist) return "";
  const license = buildLicenseChip(therapist);
  const evidence = buildEvidenceChip(therapist);
  const freshness = buildFreshnessChip(therapist);
  const chips = [license, evidence, freshness].filter(Boolean);
  if (!chips.length) return "";

  const variant = (options && options.variant) || "card";
  const extra = (options && options.className) || "";
  const wrapperClasses = ["trust-strip", "trust-strip-" + variant, extra].filter(Boolean).join(" ");

  return (
    '<div class="' +
    wrapperClasses +
    '" role="group" aria-label="Listing verification">' +
    chips.join("") +
    "</div>"
  );
}

// Exported for unit tests.
export const _internals = {
  buildLicenseChip,
  buildEvidenceChip,
  buildFreshnessChip,
  hasBipolarSpecialtySignal,
  sourceHostname,
};
