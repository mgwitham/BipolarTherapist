import { createClient } from "@sanity/client";
import { verifyAdminSession } from "../_adminAuth.mjs";
import { getRateLimiter } from "../../server/rate-limit-store.mjs";
import { getSuppressionEntry } from "../../server/outreach-suppression.mjs";
import { resendSend } from "../../server/outreach-resend.mjs";
import { escapeHtml } from "../../shared/escape-html.mjs";
import {
  buildReferralEmailContent,
  buildReferralSendPatch,
  resolveReferralSend,
} from "../../shared/referral-send-domain.mjs";

// Demand-side referral outreach send endpoint — the mirror of
// api/admin/send-email.mjs (therapist/supply side). It reuses the same safety
// machinery (global suppression list, hourly rate cap, CAN-SPAM footer,
// duplicate-send guard) but sends to `referralContact` documents, uses the
// referral template/sequence copy, and — critically — sends from an ISOLATED
// subdomain identity (OUTREACH_REFERRAL_EMAIL_FROM) so cold-outreach spam
// complaints can never degrade deliverability of product/transactional email.

const REFERRAL_HOURLY_LIMIT = Number(process.env.OUTREACH_REFERRAL_HOURLY_LIMIT) || 50;
const REFERRAL_WINDOW_MS = 60 * 60 * 1000;

function getReferralLimiter() {
  return getRateLimiter("admin_referral_outreach", REFERRAL_WINDOW_MS, REFERRAL_HOURLY_LIMIT, {
    upstashRedisRestUrl: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "",
    upstashRedisRestToken:
      process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "",
  });
}

function getClientIpAddress(req) {
  const forwarded = String((req && req.headers && req.headers["x-forwarded-for"]) || "")
    .split(",")[0]
    .trim();
  if (forwarded) return forwarded;
  return (req && req.socket && req.socket.remoteAddress) || "unknown";
}

function getSanityClient() {
  return createClient({
    projectId: process.env.VITE_SANITY_PROJECT_ID,
    dataset: process.env.VITE_SANITY_DATASET || "production",
    apiVersion: process.env.VITE_SANITY_API_VERSION || "2026-04-02",
    token: process.env.SANITY_API_TOKEN,
    useCdn: false,
  });
}

// CAN-SPAM footer — same physical-address requirement as the therapist path.
// Returns null when the postal address isn't configured so the send is blocked
// rather than shipping a non-compliant commercial email.
function buildFooter() {
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

function resolveTestRecipient(fromAddress) {
  const explicit = (process.env.OUTREACH_TEST_TO || "").trim();
  if (explicit) return explicit;
  const match = String(fromAddress || "").match(/<([^>]+)>/);
  if (match) return match[1].trim();
  const trimmed = String(fromAddress || "").trim();
  return /@/.test(trimmed) ? trimmed : "";
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export default async function handler(req, res) {
  if (!verifyAdminSession(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let body;
  try {
    body = await parseBody(req);
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  const {
    contactId,
    template: templateOverride,
    sendToSelf,
    campaign: rawCampaign,
    force,
  } = body || {};

  // Hourly send cap — after auth + parse, before any Sanity/Resend work. Test
  // sends (founder inbox only) bypass it. Recorded unconditionally so retry
  // loops on Resend errors can't game the limit.
  if (!sendToSelf) {
    const limiter = getReferralLimiter();
    const ipKey = getClientIpAddress(req);
    if (!(await limiter.canAttempt(ipKey))) {
      res.setHeader("Retry-After", String(Math.ceil(REFERRAL_WINDOW_MS / 1000)));
      res.status(429).json({
        error: "rate_limited",
        message: `Referral outreach send cap of ${REFERRAL_HOURLY_LIMIT}/hour reached.`,
        limit: REFERRAL_HOURLY_LIMIT,
        windowMs: REFERRAL_WINDOW_MS,
      });
      return;
    }
    await limiter.record(ipKey);
  }

  const campaign =
    typeof rawCampaign === "string"
      ? rawCampaign
          .trim()
          .slice(0, 80)
          .replace(/[^a-z0-9_-]/gi, "-")
          .toLowerCase()
      : "";

  if (!contactId) {
    res.status(400).json({ error: "contactId is required" });
    return;
  }

  const client = getSanityClient();
  let contact;
  try {
    contact = await client.getDocument(contactId);
  } catch (err) {
    console.error("fetch referral contact error:", err);
    res.status(500).json({ error: "Failed to fetch contact" });
    return;
  }
  if (!contact || contact._type !== "referralContact") {
    res.status(404).json({ error: "Referral contact not found" });
    return;
  }
  if (!sendToSelf && !contact.email) {
    res.status(400).json({ error: "Contact has no email address on file" });
    return;
  }

  // Global suppression guard. Shared with the therapist path: a STOP from
  // anyone suppresses everywhere. Also honors the contact's own opted_out
  // status. Fails closed if the list can't be read. Test sends skip it.
  if (!sendToSelf) {
    let suppressionEntry;
    try {
      suppressionEntry = getSuppressionEntry(contact.email);
    } catch (err) {
      console.error("suppression list error:", err?.message || String(err));
      res.status(500).json({ error: "Suppression list could not be read; send blocked." });
      return;
    }
    if (suppressionEntry || contact.optedOut === true || contact.status === "opted_out") {
      res.status(403).json({
        error: "suppressed",
        message: suppressionEntry
          ? `This address is permanently suppressed (${suppressionEntry.reason || "opted out"}${suppressionEntry.date ? `, ${suppressionEntry.date}` : ""}). Send blocked.`
          : "This contact is opted out. Send blocked.",
      });
      return;
    }
  }

  // Pick the template: an explicit override, otherwise the next due cadence
  // touch. A halted/complete sequence returns no template.
  const resolved = resolveReferralSend(contact, { templateOverride });
  if ("error" in resolved) {
    res.status(409).json({ error: resolved.error, reason: resolved.reason });
    return;
  }
  const template = resolved.template;

  // Duplicate-send guard: block re-sending the same template unless forced.
  if (!sendToSelf && !force) {
    const priorSame = (Array.isArray(contact.emailLog) ? contact.emailLog : [])
      .filter((entry) => entry && entry.template === template && entry.sentAt)
      .sort((a, b) => String(b.sentAt).localeCompare(String(a.sentAt)))[0];
    if (priorSame) {
      res.status(409).json({
        error: "duplicate_send",
        message: `This contact already received "${template}" at ${priorSame.sentAt}. Pass force:true to re-send.`,
        lastSentAt: priorSame.sentAt,
        template,
      });
      return;
    }
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    res.status(500).json({ error: "RESEND_API_KEY not configured" });
    return;
  }

  // Sending identity. PREFER an isolated subdomain identity
  // (OUTREACH_REFERRAL_EMAIL_FROM) so cold-outreach spam complaints can't
  // degrade product/transactional deliverability. If it isn't set, fall back to
  // the shared outreach From: address so the engine is usable without standing
  // up a separate sending domain — cold sends then share your product domain's
  // reputation, so keep volume low and lead with high-fit recipients. Setting
  // OUTREACH_REFERRAL_EMAIL_FROM later re-isolates with no other change.
  const fromAddress =
    process.env.OUTREACH_REFERRAL_EMAIL_FROM ||
    process.env.OUTREACH_EMAIL_FROM ||
    process.env.REVIEW_EMAIL_FROM;
  if (!fromAddress) {
    res.status(500).json({
      error:
        "No outreach From: address is configured. Set OUTREACH_REFERRAL_EMAIL_FROM (recommended — an isolated subdomain) or OUTREACH_EMAIL_FROM before sending.",
    });
    return;
  }
  const isolated = Boolean(process.env.OUTREACH_REFERRAL_EMAIL_FROM);

  const footer = buildFooter();
  if (!footer) {
    res.status(500).json({
      error:
        "OUTREACH_FOOTER_ADDRESS is not configured. CAN-SPAM requires a physical postal address on commercial email.",
    });
    return;
  }

  // Route replies to a monitored inbox. The From: is the isolated subdomain
  // (for sending reputation), but a recipient's reply — including STOP — must
  // reach a human who can act on it (and add the address to the suppression
  // list). Falls back to the product From: address so replies are never
  // silently lost; set OUTREACH_REPLY_TO to your real monitored inbox.
  const replyTo =
    (process.env.OUTREACH_REPLY_TO || "").trim() ||
    (process.env.OUTREACH_EMAIL_FROM || process.env.REVIEW_EMAIL_FROM || "").trim() ||
    undefined;

  const { subject, text, html } = buildReferralEmailContent(contact, { template, footer });

  // Test send → founder inbox only. No Sanity write, no status change.
  if (sendToSelf) {
    const testTo = resolveTestRecipient(fromAddress);
    if (!testTo) {
      res.status(500).json({ error: "Could not resolve a test recipient. Set OUTREACH_TEST_TO." });
      return;
    }
    try {
      await resendSend({
        apiKey: resendKey,
        from: fromAddress,
        to: testTo,
        subject: `[TEST] ${subject}`,
        html,
        text,
        replyTo,
      });
    } catch (err) {
      console.error("resend test error:", err?.message || String(err));
      res.status(500).json({ error: "Failed to send test email." });
      return;
    }
    res.status(200).json({ ok: true, testTo, template, isolated });
    return;
  }

  let resendResult;
  try {
    resendResult = await resendSend({
      apiKey: resendKey,
      from: fromAddress,
      to: contact.email,
      subject,
      html,
      text,
      replyTo,
    });
  } catch (err) {
    console.error("resend error:", err?.message || String(err));
    res.status(500).json({ error: "Failed to send email." });
    return;
  }

  // Sent — record it. Re-fetch first so concurrent edits don't clobber the log.
  try {
    const current = await client.getDocument(contactId);
    const set = buildReferralSendPatch(current || contact, {
      template,
      subject,
      textBody: text,
      resendId: resendResult?.id || "",
      nowIso: new Date().toISOString(),
      campaign,
    });
    await client.patch(contactId).set(set).commit();
  } catch (err) {
    console.error("sanity patch error after send:", err);
    res
      .status(200)
      .json({ ok: true, warning: "Email sent but the contact record could not be updated" });
    return;
  }

  res.status(200).json({ ok: true, template, isolated });
}
