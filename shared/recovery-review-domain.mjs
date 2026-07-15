// Suspicious-pattern rules for the admin recovery-request review queue
// (GET /recovery-requests). Extracted from server/review-recovery-routes.mjs
// so the fraud-flag heuristics are unit-testable in isolation.
//
// Pure — no I/O. Callers pass `now` explicitly.

// Free-mail providers that carry no domain-ownership signal for a
// recovery request. Deliberately a SEPARATE (smaller) list from
// FREE_EMAIL_DOMAINS in email-domain-matching.mjs: this one only feeds
// an admin-facing "verify through another channel" warning, and the two
// lists were already different before extraction. Unifying them is a
// deliberate follow-up decision, not a refactor side effect.
const RECOVERY_FLAG_FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "mail.com",
]);

const THIRTY_DAYS_MS = 30 * 86400000;

// Truncates a requester IP for storage: IPv4 keeps the /24 and masks the
// last octet ("1.2.3.4" → "1.2.3.x"); anything else (IPv6, garbage,
// empty) stores nothing. Accepts the raw header value, which may be a
// comma-separated x-forwarded-for chain — only the first hop counts.
export function anonymizeRequesterIp(raw) {
  const first = String(raw || "")
    .split(",")[0]
    .trim();
  const parts = first.split(".");
  return parts.length === 4 ? parts.slice(0, 3).join(".") + ".x" : "";
}

// Counts how many DIFFERENT licenses each requester IP has filed
// recovery requests for in the last 30 days. >1 means the same
// person/IP is filing for multiple therapists — suspicious.
// Returns Map<ip, Set<licenseNumber>>.
export function countRecentLicensesByIp(requests, now) {
  const ipCounts = new Map();
  const cutoff = now - THIRTY_DAYS_MS;
  for (const r of Array.isArray(requests) ? requests : []) {
    if (!r.requesterIp) continue;
    const created = new Date(r.createdAt || 0).getTime();
    if (created < cutoff) continue;
    if (!ipCounts.has(r.requesterIp)) ipCounts.set(r.requesterIp, new Set());
    ipCounts.get(r.requesterIp).add(r.licenseNumber);
  }
  return ipCounts;
}

// Builds the admin-facing warning flags for one recovery request.
// `anchor` is the linked therapist's verification snapshot (or null);
// `ipCounts` comes from countRecentLicensesByIp over the full queue.
export function buildRecoveryRequestFlags(request, anchor, ipCounts) {
  const flags = [];
  const requestedDomain = String(request.requestedEmail || "")
    .split("@")[1]
    ?.toLowerCase();
  if (requestedDomain && RECOVERY_FLAG_FREE_EMAIL_DOMAINS.has(requestedDomain)) {
    flags.push({
      severity: "warn",
      code: "free_email_provider",
      message:
        "Requested email is at a free provider (gmail/yahoo/etc.), no domain anchor. Verify identity through another channel.",
    });
  }
  const ipLicenses = request.requesterIp ? ipCounts.get(request.requesterIp) : null;
  if (ipLicenses && ipLicenses.size > 1) {
    flags.push({
      severity: "high",
      code: "multi_license_same_ip",
      message: `Same IP (${request.requesterIp}) has filed recovery requests for ${ipLicenses.size} different licenses in the last 30 days. Investigate before approving.`,
    });
  }
  if (anchor && anchor.disciplineFlag) {
    flags.push({
      severity: "high",
      code: "discipline_on_file",
      message:
        "DCA shows public disciplinary actions on this license. Approval will give the requester control of a profile that may need to be unpublished.",
    });
  }
  if (anchor && anchor.licenseStatus && anchor.licenseStatus !== "active") {
    flags.push({
      severity: "high",
      code: "license_not_active",
      message: `DCA shows license status as "${anchor.licenseStatus}" (not active). Verify before approving. The listing may need to be unpublished instead.`,
    });
  }
  if (anchor && !anchor.email && !anchor.website) {
    flags.push({
      severity: "warn",
      code: "no_anchors_available",
      message:
        "No email, no website on the profile. Only DCA address-of-record + phone (if any) are verification channels. Consider phone verification or postal code.",
    });
  }
  return flags;
}
