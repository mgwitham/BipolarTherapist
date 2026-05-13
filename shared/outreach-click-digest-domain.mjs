// Aggregates outreach_profile_viewed funnel events into a daily
// digest: which therapists clicked the outreach email link in the
// previous 24h, and which of them have NOT claimed yet.

const DAY_MS = 24 * 60 * 60 * 1000;

function parsePayload(raw) {
  if (raw && typeof raw === "object") return raw;
  if (typeof raw === "string" && raw.trim()) {
    try {
      return JSON.parse(raw);
    } catch (_error) {
      return {};
    }
  }
  return {};
}

// Pure: given the raw funnel-event list, the {slug → therapist}
// status map, and a reference time, return the digest payload.
//   - events: array of { type, occurredAt, payload }
//   - claimedBySlug: Set<string> of slugs that already claimed
//   - nowIso: ISO timestamp (window is the 24h before this)
export function buildOutreachClickDigest({ events, claimedBySlug, nowIso }) {
  const now = new Date(nowIso || new Date().toISOString()).getTime();
  if (!Number.isFinite(now)) return null;
  const windowStart = now - DAY_MS;

  // Dedup by slug + take the earliest view within the window for each.
  const firstViewBySlug = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    if (!event || event.type !== "outreach_profile_viewed") continue;
    const t = new Date(String(event.occurredAt || "")).getTime();
    if (!Number.isFinite(t) || t < windowStart || t >= now) continue;
    const payload = parsePayload(event.payload);
    const slug = String(payload.therapist_slug || "").trim();
    if (!slug) continue;
    const existing = firstViewBySlug.get(slug);
    if (!existing || t < existing) firstViewBySlug.set(slug, t);
  }
  if (firstViewBySlug.size === 0) return null;

  const claimed = claimedBySlug instanceof Set ? claimedBySlug : new Set(claimedBySlug || []);
  const rows = [];
  let clickedAndClaimed = 0;
  for (const [slug, viewedAtMs] of firstViewBySlug.entries()) {
    const hasClaimed = claimed.has(slug);
    if (hasClaimed) clickedAndClaimed += 1;
    rows.push({
      slug,
      viewedAt: new Date(viewedAtMs).toISOString(),
      claimed: hasClaimed,
    });
  }
  rows.sort((a, b) => (a.viewedAt < b.viewedAt ? -1 : 1));
  return {
    windowStart: new Date(windowStart).toISOString(),
    windowEnd: new Date(now).toISOString(),
    totalUniqueClickers: rows.length,
    clickedAndClaimed,
    clickedNoClaim: rows.filter((r) => !r.claimed),
  };
}

export function renderOutreachClickDigestEmail(digest) {
  if (!digest) return null;
  const lines = [
    `${digest.totalUniqueClickers} therapist${digest.totalUniqueClickers === 1 ? "" : "s"} clicked their outreach link in the last 24h.`,
    `${digest.clickedAndClaimed} claimed. ${digest.clickedNoClaim.length} clicked but did NOT claim.`,
    "",
  ];
  if (digest.clickedNoClaim.length > 0) {
    lines.push("Clicked but did not claim:");
    for (const r of digest.clickedNoClaim) {
      lines.push(`- ${r.slug} (viewed ${r.viewedAt})`);
    }
  } else {
    lines.push("Every clicker also claimed. Nice.");
  }
  return {
    subject: `[OUTREACH] ${digest.clickedNoClaim.length} clicked, no claim (last 24h)`,
    lines,
  };
}
