// Detects therapists who requested a claim magic link but didn't
// complete the claim. Pure: callers fetch the candidate list from
// Sanity, then this domain decides which ones to alert on.
//
// Window logic: each abandoned request is alerted exactly once. The
// cron runs daily and only flags requests whose most-recent
// claimLinkRequests timestamp falls in a 24-hour sliding window
// [4h, 28h) old. With daily cadence, every request crosses the
// window in exactly one cron run, so no dedup state is needed.
// Latency: alerts land 1–23h after the 4h abandonment threshold,
// average ~12h. Tight enough for same/next-day follow-up.

export const DEFAULT_WINDOW_START_MS = 4 * 60 * 60 * 1000;
export const DEFAULT_WINDOW_END_MS = 28 * 60 * 60 * 1000;

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
    // newer than the end cutoff (<28h ago). That puts each request in
    // exactly one daily cron window.
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

export function buildAbandonedClaimAlert(record, options = {}) {
  const name = record.name || record.email || "Therapist";
  const portalBaseUrl = String(options.portalBaseUrl || "https://www.bipolartherapyhub.com").replace(
    /\/+$/,
    "",
  );
  const outreachUrl = record.slug
    ? `${portalBaseUrl}/outreach?slug=${encodeURIComponent(record.slug)}`
    : "";
  const lines = [
    `Name: ${record.name || "—"}`,
    `Email: ${record.email || "—"}`,
    `Slug: ${record.slug || "—"}`,
    `Requested at: ${record.requestedAt}`,
    "",
    "Consider a personal follow-up — they showed intent.",
  ];
  if (outreachUrl) {
    lines.push("", `Open in Outreach: ${outreachUrl}`);
  }
  return {
    subject: `[ABANDONED] ${name} requested a claim link but didn't claim`,
    lines,
  };
}
