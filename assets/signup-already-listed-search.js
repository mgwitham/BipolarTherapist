// Lightweight "are you already listed?" search on /signup.
// Debounced search against /portal/quick-claim/search. Clicking a
// result routes to /claim?slug=X where the full claim + trial flow
// lives. Never triggers a claim itself — purely a routing shortcut
// so existing therapists don't accidentally file duplicate new-listing
// applications.

import { searchTherapistQuickClaim } from "./review-api.js";
import { trackFunnelEvent } from "./funnel-analytics.js";

const SEARCH_INPUT_ID = "signupAlreadyListedInput";
const SEARCH_RESULTS_ID = "signupAlreadyListedResults";
const SEARCH_STATUS_ID = "signupAlreadyListedStatus";

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, function (char) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
  });
}

function debounce(fn, wait) {
  let timer = null;
  return function (...args) {
    if (timer) {
      window.clearTimeout(timer);
    }
    timer = window.setTimeout(function () {
      timer = null;
      fn(...args);
    }, wait);
  };
}

function renderResults(container, results) {
  if (!container) {
    return;
  }
  if (!results || !results.length) {
    container.hidden = false;
    container.innerHTML =
      '<div class="signup-already-listed-empty">' +
      "No matches. Fill the form below to add a new listing." +
      "</div>";
    return;
  }
  container.hidden = false;
  container.innerHTML = results
    .slice(0, 5)
    .map(function (result) {
      const location = [result.city, result.state].filter(Boolean).join(", ");
      const credentialBit = result.credentials ? " · " + escapeHtml(result.credentials) : "";
      const licenseBit = result.license_number
        ? " · License " + escapeHtml(result.license_number)
        : "";
      const claimedBadge =
        result.claim_status === "claimed"
          ? '<span class="signup-already-listed-badge">Already claimed</span>'
          : "";
      return (
        '<a class="signup-already-listed-result" href="claim.html?slug=' +
        encodeURIComponent(result.slug) +
        '" data-slug="' +
        escapeHtml(result.slug) +
        '">' +
        '<span class="signup-already-listed-name">' +
        escapeHtml(result.name) +
        credentialBit +
        claimedBadge +
        "</span>" +
        '<span class="signup-already-listed-meta">' +
        escapeHtml(location) +
        licenseBit +
        "</span>" +
        '<span class="signup-already-listed-go">Claim this listing →</span>' +
        "</a>"
      );
    })
    .join("");

  container.querySelectorAll(".signup-already-listed-result").forEach(function (link) {
    link.addEventListener("click", function () {
      trackFunnelEvent("signup_already_listed_picked", {
        therapist_slug: link.getAttribute("data-slug"),
      });
    });
  });
}

function clearResults(container) {
  if (!container) {
    return;
  }
  container.hidden = true;
  container.innerHTML = "";
}

function setStatus(element, message) {
  if (!element) {
    return;
  }
  if (!message) {
    element.hidden = true;
    element.textContent = "";
    return;
  }
  element.hidden = false;
  element.textContent = message;
}

function initSignupAlreadyListed() {
  const input = document.getElementById(SEARCH_INPUT_ID);
  const results = document.getElementById(SEARCH_RESULTS_ID);
  const status = document.getElementById(SEARCH_STATUS_ID);
  if (!input || !results) {
    return;
  }

  let hasTrackedStart = false;

  const runSearch = debounce(async function (query) {
    const trimmed = (query || "").trim();
    if (trimmed.length < 2) {
      clearResults(results);
      setStatus(status, "");
      return;
    }
    try {
      const payload = await searchTherapistQuickClaim(trimmed);
      renderResults(results, payload && payload.results ? payload.results : []);
      setStatus(status, "");
    } catch (_error) {
      clearResults(results);
      setStatus(status, "Couldn't search right now. Try again in a moment.");
    }
  }, 180);

  input.addEventListener("input", function (event) {
    if (!hasTrackedStart && event.target.value.length >= 2) {
      hasTrackedStart = true;
      trackFunnelEvent("signup_already_listed_search_started", {});
    }
    runSearch(event.target.value);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initSignupAlreadyListed);
} else {
  initSignupAlreadyListed();
}
