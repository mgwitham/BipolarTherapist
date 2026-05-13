// Runner for the daily 'outreach click → no claim' digest. Reads
// the funnelEventLog singleton, looks up claim status for each clicker,
// and emails the founder a summary.

import {
  buildOutreachClickDigest,
  renderOutreachClickDigestEmail,
} from "../shared/outreach-click-digest-domain.mjs";
import { hasEmailConfig, sendFounderAlert } from "./review-email.mjs";

const FUNNEL_LOG_ID = "funnelEventLog.singleton";

export async function runOutreachClickDigest({ client, config, nowIso }) {
  const summary = { ok: true, generatedAt: nowIso, sent: false, skipped_reason: null };

  if (!hasEmailConfig(config)) {
    summary.skipped_reason = "email_not_configured";
    return summary;
  }

  let events = [];
  try {
    const log = await client.getDocument(FUNNEL_LOG_ID);
    events = Array.isArray(log?.events) ? log.events : [];
  } catch (err) {
    summary.ok = false;
    summary.skipped_reason = "funnel_log_fetch_failed";
    summary.error = err?.message || String(err);
    return summary;
  }

  // Pull the slugs that appear in window events so we only fetch the
  // therapists we actually need to check claim status for.
  const slugsInWindow = new Set();
  for (const event of events) {
    if (event?.type !== "outreach_profile_viewed") continue;
    const payload =
      typeof event.payload === "string"
        ? safeParse(event.payload)
        : event.payload && typeof event.payload === "object"
          ? event.payload
          : {};
    const slug = String(payload.therapist_slug || "").trim();
    if (slug) slugsInWindow.add(slug);
  }

  let claimedSlugs = new Set();
  if (slugsInWindow.size > 0) {
    try {
      const rows = await client.fetch(
        `*[_type == "therapist" && slug.current in $slugs && claimStatus == "claimed"]{
          "slug": slug.current
        }`,
        { slugs: Array.from(slugsInWindow) },
      );
      claimedSlugs = new Set(rows.map((r) => r.slug).filter(Boolean));
    } catch (err) {
      summary.ok = false;
      summary.skipped_reason = "claim_status_fetch_failed";
      summary.error = err?.message || String(err);
      return summary;
    }
  }

  const digest = buildOutreachClickDigest({
    events,
    claimedBySlug: claimedSlugs,
    nowIso,
  });
  if (!digest) {
    summary.skipped_reason = "no_clicks";
    return summary;
  }

  const email = renderOutreachClickDigestEmail(digest);
  if (!email) {
    summary.skipped_reason = "render_failed";
    return summary;
  }

  await sendFounderAlert(config, email);
  summary.sent = true;
  summary.totalUniqueClickers = digest.totalUniqueClickers;
  summary.clickedNoClaim = digest.clickedNoClaim.length;
  return summary;
}

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return {};
  }
}
