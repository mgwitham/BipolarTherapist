// Normalize US phone numbers to a single display format used across
// the site: `(NNN) NNN-NNNN`. Standard US convention since the 1960s,
// most readable for patient-facing copy, and trivial for browsers and
// screen readers to handle.
//
// The display string is what we STORE in Sanity (single source of
// truth). For `tel:` links the renderer strips non-digits at the
// last moment — see assets/directory-logic.js, match-ranking.js,
// match-contact-dialog.js. Storing display-format also keeps the
// Sanity studio UI legible for editors.
//
// Validation of "is this a usable phone?" lives in
// shared/contact-validation.mjs (validatePhone). This module is only
// concerned with FORMATTING, not gate-keeping. If the input doesn't
// look like a 10-digit US number we return it unchanged rather than
// silently corrupt it — the validator catches genuinely bad data.

export function formatPhoneUS(value) {
  if (value == null) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");

  // Strip leading "1" country code so 11-digit US numbers and bare
  // 10-digit numbers both normalize to the same thing. We don't try
  // to interpret international numbers — anything non-US gets passed
  // through as-is so a human can reformat it correctly.
  let national = digits;
  if (digits.length === 11 && digits.startsWith("1")) {
    national = digits.slice(1);
  }

  if (national.length !== 10) {
    // Not a 10-digit US number after stripping country code. Return
    // the original trimmed input so we don't lose data on edge cases
    // (international numbers, extensions, malformed entries).
    return raw;
  }

  const area = national.slice(0, 3);
  const exchange = national.slice(3, 6);
  const subscriber = national.slice(6, 10);
  return `(${area}) ${exchange}-${subscriber}`;
}
