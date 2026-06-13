// Cadence cron: auto-send the next DUE touch for each referral contact, so
// follow-ups go out on schedule without an admin clicking. Reuses the same send
// core (suppression, footer, From: fallback) as the manual send path.
//
// OFF BY DEFAULT. Auto-sending cold email is consequential, so the job no-ops
// unless REFERRAL_CADENCE_ENABLED=true. Even when enabled it is bounded:
//   - only contacts whose next touch is actually due (cadence delays respected)
//   - never halted/opted-out/bounced/complete contacts (nextReferralTouch + the
//     query filter), and the global suppression list is re-checked per send
//   - capped per run (REFERRAL_CADENCE_DAILY_LIMIT, default 15)
//   - fails closed if the From:/footer config is missing.

import { log } from "./logger.mjs";
import { getSuppressionEntry } from "./outreach-suppression.mjs";
import { selectDueReferralTouches } from "../shared/referral-cadence-domain.mjs";
import { deliverReferralTouch, getReferralSendConfig } from "./referral-send-core.mjs";

const HALTING = ["replied", "engaged", "partner", "opted_out", "bounced", "skipped"];

export async function runReferralCadence({ client, nowIso, limit } = {}) {
  const enabled = String(process.env.REFERRAL_CADENCE_ENABLED || "").toLowerCase() === "true";
  if (!enabled) {
    return { enabled: false, sent: 0, reason: "REFERRAL_CADENCE_ENABLED not set" };
  }

  const cap = Number.isFinite(limit)
    ? limit
    : Number(process.env.REFERRAL_CADENCE_DAILY_LIMIT) || 15;
  const now = nowIso || new Date().toISOString();

  const config = getReferralSendConfig();
  if (!config.ok) {
    return { enabled: true, sent: 0, error: config.error };
  }

  let contacts;
  try {
    contacts = await client.fetch(
      `*[_type == "referralContact" && defined(email) && optedOut != true && !(status in $halting)]{
        _id, email, orgName, contactName, segment, status, sequence, lastContactedAt, emailsSent, emailLog
      } | order(coalesce(lastContactedAt, "1970-01-01") asc)`,
      { halting: HALTING },
    );
  } catch (err) {
    log.error("referral cadence fetch error", { err: err?.message || String(err) });
    return { enabled: true, sent: 0, error: "fetch_failed" };
  }

  const due = selectDueReferralTouches(Array.isArray(contacts) ? contacts : [], {
    nowIso: now,
    limit: cap,
  });

  let sent = 0;
  let suppressed = 0;
  let failed = 0;
  for (const { contact, template } of due) {
    // Re-check the global STOP list at send time (it may have changed since the
    // contact was queried).
    try {
      if (getSuppressionEntry(contact.email)) {
        suppressed += 1;
        continue;
      }
    } catch (err) {
      log.error("referral cadence suppression read error", { err: err?.message || String(err) });
      failed += 1;
      continue;
    }
    try {
      await deliverReferralTouch(client, contact, {
        template,
        config,
        campaign: "cadence",
        nowIso: now,
      });
      sent += 1;
    } catch (err) {
      log.error("referral cadence send failed", {
        id: contact._id,
        err: err?.message || String(err),
      });
      failed += 1;
    }
  }

  return {
    enabled: true,
    candidates: due.length,
    sent,
    suppressed,
    failed,
    isolated: config.isolated,
  };
}
