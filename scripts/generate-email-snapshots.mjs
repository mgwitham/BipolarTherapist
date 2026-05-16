// Generates a static HTML snapshot of every email template into
// docs/email-snapshots/<template-id>.html, plus an index at
// docs/email-snapshots/README.md. Snapshots are committed to the repo so
// PR diffs show how email rendering changed.
//
// Usage:
//   npm run cms:snapshot:emails
//
// Snapshots are self-contained: inline CSS, no scripts, no external
// references. They render as-is in any browser or in a PR's "View
// rendered file" tab on GitHub.

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { EMAIL_TEMPLATES, renderTemplate } from "../server/dev/email-preview-registry.mjs";

const SNAPSHOT_DIR = resolve(process.cwd(), "docs/email-snapshots");

// Minimal config for capture mode. The senders short-circuit at sendEmail()
// before touching the network, so missing live secrets is fine.
const SNAPSHOT_CONFIG = {
  emailFrom: "BipolarTherapyHub <support@bipolartherapyhub.com>",
  notificationTo: "support@bipolartherapyhub.com",
  resendApiKey: "re_SNAPSHOT_KEY_NOT_USED",
  portalBaseUrl: "https://www.bipolartherapyhub.com",
};

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildSnapshotPage(rendered) {
  const payload = rendered.payload || {};
  const subject = escapeHtml(payload.subject || "(no subject)");
  const fromName = escapeHtml(
    String(payload.from || "")
      .split("<")[0]
      .trim() || "BipolarTherapyHub",
  );
  const toField = escapeHtml(
    Array.isArray(payload.to) ? payload.to.join(", ") : String(payload.to || ""),
  );
  const replyTo = escapeHtml(payload.reply_to || "");
  const preheader = escapeHtml(rendered.preheader || "");
  const htmlBody = String(payload.html || "");
  const textBody = String(payload.text || "(no plaintext fallback)");

  return [
    "<!doctype html>",
    "<html lang='en'>",
    "<head>",
    "<meta charset='utf-8'>",
    "<title>" + escapeHtml(rendered.name) + " · email snapshot</title>",
    "<style>",
    "body{margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f7fbfc;color:#1d3a4a;}",
    ".wrap{max-width:760px;margin:0 auto;padding:24px 16px 48px;}",
    "h1{font-size:20px;margin:0 0 4px;color:#0f3f4a;}",
    ".kicker{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#1a7a8f;margin:0 0 16px;}",
    ".meta{background:#fff;border:1px solid #d6e2e6;border-radius:10px;padding:14px 18px;margin:0 0 18px;font-size:13px;line-height:1.55;}",
    ".meta strong{color:#0f3f4a;}",
    ".inbox{background:#fff;border:1px solid #d6e2e6;border-radius:10px;padding:14px 16px;margin:0 0 18px;}",
    ".inbox .subject{font-weight:700;font-size:14px;color:#0f3f4a;}",
    ".inbox .preheader{font-size:13px;color:#6b8290;}",
    "iframe{width:100%;height:720px;border:1px solid #d6e2e6;border-radius:10px;background:#fff;}",
    "h2{font-size:14px;color:#0f3f4a;margin:24px 0 8px;}",
    "pre{background:#fff;border:1px solid #d6e2e6;border-radius:10px;padding:14px;font-size:12px;line-height:1.55;white-space:pre-wrap;word-break:break-word;}",
    "</style>",
    "</head>",
    "<body><div class='wrap'>",
    "<p class='kicker'>Email snapshot · committed for diff review</p>",
    "<h1>" + escapeHtml(rendered.name) + "</h1>",
    "<p class='meta'>",
    "<strong>Trigger:</strong> " + escapeHtml(rendered.trigger) + "<br>",
    "<strong>Recipient:</strong> " + escapeHtml(rendered.recipient) + "<br>",
    "<strong>Source:</strong> <code>" + escapeHtml(rendered.source) + "</code><br>",
    "<strong>To:</strong> " + toField + "<br>",
    "<strong>From:</strong> " + escapeHtml(payload.from || "") + "<br>",
    replyTo ? "<strong>Reply-To:</strong> " + replyTo + "<br>" : "",
    "</p>",
    "<div class='inbox'>",
    "<div class='from'><strong>" + fromName + "</strong></div>",
    "<div class='subject'>" + subject + "</div>",
    "<div class='preheader'>" + (preheader || "(no preheader)") + "</div>",
    "</div>",
    htmlBody
      ? "<h2>HTML body</h2><iframe srcdoc='" + htmlBody.replace(/'/g, "&#39;") + "'></iframe>"
      : "",
    "<h2>Plaintext fallback</h2>",
    "<pre>" + escapeHtml(textBody) + "</pre>",
    "</div></body></html>",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildIndexMarkdown(entries) {
  const lines = [
    "# Email snapshots",
    "",
    "Auto-generated visual record of every email the system can send. Each",
    "snapshot is a self-contained HTML file you can open in any browser,",
    'or view directly in a GitHub PR diff via "View rendered file".',
    "",
    "Regenerate with:",
    "",
    "```sh",
    "npm run cms:snapshot:emails",
    "```",
    "",
    "Source of truth: [`server/dev/email-preview-registry.mjs`](../../server/dev/email-preview-registry.mjs)",
    "and [`server/dev/email-sample-data.mjs`](../../server/dev/email-sample-data.mjs).",
    "",
    "| Template | Recipient | Trigger | Snapshot |",
    "| --- | --- | --- | --- |",
  ];
  for (const entry of entries) {
    lines.push(
      "| " +
        entry.name +
        " | " +
        entry.recipient +
        " | " +
        entry.trigger.replace(/\|/g, "\\|") +
        " | [`" +
        entry.id +
        ".html`](./" +
        entry.id +
        ".html) |",
    );
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  await mkdir(SNAPSHOT_DIR, { recursive: true });

  const entries = [];
  const failures = [];

  for (const entry of EMAIL_TEMPLATES) {
    try {
      const rendered = await renderTemplate(entry.id, SNAPSHOT_CONFIG);
      const snapshot = buildSnapshotPage(rendered);
      const filePath = resolve(SNAPSHOT_DIR, entry.id + ".html");
      await writeFile(filePath, snapshot, "utf8");
      entries.push({
        id: entry.id,
        name: entry.name,
        recipient: entry.recipient,
        trigger: entry.trigger,
      });
      console.log("  ok   " + entry.id);
    } catch (error) {
      failures.push({
        id: entry.id,
        error: error && error.message ? error.message : String(error),
      });
      console.error("  FAIL " + entry.id + ": " + (error && error.message ? error.message : error));
    }
  }

  const indexPath = resolve(SNAPSHOT_DIR, "README.md");
  await writeFile(indexPath, buildIndexMarkdown(entries), "utf8");

  console.log("");
  console.log(
    "Wrote " +
      entries.length +
      " snapshot" +
      (entries.length === 1 ? "" : "s") +
      " to docs/email-snapshots/",
  );
  if (failures.length) {
    console.error(failures.length + " template(s) failed to render. See above for details.");
    process.exitCode = 1;
  }
}

main().catch(function (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
