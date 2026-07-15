// Fuzzy name match for DCA licensee vs applicant-submitted name — the
// identity gate for instant signup approval. Stops someone from looking
// up a colleague's license number and registering under their own name.
// Extracted from server/review-application-routes.mjs so the matching
// rules are unit-testable in isolation.
//
// Pure — no I/O.

// Last name must match exactly (case/punct/space-insensitive). First
// name must share at least 2 leading chars OR one wholly contains the
// other (handles Mike/Michael, Liz/Elizabeth). Hyphens and middle
// names are tolerated. Returns true if names plausibly belong to the
// same person.
export function applicantNameMatchesDcaLicensee(submittedFullName, dcaLicensee) {
  if (!submittedFullName || !dcaLicensee) return false;
  const norm = (s) =>
    String(s || "")
      .toUpperCase()
      .replace(/[^A-Z]/g, "");
  // Strip honorifics + credential suffixes (Dr./Mr./Ms./Mrs./Prof. and trailing
  // PhD/PsyD/MD/LMFT/etc) so we tokenize only the legal-name portion.
  const HONORIFIC = /^(DR\.?|MR\.?|MRS\.?|MS\.?|PROF\.?)\s+/i;
  const SUFFIX =
    /,?\s*(PHD|PSYD|MD|DO|LMFT|LCSW|LPCC|MFT|MA|MS|MSW|DNP|PMHNP|APRN|MFCC|LCP|LP|EDD|JD|RN|MFC|JR|SR|II|III|IV)\.?\s*$/i;
  let cleaned = String(submittedFullName).trim();
  while (HONORIFIC.test(cleaned)) cleaned = cleaned.replace(HONORIFIC, "");
  // Only strip a credential suffix while a first + last name would remain.
  // Some real surnames are credential lookalikes ("Wei Ma", "John Do");
  // stripping those left a single token and falsely rejected the applicant.
  while (SUFFIX.test(cleaned)) {
    const next = cleaned.replace(SUFFIX, "");
    if (next.trim().split(/\s+/).filter(Boolean).length < 2) break;
    cleaned = next;
  }
  const submittedTokens = cleaned.trim().split(/\s+/).filter(Boolean);
  if (submittedTokens.length < 2) return false;
  const submittedFirst = norm(submittedTokens[0]);
  const submittedLast = norm(submittedTokens[submittedTokens.length - 1]);
  const dcaFirst = norm(dcaLicensee.firstName);
  const dcaLast = norm(dcaLicensee.lastName);
  if (!submittedFirst || !submittedLast || !dcaFirst || !dcaLast) return false;
  if (submittedLast !== dcaLast) return false;
  if (submittedFirst === dcaFirst) return true;
  if (submittedFirst.length < 2 || dcaFirst.length < 2) return false;
  if (
    submittedFirst.startsWith(dcaFirst.slice(0, 2)) ||
    dcaFirst.startsWith(submittedFirst.slice(0, 2))
  )
    return true;
  if (submittedFirst.includes(dcaFirst) || dcaFirst.includes(submittedFirst)) return true;
  return false;
}
