import "./sentry-init.js";
import { escapeHtml } from "./escape-html.js";
import {
  fetchTherapistMe,
  getTherapistSessionToken,
  lookupTherapistBySlug,
  requestTherapistQuickClaim,
  searchTherapistQuickClaim,
  sendClaimLinkToSlug,
} from "./review-api.js";
import { trackFunnelEvent } from "./funnel-analytics.js";
import { mountTurnstile } from "./turnstile-widget.js";

let turnstileHandle = null;

function gtagEvent(name, params) {
  if (typeof window.gtag === "function") {
    window.gtag("event", name, params || {});
  }
}

// Element IDs
const FORM_ID = "quickClaimForm";
const STATUS_ID = "quickClaimStatus";
const SUBMIT_BUTTON_ID = "quickClaimSubmit";
const FALLBACK_LINK_ID = "quickClaimCreateNew";
const FULL_FORM_ANCHOR_ID = "formCard";
const SEARCH_INPUT_ID = "quickClaimSearchInput";
const SEARCH_RESULTS_ID = "quickClaimSearchResults";
const SEARCH_SUMMARY_ID = "quickClaimSearchSummary";
const EMAIL_HINT_ID = "quickClaimEmailHint";
const CONFIRM_PANEL_ID = "claimConfirmPanel";
const CONFIRM_EMAIL_ID = "claimConfirmEmail";
const CONFIRM_SEND_ID = "claimConfirmSend";
const CONFIRM_CHANGE_ID = "claimStep1Change";
const CONFIRM_STATUS_ID = "claimConfirmStatus";
const QUICK_RESEND_ID = "quickClaimResend";
const QUICK_RESEND_LINK_ID = "quickClaimResendLink";
const CONFIRM_RESEND_ID = "claimConfirmResend";
const CONFIRM_RESEND_LINK_ID = "claimConfirmResendLink";
const STEP2_AREA_ID = "claimStep2Area";
const STEP1_SUMMARY_ID = "claimStep1Summary";
const SEARCHED_TERM_ID = "claimSearchedTerm";
const SEARCH_CARD_ID = "quickClaimSearch";
const SELECTED_CARD_ID = "claimSelectedCard";
const THIN_BANNER_ID = "claimThinBanner";
const THIN_BANNER_TEXT_ID = "claimThinBannerText";
const THIN_BANNER_DASHBOARD_ID = "claimThinBannerDashboard";
const THIN_BANNER_CLAIM_ID = "claimThinBannerClaim";
const THIN_BANNER_DISMISS_ID = "claimThinBannerDismiss";
const SELECTED_RESULT_STORAGE_KEY = "bt_claim_selected_slug_v2";

function canUseSessionStorage() {
  try {
    return typeof window !== "undefined" && !!window.sessionStorage;
  } catch (_error) {
    return false;
  }
}

function setStoredSelectedSlug(slug) {
  if (!canUseSessionStorage()) return;
  if (slug) {
    window.sessionStorage.setItem(SELECTED_RESULT_STORAGE_KEY, String(slug));
  } else {
    window.sessionStorage.removeItem(SELECTED_RESULT_STORAGE_KEY);
  }
}

function getStoredSelectedSlug() {
  if (!canUseSessionStorage()) return "";
  return window.sessionStorage.getItem(SELECTED_RESULT_STORAGE_KEY) || "";
}

function setStatus(element, tone, title, body) {
  if (!element) return;
  element.dataset.tone = tone;
  element.hidden = false;
  element.innerHTML = `<strong>${title}</strong>${body ? `<br /><span>${body}</span>` : ""}`;
}

function clearStatus(element) {
  if (!element) return;
  element.hidden = true;
  element.innerHTML = "";
  delete element.dataset.tone;
}

function setSearchSummary(element, title, body) {
  if (!element) return;
  if (!title) {
    element.hidden = true;
    element.innerHTML = "";
    return;
  }
  element.hidden = false;
  element.innerHTML = `<strong>${title}</strong><p>${body || ""}</p>`;
}

function showFallback(fallbackLink, anchorTarget) {
  if (fallbackLink) {
    fallbackLink.hidden = false;
    fallbackLink.focus({ preventScroll: true });
    fallbackLink.onclick = function (event) {
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

// Deterministic avatar color from name initial
function avatarBg(name) {
  const palette = ["#1a7a8f", "#3aaa7a", "#4a6572", "#155f70", "#2a9cb3"];
  return palette[(String(name || " ").charCodeAt(0) || 0) % palette.length];
}

function initials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/);
  if (parts.length >= 2) {
    return ((parts[0][0] || "") + (parts[parts.length - 1][0] || "")).toUpperCase();
  }
  return (parts[0] || "").slice(0, 2).toUpperCase();
}

// Renders a directory-card-style preview for a result
function renderListingCard(result, isSelected) {
  const loc = [result.city, result.state].filter(Boolean).join(", ");
  const bg = avatarBg(result.name || "");
  const abbr = initials(result.name || "?");
  const verified = result.license_verified_current;
  const claimed = result.claim_status === "claimed";
  const credBit = result.credentials
    ? `, <span class="claim-result-cred">${escapeHtml(result.credentials)}</span>`
    : "";
  const emailBit = result.email_hint
    ? `<span class="claim-result-email">Email on file: ${escapeHtml(result.email_hint)}</span>`
    : "";
  const badges = [
    verified
      ? `<span class="claim-result-badge claim-result-badge--verified">✓ CA license verified</span>`
      : "",
    claimed
      ? `<span class="claim-result-badge claim-result-badge--claimed">Already claimed</span>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  return `
    <div class="claim-result-card${isSelected ? " is-selected" : ""}">
      <div class="claim-result-avatar" style="background:${bg}" aria-hidden="true">${escapeHtml(abbr)}</div>
      <div class="claim-result-body">
        <div class="claim-result-name">${escapeHtml(result.name || "")}${credBit}</div>
        ${loc ? `<div class="claim-result-meta">${escapeHtml(loc)}</div>` : ""}
        ${result.license_number ? `<div class="claim-result-meta">License ${escapeHtml(result.license_number)}</div>` : ""}
        ${emailBit}
        ${badges ? `<div class="claim-result-badges">${badges}</div>` : ""}
      </div>
    </div>
  `;
}

function renderSearchResults(container, results, onPick) {
  if (!container) return;
  if (!results.length) {
    container.hidden = false;
    container.innerHTML =
      '<div class="quick-claim-search-state" data-search-state="no_results">' +
      "<strong>No listing found for that search</strong>" +
      "<p>Try a different last name or California license number.</p>" +
      '<div class="quick-claim-search-state-links">' +
      '<button type="button" data-claim-search-link="retry">Try a different search →</button>' +
      '<a href="/signup" data-claim-search-link="new_listing">Create a new listing instead →</a>' +
      "</div>" +
      "</div>";
    return;
  }
  container.hidden = false;
  const stateLabel =
    results.length === 1
      ? '<div class="quick-claim-search-state" data-search-state="single_result"><strong>1 likely match</strong><p>Review the listing details, then send the activation link.</p></div>'
      : `<div class="quick-claim-search-state" data-search-state="multiple_results"><strong>${results.length} close matches</strong><p>Choose the listing that matches your city, credentials, and license number.</p></div>`;

  container.innerHTML =
    stateLabel +
    results
      .map(function (result, index) {
        return (
          `<button type="button" class="claim-result-card" data-result-index="${index}" aria-label="Select listing for ${escapeHtml(result.name || "")}">` +
          `<div class="claim-result-avatar" style="background:${avatarBg(result.name || "")}" aria-hidden="true">${escapeHtml(initials(result.name || "?"))}</div>` +
          `<div class="claim-result-body">` +
          `<div class="claim-result-name">${escapeHtml(result.name || "")}${result.credentials ? `, <span class="claim-result-cred">${escapeHtml(result.credentials)}</span>` : ""}</div>` +
          ([result.city, result.state].filter(Boolean).length
            ? `<div class="claim-result-meta">${escapeHtml([result.city, result.state].filter(Boolean).join(", "))}</div>`
            : "") +
          (result.license_number
            ? `<div class="claim-result-meta">License ${escapeHtml(result.license_number)}</div>`
            : "") +
          (result.email_hint
            ? `<span class="claim-result-email">Email on file: ${escapeHtml(result.email_hint)}</span>`
            : "") +
          `<div class="claim-result-badges">` +
          (result.license_verified_current
            ? `<span class="claim-result-badge claim-result-badge--verified">✓ CA license verified</span>`
            : "") +
          (result.claim_status === "claimed"
            ? `<span class="claim-result-badge claim-result-badge--claimed">Already claimed</span>`
            : "") +
          `</div>` +
          `</div>` +
          `</button>`
        );
      })
      .join("");

  container.querySelectorAll(".claim-result-card[data-result-index]").forEach(function (button) {
    button.addEventListener("click", function () {
      const idx = Number(button.getAttribute("data-result-index"));
      const picked = results[idx];
      if (picked) onPick(picked);
    });
  });
}

function clearSearchResults(container) {
  if (!container) return;
  container.hidden = true;
  container.innerHTML = "";
}

function setEmailHint(element, hint) {
  if (!element) return;
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
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(function () {
      timer = null;
      fn(...args);
    }, wait);
  };
}

// Show resend element with 30-second countdown before enabling
function startResendCountdown(resendEl, resendLink, seconds) {
  if (!resendEl || !resendLink) return;
  resendEl.hidden = false;
  resendLink.setAttribute("aria-disabled", "true");

  let remaining = seconds;

  function tick() {
    if (remaining <= 0) {
      resendLink.removeAttribute("aria-disabled");
      resendLink.textContent = "Resend now";
      return;
    }
    const mm = String(Math.floor(remaining / 60)).padStart(1, "0");
    const ss = String(remaining % 60).padStart(2, "0");
    resendLink.textContent = `Resend in ${mm}:${ss}`;
    remaining--;
    window.setTimeout(tick, 1000);
  }
  tick();
}

function initQuickClaim() {
  const form = document.getElementById(FORM_ID);
  if (!form) return;

  trackFunnelEvent("claim_page_viewed", {});
  gtagEvent("claim_page_viewed");

  const status = document.getElementById(STATUS_ID);
  const submitButton = document.getElementById(SUBMIT_BUTTON_ID);
  const fallbackLink = document.getElementById(FALLBACK_LINK_ID);
  const anchorTarget = document.getElementById(FULL_FORM_ANCHOR_ID);
  const searchInput = document.getElementById(SEARCH_INPUT_ID);
  const searchResults = document.getElementById(SEARCH_RESULTS_ID);
  const searchSummary = document.getElementById(SEARCH_SUMMARY_ID);
  const emailHint = document.getElementById(EMAIL_HINT_ID);

  const fullNameInput = form.querySelector('input[name="full_name"]');
  const emailInput = form.querySelector('input[name="email"]');
  const licenseInput = form.querySelector('input[name="license_number"]');

  const quickResend = document.getElementById(QUICK_RESEND_ID);
  const quickResendLink = document.getElementById(QUICK_RESEND_LINK_ID);
  const confirmResend = document.getElementById(CONFIRM_RESEND_ID);
  const confirmResendLink = document.getElementById(CONFIRM_RESEND_LINK_ID);

  const confirmPanel = document.getElementById(CONFIRM_PANEL_ID);
  const confirmEmail = document.getElementById(CONFIRM_EMAIL_ID);
  const confirmSend = document.getElementById(CONFIRM_SEND_ID);
  const confirmStatus = document.getElementById(CONFIRM_STATUS_ID);
  const step2Area = document.getElementById(STEP2_AREA_ID);
  const step1Summary = document.getElementById(STEP1_SUMMARY_ID);
  const searchedTerm = document.getElementById(SEARCHED_TERM_ID);
  const searchCard = document.getElementById(SEARCH_CARD_ID);
  const selectedCard = document.getElementById(SELECTED_CARD_ID);

  let pickedResult = null;
  let lastSend = null;
  let searchInputTracked = false;

  // Mount Turnstile inside the confirm panel, right above the send-link
  // button — the panel is hidden in step 1 and revealed in step 2, but
  // the widget renders fine inside a display:none ancestor and becomes
  // visible/interactive when the panel is revealed.
  if (confirmSend && confirmSend.parentNode) {
    const turnstileContainer = document.createElement("div");
    turnstileContainer.className = "turnstile-container";
    confirmSend.parentNode.insertBefore(turnstileContainer, confirmSend);
    mountTurnstile(turnstileContainer).then((handle) => {
      turnstileHandle = handle;
    });
  }

  // Step management: transition from search (step 1) to confirm (step 2)
  function enterStep2(searchQuery) {
    if (searchCard) searchCard.hidden = true;
    if (step1Summary) step1Summary.hidden = false;
    if (searchedTerm) searchedTerm.textContent = searchQuery || "";
    if (step2Area) step2Area.hidden = false;
  }

  function enterStep1() {
    if (searchCard) searchCard.hidden = false;
    if (step1Summary) step1Summary.hidden = true;
    if (step2Area) step2Area.hidden = true;
    form.hidden = false;
    pickedResult = null;
    setStoredSelectedSlug("");
  }

  // Thin session banner
  async function hydrateSessionState() {
    const therapistSessionToken = getTherapistSessionToken();
    const thinBanner = document.getElementById(THIN_BANNER_ID);
    if (!therapistSessionToken || !thinBanner) return false;
    try {
      const me = await fetchTherapistMe();
      const therapist = me && me.therapist;
      if (!therapist || !therapist.slug) return false;

      thinBanner.hidden = false;
      const textEl = document.getElementById(THIN_BANNER_TEXT_ID);
      if (textEl) textEl.textContent = `Signed in as ${therapist.name || "your listing"}.`;

      const dashEl = document.getElementById(THIN_BANNER_DASHBOARD_ID);
      if (dashEl) dashEl.href = "portal.html?slug=" + encodeURIComponent(therapist.slug);

      const claimEl = document.getElementById(THIN_BANNER_CLAIM_ID);
      if (claimEl) claimEl.href = "claim.html";

      const dismissBtn = document.getElementById(THIN_BANNER_DISMISS_ID);
      if (dismissBtn) {
        dismissBtn.addEventListener("click", function () {
          thinBanner.hidden = true;
        });
      }

      trackFunnelEvent("claim_existing_session_detected", {
        therapist_slug: therapist.slug,
        claim_status: therapist.claim_status || "",
      });
      gtagEvent("claim_existing_session_detected", {
        therapist_slug: therapist.slug,
      });
      return true;
    } catch (_error) {
      return false;
    }
  }

  function setConfirmStatus(tone, message, body) {
    if (!confirmStatus) return;
    if (!message && !body) {
      confirmStatus.hidden = true;
      confirmStatus.textContent = "";
      delete confirmStatus.dataset.tone;
      return;
    }
    confirmStatus.hidden = false;
    confirmStatus.dataset.tone = tone;
    confirmStatus.textContent = "";
    if (message) {
      const strong = document.createElement("strong");
      strong.textContent = message;
      confirmStatus.appendChild(strong);
    }
    if (body) {
      confirmStatus.appendChild(document.createTextNode((message ? " " : "") + body));
    }
  }

  function renderTrustSignals(result) {
    const signals = document.getElementById("claimTrustSignals");
    if (!signals) return;
    const items = [];
    if (result && result.license_verified_current) {
      const licType = (result.credentials || "").trim();
      items.push(
        licType
          ? `CA ${licType} license verified by the Board`
          : "CA license verified by the Board",
      );
    }
    if (!items.length) {
      signals.hidden = true;
      signals.textContent = "";
      return;
    }
    signals.hidden = false;
    signals.textContent = "";
    items.forEach(function (text) {
      const item = document.createElement("li");
      item.textContent = text;
      signals.appendChild(item);
    });
  }

  function showConfirmPanel(result) {
    pickedResult = result;
    if (!confirmPanel) return;

    const isAlreadyClaimed = result && result.claim_status === "claimed";

    // Render selected listing card preview
    if (selectedCard) {
      selectedCard.innerHTML = renderListingCard(result, true);
    }

    const confirmLabel = document.getElementById("claimConfirmLabel");
    const confirmDestination = document.getElementById("claimConfirmDestination");
    const trialSubhint = document.getElementById("claimTrialSubhint");
    const disputeWrap = document.getElementById("claimConfirmDisputeWrap");
    const recoveryWrap = document.getElementById("claimConfirmRecoveryWrap");
    const recoveryLink = document.getElementById("claimConfirmRequestRecovery");

    if (confirmLabel) {
      confirmLabel.textContent = isAlreadyClaimed
        ? "This listing is already claimed"
        : "Selected listing";
    }

    const rawHint = result.email_hint != null ? String(result.email_hint).trim() : "";

    if (confirmEmail) {
      confirmEmail.textContent = rawHint || "the email on your listing";
    }

    if (confirmDestination) {
      const hintText = rawHint || "the email on your listing";
      if (!result.has_email) {
        confirmDestination.innerHTML =
          "No email is on file for this listing, so we can't send an activation link. " +
          "Verify your identity against your CA license to claim it.";
      } else if (isAlreadyClaimed) {
        confirmDestination.innerHTML = `If that's you, we'll send a fresh sign-in link to <strong id="claimConfirmEmail">${escapeHtml(hintText)}</strong> so you can get back into your portal.`;
      } else {
        confirmDestination.innerHTML = `We'll send your activation link to <strong id="claimConfirmEmail">${escapeHtml(hintText)}</strong>.`;
      }
    }

    renderTrustSignals(result);

    if (confirmSend) {
      if (!result.has_email) {
        confirmSend.textContent = "Verify your identity to continue";
      } else if (isAlreadyClaimed) {
        confirmSend.textContent = "Email me a sign-in link";
      } else {
        confirmSend.textContent = "Claim my listing →";
      }
      confirmSend.disabled = false;
      confirmSend.removeAttribute("aria-disabled");
    }

    if (trialSubhint) {
      trialSubhint.hidden = false;
      if (!result.has_email) {
        trialSubhint.textContent =
          "We can't send a link until identity is verified because no email is on file.";
      } else if (isAlreadyClaimed) {
        trialSubhint.textContent = "This sends a fresh sign-in link only.";
      } else {
        trialSubhint.textContent =
          "This step is free. Paid features appear only after activation, if available.";
      }
    }

    // Recovery link: update href with pre-fill params, hide if no-email (recovery is the primary path)
    if (recoveryLink && result.has_email) {
      try {
        const url = new URL("/recover", window.location.origin);
        if (result.name) url.searchParams.set("name", result.name);
        if (result.license_number) url.searchParams.set("license", result.license_number);
        recoveryLink.href = url.toString();
      } catch (_e) {
        recoveryLink.href = "/recover";
      }
    }
    if (recoveryWrap) {
      recoveryWrap.hidden = !result.has_email;
    }

    if (disputeWrap) {
      disputeWrap.hidden = !isAlreadyClaimed;
    }

    setConfirmStatus("", "");
    if (confirmResend) confirmResend.hidden = true;

    // Transition to step 2
    enterStep2(searchInput ? searchInput.value : "");
    form.hidden = true;
  }

  function hideConfirmPanel() {
    if (confirmPanel) {
      setConfirmStatus("", "");
    }
    if (confirmResend) confirmResend.hidden = true;
    enterStep1();
    if (searchInput) {
      searchInput.focus();
      searchInput.select();
    }
  }

  function setFormMode(mode, result) {
    const banner = document.getElementById("quickClaimFormBanner");
    const emailLabel = document.getElementById("quickClaimEmailLabel");
    if (!banner || !emailLabel) return;
    if (mode === "on_file_missing") {
      const therapistName = (result && result.name) || "this listing";
      banner.hidden = false;
      banner.innerHTML =
        "<strong>No email on file for " +
        escapeHtml(therapistName) +
        ".</strong> Enter the email you want to sign in with. " +
        "We'll send the activation link there. You can set a public contact email separately after you sign in.";
      emailLabel.textContent = "Email for signing in";
      // Funnel measurement: closes the dark transition between
      // "picked an existing listing" and "completed the fallback
      // form." Without it we couldn't tell whether the on-file-
      // missing fallback was bouncing therapists vs. silently
      // working. Fired only when the fallback form is actually
      // shown so it doesn't double-count regular claim flows.
      trackFunnelEvent("claim_form_shown", {
        therapist_slug: (result && result.slug) || "",
        reason: "on_file_missing",
      });
    } else {
      banner.hidden = true;
      banner.innerHTML = "";
      emailLabel.textContent = "Email on your current listing";
    }
  }

  function applyPickedResult(result) {
    trackFunnelEvent("claim_listing_selected", {
      therapist_slug: result && result.slug,
      has_email: Boolean(result && result.has_email),
      claim_status: (result && result.claim_status) || "unclaimed",
    });
    gtagEvent("claim_listing_selected", {
      therapist_slug: result && result.slug,
      has_email: Boolean(result && result.has_email),
    });
    clearSearchResults(searchResults);
    setStoredSelectedSlug(result && result.slug);
    if (searchInput) searchInput.value = result.name || "";
    if (fullNameInput) fullNameInput.value = result.name || "";
    if (licenseInput) licenseInput.value = result.license_number || "";
    setEmailHint(emailHint, result.email_hint || "");

    if (result.has_email && confirmPanel) {
      setFormMode("default", result);
      showConfirmPanel(result);
    } else {
      setFormMode("on_file_missing", result);
      form.hidden = false;
      step2Area.hidden = true;
      if (searchCard) searchCard.hidden = true;
      if (step1Summary) step1Summary.hidden = false;
      if (searchedTerm) searchedTerm.textContent = searchInput ? searchInput.value : "";
      if (emailInput) emailInput.focus();
    }
  }

  // Deep-link auto-pick from ?slug=X or ?confirm=X
  async function autoPickFromQueryParam() {
    try {
      const params = new URLSearchParams(window.location.search);
      const directSlug = (params.get("slug") || params.get("confirm") || "").trim();
      if (!directSlug) return;
      trackFunnelEvent("claim_deep_link_opened", { therapist_slug: directSlug });
      const response = await lookupTherapistBySlug(directSlug);
      const result = response && response.result;
      if (result && result.slug) {
        applyPickedResult(result);
        return;
      }
      if (searchInput && !searchInput.value) {
        const namePart = directSlug.split("-").filter(Boolean).slice(0, 2).join(" ");
        if (namePart) searchInput.value = namePart;
      }
    } catch (_error) {
      // Fall back to search UI silently
    }
  }

  async function handleConfirmSend(event) {
    if (event && typeof event.preventDefault === "function") event.preventDefault();
    if (!pickedResult || !pickedResult.slug || !confirmSend) return;
    if (!pickedResult.has_email) {
      // Navigate to recover page pre-filled
      try {
        const url = new URL("/recover", window.location.origin);
        if (pickedResult.name) url.searchParams.set("name", pickedResult.name);
        if (pickedResult.license_number)
          url.searchParams.set("license", pickedResult.license_number);
        window.location.href = url.toString();
      } catch (_e) {
        window.location.href = "/recover";
      }
      return;
    }

    const originalLabel = confirmSend.textContent;
    confirmSend.textContent = "Sending...";
    confirmSend.disabled = true;
    confirmSend.setAttribute("aria-disabled", "true");
    setConfirmStatus("", "");
    if (confirmResend) confirmResend.hidden = true;

    trackFunnelEvent("claim_send_link_clicked", { therapist_slug: pickedResult.slug });
    gtagEvent("claim_send_link_clicked", { therapist_slug: pickedResult.slug });

    const sendStart = Date.now();
    try {
      const result = await sendClaimLinkToSlug(pickedResult.slug, {
        turnstileToken:
          turnstileHandle && turnstileHandle.getToken ? turnstileHandle.getToken() : null,
      });
      const elapsed = Date.now() - sendStart;
      await new Promise(function (r) {
        window.setTimeout(r, Math.max(0, 1200 - elapsed));
      });
      const hint = (result && result.email_hint) || pickedResult.email_hint || "your inbox";
      setConfirmStatus(
        "success",
        "Activation link sent.",
        "Check " +
          hint +
          " for your one-time link. It expires in 30 minutes, open it on this device to finish claiming.",
      );
      trackFunnelEvent("claim_link_sent", {
        therapist_slug: pickedResult.slug,
        method: "slug_picked",
      });
      gtagEvent("claim_link_sent", { therapist_slug: pickedResult.slug, method: "slug_picked" });
      lastSend = { kind: "slug", slug: pickedResult.slug, target: "confirm" };
      startResendCountdown(confirmResend, confirmResendLink, 30);
    } catch (error) {
      const reason = (error && error.payload && error.payload.reason) || "";
      confirmSend.disabled = false;
      confirmSend.removeAttribute("aria-disabled");
      confirmSend.textContent = originalLabel;
      gtagEvent("claim_send_error", { reason: reason || "unknown" });
      if (error && error.status === 403) {
        if (turnstileHandle && turnstileHandle.reset) turnstileHandle.reset();
        setConfirmStatus(
          "warn",
          "Verification didn't complete.",
          "Refresh the page and try again.",
        );
      } else if (reason === "no_email_on_file") {
        setConfirmStatus(
          "warn",
          "No email is on file for this profile. Use the form below to verify ownership another way.",
        );
        hideConfirmPanel();
        if (emailInput) emailInput.focus();
      } else if (reason === "rate_limited") {
        setConfirmStatus(
          "warn",
          "You've requested a few links already.",
          "Please wait a little and try again.",
        );
      } else {
        setConfirmStatus(
          "warn",
          "",
          (error && error.message) || "We couldn't send the link. Try again in a moment.",
        );
      }
    } finally {
      confirmSend.disabled = false;
      confirmSend.removeAttribute("aria-disabled");
      confirmSend.textContent = originalLabel;
    }
  }

  async function replayLastSend() {
    if (!lastSend) return;
    const link = lastSend.target === "confirm" ? confirmResendLink : quickResendLink;
    if (link) {
      link.setAttribute("aria-disabled", "true");
      link.textContent = "sending...";
    }
    try {
      if (lastSend.kind === "slug") {
        await sendClaimLinkToSlug(lastSend.slug, {
          turnstileToken:
            turnstileHandle && turnstileHandle.getToken ? turnstileHandle.getToken() : null,
        });
      } else if (lastSend.kind === "quick") {
        await requestTherapistQuickClaim(lastSend.payload);
      }
      trackFunnelEvent("claim_resend_clicked", {
        therapist_slug: pickedResult && pickedResult.slug,
      });
      gtagEvent("claim_resend_clicked", { therapist_slug: pickedResult && pickedResult.slug });
      if (link) {
        link.textContent = "sent, check your inbox";
        window.setTimeout(function () {
          link.removeAttribute("aria-disabled");
          link.textContent = "Resend now";
        }, 4000);
      }
    } catch (_error) {
      if (link) {
        link.removeAttribute("aria-disabled");
        link.textContent = "Resend now";
      }
    }
  }

  if (quickResendLink) {
    quickResendLink.addEventListener("click", function (event) {
      event.preventDefault();
      replayLastSend();
    });
  }
  if (confirmResendLink) {
    confirmResendLink.addEventListener("click", function (event) {
      event.preventDefault();
      replayLastSend();
    });
  }

  if (confirmSend) confirmSend.addEventListener("click", handleConfirmSend);

  // "change" link in step 1 collapsed summary
  const confirmChange = document.getElementById(CONFIRM_CHANGE_ID);
  if (confirmChange) {
    confirmChange.addEventListener("click", function (event) {
      event.preventDefault();
      trackFunnelEvent("claim_listing_changed", {
        therapist_slug: pickedResult && pickedResult.slug,
      });
      hideConfirmPanel();
      setSearchSummary(
        searchSummary,
        "Search again",
        "Choose the listing that matches your city, credentials, and license number.",
      );
    });
  }

  const disputeLink = document.getElementById("claimConfirmDispute");
  if (disputeLink) {
    disputeLink.addEventListener("click", function () {
      trackFunnelEvent("claim_mistaken_report_clicked", {
        therapist_slug: pickedResult && pickedResult.slug,
      });
      gtagEvent("claim_mistaken_report_clicked", {
        therapist_slug: pickedResult && pickedResult.slug,
      });
    });
  }

  const recoveryLink = document.getElementById("claimConfirmRequestRecovery");
  if (recoveryLink) {
    recoveryLink.addEventListener("click", function () {
      trackFunnelEvent("claim_recovery_link_clicked", {
        therapist_slug: pickedResult && pickedResult.slug,
      });
      gtagEvent("claim_recovery_link_clicked", {
        therapist_slug: pickedResult && pickedResult.slug,
      });
    });
  }

  // Wire up no-results "try different search" button
  function wireSearchStateActions() {
    if (!searchResults) return;
    searchResults.querySelectorAll("[data-claim-search-link]").forEach(function (node) {
      node.addEventListener("click", function () {
        const action = node.getAttribute("data-claim-search-link");
        if (action === "retry") {
          clearSearchResults(searchResults);
          if (searchInput) {
            searchInput.value = "";
            searchInput.focus();
          }
        } else if (action === "new_listing") {
          trackFunnelEvent("claim_new_listing_clicked", { source: "no_results" });
          gtagEvent("claim_new_listing_clicked", { source: "no_results" });
        }
      });
    });
  }

  const runSearch = debounce(async function (query) {
    if (!searchResults) return;
    const trimmed = (query || "").trim();
    if (trimmed.length < 2) {
      clearSearchResults(searchResults);
      if (!pickedResult) {
        setSearchSummary(
          searchSummary,
          "Start with a last name or license number",
          "We'll show matching public listings if we have one.",
        );
      }
      return;
    }
    setSearchSummary(searchSummary, "Searching listings…", "Looking for likely public matches.");
    try {
      const payload = await searchTherapistQuickClaim(trimmed);
      const results = payload && payload.results ? payload.results : [];
      renderSearchResults(searchResults, results, applyPickedResult);
      wireSearchStateActions();
      if (!results.length) {
        trackFunnelEvent("claim_search_no_results", { query_length: trimmed.length });
        gtagEvent("claim_search_no_results", { query_length: trimmed.length });
        setSearchSummary(
          searchSummary,
          "No listing found",
          "Try a different last name or license number, or create a new listing.",
        );
      } else if (results.length === 1) {
        setSearchSummary(
          searchSummary,
          "1 likely match",
          "Review the listing details and continue only if they clearly match your practice.",
        );
      } else {
        setSearchSummary(
          searchSummary,
          results.length + " close matches",
          "Choose the listing that matches your city, credentials, and license number.",
        );
      }
      trackFunnelEvent("claim_search_submitted", {
        results_count: results.length,
        query_length: trimmed.length,
      });
      gtagEvent("claim_search_submitted", {
        results_count: results.length,
        query_length: trimmed.length,
      });
    } catch (_error) {
      clearSearchResults(searchResults);
      setSearchSummary(
        searchSummary,
        "Search unavailable right now",
        "Try again in a moment, or create a new listing if you're not yet listed.",
      );
    }
  }, 250);

  let searchFocusTracked = false;
  if (searchInput) {
    searchInput.addEventListener("input", function () {
      if (!searchInputTracked && searchInput.value.trim()) {
        searchInputTracked = true;
      }
      runSearch(searchInput.value);
    });
    searchInput.addEventListener("focus", function () {
      if (!searchFocusTracked) {
        searchFocusTracked = true;
        gtagEvent("claim_search_focused");
      }
      if (searchInput.value.trim().length >= 2) {
        runSearch(searchInput.value);
      }
    });
  }

  setSearchSummary(
    searchSummary,
    "Start with a last name or license number",
    "We'll show matching public listings if we have one.",
  );

  hydrateSessionState();

  const storedSlug = getStoredSelectedSlug();
  if (storedSlug) {
    lookupTherapistBySlug(storedSlug)
      .then(function (response) {
        if (response && response.result && response.result.slug && !pickedResult) {
          applyPickedResult(response.result);
          trackFunnelEvent("claim_selection_restored", {
            therapist_slug: response.result.slug,
          });
        }
      })
      .catch(function () {
        setStoredSelectedSlug("");
      });
  }

  autoPickFromQueryParam();

  // Quick claim fallback form (listings with no email on file)
  form.addEventListener("submit", async function handleSubmit(event) {
    event.preventDefault();
    clearStatus(status);
    hideFallback(fallbackLink);
    if (quickResend) quickResend.hidden = true;

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
      const result = await requestTherapistQuickClaim(payload);
      const verificationMethod = (result && result.verification_method) || "";
      const verifiedByDomain = verificationMethod === "email_domain_match";
      const manualReview = verificationMethod === "manual_review";
      if (manualReview) {
        setStatus(
          status,
          "info",
          "Sent to manual review.",
          "We couldn't auto-verify your email against the listed practice website, so a human will check it. Watch for a confirmation email within one business day.",
        );
        trackFunnelEvent("claim_recovery_submitted", {
          therapist_slug: (result && result.therapist_slug) || "",
          source: "quick_claim_no_email_on_file",
        });
      } else {
        setStatus(
          status,
          "success",
          "Check your inbox.",
          verifiedByDomain
            ? "Your email matched your practice website domain. We sent a one-time sign-in link."
            : "We sent a one-time link that signs you into your profile.",
        );
        trackFunnelEvent("claim_link_sent", {
          therapist_slug: (result && result.therapist_slug) || "",
          method: "quick_claim_form",
        });
        gtagEvent("claim_link_sent", {
          therapist_slug: (result && result.therapist_slug) || "",
          method: "quick_claim_form",
        });
      }
      lastSend = { kind: "quick", payload: { ...payload }, target: "quick" };
      if (!manualReview) {
        startResendCountdown(quickResend, quickResendLink, 30);
      }
      form.reset();
      setEmailHint(emailHint, "");
      if (searchInput) searchInput.value = "";
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
          "Try the search above, or create a new listing.",
        );
        showFallback(fallbackLink, anchorTarget);
        trackFunnelEvent("claim_search_no_results", { source: "manual_form" });
      } else if (reason === "name_mismatch") {
        setStatus(
          status,
          "warn",
          "The name doesn't match that license.",
          "Double-check spelling, drop credentials (e.g. “LMFT”), or use the search above.",
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
                "</strong> on file. Use that email, or use account recovery if you no longer have access."
            : "Contact us if you no longer have access to the email on file.",
        );
      } else if (reason === "rate_limited") {
        setStatus(
          status,
          "warn",
          "You've requested a few links already.",
          "Please wait a little and try again.",
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
