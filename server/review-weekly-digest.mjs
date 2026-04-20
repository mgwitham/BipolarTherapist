// Weekly engagement digest runner. Intended to be called by a Vercel
// cron job every Monday morning UTC. For each paid therapist with
// activity in the prior ISO week, build a digest and email it to the
// address on file. Idempotent per-week via `lastWeeklyDigestSentAt`
// on the therapist doc — re-running the job in the same week is safe.
//
// Not exposed via the HTTP handler dispatcher: the cron entry in
// `api/cron/weekly-digest.mjs` imports this directly.

import {
  buildEngagementPeriodKey,
  buildEngagementPeriodStart,
} from "../shared/therapist-engagement-domain.mjs";
import { buildWeeklyDigest } from "../shared/weekly-digest-domain.mjs";
import { sendWeeklyDigestEmail } from "./review-email.mjs";

// Compute the ISO week key for the week before the given date.
export function previousWeekKey(isoString) {
  const now = new Date(isoString || new Date().toISOString());
  const shifted = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return buildEngagementPeriodKey(shifted.toISOString());
}

// Compute the target (prior) + preceding (prior-prior) week keys. The
// digest is for the _previous_ week — running Monday morning, we report
// on the full week that just closed, not the current partial week.
export function deriveDigestWindow(isoString) {
  const now = new Date(isoString || new Date().toISOString());
  const targetKey = previousWeekKey(now.toISOString());
  const targetStart = buildEngagementPeriodStart(
    new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
  );
  const priorKey = previousWeekKey(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString());
  return { targetKey, targetStart, priorKey };
}

// Core runner. Accepts an abstract Sanity-ish client (must support
// fetch + patch) plus the API config. Returns an execution summary
// the caller (Vercel cron endpoint or admin trigger) can log.
export async function runWeeklyDigest(options) {
  const client = options && options.client;
  const config = options && options.config;
  const nowIso = (options && options.nowIso) || new Date().toISOString();
  const portalBaseUrl = (options && options.portalBaseUrl) || "";
  if (!client || !config) {
    throw new Error("runWeeklyDigest requires { client, config }.");
  }

  const { targetKey, priorKey } = deriveDigestWindow(nowIso);

  // Pull every active-featured subscription along with its therapist
  // and the two relevant engagement rollups. One round-trip keeps the
  // function cheap to run in the cron environment.
  const recipients = await client.fetch(
    `*[_type == "therapistSubscription" && plan == "featured" && status in ["active", "trialing"]]{
      therapistSlug,
      "therapist": *[_type == "therapist" && slug.current == ^.therapistSlug][0]{
        _id, name, email, "slug": slug.current, listingActive,
        lastWeeklyDigestSentAt
      },
      "current": *[_type == "therapistEngagementSummary" && therapistSlug == ^.therapistSlug && periodKey == $targetKey][0]{
        periodKey, periodStart, profileViewsTotal, profileViewsMatch, profileViewsDirectory,
        profileViewsDirect, profileViewsOther, profileViewsSearch, profileViewsEmail,
        ctaClicksTotal, ctaClicksPhone, ctaClicksEmail, ctaClicksBooking, ctaClicksWebsite,
        lastEventAt
      },
      "previous": *[_type == "therapistEngagementSummary" && therapistSlug == ^.therapistSlug && periodKey == $priorKey][0]{
        periodKey, profileViewsTotal, ctaClicksTotal
      }
    }`,
    { targetKey, priorKey },
  );

  const summary = {
    ok: true,
    target_week: targetKey,
    considered: Array.isArray(recipients) ? recipients.length : 0,
    sent: 0,
    skipped_no_activity: 0,
    skipped_no_email: 0,
    skipped_listing_inactive: 0,
    skipped_already_sent: 0,
    send_errors: 0,
    errors: [],
  };

  for (const row of recipients || []) {
    const therapist = row && row.therapist;
    if (!therapist || !therapist.slug || !therapist.email) {
      summary.skipped_no_email += 1;
      continue;
    }
    if (therapist.listingActive === false) {
      summary.skipped_listing_inactive += 1;
      continue;
    }
    const lastSentAt = therapist.lastWeeklyDigestSentAt || "";
    if (lastSentAt) {
      const lastSentKey = buildEngagementPeriodKey(lastSentAt);
      if (lastSentKey === buildEngagementPeriodKey(nowIso)) {
        summary.skipped_already_sent += 1;
        continue;
      }
    }
    const digest = buildWeeklyDigest({
      current: row.current,
      previous: row.previous,
      nowIso,
    });
    if (!digest) {
      summary.skipped_no_activity += 1;
      continue;
    }
    try {
      await sendWeeklyDigestEmail(config, therapist, digest, portalBaseUrl);
      summary.sent += 1;
      try {
        await client.patch(therapist._id).set({ lastWeeklyDigestSentAt: nowIso }).commit();
      } catch (patchError) {
        // Non-fatal: the email went out; worst case we dedupe via the
        // current-period check on the next run.
        summary.errors.push({ slug: therapist.slug, step: "patch", message: String(patchError) });
      }
    } catch (sendError) {
      summary.send_errors += 1;
      summary.errors.push({ slug: therapist.slug, step: "send", message: String(sendError) });
    }
  }

  return summary;
}
