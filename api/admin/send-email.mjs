import { createClient } from "@sanity/client";
import { Resend } from "resend";
import { verifyAdminSession } from "../_adminAuth.mjs";

const VALID_TEMPLATES = new Set(["email_1", "follow_up"]);

// Strip leading title (Dr., Mr., etc.) and take the first word.
function firstName(fullName) {
  const tokens = String(fullName || "")
    .replace(/^(Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Mx\.?)\s+/i, "")
    .trim()
    .split(/\s+/);
  return tokens[0] || "there";
}

// Fallback copy used when the composer ships a blank subject/body
// (shouldn't happen — the client validates — but defense in depth).
// Keep this in sync with getTemplateDefaults() in assets/outreach.js.
const TEMPLATES = {
  email_1: {
    subject: "Your BipolarTherapyHub listing",
    text: (t) => {
      const first = firstName(t.name);
      const url = t.profileUrl || "";
      return [
        `Hi ${first},`,
        "",
        "I built BipolarTherapyHub, a directory specifically for California therapists who treat bipolar disorder. Your practice came up in our research and I added a profile for you:",
        "",
        url,
        "",
        "It's live and free. To edit anything (bio, photo, fees, specialties), you can claim it in two clicks at the link above. No payment required.",
        "",
        "If you don't want to be listed, just reply and I'll remove it today.",
        "",
        "Best,",
        "Michael",
      ].join("\n");
    },
    html: (t) => plainTextToHtml(TEMPLATES.email_1.text(t)),
    nextStatus: "email_1_sent",
  },
  follow_up: {
    subject: "Re: Your BipolarTherapyHub listing",
    text: (t) => {
      const first = firstName(t.name);
      const url = t.profileUrl || "";
      return [
        `Hi ${first},`,
        "",
        "Bumping this in case it got buried. Your bipolar specialist listing is here:",
        "",
        url,
        "",
        `Free to claim if you want to edit anything, or reply "remove" and I'll take it down.`,
        "",
        "No more emails after this either way.",
        "",
        "Best,",
        "Michael",
      ].join("\n");
    },
    html: (t) => plainTextToHtml(TEMPLATES.follow_up.text(t)),
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

// CAN-SPAM compliance: every commercial email must include a clear
// opt-out path and a valid physical postal address. We auto-append a
// footer to every send so it can't be forgotten per-message. Address
// comes from the OUTREACH_FOOTER_ADDRESS env var; missing config blocks
// the send rather than silently skipping the legal requirement.
function buildFooter() {
  const address = (process.env.OUTREACH_FOOTER_ADDRESS || "").trim();
  if (!address) return null;
  const orgName = process.env.OUTREACH_FOOTER_ORG_NAME || "BipolarTherapyHub";
  const text = ["", "—", `${orgName} · ${address}`, "Reply STOP and I'll stop emailing you."].join(
    "\n",
  );
  const html =
    '<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px;">' +
    `<p style="color:#6b7280;font-size:12px;margin:0;">` +
    `${escapeForHtml(orgName)} · ${escapeForHtml(address)}<br>` +
    `Reply <strong>STOP</strong> and I'll stop emailing you.` +
    `</p>`;
  return { text, html };
}

function escapeForHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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

  const footer = buildFooter();
  if (!footer) {
    res.status(500).json({
      error:
        "OUTREACH_FOOTER_ADDRESS is not configured. CAN-SPAM requires a physical postal address on commercial email — set this in Vercel env before sending.",
    });
    return;
  }

  const resend = new Resend(resendKey);
  const subject = trimmedSubject || tpl.subject;
  const textBodyBase = trimmedBody || tpl.text(therapist);
  // For the HTML version, escape and convert linebreaks so the user's
  // plain-text edits render correctly. The static template falls back
  // to its own pre-built HTML.
  const htmlBodyBase = trimmedBody ? plainTextToHtml(trimmedBody) : tpl.html(therapist);
  const textBody = textBodyBase + footer.text;
  const htmlBody = htmlBodyBase + footer.html;

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
