// Logs a contact-form outreach against a therapist record. The form
// itself is filled and submitted by the human — this endpoint only
// records that the outreach happened, mirroring what send-email.mjs
// does to outreach.* fields so the CRM treats the two channels the
// same way (status transitions, follow-up due, history, stats).

import { createClient } from "@sanity/client";
import { verifyAdminSession } from "../_adminAuth.mjs";

const VALID_TEMPLATES = new Set(["email_1", "follow_up"]);

const TEMPLATE_LABELS = {
  email_1: { subject: "[FORM — Initial outreach]", nextStatus: "email_1_sent" },
  follow_up: { subject: "[FORM — Follow-up]", nextStatus: "followed_up" },
};

function getSanityClient() {
  return createClient({
    projectId: process.env.VITE_SANITY_PROJECT_ID,
    dataset: process.env.VITE_SANITY_DATASET || "production",
    apiVersion: process.env.VITE_SANITY_API_VERSION || "2026-04-02",
    token: process.env.SANITY_API_TOKEN,
    useCdn: false,
  });
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

  const { therapistId, template, subject: subjectOverride, body: bodyOverride } = body || {};
  if (!therapistId || !template) {
    res.status(400).json({ error: "therapistId and template are required" });
    return;
  }
  if (!VALID_TEMPLATES.has(template)) {
    res.status(400).json({ error: `Unknown template: ${template}` });
    return;
  }

  const trimmedSubject = typeof subjectOverride === "string" ? subjectOverride.trim() : "";
  const trimmedBody = typeof bodyOverride === "string" ? bodyOverride.trim() : "";

  const tpl = TEMPLATE_LABELS[template];
  const recordedSubject = trimmedSubject || tpl.subject;
  const client = getSanityClient();

  const now = new Date().toISOString();
  try {
    const current = await client.getDocument(therapistId);
    if (!current) {
      res.status(404).json({ error: "Therapist not found" });
      return;
    }
    const existingLog = current?.outreach?.emailLog || [];
    const existingCount = current?.outreach?.emailsSent || 0;

    await client
      .patch(therapistId)
      .set({
        "outreach.lastContactedAt": now,
        "outreach.status": tpl.nextStatus,
        "outreach.emailsSent": existingCount + 1,
        "outreach.emailLog": [
          ...existingLog,
          {
            _key: `form_${Date.now()}`,
            sentAt: now,
            subject: recordedSubject,
            template: `${template}_via_form`,
            body: trimmedBody,
          },
        ],
      })
      .commit();
  } catch (err) {
    console.error("log-contact-form patch error:", err);
    res.status(500).json({ error: "Failed to log contact form outreach" });
    return;
  }

  res.status(200).json({ ok: true });
}
