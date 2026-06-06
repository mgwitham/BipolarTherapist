import { escapeHtml } from "./escape-html.js";

// Shared preview-before-send modal for admin email campaigns (profile
// completeness nudge, "add your photo" request, and any future batch
// send). Fetches the rendered email for `previewSlug`, shows it in a
// sandboxed iframe so the email's inline styles can't leak into admin
// chrome, then sends to every slug in `slugs` (single or batch) on
// confirm. Resolves `onSuccess` after a send that reached at least one
// recipient.
//
// Options:
//   slugs        string[]  recipients to send to
//   previewSlug  string    which slug to render in the preview (defaults to slugs[0])
//   title        string    modal header + aria-label
//   batchNote    fn(n)     batch recipient line, given the recipient count
//   fetchPreview fn(slug)  -> Promise<{ preview: { subject, to_email, name, html } }>
//   sendBatch    fn(slugs) -> Promise<{ sent, failed, skipped, results }>
//   onSuccess    fn(result) called after any send that reached ≥1 recipient
//   logLabel     string    console.warn prefix for partial/empty sends
export function openEmailCampaignPreview(options) {
  const slugs = Array.isArray(options.slugs) ? options.slugs : [];
  const previewSlug = options.previewSlug || slugs[0];
  if (!previewSlug || slugs.length === 0) return;
  const title = options.title || "Preview email";
  const logLabel = options.logLabel || "[campaign]";
  const batchNote =
    typeof options.batchNote === "function"
      ? options.batchNote
      : (n) => `<strong>Sending to ${n} therapists.</strong>`;

  // Drop any pre-existing modal in case the admin double-clicks.
  document.querySelectorAll(".pc-preview-overlay").forEach((el) => el.remove());

  const overlay = document.createElement("div");
  overlay.className = "pc-preview-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", title);
  overlay.innerHTML =
    '<div class="pc-preview-modal">' +
    '<header class="pc-preview-head">' +
    '<h3 class="pc-preview-title">' +
    escapeHtml(title) +
    "</h3>" +
    '<button type="button" class="pc-preview-close" aria-label="Close">×</button>' +
    "</header>" +
    '<div class="pc-preview-body" id="pcPreviewBody">' +
    '<p class="pc-preview-loading">Loading preview…</p>' +
    "</div>" +
    '<footer class="pc-preview-foot">' +
    '<button type="button" class="pc-preview-cancel">Cancel</button>' +
    '<button type="button" class="pc-preview-send" disabled>Send</button>' +
    '<span class="pc-preview-status"></span>' +
    "</footer>" +
    "</div>";
  document.body.appendChild(overlay);

  const closeBtn = overlay.querySelector(".pc-preview-close");
  const cancelBtn = overlay.querySelector(".pc-preview-cancel");
  const sendBtn = overlay.querySelector(".pc-preview-send");
  const statusEl = overlay.querySelector(".pc-preview-status");
  const bodyEl = overlay.querySelector("#pcPreviewBody");

  function close() {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  }
  function onKey(e) {
    if (e.key === "Escape") close();
  }
  document.addEventListener("keydown", onKey);
  closeBtn.addEventListener("click", close);
  cancelBtn.addEventListener("click", close);
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) close();
  });

  // Fetch the preview, render header summary + iframe with the email body.
  options
    .fetchPreview(previewSlug)
    .then(function (result) {
      const p = (result && result.preview) || {};
      const isBatch = slugs.length > 1;
      const subjectLine = p.subject || "";
      const recipientLine = isBatch
        ? batchNote(slugs.length) +
          ` Preview shown is for <em>${escapeHtml(p.name || previewSlug)}</em>.`
        : `To: <strong>${escapeHtml(p.to_email || "")}</strong>`;
      bodyEl.innerHTML =
        '<div class="pc-preview-meta">' +
        '<div><span class="pc-preview-label">Subject</span><div class="pc-preview-subject">' +
        escapeHtml(subjectLine) +
        "</div></div>" +
        '<div class="pc-preview-recipient">' +
        recipientLine +
        "</div>" +
        "</div>" +
        '<iframe class="pc-preview-frame" sandbox title="Email body preview"></iframe>';
      const frame = bodyEl.querySelector(".pc-preview-frame");
      // Inject the HTML via srcdoc so the iframe is a fresh document and
      // the email's inline styles never reach admin chrome.
      frame.srcdoc = p.html || "<p>(no body)</p>";
      sendBtn.disabled = false;
      sendBtn.textContent = isBatch ? "Send to " + slugs.length : "Send";
    })
    .catch(function (err) {
      bodyEl.innerHTML =
        '<p class="pc-preview-error">Preview failed: ' +
        escapeHtml((err && err.message) || "unknown") +
        "</p>";
    });

  sendBtn.addEventListener("click", async function () {
    sendBtn.disabled = true;
    cancelBtn.disabled = true;
    sendBtn.textContent = "Sending…";
    statusEl.textContent = "";
    statusEl.className = "pc-preview-status";
    try {
      const result = await options.sendBatch(slugs);
      const sent = Number((result && result.sent) || 0);
      const failed = Number((result && result.failed) || 0);
      const skipped = Number((result && result.skipped) || 0);
      // Three cases: full success, partial success, or zero sends. Surface
      // each distinctly so a quiet partial failure doesn't read like a win.
      if (failed === 0 && skipped === 0) {
        statusEl.textContent = "Sent.";
        if (typeof options.onSuccess === "function") options.onSuccess(result);
        window.setTimeout(close, 600);
      } else if (sent > 0) {
        const issues = [
          failed > 0 ? `${failed} failed` : "",
          skipped > 0 ? `${skipped} skipped (no email)` : "",
        ]
          .filter(Boolean)
          .join(", ");
        statusEl.textContent = `Sent ${sent}, ${issues}. See console for details.`;
        statusEl.className = "pc-preview-status is-partial";
        if (typeof options.onSuccess === "function") options.onSuccess(result);
        // Leave the modal open so admin can act on the failures. Re-enable
        // cancel so they can dismiss; keep send disabled to prevent a
        // double-send loop on the same slugs.
        cancelBtn.disabled = false;
        cancelBtn.textContent = "Close";
        if (result && Array.isArray(result.results)) {
          console.warn(logLabel + " partial send result", result.results);
        }
      } else {
        const issues = [
          failed > 0 ? `${failed} failed` : "",
          skipped > 0 ? `${skipped} skipped (no email)` : "",
        ]
          .filter(Boolean)
          .join(", ");
        statusEl.textContent = `Nothing sent: ${issues || "no eligible recipients"}.`;
        statusEl.className = "pc-preview-status is-failure";
        sendBtn.disabled = false;
        cancelBtn.disabled = false;
        sendBtn.textContent = slugs.length > 1 ? "Send to " + slugs.length : "Send";
        if (result && Array.isArray(result.results)) {
          console.warn(logLabel + " no sends succeeded", result.results);
        }
      }
    } catch (err) {
      sendBtn.disabled = false;
      cancelBtn.disabled = false;
      sendBtn.textContent = slugs.length > 1 ? "Send to " + slugs.length : "Send";
      statusEl.textContent = "Failed: " + ((err && err.message) || "unknown");
      statusEl.className = "pc-preview-status is-failure";
    }
  });
}
