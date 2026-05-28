import { createClient } from "@sanity/client";
import { verifyAdminSession } from "../_adminAuth.mjs";
import { getRateLimiter } from "../../server/rate-limit-store.mjs";
import {
  INITIAL_SUBJECT,
  PROFILE_GAP_SUBJECT,
  REASSURANCE_SUBJECT,
  buildOutreachBody,
  buildProfileGapBody,
  buildReassuranceBody,
  withOutreachRef,
} from "../../shared/outreach-templates.mjs";

// Hourly send cap for therapist-outreach emails from this endpoint.
// Backstop against a compromised admin session attempting to blast all
// 150 live therapists with phishing in seconds. The duplicate-send
// guard below prevents the same template-to-therapist combo twice,
// but does NOT cap the total throughput per hour — this does.
//
// 50/hour matches the operational reality of weekly outreach sprints
// (we never legitimately send more than ~30 in a working session) and
// is configurable via ADMIN_OUTREACH_HOURLY_LIMIT if a real campaign
// genuinely needs more headroom.
const ADMIN_OUTREACH_HOURLY_LIMIT = Number(process.env.ADMIN_OUTREACH_HOURLY_LIMIT) || 50;
const ADMIN_OUTREACH_WINDOW_MS = 60 * 60 * 1000;

// The limiter persists across Vercel cold starts via Upstash Redis
// when configured (the Vercel KV integration also exposes the same
// Upstash REST credentials under KV_REST_API_* — accepted either way).
// In dev with neither set, it falls back to an in-process Map; that's
// fine because dev rarely sends real emails and a cold-start reset is
// not a security issue at that scale.
function getOutreachLimiter() {
  return getRateLimiter("admin_outreach", ADMIN_OUTREACH_WINDOW_MS, ADMIN_OUTREACH_HOURLY_LIMIT, {
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

// Direct fetch to the Resend HTTP API instead of the `resend` SDK.
// The SDK isn't in package.json (the rest of the codebase posts to
// api.resend.com/emails directly via fetch — see server/review-email.mjs)
// and importing it crashes the function on Vercel with
// FUNCTION_INVOCATION_FAILED.
async function resendSend({ apiKey, from, to, subject, html, text }) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ from, to, subject, html, text }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.message || data?.error || `Resend API error ${response.status}`;
    throw new Error(message);
  }
  return data;
}

const VALID_TEMPLATES = new Set(["email_1", "follow_up", "profile_gap", "reassurance"]);

// Fallback copy used when the composer ships a blank subject/body
// (shouldn't happen — the client validates — but defense in depth).
// Subject + body live in shared/outreach-templates.mjs, used by both
// the client composer and this server fallback.
function buildSharedBody(t) {
  return buildOutreachBody({
    name: t.name,
    profileUrl: withOutreachRef(t.profileUrl || ""),
  });
}
function buildSharedProfileGapBody(t) {
  return buildProfileGapBody({
    name: t.name,
    profileUrl: withOutreachRef(t.profileUrl || ""),
  });
}
function buildSharedReassuranceBody(t) {
  return buildReassuranceBody({
    name: t.name,
    profileUrl: withOutreachRef(t.profileUrl || ""),
  });
}
const TEMPLATES = {
  email_1: {
    subject: () => INITIAL_SUBJECT,
    text: (t) => buildSharedBody(t),
    html: (t) => plainTextToHtml(buildSharedBody(t)),
    nextStatus: "email_1_sent",
  },
  follow_up: {
    // Same body as the initial; Re: prefix so Gmail threads it.
    subject: () => `Re: ${INITIAL_SUBJECT}`,
    text: (t) => buildSharedBody(t),
    html: (t) => plainTextToHtml(buildSharedBody(t)),
    nextStatus: "followed_up",
  },
  profile_gap: {
    // Touch-3 angle: addresses the two highest-friction gaps on the
    // therapist's profile (photo + bipolar-years-experience). Uses a
    // fresh, action-oriented subject (not threaded) to earn inbox
    // attention back after two prior touches.
    subject: () => PROFILE_GAP_SUBJECT,
    text: (t) => buildSharedProfileGapBody(t),
    html: (t) => plainTextToHtml(buildSharedProfileGapBody(t)),
    nextStatus: "profile_gap_sent",
  },
  reassurance: {
    // Touch-4 angle: objection-handling (free / fast / reversible /
    // under their control) for therapists who've seen three touches and
    // still haven't claimed. Fresh, non-threaded subject.
    subject: () => REASSURANCE_SUBJECT,
    text: (t) => buildSharedReassuranceBody(t),
    html: (t) => plainTextToHtml(buildSharedReassuranceBody(t)),
    nextStatus: "reassurance_sent",
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
// `html` field of the email. Escapes HTML special chars, auto-links any
// http(s) URL or bare bipolartherapyhub.com reference so the signature
// line and profile link both render as clickable anchors, then turns
// blank lines into paragraph breaks and single newlines into <br>.
function plainTextToHtml(text) {
  const escaped = String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // Order matters: match full URLs first so the bare-domain fallback
  // doesn't truncate them mid-path.
  const URL_PATTERN = /(https?:\/\/[^\s<]+|www\.[^\s<]+|bipolartherapyhub\.com)/gi;
  const linked = escaped.replace(URL_PATTERN, (match) => {
    let href = match;
    if (!/^https?:\/\//i.test(href)) {
      href = `https://${href.startsWith("www.") ? href : `www.${href}`}`;
    }
    return `<a href="${href}" style="color:#2a5f6e;">${match}</a>`;
  });
  const paragraphs = linked.split(/\n{2,}/).map(function (block) {
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
  const text = [
    "",
    "---",
    `${orgName} · ${address}`,
    "Reply STOP and I'll stop emailing you.",
  ].join("\n");
  const html =
    '<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px;">' +
    `<p style="color:#6b7280;font-size:12px;margin:0;">` +
    `${escapeForHtml(orgName)} · ${escapeForHtml(address)}<br>` +
    `Reply <strong>STOP</strong> and I'll stop emailing you.` +
    `</p>`;
  return { text, html };
}

// Test sends use OUTREACH_TEST_TO when set. If unset, fall back to the
// bare email address parsed out of OUTREACH_EMAIL_FROM (e.g. extract
// `michael@bipolartherapyhub.com` from `Michael <michael@…>`).
function resolveTestRecipient(fromAddress) {
  const explicit = (process.env.OUTREACH_TEST_TO || "").trim();
  if (explicit) return explicit;
  const match = String(fromAddress || "").match(/<([^>]+)>/);
  if (match) return match[1].trim();
  // Bare-address from-field with no <…> wrapper.
  const trimmed = String(fromAddress || "").trim();
  return /@/.test(trimmed) ? trimmed : "";
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

  const {
    therapistId,
    template,
    subject: subjectOverride,
    body: bodyOverride,
    sendToSelf,
    campaign: rawCampaign,
    force,
  } = body || {};

  // Hourly send-cap check. Runs after auth (so anonymous probes don't
  // burn limiter quota) and after JSON parsing (so a bad-shape request
  // doesn't count either), but BEFORE we touch Sanity or Resend. Test
  // sends (sendToSelf, which only ever hit the founder's own inbox)
  // bypass the cap so previews never get blocked. We `record` here
  // unconditionally on real sends — counts both successful and failed
  // attempts — so loops on Resend errors can't game the limit.
  if (!sendToSelf) {
    const limiter = getOutreachLimiter();
    const ipKey = getClientIpAddress(req);
    const allowed = await limiter.canAttempt(ipKey);
    if (!allowed) {
      res.setHeader("Retry-After", String(Math.ceil(ADMIN_OUTREACH_WINDOW_MS / 1000)));
      res.status(429).json({
        error: "rate_limited",
        message: `Admin outreach send cap of ${ADMIN_OUTREACH_HOURLY_LIMIT}/hour reached. Wait and retry, or raise ADMIN_OUTREACH_HOURLY_LIMIT in env if a campaign legitimately needs more headroom.`,
        limit: ADMIN_OUTREACH_HOURLY_LIMIT,
        windowMs: ADMIN_OUTREACH_WINDOW_MS,
      });
      return;
    }
    await limiter.record(ipKey);
  }
  // Free-text campaign tag set per batch. Capped at 80 chars and
  // sanitized to slug-style so noisy entries don't pollute Subject
  // Performance grouping. Empty string is allowed and falls back to
  // "(no campaign)" in the leaderboard.
  const campaign =
    typeof rawCampaign === "string"
      ? rawCampaign
          .trim()
          .slice(0, 80)
          .replace(/[^a-z0-9_-]/gi, "-")
          .toLowerCase()
      : "";
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
        _id, name, email, slug, city,
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
  if (!sendToSelf && !therapist.email) {
    res.status(400).json({ error: "Therapist has no email address on file" });
    return;
  }

  // Duplicate-send guard. On 2026-05-15 two batch waves overlapped and
  // shipped the same `email_1` to ~30 therapists twice within ~30s. Now
  // we hard-block any real send (not test) where the same template
  // already appears in outreach.emailLog. The client can pass
  // `force: true` after explicit confirmation if a re-send is truly
  // intentional. Test sends (sendToSelf) bypass the check.
  if (!sendToSelf && !force) {
    const existingLog = Array.isArray(therapist.outreach?.emailLog)
      ? therapist.outreach.emailLog
      : [];
    const priorSameTemplate = existingLog
      .filter((entry) => entry && entry.template === template && entry.sentAt)
      .sort((a, b) => String(b.sentAt).localeCompare(String(a.sentAt)))[0];
    if (priorSameTemplate) {
      res.status(409).json({
        error: "duplicate_send",
        message: `This therapist already received the "${template}" template at ${priorSameTemplate.sentAt}. Pass force:true to re-send.`,
        lastSentAt: priorSameTemplate.sentAt,
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

  const fromAddress = process.env.OUTREACH_EMAIL_FROM || process.env.REVIEW_EMAIL_FROM;
  if (!fromAddress) {
    res.status(500).json({ error: "OUTREACH_EMAIL_FROM not configured" });
    return;
  }

  const footer = buildFooter();
  if (!footer) {
    res.status(500).json({
      error:
        "OUTREACH_FOOTER_ADDRESS is not configured. CAN-SPAM requires a physical postal address on commercial email. Set this in Vercel env before sending.",
    });
    return;
  }

  const subject = trimmedSubject || tpl.subject(therapist);
  const textBodyBase = trimmedBody || tpl.text(therapist);
  // For the HTML version, escape and convert linebreaks so the user's
  // plain-text edits render correctly. The static template falls back
  // to its own pre-built HTML.
  const htmlBodyBase = trimmedBody ? plainTextToHtml(trimmedBody) : tpl.html(therapist);
  const textBody = textBodyBase + footer.text;
  const htmlBody = htmlBodyBase + footer.html;

  // Test send: route to the founder's inbox so you can preview the
  // exact email a therapist would receive (with their personalization
  // intact). Adds [TEST] subject prefix so it's obvious in the inbox.
  // Does not patch Sanity, does not touch outreach status.
  if (sendToSelf) {
    const testTo = resolveTestRecipient(fromAddress);
    if (!testTo) {
      res.status(500).json({
        error: "Could not resolve a test recipient. Set OUTREACH_TEST_TO env var.",
      });
      return;
    }
    try {
      await resendSend({
        apiKey: resendKey,
        from: fromAddress,
        to: testTo,
        subject: `[TEST] ${subject}`,
        html: htmlBody,
        text: textBody,
      });
    } catch (err) {
      console.error("resend test error:", err);
      res.status(500).json({ error: "Failed to send test", detail: err.message });
      return;
    }
    res.status(200).json({ ok: true, testTo });
    return;
  }

  let resendResult;
  try {
    resendResult = await resendSend({
      apiKey: resendKey,
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
  const resendId = resendResult?.id || "";
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
          {
            _key: `email_${Date.now()}`,
            sentAt: now,
            subject,
            template,
            body: textBody,
            resendId,
            ...(campaign ? { campaign } : {}),
          },
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
