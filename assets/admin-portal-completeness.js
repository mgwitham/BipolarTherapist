import {
  fetchPortalCompletenessSummary,
  previewPortalCompletenessNudge,
  sendPortalCompletenessNudges,
} from "./review-api.js";
import { escapeHtml } from "./escape-html.js";

const COMPLETENESS_FIELD_LABELS = {
  card_bio: "Card bio",
  contact: "Contact route",
  headshot: "Headshot",
  name: "Name",
  location: "Location",
  years: "Bipolar years",
  full_bio: "Full bio",
  practice_name: "Practice name",
  website: "Website",
  languages: "Languages",
  fee: "Fees",
  modalities: "Modalities",
  format: "Session format",
  insurance: "Insurance",
  wait_time: "Wait time",
  first_step: "First step",
  specialties: "Specialties",
  populations: "Populations",
  total_years: "Years exp.",
};

const REQUIRED_FIELDS = ["card_bio", "contact"];

// Per-session nudge tracking so the button reflects "Sent" without a page reload.
let _portalNudgeSent = {};

// Preview-before-send modal. Fetches the rendered email for `previewSlug`
// and shows it in an iframe sandbox so the email's inline styles can't
// leak into admin chrome. Confirm sends to every slug in `slugs` (single
// or batch). Resolves the `onSuccess` callback after a successful send.
function openNudgePreview(options) {
  const slugs = Array.isArray(options.slugs) ? options.slugs : [];
  const previewSlug = options.previewSlug || slugs[0];
  if (!previewSlug || slugs.length === 0) return;

  // Drop any pre-existing modal in case the admin double-clicks.
  document.querySelectorAll(".pc-preview-overlay").forEach((el) => el.remove());

  const overlay = document.createElement("div");
  overlay.className = "pc-preview-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Preview completeness nudge email");
  overlay.innerHTML =
    '<div class="pc-preview-modal">' +
    '<header class="pc-preview-head">' +
    '<h3 class="pc-preview-title">Preview nudge email</h3>' +
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
  previewPortalCompletenessNudge(previewSlug)
    .then(function (result) {
      const p = (result && result.preview) || {};
      const isBatch = slugs.length > 1;
      const subjectLine = p.subject || "—";
      const recipientLine = isBatch
        ? `<strong>Sending to ${slugs.length} therapists.</strong> Preview shown is for <em>${escapeHtml(p.name || previewSlug)}</em>. Each recipient gets their own personalized score and missing-fields list.`
        : `To: <strong>${escapeHtml(p.to_email || "—")}</strong>`;
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
      const result = await sendPortalCompletenessNudges(slugs);
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
          // Log the per-row breakdown so admin can find which slugs failed.
          console.warn("[nudge] partial send result", result.results);
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
          console.warn("[nudge] no sends succeeded", result.results);
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

export async function renderPortalCompletenessPanel() {
  const root = document.getElementById("portalCompleteness");
  if (!root) return;
  root.innerHTML = '<p class="subtle">Loading&hellip;</p>';

  let rows;
  try {
    const result = await fetchPortalCompletenessSummary();
    rows = Array.isArray(result) ? result : result.therapists || result.data || [];
  } catch (err) {
    root.innerHTML =
      '<p class="subtle" style="color:#c2410c">Failed to load: ' + err.message + "</p>";
    return;
  }
  if (!rows.length) {
    root.innerHTML = '<p class="pc-empty">No claimed therapists yet.</p>';
    return;
  }

  let activeFilter = "all";

  function filteredRows() {
    if (activeFilter === "all") return rows;
    if (activeFilter === "incomplete")
      return rows.filter((r) => (r.portalCompletenessScore || 0) < 100);
    if (activeFilter === "no-contact")
      return rows.filter((r) => (r.portalCompletionFields || []).includes("contact"));
    if (activeFilter === "no-bio")
      return rows.filter((r) => (r.portalCompletionFields || []).includes("card_bio"));
    return rows;
  }

  function scoreClass(score) {
    if (score >= 80) return "pc-score-bar-green";
    if (score >= 50) return "pc-score-bar-yellow";
    return "pc-score-bar-amber";
  }

  // Bind filter-pill click handlers. Called from both the populated and
  // the empty-state branches of renderTable so a filter that drops the
  // count to zero doesn't strand the pills without click handlers
  // (which was the "freeze" symptom — pills repainted but unresponsive).
  function bindFilterHandlers() {
    root.querySelectorAll("[data-pc-filter]").forEach((btn) => {
      btn.addEventListener("click", function () {
        activeFilter = btn.getAttribute("data-pc-filter");
        renderTable();
      });
    });
  }

  function renderTable() {
    const visible = filteredRows();
    const batchSlugs = visible
      .filter((r) => r.hasEmail && !_portalNudgeSent[r.slug?.current || r.slug])
      .map((r) => r.slug?.current || r.slug);

    let html = '<div class="pc-filter-pills" style="margin-bottom:1rem">';
    const filters = [
      { key: "all", label: "All (" + rows.length + ")" },
      { key: "incomplete", label: "Incomplete" },
      { key: "no-contact", label: "No contact" },
      { key: "no-bio", label: "No bio" },
    ];
    filters.forEach((f) => {
      html +=
        '<button type="button" class="pc-filter-pill' +
        (activeFilter === f.key ? " is-active" : "") +
        '" data-pc-filter="' +
        f.key +
        '">' +
        f.label +
        "</button>";
    });
    html += "</div>";

    if (!visible.length) {
      html += '<p class="pc-empty">No therapists match this filter.</p>';
      root.innerHTML = html;
      bindFilterHandlers();
      return;
    }

    // Aggregate counter strip — tells the admin at a glance how many
    // nudges have ever shipped + how many today. Driven entirely off
    // the per-row counters, so no extra fetch.
    const totalNudges = rows.reduce((sum, r) => sum + (r.portalNudgeSentCount || 0), 0);
    const todayIso = new Date().toISOString().slice(0, 10);
    const sentToday = rows.filter(
      (r) => r.portalNudgeLastSentAt && r.portalNudgeLastSentAt.slice(0, 10) === todayIso,
    ).length;
    html +=
      '<div class="pc-nudge-summary"><strong>' +
      totalNudges +
      "</strong> nudge" +
      (totalNudges === 1 ? "" : "s") +
      " sent all-time · <strong>" +
      sentToday +
      "</strong> today</div>";

    html +=
      '<table class="pc-table"><thead><tr><th>Therapist</th><th>Score</th><th>Missing</th><th>Last nudge</th><th></th></tr></thead><tbody>';

    visible.forEach((t) => {
      const slug = t.slug?.current || t.slug || "";
      const score = t.portalCompletenessScore || 0;
      const missing = Array.isArray(t.portalCompletionFields) ? t.portalCompletionFields : [];
      const alreadySent = _portalNudgeSent[slug];
      const canNudge = t.hasEmail && !alreadySent;

      const requiredMissing = missing.filter((k) => REQUIRED_FIELDS.includes(k));
      const optionalMissing = missing.filter((k) => !REQUIRED_FIELDS.includes(k));
      const chips = [
        ...requiredMissing.map(
          (k) => '<span class="pc-chip">' + (COMPLETENESS_FIELD_LABELS[k] || k) + "</span>",
        ),
        ...optionalMissing.map(
          (k) =>
            '<span class="pc-chip pc-chip-optional">' +
            (COMPLETENESS_FIELD_LABELS[k] || k) +
            "</span>",
        ),
      ].join("");

      html += "<tr>";
      html += "<td><strong>" + (t.name || slug) + "</strong>";
      if (t.city)
        html +=
          '<br><span class="subtle" style="font-size:0.8rem">' +
          t.city +
          (t.state ? ", " + t.state : "") +
          "</span>";
      html += "</td>";
      html +=
        '<td><div class="pc-score-bar-wrap"><div class="pc-score-bar ' +
        scoreClass(score) +
        '" style="width:' +
        score +
        '%"></div></div><span style="font-size:0.8rem;color:#4a6875">' +
        score +
        "/100</span></td>";
      html +=
        '<td style="max-width:320px">' +
        (chips || '<span class="subtle">Complete</span>') +
        "</td>";

      // Last-nudge cell: per-therapist count + relative time. Yellow soft
      // warning when nudged in the last 14 days so admin notices before
      // re-nudging. Never-nudged shows a dash so the column doesn't read
      // as "0 times" which can imply data quality concern.
      const nudgeCount = Number(t.portalNudgeSentCount || 0);
      const lastAt = t.portalNudgeLastSentAt;
      let lastNudgeHtml = '<span class="subtle">—</span>';
      let recentClass = "";
      if (lastAt) {
        const daysAgo = Math.max(
          0,
          Math.floor((Date.now() - new Date(lastAt).getTime()) / (24 * 60 * 60 * 1000)),
        );
        const ago = daysAgo === 0 ? "today" : daysAgo === 1 ? "1d ago" : daysAgo + "d ago";
        if (daysAgo < 14) recentClass = " is-recent";
        lastNudgeHtml =
          '<span class="pc-nudge-cell' + recentClass + '">' + nudgeCount + "× · " + ago + "</span>";
      }
      html += '<td style="white-space:nowrap">' + lastNudgeHtml + "</td>";

      html +=
        '<td><button type="button" class="pc-nudge-btn' +
        (alreadySent ? " is-sent" : "") +
        '" data-pc-nudge="' +
        slug +
        '" ' +
        (!canNudge
          ? 'disabled title="' + (alreadySent ? "Nudge sent" : "No email on file") + '"'
          : "") +
        ">" +
        (alreadySent ? "Sent" : "Nudge") +
        "</button></td>";
      html += "</tr>";
    });

    html += "</tbody></table>";

    if (batchSlugs.length > 0) {
      html +=
        '<div class="pc-batch-bar" style="margin-top:1rem"><button type="button" class="pc-batch-btn" id="pcBatchSend" data-slugs="' +
        batchSlugs.join(",") +
        '">Send nudge to all ' +
        batchSlugs.length +
        " with email</button><span class='pc-status-msg' id='pcBatchStatus' style='display:none'></span></div>";
    }

    root.innerHTML = html;
    bindFilterHandlers();

    root.querySelectorAll("[data-pc-nudge]").forEach((btn) => {
      btn.addEventListener("click", function () {
        const slug = btn.getAttribute("data-pc-nudge");
        openNudgePreview({
          slugs: [slug],
          previewSlug: slug,
          onSuccess: function () {
            _portalNudgeSent[slug] = true;
            btn.classList.add("is-sent");
            btn.disabled = true;
            btn.textContent = "Sent";
          },
        });
      });
    });

    const batchBtn = document.getElementById("pcBatchSend");
    if (batchBtn) {
      batchBtn.addEventListener("click", function () {
        const slugs = batchBtn.getAttribute("data-slugs").split(",").filter(Boolean);
        openNudgePreview({
          slugs,
          previewSlug: slugs[0],
          onSuccess: function (result) {
            slugs.forEach((s) => {
              _portalNudgeSent[s] = true;
            });
            const sent = (result && result.sent) || slugs.length;
            const statusEl = document.getElementById("pcBatchStatus");
            if (statusEl) {
              statusEl.textContent = "Sent " + sent + " nudge" + (sent !== 1 ? "s" : "") + ".";
              statusEl.style.display = "";
            }
            renderTable();
          },
        });
      });
    }
  }

  renderTable();
}
