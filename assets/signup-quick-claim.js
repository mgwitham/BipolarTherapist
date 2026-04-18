import { requestTherapistQuickClaim, searchTherapistQuickClaim } from "./review-api.js";

const FORM_ID = "quickClaimForm";
const STATUS_ID = "quickClaimStatus";
const SUBMIT_BUTTON_ID = "quickClaimSubmit";
const FALLBACK_LINK_ID = "quickClaimCreateNew";
const FULL_FORM_ANCHOR_ID = "formCard";
const SEARCH_INPUT_ID = "quickClaimSearchInput";
const SEARCH_RESULTS_ID = "quickClaimSearchResults";
const EMAIL_HINT_ID = "quickClaimEmailHint";

function setStatus(element, tone, title, body) {
  if (!element) {
    return;
  }
  element.dataset.tone = tone;
  element.hidden = false;
  element.innerHTML = `<strong>${title}</strong>${body ? `<br /><span>${body}</span>` : ""}`;
}

function clearStatus(element) {
  if (!element) {
    return;
  }
  element.hidden = true;
  element.innerHTML = "";
  delete element.dataset.tone;
}

function showFallback(fallbackLink, anchorTarget) {
  if (fallbackLink) {
    fallbackLink.hidden = false;
    fallbackLink.focus({ preventScroll: true });
    fallbackLink.onclick = function handleFallbackClick(event) {
      event.preventDefault();
      if (anchorTarget && typeof anchorTarget.scrollIntoView === "function") {
        anchorTarget.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
  }
}

function hideFallback(fallbackLink) {
  if (fallbackLink) {
    fallbackLink.hidden = true;
    fallbackLink.onclick = null;
  }
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, function (char) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
  });
}

function renderSearchResults(container, results, onPick) {
  if (!container) {
    return;
  }
  if (!results.length) {
    container.hidden = false;
    container.innerHTML =
      '<div class="quick-claim-search-empty">No matches. Try a last name or license number, or create a new listing below.</div>';
    return;
  }
  container.hidden = false;
  container.innerHTML = results
    .map(function (result, index) {
      const location = [result.city, result.state].filter(Boolean).join(", ");
      const credentialBit = result.credentials ? " · " + escapeHtml(result.credentials) : "";
      const licenseBit = result.license_number
        ? " · License " + escapeHtml(result.license_number)
        : "";
      const emailBit = result.email_hint
        ? " · Email: " + escapeHtml(result.email_hint)
        : " · No email on file";
      const claimedBadge =
        result.claim_status === "claimed" ? " · <strong>Already claimed</strong>" : "";
      return (
        '<button type="button" class="quick-claim-search-result" data-result-index="' +
        index +
        '">' +
        '<span class="result-name">' +
        escapeHtml(result.name) +
        credentialBit +
        "</span>" +
        '<span class="result-meta">' +
        escapeHtml(location) +
        licenseBit +
        emailBit +
        claimedBadge +
        "</span>" +
        "</button>"
      );
    })
    .join("");

  container.querySelectorAll(".quick-claim-search-result").forEach(function (button) {
    button.addEventListener("click", function () {
      const idx = Number(button.getAttribute("data-result-index"));
      const picked = results[idx];
      if (picked) {
        onPick(picked);
      }
    });
  });
}

function clearSearchResults(container) {
  if (!container) {
    return;
  }
  container.hidden = true;
  container.innerHTML = "";
}

function setEmailHint(element, hint) {
  if (!element) {
    return;
  }
  if (hint) {
    element.hidden = false;
    element.textContent = "On file: " + hint;
  } else {
    element.hidden = true;
    element.textContent = "";
  }
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

function initQuickClaim() {
  const form = document.getElementById(FORM_ID);
  if (!form) {
    return;
  }

  const status = document.getElementById(STATUS_ID);
  const submitButton = document.getElementById(SUBMIT_BUTTON_ID);
  const fallbackLink = document.getElementById(FALLBACK_LINK_ID);
  const anchorTarget = document.getElementById(FULL_FORM_ANCHOR_ID);
  const searchInput = document.getElementById(SEARCH_INPUT_ID);
  const searchResults = document.getElementById(SEARCH_RESULTS_ID);
  const emailHint = document.getElementById(EMAIL_HINT_ID);

  const fullNameInput = form.querySelector('input[name="full_name"]');
  const emailInput = form.querySelector('input[name="email"]');
  const licenseInput = form.querySelector('input[name="license_number"]');

  function applyPickedResult(result) {
    if (fullNameInput) {
      fullNameInput.value = result.name || "";
    }
    if (licenseInput) {
      licenseInput.value = result.license_number || "";
    }
    setEmailHint(emailHint, result.email_hint || "");
    clearSearchResults(searchResults);
    if (searchInput) {
      searchInput.value = result.name || "";
    }
    if (emailInput) {
      emailInput.focus();
    }
  }

  const runSearch = debounce(async function (query) {
    if (!searchResults) {
      return;
    }
    const trimmed = (query || "").trim();
    if (trimmed.length < 2) {
      clearSearchResults(searchResults);
      return;
    }
    try {
      const payload = await searchTherapistQuickClaim(trimmed);
      renderSearchResults(
        searchResults,
        payload && payload.results ? payload.results : [],
        applyPickedResult,
      );
    } catch (_error) {
      clearSearchResults(searchResults);
    }
  }, 250);

  if (searchInput) {
    searchInput.addEventListener("input", function () {
      runSearch(searchInput.value);
    });
    searchInput.addEventListener("focus", function () {
      if (searchInput.value.trim().length >= 2) {
        runSearch(searchInput.value);
      }
    });
  }

  form.addEventListener("submit", async function handleSubmit(event) {
    event.preventDefault();
    clearStatus(status);
    hideFallback(fallbackLink);

    const formData = new FormData(form);
    const payload = {
      full_name: String(formData.get("full_name") || "").trim(),
      email: String(formData.get("email") || "").trim(),
      license_number: String(formData.get("license_number") || "").trim(),
    };

    if (!payload.full_name || !payload.email || !payload.license_number) {
      setStatus(
        status,
        "warn",
        "All three fields are required.",
        "Your full name, the email on your current listing, and your CA license number.",
      );
      return;
    }

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.dataset.originalLabel =
        submitButton.dataset.originalLabel || submitButton.textContent;
      submitButton.textContent = "Sending...";
    }

    try {
      await requestTherapistQuickClaim(payload);
      setStatus(
        status,
        "success",
        "Check your inbox.",
        "We sent a one-time link that signs you into your profile for the next 30 minutes.",
      );
      form.reset();
      setEmailHint(emailHint, "");
      if (searchInput) {
        searchInput.value = "";
      }
      clearSearchResults(searchResults);
    } catch (error) {
      const errorPayload = (error && error.payload) || {};
      const reason = errorPayload.reason || "";
      const message = (error && error.message) || "Something went wrong.";
      if (reason === "not_found") {
        setStatus(
          status,
          "info",
          "We don't see a listing for that license yet.",
          "Try the search above to look by name, or create a new listing below.",
        );
        showFallback(fallbackLink, anchorTarget);
      } else if (reason === "name_mismatch") {
        setStatus(
          status,
          "warn",
          "The name doesn't match that license.",
          "Double-check spelling, drop credentials (e.g. “, LMFT”), or use the search above to confirm the listing is yours.",
        );
      } else if (reason === "email_mismatch") {
        const hint = errorPayload.email_hint || "";
        setEmailHint(emailHint, hint);
        setStatus(
          status,
          "warn",
          "That email doesn't match the profile.",
          hint
            ? "We have <strong>" +
                escapeHtml(hint) +
                '</strong> on file. Use that email, or <a href="mailto:hello@bipolartherapyhub.com?subject=Need%20to%20update%20my%20claim%20email">email us</a> if you no longer have access.'
            : "Contact us if you no longer have access to the email on file.",
        );
      } else {
        setStatus(status, "warn", "We couldn't send the link.", message);
      }
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        if (submitButton.dataset.originalLabel) {
          submitButton.textContent = submitButton.dataset.originalLabel;
        }
      }
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initQuickClaim);
} else {
  initQuickClaim();
}
