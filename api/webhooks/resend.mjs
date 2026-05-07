// Resend webhook receiver. Resend signs payloads with Svix; we verify
// the HMAC, then patch any therapist whose email matches a bounce or
// complaint so the CRM stops sending to bad addresses.
//
// One-time setup (after this PR deploys):
//   1. Resend dashboard → Webhooks → Add Endpoint
//      URL: https://www.bipolartherapyhub.com/api/webhooks/resend
//      Events: email.bounced, email.complained, (optional) email.failed
//   2. Copy the signing secret (starts with `whsec_`)
//   3. Add to Vercel env: RESEND_WEBHOOK_SECRET=whsec_...
//
// Without RESEND_WEBHOOK_SECRET set, the endpoint rejects all requests
// with 503 — better to fail closed than accept unsigned payloads.

import crypto from "node:crypto";
import { createClient } from "@sanity/client";

function getSanityClient() {
  return createClient({
    projectId: process.env.VITE_SANITY_PROJECT_ID,
    dataset: process.env.VITE_SANITY_DATASET || "production",
    apiVersion: process.env.VITE_SANITY_API_VERSION || "2026-04-02",
    token: process.env.SANITY_API_TOKEN,
    useCdn: false,
  });
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

// Svix verification: signed content is `${id}.${timestamp}.${body}`,
// HMAC-SHA256 with the (base64-decoded) secret, result is base64-encoded.
// Header value can contain multiple comma-separated `v1,sig` entries —
// at least one must match.
function verifySvixSignature({ secret, id, timestamp, body, signatureHeader }) {
  if (!secret || !id || !timestamp || !body || !signatureHeader) return false;
  // Reject stale timestamps (>5 min old) to limit replay risk.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
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

function getHeader(req, name) {
  const h = req.headers || {};
  if (typeof h.get === "function") return h.get(name) || "";
  return h[name] || h[name.toLowerCase()] || "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    res.status(503).json({ error: "RESEND_WEBHOOK_SECRET not configured" });
    return;
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch {
    res.status(400).json({ error: "Failed to read body" });
    return;
  }

  const ok = verifySvixSignature({
    secret,
    id: getHeader(req, "svix-id"),
    timestamp: getHeader(req, "svix-timestamp"),
    body: rawBody,
    signatureHeader: getHeader(req, "svix-signature"),
  });
  if (!ok) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  const type = event?.type || "";
  const recipients = Array.isArray(event?.data?.to) ? event.data.to : [];
  if (recipients.length === 0) {
    // Nothing actionable — ack so Resend doesn't retry.
    res.status(200).json({ ok: true, noop: true });
    return;
  }

  // We only act on these. Other events (delivered, opened, clicked) ack
  // silently — we may add engagement tracking later.
  const STATUS_BY_TYPE = {
    "email.bounced": "bounced",
    "email.complained": "opted_out",
  };
  const newStatus = STATUS_BY_TYPE[type];
  if (!newStatus) {
    res.status(200).json({ ok: true, noop: true });
    return;
  }

  const client = getSanityClient();
  const recipientLower = recipients.map((r) => String(r).toLowerCase());
  const therapists = await client.fetch(
    `*[_type == "therapist" && lower(email) in $emails]{ _id, name, email, outreach }`,
    { emails: recipientLower },
  );

  if (therapists.length === 0) {
    res.status(200).json({ ok: true, matched: 0 });
    return;
  }

  const now = new Date().toISOString();
  const noteSuffix =
    type === "email.bounced"
      ? `[${now.slice(0, 10)}] Resend bounce: ${event?.data?.bounce?.type || "unknown"} — ${event?.data?.bounce?.message || ""}`.trim()
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
      console.error(`webhook patch failed for ${t._id}:`, err);
    }
  }

  res.status(200).json({ ok: true, matched: therapists.length, patched });
}

// Vercel serverless: opt out of automatic body parsing so we can
// HMAC-verify the raw bytes.
export const config = {
  api: { bodyParser: false },
};
