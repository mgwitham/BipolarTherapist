import { approveSourcedPhoto, fetchPhotoReviewQueue, rejectSourcedPhoto } from "./review-api.js";
import { escapeHtml } from "./escape-html.js";

// Admin panel: sourced headshots awaiting review before they publish.
// Each row shows the candidate photo next to the source URL so the
// reviewer can confirm it's the right person, then Approve (publishes +
// notifies the therapist with an opt-out) or Reject (discards + blocks
// re-sourcing). Self-contained: fetches its own data, like the photo
// campaign panel, rather than reading the admin store.
//
// mountPhotoReviewQueuePanel is idempotent — the render-all pass calls it
// on every portal-view render, so it guards against concurrent fetches
// and only refetches when asked (initial load, or after an action).

let _loadState = "idle"; // idle | loading | loaded | error
let _rows = null;

function relativeDay(iso) {
  if (!iso) return "";
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  return days + "d ago";
}

export function renderPhotoReviewQueuePanel(options) {
  const opts = options || {};
  const root = document.getElementById("photoReviewQueue");
  const countEl = document.getElementById("photoReviewCount");
  if (!root) return;

  if (opts.authRequired) {
    root.innerHTML = "";
    if (countEl) countEl.textContent = "";
    _loadState = "idle";
    _rows = null;
    return;
  }

  function paint() {
    if (_loadState === "loading" && !_rows) {
      root.innerHTML = '<p class="subtle">Loading sourced photos…</p>';
      return;
    }
    if (_loadState === "error") {
      root.innerHTML =
        '<p class="subtle" style="color:#c2410c">Failed to load the photo review queue. <button type="button" class="linklike" id="photoReviewRetry">Retry</button></p>';
      const retry = document.getElementById("photoReviewRetry");
      if (retry) retry.addEventListener("click", () => load(true));
      return;
    }
    const rows = _rows || [];
    if (countEl) {
      countEl.textContent = rows.length ? rows.length + " awaiting review" : "";
    }
    if (!rows.length) {
      root.innerHTML =
        '<div class="empty">No sourced photos awaiting review. Run <code>scripts/source-therapist-photos.mjs --apply</code> to queue candidates from unclaimed listings’ websites.</div>';
      return;
    }

    let html = '<div class="pr-grid">';
    rows.forEach((r) => {
      const slug = escapeHtml(r.slug || "");
      const loc = [r.city, r.state].filter(Boolean).map(escapeHtml).join(", ");
      html +=
        '<div class="pr-card" data-pr-card="' +
        slug +
        '">' +
        '<div class="pr-photo">' +
        (r.candidateUrl
          ? '<img src="' +
            escapeHtml(r.candidateUrl) +
            '" alt="Sourced headshot for ' +
            escapeHtml(r.name || r.slug || "listing") +
            '" loading="lazy" />'
          : '<div class="pr-photo-missing">no image</div>') +
        "</div>" +
        '<div class="pr-meta">' +
        '<div class="pr-name">' +
        escapeHtml(r.name || r.slug || "Unknown") +
        (r.claimStatus && r.claimStatus !== "unclaimed"
          ? ' <span class="pr-tag">' +
            escapeHtml(String(r.claimStatus).replace(/_/g, " ")) +
            "</span>"
          : "") +
        "</div>" +
        (loc ? '<div class="pr-loc">' + loc + "</div>" : "") +
        '<div class="pr-source">Sourced ' +
        escapeHtml(relativeDay(r.photoCandidateSourcedAt)) +
        (r.photoCandidateSourceUrl
          ? ' from <a href="' +
            escapeHtml(r.photoCandidateSourceUrl) +
            '" target="_blank" rel="noopener noreferrer">' +
            escapeHtml(r.photoCandidateSourceHost || "source") +
            "</a>"
          : "") +
        "</div>" +
        '<div class="pr-actions">' +
        '<button type="button" class="pr-approve" data-pr-approve="' +
        slug +
        '">Approve &amp; publish</button>' +
        '<button type="button" class="pr-reject" data-pr-reject="' +
        slug +
        '">Reject</button>' +
        '<span class="pr-status" data-pr-status="' +
        slug +
        '"></span>' +
        "</div>" +
        "</div>" +
        "</div>";
    });
    html += "</div>";
    root.innerHTML = html;
    wireActions();
  }

  function setRowBusy(slug, busy, message) {
    const card = root.querySelector('[data-pr-card="' + cssEscape(slug) + '"]');
    if (!card) return;
    card.querySelectorAll("button").forEach((b) => {
      b.disabled = busy;
    });
    const status = card.querySelector('[data-pr-status="' + cssEscape(slug) + '"]');
    if (status) status.textContent = message || "";
  }

  function removeRow(slug) {
    _rows = (_rows || []).filter((r) => r.slug !== slug);
    paint();
    if (typeof opts.onChange === "function") opts.onChange();
  }

  function wireActions() {
    root.querySelectorAll("[data-pr-approve]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const slug = btn.getAttribute("data-pr-approve");
        setRowBusy(slug, true, "Publishing…");
        try {
          const res = await approveSourcedPhoto(slug);
          if (res && res.published) {
            removeRow(slug);
          } else {
            setRowBusy(slug, false, "Couldn't publish");
          }
        } catch (err) {
          setRowBusy(slug, false, (err && err.message) || "Failed");
        }
      });
    });
    root.querySelectorAll("[data-pr-reject]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const slug = btn.getAttribute("data-pr-reject");
        setRowBusy(slug, true, "Rejecting…");
        try {
          const res = await rejectSourcedPhoto(slug);
          if (res && res.rejected) {
            removeRow(slug);
          } else {
            setRowBusy(slug, false, "Couldn't reject");
          }
        } catch (err) {
          setRowBusy(slug, false, (err && err.message) || "Failed");
        }
      });
    });
  }

  async function load(force) {
    if (_loadState === "loading") return;
    if (_loadState === "loaded" && !force) {
      paint();
      return;
    }
    _loadState = "loading";
    paint();
    try {
      const result = await fetchPhotoReviewQueue();
      _rows = (result && result.therapists) || [];
      _loadState = "loaded";
    } catch {
      _loadState = "error";
    }
    paint();
  }

  load(opts.forceReload === true);
}

// Escape for the [data-pr-*="..."] attribute selectors. Therapist slugs
// are [a-z0-9-], so this only needs to neutralize the odd stray quote or
// backslash rather than pull in the full CSS.escape surface.
function cssEscape(value) {
  return String(value).replace(/["\\\]]/g, "\\$&");
}
