import "./sentry-init.js";
import "./site-analytics.js";
import { searchTherapistQuickClaim } from "./review-api.js";
import { trackFunnelEvent } from "./funnel-analytics.js";
import { escapeHtml } from "./escape-html.js";
import { mountTurnstile } from "./turnstile-widget.js";

const REMOVAL_ENDPOINT = "/api/review/portal/listing-removal/request";

let turnstileHandle = null;

function isLikelyEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

// Render a toast if the user lands here after clicking a confirmation link.
// Listing-removal redirect: /remove?removed=ok|expired|invalid.
// Photo opt-out redirect:   /remove?photo=removed|expired|invalid.
function renderToast() {
  const params = new URLSearchParams(window.location.search);
  const removed = params.get("removed");
  const photo = params.get("photo");
  if (!removed && !photo) return;

  const toast = document.createElement("div");
  toast.className = "remove-toast";
  if (photo === "removed") {
    toast.classList.add("is-success");
    toast.textContent =
      "Done — that photo has been removed from your listing and won't be added again. If you'd like to manage the rest of your listing, you can claim it any time.";
  } else if (photo === "expired" || photo === "invalid") {
    toast.classList.add("is-error");
    toast.textContent =
      "That photo-removal link isn't valid or has already been used. Email support@bipolartherapyhub.com and we'll take the photo down right away.";
  } else if (removed === "ok") {
    toast.classList.add("is-success");
    toast.textContent =
      "Your listing has been removed from Bipolar Therapy Hub. You'll no longer appear in the directory or in match results. You can create a new listing any time if you change your mind.";
  } else if (removed === "expired") {
    toast.classList.add("is-error");
    toast.textContent =
      "That removal link expired or has already been used. Submit the form below to get a fresh confirmation link.";
  } else if (removed === "invalid") {
    toast.classList.add("is-error");
    toast.textContent =
      "That removal link isn't valid. If you believe this is a mistake, submit the form below to get a new confirmation link.";
  } else {
    return;
  }

  const nav = document.querySelector("nav");
  if (nav && nav.nextSibling) {
    nav.parentNode.insertBefore(toast, nav.nextSibling);
  } else {
    document.body.insertBefore(toast, document.body.firstChild);
  }
}

function setStatus(node, message, tone) {
  if (!node) return;
  node.hidden = !message;
  node.textContent = message || "";
  node.classList.remove("is-success", "is-error");
  if (tone === "success") node.classList.add("is-success");
  if (tone === "error") node.classList.add("is-error");
}

async function submitRemovalRequest(form, status) {
  if (form.dataset.submitting === "true") return;

  const payload = {
    full_name: form.elements.full_name.value.trim(),
    license_number: form.elements.license_number.value.trim(),
    email: form.elements.email.value.trim(),
    turnstile_token:
      turnstileHandle && turnstileHandle.getToken ? turnstileHandle.getToken() : null,
  };

  if (!payload.full_name || !payload.license_number || !payload.email) {
    setStatus(status, "Fill in all three fields so we can look up your listing.", "error");
    return;
  }

  if (!isLikelyEmail(payload.email)) {
    setStatus(status, "Enter the email address on file for this listing.", "error");
    return;
  }

  const submit = form.querySelector('button[type="submit"]');
  const priorLabel = submit ? submit.textContent : "";
  form.dataset.submitting = "true";
  if (submit) {
    submit.disabled = true;
    submit.textContent = "Sending link...";
  }
  setStatus(status, "", null);

  try {
    const response = await fetch(REMOVAL_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    // Always treat non-5xx as success to avoid leaking listing existence.
    if (response.status === 403) {
      if (turnstileHandle && turnstileHandle.reset) turnstileHandle.reset();
      setStatus(status, "Verification didn't complete. Refresh the page and try again.", "error");
      return;
    }
    if (response.status >= 500) {
      setStatus(
        status,
        "Something went wrong on our end. Try again in a minute, or email us directly.",
        "error",
      );
      return;
    }
    setStatus(
      status,
      "If a listing matches these details, we just sent a confirmation link to the email on file. Click the link in that email to finish removing your listing.",
      "success",
    );
    trackFunnelEvent("removal_link_sent", {});
    form.reset();
  } catch (_error) {
    setStatus(
      status,
      "We couldn't reach the server. Check your connection and try again.",
      "error",
    );
  } finally {
    delete form.dataset.submitting;
    if (submit) {
      submit.disabled = false;
      submit.textContent = priorLabel;
    }
  }
}

function debounce(fn, wait) {
  let timer = null;
  return function (...args) {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };
}

function renderRemovalSearchResults(container, results, onPick) {
  if (!container) return;
  container.textContent = "";
  if (!results.length) {
    container.hidden = false;
    const empty = document.createElement("div");
    empty.className = "removal-search-empty";
    empty.textContent = "No matches. Try your last name or CA license number.";
    container.appendChild(empty);
    return;
  }
  container.hidden = false;
  results.slice(0, 5).forEach((result, index) => {
    const location = [result.city, result.state].filter(Boolean).join(", ");
    const metaParts = [
      location,
      result.license_number ? "License " + result.license_number : "",
      result.email_hint ? "Email: " + result.email_hint : "No email on file",
    ].filter(Boolean);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "removal-search-result";
    button.dataset.resultIndex = String(index);

    const name = document.createElement("span");
    name.className = "result-name";
    name.textContent = [result.name || "", result.credentials || ""].filter(Boolean).join(" · ");

    const meta = document.createElement("span");
    meta.className = "result-meta";
    meta.textContent = metaParts.join(" · ");

    button.append(name, meta);
    button.addEventListener("click", () => {
      const idx = Number(button.getAttribute("data-result-index"));
      const picked = results[idx];
      if (picked) onPick(picked);
    });
    container.appendChild(button);
  });
}

function bindRemovalSearch() {
  const input = document.getElementById("removalSearchInput");
  const resultsEl = document.getElementById("removalSearchResults");
  const form = document.getElementById("removalForm");
  const emailHint = document.getElementById("removalEmailHint");
  if (!input || !resultsEl || !form) return;

  let searchRequestId = 0;
  const runSearch = debounce(async (query) => {
    const requestId = ++searchRequestId;
    const trimmed = (query || "").trim();
    if (trimmed.length < 2) {
      resultsEl.hidden = true;
      resultsEl.textContent = "";
      return;
    }
    try {
      const payload = await searchTherapistQuickClaim(trimmed);
      if (requestId !== searchRequestId || input.value.trim() !== trimmed) return;
      renderRemovalSearchResults(resultsEl, (payload && payload.results) || [], (picked) => {
        form.elements.full_name.value = picked.name || "";
        form.elements.license_number.value = picked.license_number || "";
        input.value = picked.name || "";
        resultsEl.hidden = true;
        resultsEl.textContent = "";
        trackFunnelEvent("removal_listing_selected", {
          therapist_slug: picked.slug,
        });
        if (emailHint) {
          if (picked.email_hint) {
            emailHint.textContent = "On file: ";
            const strong = document.createElement("strong");
            strong.textContent = picked.email_hint;
            emailHint.append(
              strong,
              document.createTextNode(
                ". Type the full address. The confirmation link always goes to the on-file inbox, not the one you type here.",
              ),
            );
          } else {
            emailHint.textContent =
              "No email on file for this listing. Contact us at support@bipolartherapyhub.com to remove it.";
          }
        }
        if (form.elements.email) form.elements.email.focus();
      });
    } catch (_error) {
      if (requestId !== searchRequestId) return;
      resultsEl.hidden = true;
      resultsEl.textContent = "";
    }
  }, 200);

  input.addEventListener("input", () => runSearch(input.value));
}

function bindRemovalForm() {
  const form = document.getElementById("removalForm");
  if (!form) return;
  const status = document.getElementById("removalStatus");
  const submit = form.querySelector('button[type="submit"]');
  const container = document.createElement("div");
  container.className = "turnstile-container";
  if (submit && submit.parentNode) {
    submit.parentNode.insertBefore(container, submit);
  } else {
    form.appendChild(container);
  }
  mountTurnstile(container).then((handle) => {
    turnstileHandle = handle;
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitRemovalRequest(form, status);
  });
}

function init() {
  trackFunnelEvent("removal_page_viewed", {});
  renderToast();
  bindRemovalSearch();
  bindRemovalForm();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

export { escapeHtml, submitRemovalRequest };
