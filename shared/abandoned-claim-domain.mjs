// Detects therapists who requested a claim magic link but didn't
// complete the claim. Pure: callers fetch the candidate list from
// Sanity, then this domain decides which ones to alert on.
//
// Window logic: each abandoned request is alerted exactly once. The
// cron runs hourly and only flags requests whose most-recent
// claimLinkRequests timestamp falls in a 1-hour sliding window that
// starts at WINDOW_START_MS_AGO and ends at WINDOW_END_MS_AGO. With
// the defaults (4h–5h ago) every abandoned request is in the window
// for exactly one cron run.

export const DEFAULT_WINDOW_START_MS = 4 * 60 * 60 * 1000;
export const DEFAULT_WINDOW_END_MS = 5 * 60 * 60 * 1000;

function latestTimestampMs(history) {
  if (!Array.isArray(history) || history.length === 0) return NaN;
  let latest = -Infinity;
  for (const iso of history) {
    const t = new Date(String(iso || "")).getTime();
    if (Number.isFinite(t) && t > latest) latest = t;
  }
  return Number.isFinite(latest) ? latest : NaN;
}

export function findAbandonedClaims({
  therapists,
  nowIso,
  windowStartMs = DEFAULT_WINDOW_START_MS,
  windowEndMs = DEFAULT_WINDOW_END_MS,
}) {
  const now = new Date(nowIso || new Date().toISOString()).getTime();
  if (!Number.isFinite(now)) return [];
  const startCutoff = now - windowStartMs;
  const endCutoff = now - windowEndMs;
  const list = Array.isArray(therapists) ? therapists : [];
  const abandoned = [];
  for (const t of list) {
    if (!t || t.claimStatus !== "claim_requested") continue;
    const latest = latestTimestampMs(t.claimLinkRequests);
    if (!Number.isFinite(latest)) continue;
    // Latest request must be older than the start cutoff (≥4h ago) and
    // newer than the end cutoff (<5h ago). That puts each request in
    // exactly one hourly cron window.
    if (latest > startCutoff || latest <= endCutoff) continue;
    abandoned.push({
      _id: t._id,
      name: t.name || "",
      email: t.email || "",
      slug: typeof t.slug === "object" ? t.slug?.current || "" : t.slug || "",
      requestedAt: new Date(latest).toISOString(),
    });
  }
  return abandoned;
}

export function buildAbandonedClaimAlert(record) {
  const name = record.name || record.email || "Therapist";
  return {
    subject: `[ABANDONED] ${name} requested a claim link but didn't claim`,
    lines: [
      `Name: ${record.name || "—"}`,
      `Email: ${record.email || "—"}`,
      `Slug: ${record.slug || "—"}`,
      `Requested at: ${record.requestedAt}`,
      "",
      "Consider a personal follow-up — they showed intent.",
    ],
  };
}
