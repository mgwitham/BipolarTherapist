import { createClient } from "@sanity/client";
import { Resend } from "resend";
import { verifyAdminSession } from "../_adminAuth.mjs";

const VALID_TEMPLATES = new Set(["email_1", "follow_up"]);

// TODO: Replace placeholder subject/body with real copy before sending live emails.
const TEMPLATES = {
  email_1: {
    subject: "[SUBJECT PLACEHOLDER — Initial outreach]",
    html: (t) =>
      `<p>[BODY PLACEHOLDER — Initial outreach to ${t.name}.]</p>` +
      (t.profileUrl ? `<p>Your profile: <a href="${t.profileUrl}">${t.profileUrl}</a></p>` : ""),
    text: (t) =>
      `[BODY PLACEHOLDER — Initial outreach to ${t.name}.]\n` +
      (t.profileUrl ? `\nYour profile: ${t.profileUrl}` : ""),
    nextStatus: "email_1_sent",
  },
  follow_up: {
    subject: "[SUBJECT PLACEHOLDER — Follow-up]",
    html: (t) =>
      `<p>[BODY PLACEHOLDER — Follow-up to ${t.name}.]</p>` +
      (t.profileUrl ? `<p>Your profile: <a href="${t.profileUrl}">${t.profileUrl}</a></p>` : ""),
    text: (t) =>
      `[BODY PLACEHOLDER — Follow-up to ${t.name}.]\n` +
      (t.profileUrl ? `\nYour profile: ${t.profileUrl}` : ""),
    nextStatus: "followed_up",
  },
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

// Convert the user's plain-text edited body into safe HTML for the
// `html` field of the email. Escapes HTML special chars, then turns
// blank lines into paragraph breaks and single newlines into <br>.
function plainTextToHtml(text) {
  const escaped = String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paragraphs = escaped.split(/\n{2,}/).map(function (block) {
    return "<p>" + block.replace(/\n/g, "<br>") + "</p>";
  });
  return paragraphs.join("");
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

  // Trim user overrides. Empty/whitespace strings fall back to the static
  // template default so a stray empty input doesn't ship a blank email.
  const trimmedSubject = typeof subjectOverride === "string" ? subjectOverride.trim() : "";
  const trimmedBody = typeof bodyOverride === "string" ? bodyOverride.trim() : "";

  const tpl = TEMPLATES[template];
  const client = getSanityClient();

  let therapist;
  try {
    therapist = await client.fetch(
      `*[_type == "therapist" && _id == $id][0] {
        _id, name, email, slug,
        "profileUrl": select(
          defined(slug.current) => "https://www.bipolartherapyhub.com/therapists/" + slug.current,
          null
        ),
        outreach
      }`,
      { id: therapistId },
    );
  } catch (err) {
    console.error("fetch therapist error:", err);
    res.status(500).json({ error: "Failed to fetch therapist" });
    return;
  }

  if (!therapist) {
    res.status(404).json({ error: "Therapist not found" });
    return;
  }
  if (!therapist.email) {
    res.status(400).json({ error: "Therapist has no email address on file" });
    return;
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    res.status(500).json({ error: "RESEND_API_KEY not configured" });
    return;
  }

  const fromAddress = process.env.OUTREACH_EMAIL_FROM || process.env.REVIEW_EMAIL_FROM;
  if (!fromAddress) {
    res.status(500).json({ error: "OUTREACH_EMAIL_FROM not configured" });
    return;
  }

  const resend = new Resend(resendKey);
  const subject = trimmedSubject || tpl.subject;
  const textBody = trimmedBody || tpl.text(therapist);
  // For the HTML version, escape and convert linebreaks so the user's
  // plain-text edits render correctly. The static template falls back
  // to its own pre-built HTML.
  const htmlBody = trimmedBody ? plainTextToHtml(trimmedBody) : tpl.html(therapist);

  try {
    await resend.emails.send({
      from: fromAddress,
      to: therapist.email,
      subject,
      html: htmlBody,
      text: textBody,
    });
  } catch (err) {
    console.error("resend error:", err);
    res.status(500).json({ error: "Failed to send email", detail: err.message });
    return;
  }

  // Email sent — now update Sanity. Fetch current state first to safely append.
  const now = new Date().toISOString();
  try {
    const current = await client.getDocument(therapistId);
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
          { _key: `email_${Date.now()}`, sentAt: now, subject, template, body: textBody },
        ],
      })
      .commit();
  } catch (err) {
    // Email already sent — log but don't surface as failure.
    console.error("sanity patch error after send:", err);
    res
      .status(200)
      .json({ ok: true, warning: "Email sent but Sanity record could not be updated" });
    return;
  }

  res.status(200).json({ ok: true });
}
