// Shared core for actually delivering a referral email — used by both the
// admin send endpoint (server/review-referral-routes.mjs) and the cadence cron
// (server/referral-cadence-runner.mjs) so the From:/footer/Reply-To resolution
// and the send + record step live in exactly one place.

import { resendSend } from "./outreach-resend.mjs";
import { escapeHtml } from "../shared/escape-html.mjs";
import {
  buildReferralEmailContent,
  buildReferralSendPatch,
} from "../shared/referral-send-domain.mjs";

/**
 * How many active listings a contact's city has. The SEO city page only exists
 * at or above MIN_CITY_PAGE_PROVIDERS, so the templates use this to decide
 * whether the city link is safe to include. Returns 0 on any failure —
 * fail-safe: an email with no city link beats one that 404s.
 *
 * @param {{ fetch: Function }} client
 * @param {unknown} city
 * @returns {Promise<number>}
 */
export async function fetchCityListingCount(client, city) {
  const name = String(city || "").trim();
  if (!name) return 0;
  try {
    const count = await client.fetch(
      `count(*[_type == "therapist" && listingActive == true && city == $city])`,
      { city: name },
    );
    return Number.isFinite(Number(count)) ? Number(count) : 0;
  } catch (_error) {
    return 0;
  }
}

// CAN-SPAM footer — physical postal address required; null blocks the send.
export function buildReferralFooter() {
  const address = (process.env.OUTREACH_FOOTER_ADDRESS || "").trim();
  if (!address) return null;
  const orgName = process.env.OUTREACH_FOOTER_ORG_NAME || "BipolarTherapyHub";
  const text = [
    "",
    "---",
    `${orgName} · ${address}`,
    "Reply STOP and I'll stop emailing you.",
  ].join("\n");
  const html =
    '<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px;">' +
    `<p style="color:#6b7280;font-size:12px;margin:0;">` +
    `${escapeHtml(orgName)} · ${escapeHtml(address)}<br>` +
    `Reply <strong>STOP</strong> and I'll stop emailing you.` +
    `</p>`;
  return { text, html };
}

/**
 * Resolve everything needed to send: the Resend key, the From: address
 * (isolated subdomain preferred, falling back to the shared product address),
 * the footer, and the Reply-To. Returns `{ ok: false, error }` when something
 * required is missing so callers fail closed.
 *
 * @returns {{ ok: true, resendKey: string, fromAddress: string, isolated: boolean, footer: { text: string, html: string }, replyTo: string | undefined } | { ok: false, error: string }}
 */
export function getReferralSendConfig() {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return { ok: false, error: "RESEND_API_KEY not configured" };

  const fromAddress =
    process.env.OUTREACH_REFERRAL_EMAIL_FROM ||
    process.env.OUTREACH_EMAIL_FROM ||
    process.env.REVIEW_EMAIL_FROM;
  if (!fromAddress) {
    return {
      ok: false,
      error:
        "No outreach From: address is configured. Set OUTREACH_REFERRAL_EMAIL_FROM (recommended — an isolated subdomain) or OUTREACH_EMAIL_FROM.",
    };
  }

  const footer = buildReferralFooter();
  if (!footer) {
    return {
      ok: false,
      error:
        "OUTREACH_FOOTER_ADDRESS is not configured. CAN-SPAM requires a physical postal address on commercial email.",
    };
  }

  const replyTo =
    (process.env.OUTREACH_REPLY_TO || "").trim() ||
    (process.env.OUTREACH_EMAIL_FROM || process.env.REVIEW_EMAIL_FROM || "").trim() ||
    undefined;

  return {
    ok: true,
    resendKey,
    fromAddress,
    isolated: Boolean(process.env.OUTREACH_REFERRAL_EMAIL_FROM),
    footer,
    replyTo,
  };
}

/**
 * Send one referral touch to a contact and record it on the document. Assumes
 * the caller has already resolved the template and run the suppression /
 * opt-out / dedup checks. Throws on a Resend or Sanity failure.
 *
 * @param {{ getDocument: Function, patch: Function }} client
 * @param {{ _id: string, email?: string, contactName?: unknown, orgName?: unknown, segment?: unknown, sequence?: unknown, emailsSent?: unknown, emailLog?: unknown }} contact
 * The send itself throws on failure (Resend error). A failure to RECORD the
 * send afterward does not throw — it returns `recorded: false` — because the
 * email already went out and the caller must not treat that as a send failure
 * (which could trigger a duplicate re-send).
 *
 * @param {{ template: string, config: ReturnType<typeof getReferralSendConfig>, campaign?: string, nowIso?: string }} options
 * @returns {Promise<{ resendId: string, template: string, recorded: boolean }>}
 */
export async function deliverReferralTouch(client, contact, options) {
  const { template, config, campaign, nowIso } = options;
  const now = nowIso || new Date().toISOString();
  const cityListingCount = await fetchCityListingCount(client, contact && contact.city);
  const { subject, text, html } = buildReferralEmailContent(contact, {
    template,
    footer: config.footer,
    cityListingCount,
  });

  const result = await resendSend({
    apiKey: config.resendKey,
    from: config.fromAddress,
    to: contact.email,
    subject,
    html,
    text,
    replyTo: config.replyTo,
  });

  try {
    // Re-read so a concurrent edit doesn't clobber the log we append to.
    const current = await client.getDocument(contact._id);
    const set = buildReferralSendPatch(current || contact, {
      template,
      subject,
      textBody: text,
      resendId: result?.id || "",
      nowIso: now,
      campaign,
    });
    await client.patch(contact._id).set(set).commit();
    return { resendId: result?.id || "", template, recorded: true };
  } catch {
    return { resendId: result?.id || "", template, recorded: false };
  }
}
