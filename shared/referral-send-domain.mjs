// Pure orchestration logic for sending a referral outreach email. The HTTP
// handler (api/admin/send-referral-email.mjs) does the I/O — auth, rate limit,
// suppression read, Resend call, Sanity write — and delegates every decision
// (which template, what content, what the post-send record looks like) here so
// it's testable without a network.

import { REFERRAL_TEMPLATES, getReferralTemplate } from "./referral-outreach-templates.mjs";
import { nextReferralTouch } from "./referral-sequence-domain.mjs";
import { plainTextToHtml } from "./plain-text-to-html.mjs";

// The public homepage is the call-to-action for every referral email.
export const DEFAULT_DIRECTORY_URL = "https://www.bipolartherapyhub.com";

/**
 * Decide which template to send for a contact. An explicit `templateOverride`
 * (admin picked one) wins after validation; otherwise the cadence decides via
 * nextReferralTouch. Returns `{ template, ... }` or `{ error, reason }` when
 * there's nothing to send (halted, opted out, sequence complete).
 *
 * @param {object} contact
 * @param {{ templateOverride?: string, nowIso?: string }} [options]
 * @returns {{ template: string, step?: number, dueAt?: string, isDue?: boolean } | { error: string, reason: string }}
 */
export function resolveReferralSend(contact, options = {}) {
  const override = options.templateOverride;
  if (override) {
    if (!REFERRAL_TEMPLATES.includes(override)) {
      return { error: "unknown_template", reason: override };
    }
    return { template: override };
  }
  const next = nextReferralTouch(contact, { nowIso: options.nowIso });
  const template = next.template;
  if (!template) {
    return { error: "no_touch_due", reason: next.reason || "unknown" };
  }
  return { template, step: next.step, dueAt: next.dueAt, isDue: next.isDue };
}

/**
 * The subject of the intro this contact actually received, from the email log.
 * "" when no intro has been logged.
 *
 * @param {{ emailLog?: unknown }} record
 * @returns {string}
 */
function sentIntroSubject(record) {
  const log = Array.isArray(record.emailLog) ? record.emailLog : [];
  for (let index = log.length - 1; index >= 0; index -= 1) {
    const entry = log[index] || {};
    if (entry.template === "referral_intro" && String(entry.subject || "").trim()) {
      return String(entry.subject).trim();
    }
  }
  return "";
}

/**
 * Build the subject/text/html for a referral send. `footer` is the CAN-SPAM
 * footer ({ text, html }) appended to every commercial email; passed in so this
 * stays pure (the handler reads the address from env).
 *
 * A follow-up threads under the intro subject the contact actually received
 * (from the email log), not the current template's subject — segment copy can
 * change between touches, and a "Re:" to a subject that was never sent reads
 * as spam.
 *
 * @param {object} contact
 * @param {{ template: string, directoryUrl?: string, footer?: { text?: string, html?: string } }} params
 * @returns {{ subject: string, text: string, html: string }}
 */
export function buildReferralEmailContent(contact, params) {
  const record = contact || {};
  const footer = params.footer || {};
  const { subject, body } = getReferralTemplate(params.template, {
    contactName: record.contactName,
    orgName: record.orgName,
    segment: record.segment,
    city: record.city,
    state: record.state,
    directoryUrl: params.directoryUrl || DEFAULT_DIRECTORY_URL,
  });
  let resolvedSubject = subject;
  if (params.template === "referral_follow_up") {
    const priorSubject = sentIntroSubject(record);
    if (priorSubject) {
      resolvedSubject = /^re:/i.test(priorSubject) ? priorSubject : `Re: ${priorSubject}`;
    }
  }
  return {
    subject: resolvedSubject,
    text: body + (footer.text || ""),
    html: plainTextToHtml(body) + (footer.html || ""),
  };
}

/**
 * Compute the Sanity `set` patch to apply after a successful send: advance the
 * pipeline to `contacted`, bump counts, append the email log entry, advance the
 * sequence step, and recompute the next touch time. Pure and deterministic —
 * the `_key` is derived from `nowIso`, not Date.now(), so tests are stable.
 *
 * @param {object} contact
 * @param {{ template: string, subject: string, textBody: string, resendId?: string, nowIso?: string, campaign?: string }} params
 * @returns {Record<string, unknown>}
 */
export function buildReferralSendPatch(contact, params) {
  const record = contact || {};
  const now = params.nowIso || new Date().toISOString();
  const existingLog = Array.isArray(record.emailLog) ? record.emailLog : [];
  const existingCount = Number(record.emailsSent) || 0;
  const newStep = (Number(record.sequence && record.sequence.step) || 0) + 1;

  // Recompute the next touch as if this send already landed, so nextTouchAt is
  // correct for the cron/UI without a second round-trip.
  const advanced = {
    ...record,
    status: "contacted",
    lastContactedAt: now,
    sequence: { ...(record.sequence || {}), step: newStep },
  };
  const next = nextReferralTouch(advanced, { nowIso: now });

  return {
    status: "contacted",
    lastContactedAt: now,
    emailsSent: existingCount + 1,
    "sequence.step": newStep,
    "sequence.nextTouchAt": next.template ? next.dueAt : null,
    emailLog: [
      ...existingLog,
      {
        _key: `email_${now.replace(/[^0-9]/g, "")}`,
        sentAt: now,
        subject: params.subject,
        template: params.template,
        body: params.textBody,
        resendId: params.resendId || "",
        status: "sent",
        ...(params.campaign ? { campaign: params.campaign } : {}),
      },
    ],
  };
}
