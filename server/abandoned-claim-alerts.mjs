// Runner for the abandoned-claim alert cron. Fetches candidate
// therapists (claimStatus == "claim_requested"), runs the domain
// detector, and sends a founder alert per abandoned record.
//
// Wired into a Vercel cron at api/cron/abandoned-claim-alerts.mjs.

import {
  findAbandonedClaims,
  buildAbandonedClaimAlert,
} from "../shared/abandoned-claim-domain.mjs";
import { hasEmailConfig, sendFounderAlert } from "./review-email.mjs";

export async function runAbandonedClaimAlerts({ client, config, nowIso }) {
  const summary = { ok: true, generatedAt: nowIso, alerts: 0, skipped_reason: null };

  if (!hasEmailConfig(config)) {
    summary.skipped_reason = "email_not_configured";
    return summary;
  }

  let therapists = [];
  try {
    therapists = await client.fetch(
      `*[_type == "therapist" && claimStatus == "claim_requested"]{
        _id, name, email, "slug": slug.current, claimStatus, claimLinkRequests
      }`,
    );
  } catch (err) {
    summary.ok = false;
    summary.skipped_reason = "sanity_fetch_failed";
    summary.error = err?.message || String(err);
    return summary;
  }

  const abandoned = findAbandonedClaims({ therapists, nowIso });
  for (const record of abandoned) {
    try {
      await sendFounderAlert(config, buildAbandonedClaimAlert(record));
      summary.alerts += 1;
    } catch (_err) {
      // Continue on send failures — partial delivery is better than none.
    }
  }
  return summary;
}
