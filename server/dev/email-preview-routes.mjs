// Dev-only email preview routes. Mounted at /dev/emails on the local
// review API (default http://localhost:8787). Returns 404 in production
// regardless of how the request was routed, so accidental exposure is
// bounded — the worst case is that the route exists but every response
// is "Not found".
//
// Routes:
//   GET  /dev/emails                      → picker HTML
//   GET  /dev/emails/list.json            → JSON catalog
//   GET  /dev/emails/<id>                 → detail HTML
//   GET  /dev/emails/<id>/preview.json    → rendered Resend payload + metadata
//   POST /dev/emails/<id>/send-test       → fires the actual Resend send,
//                                          honoring EMAIL_DEV_REDIRECT
//
// The picker is intentionally vanilla — no build step, no framework.
// A static HTML shell with inline CSS and ~80 lines of JS that hits the
// JSON endpoints. Works on mobile since the layout is single-column.

import { sendEmail } from "../review-email.mjs";
import { listTemplates, renderTemplate } from "./email-preview-registry.mjs";

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function send404(response) {
  response.statusCode = 404;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.end("Not found.");
  return true;
}

function sendHtml(response, status, body) {
  response.statusCode = status;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(body);
  return true;
}

function sendJsonLocal(response, status, body) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
  return true;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// Rate limiting for test sends — 1 per template per 10 seconds.
// ---------------------------------------------------------------------------

const sendCooldown = new Map();
const COOLDOWN_MS = 10 * 1000;

function isOnCooldown(id) {
  const last = sendCooldown.get(id);
  if (!last) return false;
  return Date.now() - last < COOLDOWN_MS;
}

function recordSend(id) {
  sendCooldown.set(id, Date.now());
}

// ---------------------------------------------------------------------------
// HTML pages
// ---------------------------------------------------------------------------

const SHARED_CSS = `
  body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f7fbfc; color: #1d3a4a; }
  .wrap { max-width: 980px; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { font-size: 22px; margin: 0 0 4px; color: #0f3f4a; }
  .kicker { font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #1a7a8f; margin: 0 0 12px; }
  .lede { color: #4a6572; margin: 0 0 20px; font-size: 14px; line-height: 1.5; }
  .banner { padding: 10px 14px; border-radius: 8px; margin: 0 0 20px; font-size: 13px; line-height: 1.5; }
  .banner.warn { background: #fff4cc; border: 1px solid #d8b647; color: #5a3e00; }
  .banner.info { background: #eaf3f6; border: 1px solid #c4dde4; color: #0f3f4a; }
  .banner.danger { background: #fbeaea; border: 1px solid #e8c4c4; color: #7a2f2f; }
  table.list { width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(15,65,78,0.06); }
  table.list th, table.list td { text-align: left; padding: 12px 14px; border-bottom: 1px solid #eef3f5; vertical-align: top; font-size: 13px; }
  table.list th { background: #f0f6f8; font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: #1a7a8f; }
  table.list td.template-name { font-weight: 600; color: #0f3f4a; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; }
  .pill.recipient-admin { background: #e6e0f5; color: #4a2f7a; }
  .pill.recipient-therapist { background: #d4eef0; color: #0f3f4a; }
  .pill.recipient-both { background: #f5e0d4; color: #7a3f1d; }
  .pill.preheader-set { background: #d8eed8; color: #2f5a2f; }
  .pill.preheader-missing { background: #fbeaea; color: #7a2f2f; }
  .pill.preheader-todo { background: #fff4cc; color: #5a3e00; }
  a.btn { display: inline-block; padding: 8px 14px; background: #1a7a8f; color: #fff; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 13px; }
  a.btn:hover { background: #155f70; }
  a.btn.secondary { background: #fff; color: #1a7a8f; border: 1px solid #1a7a8f; }
  button.btn { font-family: inherit; cursor: pointer; padding: 10px 18px; background: #1a7a8f; color: #fff; border: 0; border-radius: 8px; font-weight: 700; font-size: 14px; }
  button.btn:disabled { background: #b3c5cb; cursor: not-allowed; }
  button.btn:hover:not(:disabled) { background: #155f70; }
  .meta-grid { display: grid; grid-template-columns: 140px 1fr; gap: 8px 16px; font-size: 13px; margin: 0 0 18px; }
  .meta-grid dt { font-weight: 600; color: #4a6572; }
  .meta-grid dd { margin: 0; color: #1d3a4a; word-break: break-word; }
  .inbox-row { background: #fff; border: 1px solid #d6e2e6; border-radius: 10px; padding: 14px 16px; margin: 0 0 18px; box-shadow: 0 1px 3px rgba(15,65,78,0.04); }
  .inbox-row .from { font-weight: 700; font-size: 14px; color: #0f3f4a; }
  .inbox-row .subject { font-size: 14px; font-weight: 700; color: #0f3f4a; margin-top: 2px; }
  .inbox-row .preheader { font-size: 13px; color: #6b8290; margin-top: 2px; }
  .inbox-row .placeholder { color: #b06a00; font-style: italic; }
  iframe.preview { width: 100%; height: 720px; border: 1px solid #d6e2e6; border-radius: 10px; background: #fff; }
  pre.text { background: #fff; border: 1px solid #d6e2e6; border-radius: 10px; padding: 14px; font-size: 13px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
  section { margin-bottom: 28px; }
  h2 { font-size: 16px; color: #0f3f4a; margin: 0 0 10px; }
  .toast { position: fixed; bottom: 20px; right: 20px; background: #0f3f4a; color: #fff; padding: 12px 18px; border-radius: 8px; font-size: 13px; box-shadow: 0 4px 12px rgba(15,65,78,0.2); }
  .toast.error { background: #7a2f2f; }
`;

function renderEnvBanner() {
  const redirect = process.env.EMAIL_DEV_REDIRECT || "";
  if (redirect) {
    return (
      '<div class="banner warn">' +
      '<strong>EMAIL_DEV_REDIRECT is active.</strong> All "Send test" buttons route to <code>' +
      escapeHtml(redirect) +
      "</code> regardless of the original recipient." +
      "</div>"
    );
  }
  return (
    '<div class="banner info">' +
    "<strong>EMAIL_DEV_REDIRECT is not set.</strong> Test sends are disabled. " +
    "Add it to your <code>.env</code> (e.g. <code>EMAIL_DEV_REDIRECT=you+bth-dev@gmail.com</code>) and restart the API." +
    "</div>"
  );
}

function renderPickerPage() {
  const templates = listTemplates();
  const rows = templates
    .map(function (entry) {
      return (
        "<tr>" +
        '<td class="template-name">' +
        escapeHtml(entry.name) +
        "</td>" +
        '<td><span class="pill recipient-' +
        escapeHtml(entry.recipient) +
        '">' +
        escapeHtml(entry.recipient) +
        "</span></td>" +
        "<td>" +
        escapeHtml(entry.trigger) +
        "</td>" +
        '<td><span class="pill preheader-' +
        escapeHtml(entry.preheaderStatus) +
        '">' +
        escapeHtml(entry.preheaderStatus) +
        "</span></td>" +
        '<td><a class="btn secondary" href="/dev/emails/' +
        escapeHtml(entry.id) +
        '">Preview</a></td>' +
        "</tr>"
      );
    })
    .join("");

  return (
    "<!doctype html><html lang='en'><head><meta charset='utf-8'>" +
    "<meta name='viewport' content='width=device-width, initial-scale=1'>" +
    "<title>Email previews · BipolarTherapyHub dev</title>" +
    "<style>" +
    SHARED_CSS +
    "</style></head><body>" +
    "<div class='wrap'>" +
    "<p class='kicker'>Dev-only</p>" +
    "<h1>Email previews</h1>" +
    "<p class='lede'>" +
    escapeHtml(String(templates.length)) +
    " templates. Each is rendered against the same Jamie Rivera sample so cross-template comparison works." +
    "</p>" +
    renderEnvBanner() +
    "<table class='list'>" +
    "<thead><tr><th>Template</th><th>Recipient</th><th>Trigger</th><th>Preheader</th><th></th></tr></thead>" +
    "<tbody>" +
    rows +
    "</tbody>" +
    "</table>" +
    "</div></body></html>"
  );
}

async function renderDetailPage(templateId, config) {
  let rendered;
  let renderError = null;
  try {
    rendered = await renderTemplate(templateId, config);
  } catch (error) {
    renderError = error && error.message ? error.message : String(error);
  }

  if (renderError) {
    return (
      "<!doctype html><html><head><meta charset='utf-8'><title>Preview error</title>" +
      "<style>" +
      SHARED_CSS +
      "</style></head><body><div class='wrap'>" +
      "<p class='kicker'>Dev-only</p>" +
      "<h1>Preview error</h1>" +
      "<div class='banner danger'>" +
      escapeHtml(renderError) +
      "</div>" +
      "<p><a href='/dev/emails'>← Back to picker</a></p>" +
      "</div></body></html>"
    );
  }

  const payload = rendered.payload || {};
  const fromName =
    String(payload.from || "BipolarTherapyHub")
      .split("<")[0]
      .trim() || "BipolarTherapyHub";
  const subject = payload.subject || "(no subject)";
  const preheader = rendered.preheader || "";
  const preheaderHtml = preheader
    ? '<div class="preheader">' + escapeHtml(preheader) + "</div>"
    : '<div class="preheader placeholder">' +
      "(no preheader — the inbox will show the first words of the body instead)" +
      "</div>";

  const preheaderWarning =
    rendered.preheaderStatus !== "set"
      ? '<div class="banner warn"><strong>Preheader ' +
        escapeHtml(rendered.preheaderStatus) +
        ".</strong> The inbox snippet will fall back to scaffolding text. " +
        "Add a deliberate preheader in the registry entry for this template.</div>"
      : "";

  const sendDisabled = !process.env.EMAIL_DEV_REDIRECT;
  const resendDisabled = !config.resendApiKey;
  const sendButtonLabel = sendDisabled
    ? "Send test (set EMAIL_DEV_REDIRECT to enable)"
    : resendDisabled
      ? "Send test (set RESEND_API_KEY to enable)"
      : "Send test to dev inbox";

  const htmlBody = String(payload.html || "");
  const textBody = String(payload.text || "(no plaintext fallback)");
  const toField = Array.isArray(payload.to) ? payload.to.join(", ") : String(payload.to || "");
  const replyTo = String(payload.reply_to || "");

  return (
    "<!doctype html><html lang='en'><head><meta charset='utf-8'>" +
    "<meta name='viewport' content='width=device-width, initial-scale=1'>" +
    "<title>" +
    escapeHtml(rendered.name) +
    " · email preview</title>" +
    "<style>" +
    SHARED_CSS +
    "</style></head><body><div class='wrap'>" +
    "<p class='kicker'><a href='/dev/emails' style='color:inherit;text-decoration:none;'>← All templates</a></p>" +
    "<h1>" +
    escapeHtml(rendered.name) +
    "</h1>" +
    "<p class='lede'>" +
    escapeHtml(rendered.trigger) +
    "</p>" +
    renderEnvBanner() +
    preheaderWarning +
    "<section><h2>Inbox preview</h2>" +
    "<div class='inbox-row'>" +
    "<div class='from'>" +
    escapeHtml(fromName) +
    "</div>" +
    "<div class='subject'>" +
    escapeHtml(subject) +
    "</div>" +
    preheaderHtml +
    "</div>" +
    "</section>" +
    "<section><h2>Metadata</h2><dl class='meta-grid'>" +
    "<dt>Recipient type</dt><dd>" +
    escapeHtml(rendered.recipient) +
    "</dd>" +
    "<dt>To</dt><dd>" +
    escapeHtml(toField) +
    "</dd>" +
    "<dt>From</dt><dd>" +
    escapeHtml(payload.from || "") +
    "</dd>" +
    (replyTo ? "<dt>Reply-To</dt><dd>" + escapeHtml(replyTo) + "</dd>" : "") +
    "<dt>Source</dt><dd><code>" +
    escapeHtml(rendered.source) +
    "</code></dd>" +
    "<dt>Snapshot</dt><dd><code>docs/email-snapshots/" +
    escapeHtml(rendered.id) +
    ".html</code></dd>" +
    "</dl></section>" +
    "<section><h2>Rendered HTML</h2>" +
    "<iframe class='preview' srcdoc='" +
    htmlBody.replace(/'/g, "&#39;") +
    "'></iframe>" +
    "</section>" +
    "<section><h2>Plaintext fallback</h2>" +
    "<pre class='text'>" +
    escapeHtml(textBody) +
    "</pre></section>" +
    "<section><h2>Send a real test</h2>" +
    "<button class='btn' id='sendBtn' " +
    (sendDisabled || resendDisabled ? "disabled" : "") +
    " data-template='" +
    escapeHtml(rendered.id) +
    "'>" +
    escapeHtml(sendButtonLabel) +
    "</button>" +
    "</section>" +
    "</div>" +
    "<script>" +
    "const btn = document.getElementById('sendBtn');" +
    "if (btn) {" +
    "  btn.addEventListener('click', async function () {" +
    "    const id = btn.getAttribute('data-template');" +
    "    btn.disabled = true; btn.textContent = 'Sending...';" +
    "    try {" +
    "      const r = await fetch('/dev/emails/' + encodeURIComponent(id) + '/send-test', { method: 'POST' });" +
    "      const j = await r.json().catch(function(){ return {}; });" +
    "      if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));" +
    "      const t = document.createElement('div');" +
    "      t.className = 'toast'; t.textContent = 'Sent — Resend id: ' + (j.id || 'ok');" +
    "      document.body.appendChild(t);" +
    "      setTimeout(function(){ t.remove(); btn.disabled = false; btn.textContent = " +
    JSON.stringify(sendButtonLabel) +
    "; }, 4000);" +
    "    } catch (err) {" +
    "      const t = document.createElement('div');" +
    "      t.className = 'toast error'; t.textContent = 'Failed: ' + (err.message || err);" +
    "      document.body.appendChild(t);" +
    "      setTimeout(function(){ t.remove(); btn.disabled = false; btn.textContent = " +
    JSON.stringify(sendButtonLabel) +
    "; }, 6000);" +
    "    }" +
    "  });" +
    "}" +
    "</script>" +
    "</body></html>"
  );
}

// ---------------------------------------------------------------------------
// Route handler — entry point registered in review-handler.mjs
// ---------------------------------------------------------------------------

export async function handleEmailPreviewRoutes(context) {
  const { request, response, routePath, config } = context;

  if (!routePath.startsWith("/dev/emails")) {
    return false;
  }

  if (isProduction()) {
    return send404(response);
  }

  // GET /dev/emails — picker
  if (request.method === "GET" && (routePath === "/dev/emails" || routePath === "/dev/emails/")) {
    return sendHtml(response, 200, renderPickerPage());
  }

  // GET /dev/emails/list.json
  if (request.method === "GET" && routePath === "/dev/emails/list.json") {
    return sendJsonLocal(response, 200, {
      templates: listTemplates(),
      env: {
        emailDevRedirect: process.env.EMAIL_DEV_REDIRECT || "",
        resendConfigured: Boolean(config.resendApiKey),
      },
    });
  }

  const detailMatch = routePath.match(/^\/dev\/emails\/([a-z0-9-]+)$/);
  if (request.method === "GET" && detailMatch) {
    const html = await renderDetailPage(detailMatch[1], config);
    return sendHtml(response, 200, html);
  }

  const previewMatch = routePath.match(/^\/dev\/emails\/([a-z0-9-]+)\/preview\.json$/);
  if (request.method === "GET" && previewMatch) {
    try {
      const rendered = await renderTemplate(previewMatch[1], config);
      return sendJsonLocal(response, 200, rendered);
    } catch (error) {
      return sendJsonLocal(response, 500, {
        error: error && error.message ? error.message : "Preview failed.",
      });
    }
  }

  const sendMatch = routePath.match(/^\/dev\/emails\/([a-z0-9-]+)\/send-test$/);
  if (request.method === "POST" && sendMatch) {
    const id = sendMatch[1];
    if (!process.env.EMAIL_DEV_REDIRECT) {
      return sendJsonLocal(response, 412, {
        error: "EMAIL_DEV_REDIRECT is not set. Refusing to send.",
      });
    }
    if (!config.resendApiKey) {
      return sendJsonLocal(response, 412, {
        error: "RESEND_API_KEY is not configured.",
      });
    }
    if (isOnCooldown(id)) {
      return sendJsonLocal(response, 429, {
        error: "Slow down — wait 10 seconds between test sends per template.",
      });
    }
    try {
      const rendered = await renderTemplate(id, config);
      const payload = rendered.payload;
      // Force the to-field to a sentinel; applyDevRedirect inside sendEmail()
      // will rewrite it to EMAIL_DEV_REDIRECT and prepend the banner.
      const result = await sendEmail(config, payload);
      recordSend(id);
      return sendJsonLocal(response, 200, {
        ok: true,
        id: result && result.id ? result.id : null,
        redirected_to: process.env.EMAIL_DEV_REDIRECT,
      });
    } catch (error) {
      return sendJsonLocal(response, 502, {
        error: error && error.message ? error.message : "Send failed.",
      });
    }
  }

  // Unknown sub-path under /dev/emails
  return send404(response);
}
