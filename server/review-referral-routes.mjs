import { log } from "./logger.mjs";
import { getRateLimiter } from "./rate-limit-store.mjs";
import { getSuppressionEntry } from "./outreach-suppression.mjs";
import { resendSend } from "./outreach-resend.mjs";
import { escapeHtml } from "../shared/escape-html.mjs";
import { CONTACT_STATUS_VALUES, SEGMENT_VALUES } from "../shared/referral-contact-domain.mjs";
import {
  buildReferralEmailContent,
  buildReferralSendPatch,
  resolveReferralSend,
} from "../shared/referral-send-domain.mjs";

// Referral outreach admin endpoints, served inside the review dispatcher (one
// Vercel function, many paths) to stay under the Hobby plan's 12-function cap —
// the same reason patient-signal, analytics, etc. live here instead of as
// standalone api/admin/*.mjs files. Gated on the bt_admin_session cookie.
//
//   GET   /api/review/admin/referral-contacts        list (status/segment filter)
//   PATCH /api/review/admin/referral-contact/<id>    update status/owner/notes/tags
//   POST  /api/review/admin/send-referral-email      send a referral email

const REFERRAL_HOURLY_LIMIT = Number(process.env.OUTREACH_REFERRAL_HOURLY_LIMIT) || 50;
const REFERRAL_WINDOW_MS = 60 * 60 * 1000;
const CONTACT_PREFIX = "/admin/referral-contact/";

function json(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

function getReferralLimiter() {
  return getRateLimiter("admin_referral_outreach", REFERRAL_WINDOW_MS, REFERRAL_HOURLY_LIMIT, {
    upstashRedisRestUrl: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "",
    upstashRedisRestToken:
      process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "",
  });
}

function getClientIpAddress(request) {
  const forwarded = String((request && request.headers && request.headers["x-forwarded-for"]) || "")
    .split(",")[0]
    .trim();
  if (forwarded) return forwarded;
  return (request && request.socket && request.socket.remoteAddress) || "unknown";
}

// CAN-SPAM footer — physical postal address required; null blocks the send.
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

async function handleList(context) {
  const { client, request, response } = context;
  if (request.method !== "GET") return json(response, 405, { error: "Method not allowed" });

  const url = new URL(request.url || "", "http://localhost");
  const status = url.searchParams.get("status");
  const segment = url.searchParams.get("segment");
  const statusFilter = status && CONTACT_STATUS_VALUES.has(status) ? status : null;
  const segmentFilter = segment && SEGMENT_VALUES.has(segment) ? segment : null;

  const conditions = ['_type == "referralContact"'];
  const params = {};
  if (statusFilter) {
    conditions.push("status == $status");
    params.status = statusFilter;
  }
  if (segmentFilter) {
    conditions.push("segment == $segment");
    params.segment = segmentFilter;
  }

  const query = `*[${conditions.join(" && ")}] {
    _id, orgName, contactName, role, email, phone, website, segment, state, city,
    status, fitScore, fitReasons, sequence, owner, tags, notes,
    lastContactedAt, emailsSent, repliedAt, optedOut,
    "provenance": provenance{ sourceUrl, confidence, verificationMethod },
    "emailLog": emailLog[]{ _key, sentAt, template, subject, openedAt, status, campaign }
  } | order(fitScore desc, coalesce(lastContactedAt, "1970-01-01") desc)`;

  try {
    const contacts = await client.fetch(query, params);
    return json(response, 200, contacts);
  } catch (err) {
    log.error("referral-contacts fetch error", { err: err?.message || String(err) });
    return json(response, 500, { error: "Failed to fetch referral contacts" });
  }
}

async function handlePatch(context, id) {
  const { client, request, response, deps } = context;
  if (request.method !== "PATCH") return json(response, 405, { error: "Method not allowed" });
  if (!id) return json(response, 400, { error: "Missing contact id" });

  let body;
  try {
    body = await deps.parseBody(request);
  } catch {
    return json(response, 400, { error: "Invalid JSON" });
  }

  const patch = {};
  const errors = [];
  if (body.status !== undefined) {
    if (!CONTACT_STATUS_VALUES.has(body.status)) {
      errors.push(`Invalid status: ${body.status}`);
    } else {
      patch.status = body.status;
      if (body.status === "opted_out") {
        patch.optedOut = true;
        patch.optedOutAt = new Date().toISOString();
      }
    }
  }
  if (body.owner !== undefined) {
    if (typeof body.owner !== "string" || body.owner.length > 200) errors.push("Invalid owner");
    else patch.owner = body.owner;
  }
  if (body.notes !== undefined) {
    if (typeof body.notes !== "string" || body.notes.length > 5000) errors.push("Invalid notes");
    else patch.notes = body.notes;
  }
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || body.tags.some((t) => typeof t !== "string" || t.length > 60))
      errors.push("Invalid tags");
    else patch.tags = body.tags;
  }

  if (errors.length > 0) return json(response, 400, { error: errors.join("; ") });
  if (Object.keys(patch).length === 0) return json(response, 400, { error: "No valid fields" });
  patch.updatedAt = new Date().toISOString();

  try {
    const updated = await client.patch(id).set(patch).commit({ returnDocuments: true });
    return json(response, 200, { ok: true, doc: updated });
  } catch (err) {
    log.error("referral-contact patch error", { err: err?.message || String(err) });
    return json(response, 500, { error: "Failed to update contact" });
  }
}

async function handleSend(context) {
  const { client, request, response, deps } = context;
  if (request.method !== "POST") return json(response, 405, { error: "Method not allowed" });

  let body;
  try {
    body = await deps.parseBody(request);
  } catch {
    return json(response, 400, { error: "Invalid JSON" });
  }
  const {
    contactId,
    template: templateOverride,
    sendToSelf,
    campaign: rawCampaign,
    force,
  } = body || {};

  // Hourly cap (skip test sends, which only hit the founder inbox).
  if (!sendToSelf) {
    const limiter = getReferralLimiter();
    const ipKey = getClientIpAddress(request);
    if (!(await limiter.canAttempt(ipKey))) {
      response.setHeader?.("Retry-After", String(Math.ceil(REFERRAL_WINDOW_MS / 1000)));
      return json(response, 429, {
        error: "rate_limited",
        message: `Referral outreach send cap of ${REFERRAL_HOURLY_LIMIT}/hour reached.`,
      });
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
  if (!contactId) return json(response, 400, { error: "contactId is required" });

  let contact;
  try {
    contact = await client.getDocument(contactId);
  } catch (err) {
    log.error("referral send fetch error", { err: err?.message || String(err) });
    return json(response, 500, { error: "Failed to fetch contact" });
  }
  if (!contact || contact._type !== "referralContact")
    return json(response, 404, { error: "Referral contact not found" });
  if (!sendToSelf && !contact.email)
    return json(response, 400, { error: "Contact has no email address on file" });

  // Global suppression + per-contact opt-out (skip for test sends).
  if (!sendToSelf) {
    let suppressionEntry;
    try {
      suppressionEntry = getSuppressionEntry(contact.email);
    } catch (err) {
      log.error("suppression list error", { err: err?.message || String(err) });
      return json(response, 500, { error: "Suppression list could not be read; send blocked." });
    }
    if (suppressionEntry || contact.optedOut === true || contact.status === "opted_out") {
      return json(response, 403, {
        error: "suppressed",
        message: suppressionEntry
          ? `This address is permanently suppressed (${suppressionEntry.reason || "opted out"}${suppressionEntry.date ? `, ${suppressionEntry.date}` : ""}). Send blocked.`
          : "This contact is opted out. Send blocked.",
      });
    }
  }

  const resolved = resolveReferralSend(contact, { templateOverride });
  if ("error" in resolved)
    return json(response, 409, { error: resolved.error, reason: resolved.reason });
  const template = resolved.template;

  if (!sendToSelf && !force) {
    const priorSame = (Array.isArray(contact.emailLog) ? contact.emailLog : [])
      .filter((entry) => entry && entry.template === template && entry.sentAt)
      .sort((a, b) => String(b.sentAt).localeCompare(String(a.sentAt)))[0];
    if (priorSame) {
      return json(response, 409, {
        error: "duplicate_send",
        message: `This contact already received "${template}" at ${priorSame.sentAt}. Pass force:true to re-send.`,
        lastSentAt: priorSame.sentAt,
        template,
      });
    }
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return json(response, 500, { error: "RESEND_API_KEY not configured" });

  // Prefer an isolated subdomain identity; fall back to the shared outreach
  // From: address so the engine is usable without a separate sending domain.
  const fromAddress =
    process.env.OUTREACH_REFERRAL_EMAIL_FROM ||
    process.env.OUTREACH_EMAIL_FROM ||
    process.env.REVIEW_EMAIL_FROM;
  if (!fromAddress) {
    return json(response, 500, {
      error:
        "No outreach From: address is configured. Set OUTREACH_REFERRAL_EMAIL_FROM (recommended — an isolated subdomain) or OUTREACH_EMAIL_FROM before sending.",
    });
  }
  const isolated = Boolean(process.env.OUTREACH_REFERRAL_EMAIL_FROM);

  const footer = buildFooter();
  if (!footer) {
    return json(response, 500, {
      error:
        "OUTREACH_FOOTER_ADDRESS is not configured. CAN-SPAM requires a physical postal address on commercial email.",
    });
  }

  // Route replies (including STOP) to a monitored inbox.
  const replyTo =
    (process.env.OUTREACH_REPLY_TO || "").trim() ||
    (process.env.OUTREACH_EMAIL_FROM || process.env.REVIEW_EMAIL_FROM || "").trim() ||
    undefined;

  const { subject, text, html } = buildReferralEmailContent(contact, { template, footer });

  if (sendToSelf) {
    const testTo = resolveTestRecipient(fromAddress);
    if (!testTo)
      return json(response, 500, {
        error: "Could not resolve a test recipient. Set OUTREACH_TEST_TO.",
      });
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
      log.error("resend test error", { err: err?.message || String(err) });
      return json(response, 500, { error: "Failed to send test email." });
    }
    return json(response, 200, { ok: true, testTo, template, isolated });
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
    log.error("resend error", { err: err?.message || String(err) });
    return json(response, 500, { error: "Failed to send email." });
  }

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
    log.error("referral send patch error", { err: err?.message || String(err) });
    return json(response, 200, {
      ok: true,
      warning: "Email sent but the contact record could not be updated",
      isolated,
    });
  }

  return json(response, 200, { ok: true, template, isolated });
}

export async function handleReferralRoutes(context) {
  const { config, request, response, routePath, deps } = context;
  const isList = routePath === "/admin/referral-contacts";
  const isSend = routePath === "/admin/send-referral-email";
  const isContact = routePath.startsWith(CONTACT_PREFIX);
  if (!isList && !isSend && !isContact) return false;

  const session = deps.readAdminSessionFromRequest(request, config);
  if (!session) {
    json(response, 401, { error: "Unauthorized" });
    return true;
  }

  if (isList) {
    await handleList(context);
    return true;
  }
  if (isSend) {
    await handleSend(context);
    return true;
  }
  const id = decodeURIComponent(routePath.slice(CONTACT_PREFIX.length));
  await handlePatch(context, id);
  return true;
}
