import {
  fetchPhotoMissingSummary,
  previewTherapistPhotoRequest,
  sendTherapistPhotoRequests,
} from "./review-api.js";
import { openEmailCampaignPreview } from "./admin-email-campaign-preview.js";
import { escapeHtml } from "./escape-html.js";

// Per-session send tracking so a button reads "Sent" without a reload.
const _photoRequestSent = {};

// Preview-before-send for the "add your photo" campaign. Thin wrapper over
// the shared campaign modal with this campaign's copy + API functions.
function openPhotoRequestPreview(options) {
  openEmailCampaignPreview({
    slugs: options.slugs,
    previewSlug: options.previewSlug,
    title: "Preview photo-request email",
    logLabel: "[photo-request]",
    batchNote: (n) =>
      `<strong>Sending to ${n} therapists.</strong> Each gets the same one-ask photo email.`,
    fetchPreview: previewTherapistPhotoRequest,
    sendBatch: sendTherapistPhotoRequests,
    onSuccess: options.onSuccess,
  });
}

// Admin panel: claimed therapists with a live listing but no headshot —
// the target list for the consent-based "add your photo" campaign. Mirrors
// the completeness tracker but simpler (photo is binary, no score). Reuses
// the .pc-* styles from the completeness panel.
export async function renderPhotoCampaignPanel() {
  const root = document.getElementById("photoCampaign");
  if (!root) return;
  root.innerHTML = '<p class="subtle">Loading&hellip;</p>';

  let rows;
  try {
    const result = await fetchPhotoMissingSummary();
    rows = Array.isArray(result) ? result : result.therapists || result.data || [];
  } catch (err) {
    root.innerHTML =
      '<p class="subtle" style="color:#c2410c">Failed to load: ' + escapeHtml(err.message) + "</p>";
    return;
  }
  if (!rows.length) {
    root.innerHTML = '<p class="pc-empty">Every claimed, live listing has a photo. 🎉</p>';
    return;
  }

  function slugOf(r) {
    return (r.slug && r.slug.current) || r.slug || "";
  }

  function renderTable() {
    const batchSlugs = rows.filter((r) => r.hasEmail && !_photoRequestSent[slugOf(r)]).map(slugOf);

    // Aggregate strip: how many photo requests have shipped all-time and
    // today, computed off the per-row counters (no extra fetch).
    const totalSent = rows.reduce((sum, r) => sum + (r.photoRequestSentCount || 0), 0);
    const todayIso = new Date().toISOString().slice(0, 10);
    const sentToday = rows.filter(
      (r) => r.photoRequestLastSentAt && r.photoRequestLastSentAt.slice(0, 10) === todayIso,
    ).length;

    let html =
      '<div class="pc-nudge-summary"><strong>' +
      rows.length +
      "</strong> claimed listing" +
      (rows.length === 1 ? "" : "s") +
      " without a photo · <strong>" +
      totalSent +
      "</strong> request" +
      (totalSent === 1 ? "" : "s") +
      " sent all-time · <strong>" +
      sentToday +
      "</strong> today</div>";

    html +=
      '<table class="pc-table"><thead><tr><th>Therapist</th><th>Email</th><th>Last request</th><th></th></tr></thead><tbody>';

    rows.forEach((t) => {
      const slug = slugOf(t);
      const alreadySent = _photoRequestSent[slug];
      const canSend = t.hasEmail && !alreadySent;

      html += "<tr>";
      html += "<td><strong>" + escapeHtml(t.name || slug) + "</strong>";
      if (t.city)
        html +=
          '<br><span class="subtle" style="font-size:0.8rem">' +
          escapeHtml(t.city) +
          (t.state ? ", " + escapeHtml(t.state) : "") +
          "</span>";
      html += "</td>";

      html +=
        '<td style="max-width:220px;font-size:0.82rem;color:#4a6875">' +
        (t.hasEmail ? escapeHtml(t.email || "") : '<span class="subtle">No email on file</span>') +
        "</td>";

      // Last-request cell: count + relative time, with a soft "recent"
      // warning when sent in the last 14 days. Never-sent shows a dash so
      // the column doesn't read as "0 times".
      const count = Number(t.photoRequestSentCount || 0);
      const lastAt = t.photoRequestLastSentAt;
      let lastHtml = '<span class="subtle">—</span>';
      if (lastAt) {
        const daysAgo = Math.max(
          0,
          Math.floor((Date.now() - new Date(lastAt).getTime()) / (24 * 60 * 60 * 1000)),
        );
        const ago = daysAgo === 0 ? "today" : daysAgo === 1 ? "1d ago" : daysAgo + "d ago";
        const recentClass = daysAgo < 14 ? " is-recent" : "";
        lastHtml =
          '<span class="pc-nudge-cell' + recentClass + '">' + count + "× · " + ago + "</span>";
      }
      html += '<td style="white-space:nowrap">' + lastHtml + "</td>";

      html +=
        '<td><button type="button" class="pc-nudge-btn' +
        (alreadySent ? " is-sent" : "") +
        '" data-photo-req="' +
        escapeHtml(slug) +
        '" ' +
        (!canSend
          ? 'disabled title="' + (alreadySent ? "Request sent" : "No email on file") + '"'
          : "") +
        ">" +
        (alreadySent ? "Sent" : "Request") +
        "</button></td>";
      html += "</tr>";
    });

    html += "</tbody></table>";

    if (batchSlugs.length > 0) {
      html +=
        '<div class="pc-batch-bar" style="margin-top:1rem"><button type="button" class="pc-batch-btn" id="photoBatchSend" data-slugs="' +
        escapeHtml(batchSlugs.join(",")) +
        '">Send photo request to all ' +
        batchSlugs.length +
        " with email</button><span class='pc-status-msg' id='photoBatchStatus' style='display:none'></span></div>";
    }

    root.innerHTML = html;

    root.querySelectorAll("[data-photo-req]").forEach((btn) => {
      btn.addEventListener("click", function () {
        const slug = btn.getAttribute("data-photo-req");
        openPhotoRequestPreview({
          slugs: [slug],
          previewSlug: slug,
          onSuccess: function () {
            _photoRequestSent[slug] = true;
            btn.classList.add("is-sent");
            btn.disabled = true;
            btn.textContent = "Sent";
          },
        });
      });
    });

    const batchBtn = document.getElementById("photoBatchSend");
    if (batchBtn) {
      batchBtn.addEventListener("click", function () {
        const slugs = batchBtn.getAttribute("data-slugs").split(",").filter(Boolean);
        openPhotoRequestPreview({
          slugs,
          previewSlug: slugs[0],
          onSuccess: function (result) {
            slugs.forEach((s) => {
              _photoRequestSent[s] = true;
            });
            const sent = (result && result.sent) || slugs.length;
            const statusEl = document.getElementById("photoBatchStatus");
            if (statusEl) {
              statusEl.textContent = "Sent " + sent + " request" + (sent !== 1 ? "s" : "") + ".";
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
