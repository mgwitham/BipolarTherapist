// Client-side wiring for the /signup listing-removal form and the
// toast banner shown after the user lands back on /signup via the
// confirmation email link.
//
// The removal flow intentionally mirrors the quick-claim flow in
// structure but with tighter verification: we only send the one-time
// link to the email on file for the listing. If the submitter types a
// different email, the request still returns a generic "check your
// inbox" response so we don't leak which listings exist or which email
// is on file.

import { searchTherapistQuickClaim } from "./review-api.js";
import { trackFunnelEvent } from "./funnel-analytics.js";

const REMOVAL_ENDPOINT = "/api/review/portal/listing-removal/request";

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderToast() {
  const params = new URLSearchParams(window.location.search);
  const removed = params.get("removed");
  if (!removed) return;

  const host = document.body;
  if (!host) return;

  const toast = document.createElement("div");
  toast.className = "signup-toast";
  if (removed === "ok") {
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

  // Insert at the very top of the page so it's the first thing seen.
  const nav = document.querySelector("nav");
  if (nav && nav.nextSibling) {
    nav.parentNode.insertBefore(toast, nav.nextSibling);
  } else {
    host.insertBefore(toast, host.firstChild);
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
  const payload = {
    full_name: form.elements.full_name.value.trim(),
    license_number: form.elements.license_number.value.trim(),
    email: form.elements.email.value.trim(),
  };

  if (!payload.full_name || !payload.license_number || !payload.email) {
    setStatus(status, "Fill in all three fields so we can look up your listing.", "error");
    return;
  }

  const submit = form.querySelector('button[type="submit"]');
  const priorLabel = submit ? submit.textContent : "";
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
    // For security we always treat non-5xx as success from the user's
    // perspective. The server returns generic copy whether the listing
    // exists or not — we don't leak existence.
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
    trackFunnelEvent("listing_removal_request_submitted", {});
    form.reset();
  } catch (_error) {
    setStatus(
      status,
      "We couldn't reach the server. Check your connection and try again.",
      "error",
    );
  } finally {
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
  if (!results.length) {
    container.hidden = false;
    container.innerHTML =
      '<div class="listing-removal-search-empty">No matches. Type your last name or license number.</div>';
    return;
  }
  container.hidden = false;
  container.innerHTML = results
    .slice(0, 5)
    .map((result, index) => {
      const location = [result.city, result.state].filter(Boolean).join(", ");
      const credentialBit = result.credentials ? " · " + escapeHtml(result.credentials) : "";
      const licenseBit = result.license_number
        ? " · License " + escapeHtml(result.license_number)
        : "";
      const emailBit = result.email_hint
        ? " · Email: " + escapeHtml(result.email_hint)
        : " · No email on file";
      return (
        '<button type="button" class="listing-removal-search-result" data-result-index="' +
        index +
        '">' +
        '<span class="result-name">' +
        escapeHtml(result.name || "") +
        credentialBit +
        "</span>" +
        '<span class="result-meta">' +
        escapeHtml(location) +
        licenseBit +
        emailBit +
        "</span>" +
        "</button>"
      );
    })
    .join("");
  container.querySelectorAll(".listing-removal-search-result").forEach((button) => {
    button.addEventListener("click", () => {
      const idx = Number(button.getAttribute("data-result-index"));
      const picked = results[idx];
      if (picked) onPick(picked);
    });
  });
}

function bindRemovalSearch() {
  const input = document.getElementById("listingRemovalSearchInput");
  const resultsEl = document.getElementById("listingRemovalSearchResults");
  const form = document.getElementById("listingRemovalForm");
  const emailHint = document.getElementById("listingRemovalEmailHint");
  if (!input || !resultsEl || !form) return;

  const runSearch = debounce(async (query) => {
    const trimmed = (query || "").trim();
    if (trimmed.length < 2) {
      resultsEl.hidden = true;
      resultsEl.innerHTML = "";
      return;
    }
    try {
      const payload = await searchTherapistQuickClaim(trimmed);
      renderRemovalSearchResults(resultsEl, (payload && payload.results) || [], (picked) => {
        // Auto-fill the form and surface the masked email hint so the
        // user knows which inbox to type below.
        form.elements.full_name.value = picked.name || "";
        form.elements.license_number.value = picked.license_number || "";
        input.value = picked.name || "";
        resultsEl.hidden = true;
        resultsEl.innerHTML = "";
        if (emailHint) {
          if (picked.email_hint) {
            emailHint.innerHTML =
              'On file: <span class="listing-removal-email-hint-prefill">' +
              escapeHtml(picked.email_hint) +
              "</span>. Type the full address so we know it's you. Link still goes to the on-file inbox, never the one you type.";
          } else {
            emailHint.textContent =
              "No email on file for this listing. Contact us directly at hello@bipolartherapyhub.com to remove it.";
          }
        }
        // Focus the email input since name/license are already filled
        if (form.elements.email) form.elements.email.focus();
      });
    } catch (_error) {
      resultsEl.hidden = true;
      resultsEl.innerHTML = "";
    }
  }, 200);

  input.addEventListener("input", () => runSearch(input.value));
}

function bindRemovalForm() {
  const form = document.getElementById("listingRemovalForm");
  if (!form) return;
  const status = document.getElementById("listingRemovalStatus");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitRemovalRequest(form, status);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    renderToast();
    bindRemovalSearch();
    bindRemovalForm();
  });
} else {
  renderToast();
  bindRemovalSearch();
  bindRemovalForm();
}

// Exported for tests / future reuse.
export { escapeHtml, submitRemovalRequest };
