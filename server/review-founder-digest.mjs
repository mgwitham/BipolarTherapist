// Founder funnel digest runner. Reads the funnelEventLog singleton,
// builds a 7-day rollup with prior-week comparison, and emails the
// summary to config.notificationTo. Triggered by the Vercel cron at
// api/cron/founder-digest.mjs.

import {
  buildFounderFunnelDigest,
  renderFounderFunnelEmail,
} from "../shared/founder-funnel-digest-domain.mjs";
import { hasEmailConfig, sendEmail } from "./review-email.mjs";

const FUNNEL_LOG_ID = "funnelEventLog.singleton";

function parseEventPayload(events) {
  if (!Array.isArray(events)) return [];
  return events.map(function (raw) {
    if (!raw || typeof raw !== "object") return null;
    return {
      type: String(raw.type || ""),
      occurredAt: String(raw.occurredAt || ""),
      payload: raw.payload || "",
    };
  });
}

export async function runFounderDigest(options) {
  const client = options && options.client;
  const config = options && options.config;
  const adminUrl = (options && options.adminUrl) || "";
  const nowIso = (options && options.nowIso) || new Date().toISOString();

  if (!client || !config) {
    throw new Error("runFounderDigest requires { client, config }.");
  }

  const summary = {
    ok: true,
    generatedAt: nowIso,
    sent: false,
    skipped_reason: null,
  };

  if (!hasEmailConfig(config)) {
    summary.skipped_reason = "email_not_configured";
    return summary;
  }

  const log = await client.getDocument(FUNNEL_LOG_ID);
  const events = parseEventPayload(log && log.events);

  const digest = buildFounderFunnelDigest({ events, nowIso });
  if (!digest) {
    summary.skipped_reason = "no_activity";
    return summary;
  }

  const { subject, text } = renderFounderFunnelEmail({ digest, adminUrl });

  await sendEmail(config, {
    from: config.emailFrom,
    to: [config.notificationTo],
    subject,
    text,
  });

  summary.sent = true;
  summary.subject = subject;
  summary.patient_started = digest.patient.started;
  summary.patient_reached_contact = digest.patient.reachedContact;
  summary.bottleneck = digest.patient.bottleneck;
  return summary;
}
