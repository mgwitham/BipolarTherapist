// Email transport + branded layout. The delivery mechanics (Resend POST, dev
// redirect, kill switch, capture buffer for the /dev/emails preview) and the
// shared branded HTML/text shell live here, separate from the per-message
// composers in review-email.mjs and review-email-recovery.mjs. Composers
// import sendEmail + the renderers + escapeEmailHtml from this module.

import { log } from "./logger.mjs";

export function hasEmailConfig(config) {
  return Boolean(config.resendApiKey && config.emailFrom && config.notificationTo);
}

// Capture buffer for the /dev/emails preview UI. When __captureNext is set,
// the next call to sendEmail() short-circuits the network request and stashes
// the rendered payload here instead. The preview registry consumes this
// without ever needing a Resend API key. See server/dev/email-preview-registry.mjs.
let __captureBuffer = null;
let __captureNext = false;

export function startEmailCapture() {
  __captureBuffer = null;
  __captureNext = true;
}

export function readEmailCapture() {
  const captured = __captureBuffer;
  __captureBuffer = null;
  __captureNext = false;
  return captured;
}

// Dev redirect plumbing. When config.emailDevRedirect is set AND we're not
// in production, every send routes to that single inbox. The original
// to-field is preserved in a yellow banner inside the email body. Refuses
// to honor the redirect in production and logs a critical warning instead.
function applyDevRedirect(config, payload) {
  const redirect = config && config.emailDevRedirect ? String(config.emailDevRedirect).trim() : "";
  if (!redirect) {
    return { payload: payload, redirected: false };
  }

  if (process.env.NODE_ENV === "production") {
    log.error("[email] CRITICAL: EMAIL_DEV_REDIRECT is set in production. Refusing to send.", {
      recipients: payload.to || [],
    });
    throw new Error("EMAIL_DEV_REDIRECT must not be set in production.");
  }

  const originalTo = Array.isArray(payload.to) ? payload.to.join(", ") : String(payload.to || "");
  const banner =
    `<div style="background:#fff4cc;border:1px solid #d8b647;color:#5a3e00;` +
    `padding:10px 14px;font-family:Arial,sans-serif;font-size:13px;line-height:1.5;` +
    `border-radius:6px;margin:0 0 12px 0;">` +
    `<strong>DEV MODE</strong>, original recipient: ` +
    String(originalTo).replace(/[<>]/g, "") +
    `</div>`;
  const textBanner =
    "[DEV MODE, original recipient: " + String(originalTo).replace(/[<>]/g, "") + "]\n\n";

  const redirectedPayload = {
    ...payload,
    to: [redirect],
    html: payload.html ? banner + payload.html : banner,
    text: payload.text ? textBanner + payload.text : textBanner,
  };

  log.info("[email] DEV REDIRECT", {
    to: redirect,
    original: originalTo,
    subject: String(payload.subject || ""),
  });

  return { payload: redirectedPayload, redirected: true };
}

export async function sendEmail(config, payload) {
  // Capture mode: stash the rendered payload and bail before any network call.
  // Used by the /dev/emails preview UI to render a template without sending.
  if (__captureNext) {
    __captureBuffer = payload;
    __captureNext = false;
    return { captured: true };
  }

  // Global kill switch for every email path that flows through this helper:
  // weekly digests, license-expiration warnings, application notifications,
  // recovery flows, portal nudges, founder digest, etc. Set EMAIL_KILL_SWITCH
  // to anything truthy in env to pause all of them. Manual outreach sends
  // from /api/admin/send-email use a separate code path and are NOT gated
  // by this switch. That's intentional, the founder still needs to ship
  // intentional outreach from the CRM.
  if (String(process.env.EMAIL_KILL_SWITCH || "").toLowerCase() === "true") {
    log.warn("[email] kill switch active, skipping send", { to: payload?.to });
    return { skipped: true, killed: true };
  }

  if (!hasEmailConfig(config)) {
    return { skipped: true };
  }

  const { payload: outgoingPayload } = applyDevRedirect(config, payload);

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.resendApiKey}`,
    },
    body: JSON.stringify(outgoingPayload),
  });

  const result = await response.json().catch(function () {
    return {};
  });

  if (!response.ok) {
    throw new Error(result.message || result.error || "Email send failed.");
  }

  return result;
}

export function escapeEmailHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
  });
}

// Shared branded shell for all therapist-facing emails. Mobile-friendly,
// uses table-based button markup so Outlook doesn't mangle it, and
// provides an optional alert banner, primary/secondary CTAs, fallback
// URL block, and trust footer. Caller supplies bodyHtml as a string of
// sanitized/known-safe HTML (use escapeEmailHtml on user data).
//
// Props:
//   heading:          plain text, escaped here.
//   greetingName:     plain text, escaped. Rendered as "Hi {name},".
//                     Pass "" to omit the greeting line.
//   bodyHtml:         pre-built HTML for the body (paragraphs, lists).
//   alertBanner:      optional { tone: "warn"|"info", html } for
//                     callouts above the heading.
//   primaryCta:       optional { label, url }. Teal button.
//   secondaryCta:     optional { label, url }. Red button, paired
//                     next to primary (used by confirm/deny recovery).
//   footerLines:      array of plain-text lines rendered in the muted
//                     footer. Supports minimal HTML via footerLinesHtml.
//   footerLinesHtml:  array of HTML strings. Takes precedence over
//                      footerLines when set (caller pre-escaped).
export function renderBrandedEmail(options) {
  const heading = escapeEmailHtml((options && options.heading) || "");
  const greetingName = options && options.greetingName ? String(options.greetingName) : "";
  const bodyHtml = (options && options.bodyHtml) || "";
  const preheader = options && options.preheader ? String(options.preheader) : "";
  const alertBanner = options && options.alertBanner;
  const primaryCta = options && options.primaryCta;
  const secondaryCta = options && options.secondaryCta;
  const footerLinesHtml =
    options && Array.isArray(options.footerLinesHtml) ? options.footerLinesHtml : null;
  const footerLines =
    options && Array.isArray(options.footerLines) ? options.footerLines : footerLinesHtml ? [] : [];

  const greetingBlock = greetingName
    ? `<p style="margin:0 0 12px 0;">Hi ${escapeEmailHtml(greetingName)},</p>`
    : "";

  const alertHtml = alertBanner
    ? (function () {
        const palette =
          alertBanner.tone === "warn"
            ? { bg: "#fbeaea", border: "#e8c4c4", color: "#7a2f2f" }
            : { bg: "#eaf3f6", border: "#c4dde4", color: "#0f3f4a" };
        return `<tr>
              <td style="padding:0 28px 4px 28px;">
                <div style="background:${palette.bg};border:1px solid ${palette.border};color:${palette.color};border-radius:10px;padding:12px 14px;font-size:13px;line-height:1.5;">
                  ${alertBanner.html || ""}
                </div>
              </td>
            </tr>`;
      })()
    : "";

  function ctaMarkup(cta, color) {
    if (!cta || !cta.url || !cta.label) return "";
    const url = escapeEmailHtml(cta.url);
    const label = escapeEmailHtml(cta.label);
    return `<td style="background:${color};border-radius:10px;padding-right:10px;">
                      <a href="${url}" style="display:inline-block;padding:13px 22px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">${label}</a>
                    </td>`;
  }

  const ctaBlock =
    primaryCta || secondaryCta
      ? `<tr>
              <td align="left" style="padding:4px 28px 8px 28px;">
                <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate;">
                  <tr>
                    ${ctaMarkup(primaryCta, "#1a7a8f")}
                    ${ctaMarkup(secondaryCta, "#a04a4a")}
                  </tr>
                </table>
              </td>
            </tr>`
      : "";

  // Fallback-URL block is only shown when a primary CTA exists; that's
  // where "button not working" matters. Pick the first URL that exists.
  const fallbackUrl = (primaryCta && primaryCta.url) || (secondaryCta && secondaryCta.url) || "";
  const fallbackBlock = fallbackUrl
    ? `<tr>
              <td style="padding:14px 28px 4px 28px;font-size:13px;line-height:1.5;color:#4a6572;">
                <p style="margin:0 0 6px 0;">Button not working? Paste this into your browser:</p>
                <p style="margin:0;word-break:break-all;">
                  <a href="${escapeEmailHtml(fallbackUrl)}" style="color:#155f70;text-decoration:underline;">${escapeEmailHtml(fallbackUrl)}</a>
                </p>
              </td>
            </tr>`
    : "";

  const footerHtml = (footerLinesHtml || footerLines.map(escapeEmailHtml))
    .filter(Boolean)
    .map(function (line, index) {
      return `<p style="margin:${index === 0 ? "14px 0 6px 0" : "0 0 6px 0"};">${line}</p>`;
    })
    .join("");

  const footerBlock = footerHtml
    ? `<tr>
              <td style="padding:18px 28px 22px 28px;border-top:1px solid #e6eef1;margin-top:14px;font-size:12px;line-height:1.5;color:#6b8290;">
                ${footerHtml}
              </td>
            </tr>`
    : "";

  // Hidden preheader text. Mail clients pull this for inbox-list preview
  // text. The trailing &zwnj; / &#847; combo plus extra whitespace prevents
  // the rest of the body content from leaking into the snippet on Gmail.
  const preheaderBlock = preheader
    ? `<div style="display:none;font-size:1px;color:#f7fbfc;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;mso-hide:all;">${escapeEmailHtml(preheader)}&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>`
    : "";

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f7fbfc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#1d3a4a;">
    ${preheaderBlock}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7fbfc;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:14px;box-shadow:0 6px 20px rgba(15,65,78,0.08);overflow:hidden;">
            <tr>
              <td style="padding:22px 28px 0 28px;">
                <div style="font-size:15px;font-weight:700;letter-spacing:-0.01em;color:#0f3f4a;">
                  BipolarTherapy<span style="color:#1a7a8f;">Hub</span>
                </div>
              </td>
            </tr>
            ${alertHtml}
            <tr>
              <td style="padding:18px 28px 4px 28px;">
                <h1 style="margin:0;font-size:22px;line-height:1.25;color:#0f3f4a;font-weight:700;">${heading}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px 8px 28px;font-size:15px;line-height:1.55;color:#1d3a4a;">
                ${greetingBlock}
                ${bodyHtml}
              </td>
            </tr>
            ${ctaBlock}
            ${fallbackBlock}
            ${footerBlock}
          </table>
          <p style="margin:18px 0 0 0;font-size:11px;color:#8a9ba4;">
            BipolarTherapyHub · California bipolar-specialist directory
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

// Plain-text fallback. Some mail clients and screen readers prefer
// text/plain, and a clean plain-text part also improves deliverability.
export function renderBrandedEmailText(options) {
  const heading = (options && options.heading) || "";
  const greetingName = options && options.greetingName ? String(options.greetingName) : "";
  const bodyText = (options && options.bodyText) || "";
  const primaryCta = options && options.primaryCta;
  const secondaryCta = options && options.secondaryCta;
  const footerLines =
    options && Array.isArray(options.footerLines) ? options.footerLines.filter(Boolean) : [];

  const parts = [heading, ""];
  if (greetingName) {
    parts.push("Hi " + greetingName + ",", "");
  }
  if (bodyText) {
    parts.push(bodyText, "");
  }
  if (primaryCta && primaryCta.url) {
    parts.push((primaryCta.label ? primaryCta.label + ": " : "") + primaryCta.url, "");
  }
  if (secondaryCta && secondaryCta.url) {
    parts.push((secondaryCta.label ? secondaryCta.label + ": " : "") + secondaryCta.url, "");
  }
  if (footerLines.length) {
    parts.push(...footerLines, "");
  }
  parts.push("BipolarTherapyHub");
  return parts.join("\n");
}
