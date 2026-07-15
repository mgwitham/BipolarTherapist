// Canonical email masker (one source of truth) — "jane.doe@gmail.com" →
// "j***@g***.com". Used wherever we hint at an on-file email without
// revealing it (claim sign-in hints, recovery confirmations). Previously
// duplicated verbatim in review-claim-routes.mjs and
// review-recovery-routes.mjs.
//
// Pure — no I/O.
export function maskEmail(email) {
  const trimmed = String(email || "").trim();
  if (!trimmed) {
    return "";
  }
  const at = trimmed.indexOf("@");
  if (at < 1) {
    return trimmed.slice(0, 1) + "***";
  }
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const domainHead = dot > 0 ? domain.slice(0, dot) : domain;
  const domainTail = dot > 0 ? domain.slice(dot) : "";
  const maskLocal = local.slice(0, 1) + "***";
  const maskDomain = (domainHead ? domainHead.slice(0, 1) + "***" : "***") + domainTail;
  return maskLocal + "@" + maskDomain;
}
