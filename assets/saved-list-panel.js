// Slide-over panel that surfaces the saved-therapist list on every page.
// Mounts once, lives in body, opens when the user clicks the nav badge.
// Reads through the shared saved-list module, so any save/remove from
// any surface re-renders the panel automatically.

import { fetchPublicTherapists } from "./cms.js";
import { escapeHtml } from "./escape-html.js";
import { sanityImageUrl } from "./sanity-image.js";
import {
  readList,
  removeFromList,
  updateNote,
  subscribe,
  NOTE_MAX_LENGTH,
  MAX_ENTRIES,
} from "./saved-list.js";
import { trackFunnelEvent } from "./funnel-analytics.js";
import { mountTurnstile } from "./turnstile-widget.js";

// Turnstile handle for the "email my list" form. Null until the form is
// opened; reset to null whenever the panel re-renders (which rebuilds the
// form DOM). No-op when Turnstile isn't configured.
let turnstileHandle = null;

function readBuildEnvValue(getValue) {
  try {
    return getValue() || "";
  } catch (_error) {
    return "";
  }
}

const reviewApiUrl = readBuildEnvValue(() => import.meta.env.VITE_REVIEW_API_URL);

function getReviewApiBase() {
  if (reviewApiUrl) return reviewApiUrl;
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") return "http://localhost:8787";
  }
  return "/api/review";
}

const EMAIL_THROTTLE_KEY = "bth_saved_list_email_last_v1";
const EMAIL_THROTTLE_MS = 5 * 60 * 1000;

function isLocallyThrottled() {
  try {
    const raw = window.localStorage.getItem(EMAIL_THROTTLE_KEY);
    if (!raw) return false;
    const last = Number(raw);
    if (!isFinite(last)) return false;
    return Date.now() - last < EMAIL_THROTTLE_MS;
  } catch (_error) {
    return false;
  }
}

function recordLocalSend() {
  try {
    window.localStorage.setItem(EMAIL_THROTTLE_KEY, String(Date.now()));
  } catch (_error) {
    // ignore
  }
}

const PANEL_STYLES = [
  ".saved-list-panel-locked { overflow: hidden; }",
  ".saved-list-panel-root { position: fixed; inset: 0; z-index: 1100; pointer-events: none; }",
  ".saved-list-panel-backdrop { position: absolute; inset: 0; background: rgba(15, 42, 49, 0.45); opacity: 0; transition: opacity 0.2s ease; pointer-events: auto; }",
  ".saved-list-panel-root.is-open .saved-list-panel-backdrop { opacity: 1; }",
  ".saved-list-panel { position: absolute; top: 0; right: 0; bottom: 0; width: min(440px, 100%); max-width: 100%; background: #fff; box-shadow: -16px 0 40px rgba(15, 42, 49, 0.18); display: flex; flex-direction: column; transform: translateX(100%); transition: transform 0.22s ease; pointer-events: auto; outline: none; }",
  ".saved-list-panel-root.is-open .saved-list-panel { transform: translateX(0); }",
  ".saved-list-panel-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem; padding: 1.25rem 1.25rem 0.75rem; border-bottom: 1px solid #e6eef0; }",
  ".saved-list-panel-title { margin: 0 0 0.2rem; font-size: 1.15rem; font-weight: 700; color: #0f2a31; }",
  ".saved-list-panel-sub { margin: 0; font-size: 0.85rem; color: #52707c; }",
  ".saved-list-panel-close { background: #fff; border: 1px solid rgba(14,77,95,0.18); border-radius: 999px; width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center; color: #0f2a31; cursor: pointer; flex-shrink: 0; transition: background 0.15s ease, border-color 0.15s ease; }",
  ".saved-list-panel-close:hover { background: rgba(26,122,143,0.08); border-color: rgba(14,77,95,0.35); }",
  ".saved-list-panel-close svg { width: 14px; height: 14px; stroke-width: 2.5; }",
  ".saved-list-panel-body { flex: 1; overflow-y: auto; padding: 1rem 1.25rem 1.5rem; }",
  ".saved-list-panel-cards { display: flex; flex-direction: column; gap: 0.75rem; }",
  ".saved-list-panel-empty { padding: 2.25rem 1rem; text-align: center; color: #52707c; }",
  ".saved-list-panel-empty-icon { width: 48px; height: 48px; margin: 0 auto 0.85rem; border-radius: 999px; background: #e6f4f6; display: inline-flex; align-items: center; justify-content: center; color: #1a7a8f; }",
  ".saved-list-panel-empty-icon svg { width: 24px; height: 24px; }",
  ".saved-list-panel-empty-title { margin: 0 0 0.35rem; font-size: 1rem; font-weight: 600; color: #0f2a31; }",
  ".saved-list-panel-empty-copy { margin: 0 0 1rem; font-size: 0.9rem; line-height: 1.45; }",
  ".saved-list-panel-loading { padding: 1.5rem 0; text-align: center; color: #52707c; font-size: 0.9rem; }",
  ".saved-list-card { display: flex; gap: 0.75rem; padding: 0.85rem; border: 1px solid #e6eef0; border-radius: 12px; background: #fff; }",
  ".saved-list-card-photo { flex-shrink: 0; width: 56px; height: 56px; border-radius: 999px; overflow: hidden; background: #e6f4f6; display: inline-flex; align-items: center; justify-content: center; color: #155f70; font-weight: 700; }",
  ".saved-list-card-photo img { width: 100%; height: 100%; object-fit: cover; display: block; }",
  ".saved-list-card-initials { font-size: 0.95rem; }",
  ".saved-list-card-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.4rem; }",
  ".saved-list-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; }",
  ".saved-list-card-name { margin: 0; font-size: 0.98rem; font-weight: 600; color: #0f2a31; line-height: 1.25; }",
  ".saved-list-card-meta { margin: 0.1rem 0 0; font-size: 0.8rem; color: #52707c; }",
  ".saved-list-card-remove { background: transparent; border: none; color: #7a9aa5; cursor: pointer; padding: 0.25rem; border-radius: 6px; transition: color 0.15s ease, background 0.15s ease; }",
  ".saved-list-card-remove:hover { color: #b14040; background: #fbecec; }",
  ".saved-list-card-remove svg { width: 14px; height: 14px; stroke-width: 2.5; }",
  ".saved-list-card-note-label { font-size: 0.75rem; font-weight: 600; color: #52707c; text-transform: uppercase; letter-spacing: 0.04em; }",
  ".saved-list-card-note { width: 100%; resize: vertical; min-height: 44px; padding: 0.5rem 0.6rem; border: 1px solid #d2dde0; border-radius: 8px; font-family: inherit; font-size: 0.85rem; color: #0f2a31; transition: border-color 0.15s ease; box-sizing: border-box; }",
  ".saved-list-card-note:focus { outline: none; border-color: #1a7a8f; }",
  ".saved-list-card-action { font-size: 0.85rem; font-weight: 600; color: #1a7a8f; text-decoration: none; padding-top: 0.1rem; }",
  ".saved-list-card-action:hover { text-decoration: underline; }",
  ".saved-list-panel-footer { margin-top: 1.1rem; display: flex; flex-direction: column; gap: 0.6rem; align-items: stretch; }",
  ".saved-list-panel-cta { display: inline-flex; align-items: center; justify-content: center; padding: 0.7rem 1rem; background: #1a7a8f; color: #fff; border-radius: 999px; font-weight: 600; text-decoration: none; font-size: 0.95rem; transition: background 0.15s ease; }",
  ".saved-list-panel-cta:hover { background: #155f70; }",
  ".saved-list-panel-link { display: inline-flex; align-items: center; justify-content: center; font-size: 0.85rem; color: #52707c; text-decoration: none; }",
  ".saved-list-panel-link:hover { color: #1a7a8f; text-decoration: underline; }",
  ".saved-list-panel-status { position: absolute; left: 1.25rem; bottom: 1rem; font-size: 0.8rem; color: #155f70; background: #e6f4f6; padding: 0.4rem 0.7rem; border-radius: 999px; opacity: 0; transform: translateY(0.3rem); transition: opacity 0.15s ease, transform 0.15s ease; pointer-events: none; }",
  ".saved-list-panel-status.is-visible { opacity: 1; transform: translateY(0); }",
  ".saved-list-panel-email { display: flex; flex-direction: column; gap: 0; border-radius: 12px; overflow: hidden; border: 1.5px solid #c3d8dd; background: #fff; box-shadow: 0 2px 8px rgba(26,122,143,0.07); }",
  ".saved-list-panel-email-toggle { display: flex; align-items: center; justify-content: center; gap: 0.5rem; width: 100%; padding: 0.7rem 1rem; background: #fff; border: none; cursor: pointer; font-size: 0.9rem; font-weight: 600; color: #1a7a8f; font-family: inherit; transition: background 0.15s ease, color 0.15s ease; }",
  ".saved-list-panel-email-toggle:hover { background: #f0f8fa; color: #155f70; }",
  ".saved-list-panel-email-toggle svg { flex-shrink: 0; }",
  ".saved-list-panel-email-expand { padding: 0.9rem; border-top: 1.5px solid #c3d8dd; background: linear-gradient(160deg, #f4fbfc 0%, #eaf5f7 100%); display: flex; flex-direction: column; gap: 0.65rem; }",
  ".saved-list-panel-email-label { font-size: 0.7rem; font-weight: 700; color: #52707c; text-transform: uppercase; letter-spacing: 0.07em; }",
  ".saved-list-panel-email-row { display: flex; gap: 0.5rem; }",
  ".saved-list-panel-email-row input { flex: 1; min-width: 0; padding: 0.6rem 0.85rem; border: 1.5px solid #c3d8dd; border-radius: 999px; font-size: 0.9rem; font-family: inherit; background: #fff; box-sizing: border-box; transition: border-color 0.15s ease; }",
  ".saved-list-panel-email-row input:focus { outline: none; border-color: #1a7a8f; }",
  ".saved-list-panel-email-row input::placeholder { color: #a0b5bb; }",
  ".saved-list-panel-cta-compact { padding: 0.6rem 1.1rem; font-size: 0.88rem; }",
  ".saved-list-panel-cta:disabled { background: #98a8af; cursor: progress; }",
  ".saved-list-panel-email-status { font-size: 0.8rem; color: #52707c; min-height: 1em; padding: 0 0.1rem; }",
  ".saved-list-panel-email-status-error { color: #b14040; }",
  ".saved-list-panel-email-status-success { color: #1a7a8f; font-weight: 600; }",
  "@media (max-width: 520px) { .saved-list-panel { width: 100%; box-shadow: none; } }",
].join("\n");

function injectStylesOnce() {
  if (typeof document === "undefined") return;
  if (document.getElementById("saved-list-panel-styles")) return;
  const style = document.createElement("style");
  style.id = "saved-list-panel-styles";
  style.textContent = PANEL_STYLES;
  document.head.appendChild(style);
}

let panelRoot = null;
let panelBody = null;
let panelStatus = null;
let lastFocusedElement = null;
let therapistCache = null;
let therapistCachePromise = null;
let hasOpenedOnce = false;

function getTherapistProfileHref(slug) {
  if (!slug) return "/directory";
  return "/therapists/" + encodeURIComponent(slug);
}

function getInitials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(function (w) {
      return !/^(dr|mr|mrs|ms|mx|prof)\.?$/i.test(w);
    })
    .slice(0, 2);
  return (
    parts
      .map(function (part) {
        return part.charAt(0).toUpperCase();
      })
      .join("") || "?"
  );
}

async function loadTherapistsByCache() {
  if (therapistCache) return therapistCache;
  if (therapistCachePromise) return therapistCachePromise;
  therapistCachePromise = fetchPublicTherapists()
    .then(function (list) {
      therapistCache = Array.isArray(list) ? list : [];
      return therapistCache;
    })
    .catch(function () {
      therapistCache = [];
      return therapistCache;
    })
    .finally(function () {
      therapistCachePromise = null;
    });
  return therapistCachePromise;
}

function buildPanelMarkup() {
  return (
    '<div class="saved-list-panel-backdrop" data-saved-list-close="backdrop" hidden></div>' +
    '<aside class="saved-list-panel" role="dialog" aria-modal="true" aria-labelledby="savedListPanelTitle" hidden tabindex="-1">' +
    '<header class="saved-list-panel-header">' +
    "<div>" +
    '<h2 id="savedListPanelTitle" class="saved-list-panel-title">My List</h2>' +
    '<p class="saved-list-panel-sub" data-saved-list-sub>Therapists you have saved to revisit.</p>' +
    "</div>" +
    '<button type="button" class="saved-list-panel-close" data-saved-list-close="button" aria-label="Close saved list">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
    "</button>" +
    "</header>" +
    '<div class="saved-list-panel-body" data-saved-list-body></div>' +
    '<div class="saved-list-panel-status" role="status" aria-live="polite" data-saved-list-status></div>' +
    "</aside>"
  );
}

function ensureMounted() {
  if (panelRoot) return;
  injectStylesOnce();
  panelRoot = document.createElement("div");
  panelRoot.className = "saved-list-panel-root";
  panelRoot.innerHTML = buildPanelMarkup();
  document.body.appendChild(panelRoot);

  panelBody = panelRoot.querySelector("[data-saved-list-body]");
  panelStatus = panelRoot.querySelector("[data-saved-list-status]");

  panelRoot.addEventListener("click", handlePanelClick);
  panelRoot.addEventListener("input", handlePanelInput);
  document.addEventListener("keydown", handleKeydown);
}

function isOpen() {
  if (!panelRoot) return false;
  const aside = panelRoot.querySelector(".saved-list-panel");
  return aside && !aside.hasAttribute("hidden");
}

function openPanel(triggerSource) {
  ensureMounted();
  const backdrop = panelRoot.querySelector(".saved-list-panel-backdrop");
  const aside = panelRoot.querySelector(".saved-list-panel");
  if (!backdrop || !aside) return;
  lastFocusedElement = document.activeElement;
  backdrop.removeAttribute("hidden");
  aside.removeAttribute("hidden");
  // Allow CSS transitions to pick up the open state on next frame.
  window.requestAnimationFrame(function () {
    panelRoot.classList.add("is-open");
  });
  document.body.classList.add("saved-list-panel-locked");
  renderPanel();
  // Hand keyboard focus to the panel.
  window.setTimeout(function () {
    aside.focus();
  }, 50);
  if (!hasOpenedOnce) {
    hasOpenedOnce = true;
    trackFunnelEvent("saved_list_panel_opened_first_time", {
      list_size: readList().length,
      source: triggerSource || "",
    });
  }
  trackFunnelEvent("saved_list_panel_opened", {
    list_size: readList().length,
    source: triggerSource || "",
  });
}

function closePanel(reason) {
  if (!panelRoot) return;
  const backdrop = panelRoot.querySelector(".saved-list-panel-backdrop");
  const aside = panelRoot.querySelector(".saved-list-panel");
  if (!backdrop || !aside) return;
  panelRoot.classList.remove("is-open");
  // Wait for the CSS transition before hiding so the slide-out is visible.
  window.setTimeout(function () {
    backdrop.setAttribute("hidden", "");
    aside.setAttribute("hidden", "");
    document.body.classList.remove("saved-list-panel-locked");
    if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
      lastFocusedElement.focus();
    }
  }, 200);
  trackFunnelEvent("saved_list_panel_closed", { reason: reason || "" });
}

function handleKeydown(event) {
  if (event.key === "Escape" && isOpen()) {
    event.preventDefault();
    closePanel("escape");
  }
}

function handlePanelClick(event) {
  const closeTarget = event.target.closest("[data-saved-list-close]");
  if (closeTarget) {
    event.preventDefault();
    closePanel(closeTarget.getAttribute("data-saved-list-close") || "");
    return;
  }

  const removeBtn = event.target.closest("[data-saved-list-remove]");
  if (removeBtn) {
    event.preventDefault();
    const removeSlug = removeBtn.getAttribute("data-saved-list-remove");
    removeFromList(removeSlug, { surface: "saved_list_panel" });
    flashStatus("Removed from your list.");
    return;
  }

  const profileLink = event.target.closest("[data-saved-list-profile]");
  if (profileLink) {
    trackFunnelEvent("saved_list_profile_opened", {
      therapist_slug: profileLink.getAttribute("data-saved-list-profile") || "",
    });
    return;
  }

  const compareLink = event.target.closest("[data-saved-list-compare]");
  if (compareLink) {
    trackFunnelEvent("saved_list_compare_clicked", {
      list_size: readList().length,
    });
    return;
  }

  const browseLink = event.target.closest("[data-saved-list-browse]");
  if (browseLink) {
    trackFunnelEvent("saved_list_browse_clicked", {
      list_size: readList().length,
    });
    return;
  }

  const emailToggle = event.target.closest("[data-saved-list-email-toggle]");
  if (emailToggle) {
    event.preventDefault();
    const fields = panelRoot.querySelector("[data-saved-list-email-fields]");
    if (fields) {
      const willOpen = fields.hasAttribute("hidden");
      if (willOpen) {
        fields.removeAttribute("hidden");
        const input = fields.querySelector("[data-saved-list-email-input]");
        if (input) input.focus();
        // Mount the Turnstile widget the first time the form is revealed.
        // No-op when unconfigured. The handle is nulled on panel re-render.
        const tsContainer = fields.querySelector("[data-saved-list-turnstile]");
        if (tsContainer && !turnstileHandle) {
          mountTurnstile(tsContainer).then(function (handle) {
            turnstileHandle = handle;
          });
        }
        trackFunnelEvent("saved_list_email_form_opened", {
          list_size: readList().length,
        });
      } else {
        fields.setAttribute("hidden", "");
      }
    }
    return;
  }

  const sendBtn = event.target.closest("[data-saved-list-email-send]");
  if (sendBtn) {
    event.preventDefault();
    submitEmailRequest();
    return;
  }
}

function setEmailStatus(message, tone) {
  const statusNode = panelRoot && panelRoot.querySelector("[data-saved-list-email-status]");
  if (!statusNode) return;
  statusNode.textContent = message || "";
  statusNode.className =
    "saved-list-panel-email-status" + (tone ? " saved-list-panel-email-status-" + tone : "");
}

async function submitEmailRequest() {
  const input = panelRoot.querySelector("[data-saved-list-email-input]");
  const sendBtn = panelRoot.querySelector("[data-saved-list-email-send]");
  if (!input || !sendBtn) return;
  const email = String(input.value || "").trim();
  if (!email) {
    setEmailStatus("Enter an email address.", "error");
    input.focus();
    return;
  }
  if (isLocallyThrottled()) {
    setEmailStatus("Just sent. Try again in a few minutes.", "error");
    return;
  }
  const list = readList();
  if (!list.length) {
    setEmailStatus("Your list is empty.", "error");
    return;
  }
  sendBtn.disabled = true;
  setEmailStatus("Sending.", "pending");
  trackFunnelEvent("saved_list_email_requested", { list_size: list.length });
  try {
    const turnstileToken =
      turnstileHandle && typeof turnstileHandle.getToken === "function"
        ? turnstileHandle.getToken()
        : null;
    const requestBody = {
      email: email,
      items: list.map(function (entry) {
        return { slug: entry.slug, note: entry.note };
      }),
    };
    if (turnstileToken) {
      requestBody.turnstile_token = turnstileToken;
    }
    const response = await window.fetch(getReviewApiBase() + "/saved-list/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    const payload = await response.json().catch(function () {
      return {};
    });
    if (!response.ok) {
      // A 403 is a failed Turnstile challenge — reset so the user gets a
      // fresh token on retry.
      if (response.status === 403 && turnstileHandle && turnstileHandle.reset) {
        turnstileHandle.reset();
      }
      throw new Error(payload && payload.error ? payload.error : "Could not send the email.");
    }
    recordLocalSend();
    setEmailStatus("Sent. Check your inbox.", "success");
    trackFunnelEvent("saved_list_email_sent", {
      list_size: list.length,
      count: payload && payload.count,
    });
  } catch (error) {
    setEmailStatus("Could not send the email. Try again.", "error");
    trackFunnelEvent("saved_list_email_failed", {
      list_size: list.length,
      message: error && error.message ? error.message : "",
    });
  } finally {
    sendBtn.disabled = false;
  }
}

const noteSaveTimers = Object.create(null);
function handlePanelInput(event) {
  const noteInput = event.target.closest("[data-saved-list-note]");
  if (!noteInput) return;
  const slug = noteInput.getAttribute("data-saved-list-note");
  if (!slug) return;
  // Debounce so we don't write on every keystroke.
  window.clearTimeout(noteSaveTimers[slug]);
  noteSaveTimers[slug] = window.setTimeout(function () {
    updateNote(slug, noteInput.value);
    flashStatus("Note saved.");
  }, 400);
}

let statusTimer = 0;
function flashStatus(message) {
  if (!panelStatus) return;
  panelStatus.textContent = message;
  panelStatus.classList.add("is-visible");
  window.clearTimeout(statusTimer);
  statusTimer = window.setTimeout(function () {
    panelStatus.classList.remove("is-visible");
  }, 1800);
}

function renderEmptyState() {
  return (
    '<div class="saved-list-panel-empty">' +
    '<div class="saved-list-panel-empty-icon" aria-hidden="true">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">' +
    '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>' +
    "</div>" +
    '<h3 class="saved-list-panel-empty-title">Save the therapists you want to revisit.</h3>' +
    '<p class="saved-list-panel-empty-copy">Tap the bookmark on any profile or match card. Your saved list lives here, ready when you are.</p>' +
    '<a class="saved-list-panel-cta" href="/directory" data-saved-list-browse="empty">Browse therapists</a>' +
    "</div>"
  );
}

function renderLoading() {
  return '<div class="saved-list-panel-loading">Loading your saved therapists.</div>';
}

function renderCard(entry, therapist) {
  const name = (therapist && therapist.name) || "Saved therapist";
  const credentials = (therapist && (therapist.title || therapist.credentials)) || "";
  const location = therapist ? [therapist.city, therapist.state].filter(Boolean).join(", ") : "";
  const meta = [credentials, location].filter(Boolean).join(" · ");
  const photo = therapist && therapist.photo_url;
  const slug = entry.slug;
  const noteValue = entry.note || "";
  const avatar = photo
    ? '<img src="' +
      escapeHtml(sanityImageUrl(photo, { width: 112, height: 112 })) +
      '" alt="" width="56" height="56" loading="lazy" decoding="async" />'
    : '<span class="saved-list-card-initials" aria-hidden="true">' +
      escapeHtml(getInitials(name)) +
      "</span>";

  return (
    '<article class="saved-list-card" data-saved-list-slug="' +
    escapeHtml(slug) +
    '">' +
    '<div class="saved-list-card-photo">' +
    avatar +
    "</div>" +
    '<div class="saved-list-card-body">' +
    '<div class="saved-list-card-head">' +
    "<div>" +
    '<h3 class="saved-list-card-name">' +
    escapeHtml(name) +
    "</h3>" +
    (meta ? '<p class="saved-list-card-meta">' + escapeHtml(meta) + "</p>" : "") +
    "</div>" +
    '<button type="button" class="saved-list-card-remove" data-saved-list-remove="' +
    escapeHtml(slug) +
    '" aria-label="Remove ' +
    escapeHtml(name) +
    ' from your list">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
    "</button>" +
    "</div>" +
    '<label class="saved-list-card-note-label" for="savedListNote-' +
    escapeHtml(slug) +
    '">Your note</label>' +
    '<textarea id="savedListNote-' +
    escapeHtml(slug) +
    '" class="saved-list-card-note" data-saved-list-note="' +
    escapeHtml(slug) +
    '" maxlength="' +
    NOTE_MAX_LENGTH +
    '" rows="2" placeholder="One sharp reminder for future-you (e.g. great evening availability).">' +
    escapeHtml(noteValue) +
    "</textarea>" +
    '<a class="saved-list-card-action" href="' +
    escapeHtml(getTherapistProfileHref(slug)) +
    '" data-saved-list-profile="' +
    escapeHtml(slug) +
    '">View profile and contact options</a>' +
    "</div>" +
    "</article>"
  );
}

function renderEmailForm() {
  return (
    '<div class="saved-list-panel-email" data-saved-list-email-form>' +
    '<button type="button" class="saved-list-panel-email-toggle" data-saved-list-email-toggle>' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" width="16" height="16">' +
    '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 7l10 7 10-7"/></svg>' +
    "Send to my email" +
    "</button>" +
    '<div class="saved-list-panel-email-expand" data-saved-list-email-fields hidden>' +
    '<label class="saved-list-panel-email-label" for="savedListEmailInput">Your email</label>' +
    '<div class="saved-list-panel-email-row">' +
    '<input id="savedListEmailInput" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" data-saved-list-email-input />' +
    '<button type="button" class="saved-list-panel-cta saved-list-panel-cta-compact" data-saved-list-email-send>Send</button>' +
    "</div>" +
    '<div class="saved-list-panel-turnstile" data-saved-list-turnstile></div>' +
    '<div class="saved-list-panel-email-status" data-saved-list-email-status></div>' +
    "</div>" +
    "</div>"
  );
}

function renderFooter(list) {
  if (!list.length) return "";
  const emailFormHtml = renderEmailForm();
  if (list.length >= 2) {
    const slugs = list
      .map(function (item) {
        return item.slug;
      })
      .join(",");
    return (
      '<div class="saved-list-panel-footer">' +
      '<a class="saved-list-panel-cta" href="/match?shortlist=' +
      encodeURIComponent(slugs) +
      '" data-saved-list-compare>Compare these therapists →</a>' +
      emailFormHtml +
      '<a class="saved-list-panel-link" href="/directory" data-saved-list-browse="footer">Browse more therapists →</a>' +
      "</div>"
    );
  }
  return (
    '<div class="saved-list-panel-footer">' +
    '<a class="saved-list-panel-cta" href="/directory" data-saved-list-browse="footer-single">Find your next pick</a>' +
    emailFormHtml +
    "</div>"
  );
}

function renderPanel() {
  if (!panelBody) return;
  // The panel rebuilds its inner HTML below, which destroys any mounted
  // Turnstile widget; drop the stale handle so it re-mounts on next open.
  turnstileHandle = null;
  const list = readList();
  const sub = panelRoot.querySelector("[data-saved-list-sub]");
  if (sub) {
    if (!list.length) {
      sub.textContent = "Therapists you save will appear here.";
    } else {
      sub.textContent =
        list.length +
        " saved · " +
        MAX_ENTRIES +
        " max. Notes are saved to this browser. Clearing your history will remove them.";
    }
  }

  if (!list.length) {
    panelBody.innerHTML = renderEmptyState();
    return;
  }

  panelBody.innerHTML = renderLoading();
  loadTherapistsByCache().then(function (therapists) {
    if (!isOpen()) return;
    const bySlug = Object.create(null);
    (therapists || []).forEach(function (t) {
      if (t && t.slug) bySlug[t.slug] = t;
    });
    const currentList = readList();
    if (!currentList.length) {
      panelBody.innerHTML = renderEmptyState();
      return;
    }
    const cardsHtml = currentList
      .map(function (entry) {
        return renderCard(entry, bySlug[entry.slug] || null);
      })
      .join("");
    panelBody.innerHTML =
      '<div class="saved-list-panel-cards">' + cardsHtml + "</div>" + renderFooter(currentList);
  });
}

function bindShortlistTriggers() {
  document.addEventListener("click", function (event) {
    const trigger = event.target.closest("[data-shortlist-link]");
    if (!trigger) return;
    // Plain Cmd/Ctrl-click should still navigate (open in new tab), only
    // hijack a normal left-click without modifier keys.
    if (event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    openPanel(trigger.getAttribute("data-shortlist-source") || "nav");
  });
}

export function initSavedListPanel() {
  if (typeof document === "undefined") return;
  bindShortlistTriggers();
  subscribe(function () {
    if (isOpen()) renderPanel();
  });
}

export function openSavedListPanel(source) {
  openPanel(source);
}
