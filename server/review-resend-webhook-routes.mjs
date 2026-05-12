import { log } from "./logger.mjs";

// Resend webhook receiver. Verifies the Svix signature, then patches
// any therapist whose email matches a bounce or complaint so the CRM
// stops sending to bad addresses.
//
// Lives inside the review-handler route table (not its own Vercel
// function) to stay under the Hobby plan's 12-function cap.
//
// One-time setup:
//   1. Resend dashboard → Webhooks → Add Endpoint
//      URL: https://www.bipolartherapyhub.com/api/review/webhooks/resend
//      Events: email.bounced, email.complained
//   2. Copy the signing secret (whsec_…)
//   3. Add to Vercel env: RESEND_WEBHOOK_SECRET
//
// Without the secret set, the endpoint returns 503.

import crypto from "node:crypto";

// Svix verification: signed content is `${id}.${timestamp}.${body}`,
// HMAC-SHA256 with the (base64-decoded) secret, result base64-encoded.
// Header value can hold multiple comma-separated `v1,sig` entries —
// at least one must match.
function verifySvixSignature({ secret, id, timestamp, body, signatureHeader }) {
  if (!secret || !id || !timestamp || !body || !signatureHeader) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  // Reject stale timestamps (>5 min old) to limit replay risk.
  if (Math.abs(Date.now() / 1000 - ts) > 5 * 60) return false;

  const cleanedSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let secretBytes;
  try {
    secretBytes = Buffer.from(cleanedSecret, "base64");
  } catch {
    return false;
  }
  const signed = `${id}.${timestamp}.${body}`;
  const expected = crypto.createHmac("sha256", secretBytes).update(signed).digest("base64");

  const candidates = signatureHeader
    .split(" ")
    .map((part) => {
      const idx = part.indexOf(",");
      return idx === -1 ? "" : part.slice(idx + 1);
    })
    .filter(Boolean);

  for (const candidate of candidates) {
    try {
      const a = Buffer.from(expected);
      const b = Buffer.from(candidate);
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
    } catch {
      // try next candidate
    }
  }
  return false;
}

function getHeader(request, name) {
  const h = (request && request.headers) || {};
  return h[name] || h[name.toLowerCase()] || "";
}

export async function handleResendWebhookRoutes(context) {
  const { client, request, response, routePath, deps } = context;
  if (routePath !== "/webhooks/resend") return false;

  if (request.method !== "POST") {
    response.writeHead(405, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Method not allowed" }));
    return true;
  }

  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    response.writeHead(503, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "RESEND_WEBHOOK_SECRET not configured" }));
    return true;
  }

  let rawBody;
  try {
    rawBody = await deps.parseRawBody(request);
  } catch {
    response.writeHead(400, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Failed to read body" }));
    return true;
  }
  // parseRawBody returns a Buffer or string; normalize to string for hmac.
  const bodyStr =
    typeof rawBody === "string"
      ? rawBody
      : Buffer.isBuffer(rawBody)
        ? rawBody.toString("utf8")
        : "";

  const ok = verifySvixSignature({
    secret,
    id: getHeader(request, "svix-id"),
    timestamp: getHeader(request, "svix-timestamp"),
    body: bodyStr,
    signatureHeader: getHeader(request, "svix-signature"),
  });
  if (!ok) {
    response.writeHead(401, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Invalid signature" }));
    return true;
  }

  let event;
  try {
    event = JSON.parse(bodyStr);
  } catch {
    response.writeHead(400, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Invalid JSON" }));
    return true;
  }

  const type = event?.type || "";
  const recipients = Array.isArray(event?.data?.to) ? event.data.to : [];

  // email.opened — look up the originating send by its Resend message id and
  // stamp openedAt on that emailLog entry. First open wins so the metric
  // reflects unique-opener rate rather than total opens.
  if (type === "email.opened") {
    const resendId = event?.data?.email_id || "";
    if (!resendId) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true, noop: true, reason: "no email_id" }));
      return true;
    }
    let match;
    try {
      match = await client.fetch(
        `*[_type == "therapist" && $resendId in outreach.emailLog[].resendId][0]{
          _id, outreach
        }`,
        { resendId },
      );
    } catch (err) {
      log.error("resend opened lookup error", { err: err?.message || String(err) });
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Sanity fetch failed" }));
      return true;
    }
    if (!match) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true, matched: 0 }));
      return true;
    }
    const existingLog = match?.outreach?.emailLog || [];
    const idx = existingLog.findIndex((e) => e?.resendId === resendId);
    if (idx === -1 || existingLog[idx]?.openedAt) {
      // Either already opened (idempotent) or somehow no entry — ack.
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true, alreadyOpened: idx !== -1 }));
      return true;
    }
    const openedAt = new Date().toISOString();
    try {
      await client
        .patch(match._id)
        .set({ [`outreach.emailLog[${idx}].openedAt`]: openedAt })
        .commit({ visibility: "async" });
    } catch (err) {
      log.error("resend opened patch failed", { id: match._id, err: err?.message || String(err) });
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Sanity patch failed" }));
      return true;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true, opened: 1 }));
    return true;
  }

  if (recipients.length === 0) {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true, noop: true }));
    return true;
  }

  const STATUS_BY_TYPE = {
    "email.bounced": "bounced",
    "email.complained": "opted_out",
  };
  const newStatus = STATUS_BY_TYPE[type];
  if (!newStatus) {
    // Other events (delivered, clicked) ack silently.
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true, noop: true }));
    return true;
  }

  const recipientLower = recipients.map((r) => String(r).toLowerCase());
  let therapists = [];
  try {
    therapists = await client.fetch(
      `*[_type == "therapist" && lower(email) in $emails]{ _id, name, email, outreach }`,
      { emails: recipientLower },
    );
  } catch (err) {
    log.error("resend webhook fetch error", { err: err?.message || String(err) });
    response.writeHead(500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Sanity fetch failed" }));
    return true;
  }

  if (therapists.length === 0) {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true, matched: 0 }));
    return true;
  }

  const now = new Date().toISOString();
  const noteSuffix =
    type === "email.bounced"
      ? `[${now.slice(0, 10)}] Resend bounce: ${event?.data?.bounce?.type || "unknown"} — ${
          event?.data?.bounce?.message || ""
        }`.trim()
      : `[${now.slice(0, 10)}] Resend complaint (recipient marked as spam).`;

  let patched = 0;
  for (const t of therapists) {
    try {
      const existingLog = t?.outreach?.emailLog || [];
      const existingNotes = t?.outreach?.notes || "";
      await client
        .patch(t._id)
        .set({
          "outreach.status": newStatus,
          "outreach.notes": existingNotes ? `${existingNotes}\n${noteSuffix}` : noteSuffix,
          "outreach.emailLog": [
            ...existingLog,
            {
              _key: `webhook_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              sentAt: now,
              subject: type === "email.bounced" ? "(bounce notification)" : "(spam complaint)",
              template: type,
              body: noteSuffix,
            },
          ],
        })
        .commit({ visibility: "async" });
      patched++;
    } catch (err) {
      log.error("resend webhook patch failed", { id: t._id, err: err?.message || String(err) });
    }
  }

  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ ok: true, matched: therapists.length, patched }));
  return true;
}
