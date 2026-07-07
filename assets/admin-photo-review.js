import {
  adminUploadTherapistPhoto,
  approveSourcedPhoto,
  fetchPhotoReviewQueue,
  fetchPhotoUploadTargets,
  rejectSourcedPhoto,
} from "./review-api.js";
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
        '<button type="button" class="pr-notify" data-pr-notify="' +
        slug +
        '" title="Publish and email the therapist a notice with a one-click opt-out">Approve + notify</button>' +
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

  async function doApprove(slug, notify) {
    setRowBusy(slug, true, notify ? "Publishing + notifying…" : "Publishing…");
    try {
      const res = await approveSourcedPhoto(slug, notify);
      if (res && res.published) {
        removeRow(slug);
      } else {
        setRowBusy(slug, false, "Couldn't publish");
      }
    } catch (err) {
      setRowBusy(slug, false, (err && err.message) || "Failed");
    }
  }

  function wireActions() {
    root.querySelectorAll("[data-pr-approve]").forEach((btn) => {
      btn.addEventListener("click", () => doApprove(btn.getAttribute("data-pr-approve"), false));
    });
    root.querySelectorAll("[data-pr-notify]").forEach((btn) => {
      btn.addEventListener("click", () => doApprove(btn.getAttribute("data-pr-notify"), true));
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

// ── Manual headshot upload ─────────────────────────────────────────────
// Operator workflow for listings the sourcer can't reach (aggregator-only
// websites): find a photo yourself, screenshot it, paste it here (or pick
// a file), and publish it onto the listing. Same state shape as an
// approved sourced photo, so opt-out/suppression/portal-consent all apply.

const UPLOAD_ALLOWED_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.readAsDataURL(file);
  });
}

export function renderManualPhotoUpload(options) {
  const opts = options || {};
  const root = document.getElementById("photoManualUpload");
  if (!root) return;
  if (opts.authRequired) {
    root.innerHTML = "";
    return;
  }
  // Idempotent: the render-all pass re-invokes on every portal render;
  // don't wipe in-progress form state.
  if (root.dataset.pruMounted === "true") return;
  root.dataset.pruMounted = "true";

  root.innerHTML =
    '<div class="pru-form">' +
    '<div class="pru-row">' +
    '<label class="pru-label" for="pruTherapist">Therapist</label>' +
    '<input type="text" id="pruTherapist" class="pru-input" list="pruTargets" ' +
    'placeholder="Start typing a name…" autocomplete="off" />' +
    '<datalist id="pruTargets"></datalist>' +
    "</div>" +
    '<div class="pru-row">' +
    '<label class="pru-label" for="pruSourceUrl">Source URL <span class="subtle">(optional, where the photo came from)</span></label>' +
    '<input type="url" id="pruSourceUrl" class="pru-input" placeholder="https://…" />' +
    "</div>" +
    '<div class="pru-drop" id="pruDrop" tabindex="0">' +
    '<img id="pruPreview" alt="Preview of the headshot to publish" hidden />' +
    '<span id="pruDropHint">Paste a screenshot here (Cmd+V) or ' +
    '<button type="button" class="linklike" id="pruPick">choose a file</button></span>' +
    '<input type="file" id="pruFile" accept="image/jpeg,image/png,image/webp" hidden />' +
    "</div>" +
    '<div class="pru-actions">' +
    '<label class="pru-notify"><input type="checkbox" id="pruNotify" /> Email the therapist a notice with a one-click opt-out</label>' +
    '<button type="button" class="pr-approve" id="pruPublish" disabled>Publish photo</button>' +
    "</div>" +
    '<div class="pr-status" id="pruStatus" role="status" aria-live="polite"></div>' +
    "</div>";

  const therapistInput = document.getElementById("pruTherapist");
  const targetsList = document.getElementById("pruTargets");
  const sourceInput = document.getElementById("pruSourceUrl");
  const drop = document.getElementById("pruDrop");
  const preview = document.getElementById("pruPreview");
  const dropHint = document.getElementById("pruDropHint");
  const fileInput = document.getElementById("pruFile");
  const pickBtn = document.getElementById("pruPick");
  const notifyBox = document.getElementById("pruNotify");
  const publishBtn = document.getElementById("pruPublish");
  const status = document.getElementById("pruStatus");

  let targets = [];
  let staged = null; // { dataUrl, filename }

  function setStatus(message, tone) {
    status.textContent = message || "";
    status.classList.toggle("is-error", tone === "error");
    status.classList.toggle("is-success", tone === "success");
  }

  function selectedTarget() {
    const value = therapistInput.value.trim().toLowerCase();
    if (!value) return null;
    return (
      targets.find((t) => `${t.name} (${t.slug})`.toLowerCase() === value) ||
      targets.find((t) => t.slug === value) ||
      targets.find((t) => t.name.toLowerCase() === value) ||
      null
    );
  }

  function refreshPublishState() {
    publishBtn.disabled = !(staged && selectedTarget());
  }

  async function loadTargets() {
    try {
      const result = await fetchPhotoUploadTargets();
      targets = (result && result.therapists) || [];
      targetsList.innerHTML = targets
        .map(
          (t) =>
            '<option value="' +
            escapeHtml(`${t.name} (${t.slug})`) +
            '">' +
            escapeHtml([t.city, t.state].filter(Boolean).join(", ")) +
            "</option>",
        )
        .join("");
    } catch {
      setStatus("Couldn't load the therapist list — type a slug instead.", "error");
    }
  }

  async function stageFile(file) {
    if (!file) return;
    if (!UPLOAD_ALLOWED_MIMES.has(file.type)) {
      setStatus("Photo must be a JPG, PNG, or WebP.", "error");
      return;
    }
    if (file.size > UPLOAD_MAX_BYTES) {
      setStatus("Photo is over 4 MB. Crop the screenshot tighter.", "error");
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      staged = { dataUrl, filename: file.name || "screenshot" };
      preview.src = dataUrl;
      preview.hidden = false;
      dropHint.textContent = "Ready — paste or choose again to replace.";
      setStatus("", null);
      refreshPublishState();
    } catch (err) {
      setStatus(err.message, "error");
    }
  }

  drop.addEventListener("paste", (event) => {
    const items = (event.clipboardData && event.clipboardData.files) || [];
    if (items.length) {
      event.preventDefault();
      stageFile(items[0]);
    }
  });
  pickBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    stageFile(fileInput.files && fileInput.files[0]);
    fileInput.value = "";
  });
  therapistInput.addEventListener("input", refreshPublishState);

  publishBtn.addEventListener("click", async () => {
    const target = selectedTarget();
    if (!target || !staged) return;
    publishBtn.disabled = true;
    setStatus("Publishing…", null);
    try {
      const result = await adminUploadTherapistPhoto({
        slug: target.slug,
        dataUrl: staged.dataUrl,
        filename: staged.filename,
        sourceUrl: sourceInput.value.trim(),
        notify: notifyBox.checked,
      });
      if (result && result.published) {
        setStatus(
          "Published on " +
            target.name +
            "'s listing" +
            (result.noticeSent ? " — notice email sent." : "."),
          "success",
        );
        staged = null;
        preview.hidden = true;
        therapistInput.value = "";
        sourceInput.value = "";
        notifyBox.checked = false;
        dropHint.innerHTML =
          'Paste a screenshot here (Cmd+V) or <button type="button" class="linklike" id="pruPick2">choose a file</button>';
        const pick2 = document.getElementById("pruPick2");
        if (pick2) pick2.addEventListener("click", () => fileInput.click());
        loadTargets();
        refreshPublishState();
      } else {
        setStatus("Publish didn't complete — try again.", "error");
        refreshPublishState();
      }
    } catch (err) {
      setStatus((err && err.message) || "Publish failed.", "error");
      refreshPublishState();
    }
  });

  loadTargets();
}
