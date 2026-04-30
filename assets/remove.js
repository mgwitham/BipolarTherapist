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

// Render a toast if the user lands here after clicking a removal confirmation link.
// The backend redirect targets /remove?removed=ok|expired|invalid.
function renderToast() {
  const params = new URLSearchParams(window.location.search);
  const removed = params.get("removed");
  if (!removed) return;

  const toast = document.createElement("div");
  toast.className = "remove-toast";
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
    // Always treat non-5xx as success to avoid leaking listing existence.
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
      '<div class="removal-search-empty">No matches. Try your last name or CA license number.</div>';
    return;
  }
  container.hidden = false;
  container.innerHTML = results
    .slice(0, 5)
    .map((result, index) => {
      const location = [result.city, result.state].filter(Boolean).join(", ");
      const credBit = result.credentials ? " · " + escapeHtml(result.credentials) : "";
      const licenseBit = result.license_number
        ? " · License " + escapeHtml(result.license_number)
        : "";
      const emailBit = result.email_hint
        ? " · Email: " + escapeHtml(result.email_hint)
        : " · No email on file";
      return (
        `<button type="button" class="removal-search-result" data-result-index="${index}">` +
        `<span class="result-name">${escapeHtml(result.name || "")}${credBit}</span>` +
        `<span class="result-meta">${escapeHtml(location)}${licenseBit}${emailBit}</span>` +
        `</button>`
      );
    })
    .join("");
  container.querySelectorAll(".removal-search-result").forEach((button) => {
    button.addEventListener("click", () => {
      const idx = Number(button.getAttribute("data-result-index"));
      const picked = results[idx];
      if (picked) onPick(picked);
    });
  });
}

function bindRemovalSearch() {
  const input = document.getElementById("removalSearchInput");
  const resultsEl = document.getElementById("removalSearchResults");
  const form = document.getElementById("removalForm");
  const emailHint = document.getElementById("removalEmailHint");
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
        form.elements.full_name.value = picked.name || "";
        form.elements.license_number.value = picked.license_number || "";
        input.value = picked.name || "";
        resultsEl.hidden = true;
        resultsEl.innerHTML = "";
        trackFunnelEvent("removal_listing_selected", {
          therapist_slug: picked.slug,
        });
        if (emailHint) {
          if (picked.email_hint) {
            emailHint.innerHTML = `On file: <strong>${escapeHtml(picked.email_hint)}</strong>. Type the full address. The confirmation link always goes to the on-file inbox, not the one you type here.`;
          } else {
            emailHint.textContent =
              "No email on file for this listing. Contact us at support@bipolartherapyhub.com to remove it.";
          }
        }
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
  const form = document.getElementById("removalForm");
  if (!form) return;
  const status = document.getElementById("removalStatus");
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
