import {
  fetchPortalCompletenessSummary,
  previewPortalCompletenessNudge,
  sendPortalCompletenessNudges,
} from "./review-api.js";
import { openEmailCampaignPreview } from "./admin-email-campaign-preview.js";
import {
  PORTAL_COMPLETENESS_SHORT_LABELS as COMPLETENESS_FIELD_LABELS,
  PORTAL_COMPLETENESS_REQUIRED_FIELDS as REQUIRED_FIELDS,
} from "../shared/portal-completeness-registry.mjs";

// Per-session nudge tracking so the button reflects "Sent" without a page reload.
let _portalNudgeSent = {};

// Preview-before-send for the completeness nudge. Thin wrapper over the
// shared campaign modal with this campaign's copy + API functions.
function openNudgePreview(options) {
  openEmailCampaignPreview({
    slugs: options.slugs,
    previewSlug: options.previewSlug,
    title: "Preview nudge email",
    logLabel: "[nudge]",
    batchNote: (n) =>
      `<strong>Sending to ${n} therapists.</strong> Each recipient gets their own personalized score and missing-fields list.`,
    fetchPreview: previewPortalCompletenessNudge,
    sendBatch: sendPortalCompletenessNudges,
    onSuccess: options.onSuccess,
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
  // (which was the "freeze" symptom, pills repainted but unresponsive).
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

    // Aggregate counter strip, tells the admin at a glance how many
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
      let lastNudgeHtml = '<span class="subtle">, </span>';
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
