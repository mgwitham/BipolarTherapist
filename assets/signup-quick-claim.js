import {
  createStripeFeaturedCheckoutSession,
  requestTherapistQuickClaim,
  searchTherapistQuickClaim,
  sendClaimLinkToSlug,
  startClaimTrial,
} from "./review-api.js";
import { fetchFoundingSpotsRemaining } from "./cms.js";
import { trackFunnelEvent } from "./funnel-analytics.js";

const FORM_ID = "quickClaimForm";
const STATUS_ID = "quickClaimStatus";
const SUBMIT_BUTTON_ID = "quickClaimSubmit";
const FALLBACK_LINK_ID = "quickClaimCreateNew";
const FULL_FORM_ANCHOR_ID = "formCard";
const SEARCH_INPUT_ID = "quickClaimSearchInput";
const SEARCH_RESULTS_ID = "quickClaimSearchResults";
const EMAIL_HINT_ID = "quickClaimEmailHint";
const TRIAL_OFFER_ID = "claimTrialOffer";
const TRIAL_FOUNDING_ID = "claimTrialFounding";
const TRIAL_STANDARD_ID = "claimTrialStandard";
const TRIAL_DISMISS_ID = "claimTrialDismiss";
const TRIAL_FEEDBACK_ID = "claimTrialFeedback";
const TRIAL_FOUNDING_NOTE_SELECTOR = "[data-claim-founding-note]";
const CONFIRM_PANEL_ID = "claimConfirmPanel";
const CONFIRM_NAME_ID = "claimConfirmName";
const CONFIRM_META_ID = "claimConfirmMeta";
const CONFIRM_EMAIL_ID = "claimConfirmEmail";
const CONFIRM_SEND_ID = "claimConfirmSend";
const CONFIRM_TRIAL_ID = "claimStartTrial";
const CONFIRM_CHANGE_ID = "claimConfirmChange";
const CONFIRM_USE_OTHER_ID = "claimConfirmUseOther";
const CONFIRM_STATUS_ID = "claimConfirmStatus";
const QUICK_RESEND_ID = "quickClaimResend";
const QUICK_RESEND_LINK_ID = "quickClaimResendLink";
const CONFIRM_RESEND_ID = "claimConfirmResend";
const CONFIRM_RESEND_LINK_ID = "claimConfirmResendLink";

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

async function showTrialOffer(slug, email) {
  const offer = document.getElementById(TRIAL_OFFER_ID);
  if (!offer || !slug) {
    return;
  }
  offer.hidden = false;
  offer.dataset.slug = slug;
  offer.dataset.email = email || "";

  const foundingButton = document.getElementById(TRIAL_FOUNDING_ID);
  const foundingNote = offer.querySelector(TRIAL_FOUNDING_NOTE_SELECTOR);

  try {
    const spots = await fetchFoundingSpotsRemaining();
    if (!spots || !Number.isFinite(spots.remaining)) {
      return;
    }
    if (spots.remaining <= 0) {
      if (foundingButton) {
        foundingButton.disabled = true;
        const title = foundingButton.querySelector(".claim-trial-cta-title");
        if (title) {
          title.textContent = "Founding spots full";
        }
      }
      if (foundingNote) {
        foundingNote.textContent = "standard rate applies";
      }
    } else if (foundingNote) {
      foundingNote.textContent =
        spots.remaining + " of " + spots.cap + " spots left · rate locked 24 months";
    }
  } catch (_error) {
    // leave defaults
  }
}

function hideTrialOffer() {
  const offer = document.getElementById(TRIAL_OFFER_ID);
  if (offer) {
    offer.hidden = true;
  }
}

function setTrialFeedback(message) {
  const node = document.getElementById(TRIAL_FEEDBACK_ID);
  if (node) {
    node.textContent = message || "";
  }
}

async function handleTrialCheckout(button) {
  const offer = document.getElementById(TRIAL_OFFER_ID);
  if (!offer) {
    return;
  }
  const slug = offer.dataset.slug || "";
  const email = offer.dataset.email || "";
  const plan = button.getAttribute("data-plan") || "";
  if (!slug || !plan) {
    return;
  }
  setTrialFeedback("");
  button.disabled = true;
  const title = button.querySelector(".claim-trial-cta-title");
  const originalTitle = title ? title.textContent : "";
  if (title) {
    title.textContent = "Opening secure checkout...";
  }
  try {
    trackFunnelEvent("pricing_checkout_clicked", {
      therapist_slug: slug,
      plan,
      tier: plan.indexOf("founding") === 0 ? "founding" : "regular",
      source: "claim_success",
    });
    const result = await createStripeFeaturedCheckoutSession({
      therapist_slug: slug,
      email,
      plan,
      return_path: "/portal.html?slug=" + encodeURIComponent(slug),
    });
    if (result && result.url) {
      window.location.href = result.url;
      return;
    }
    throw new Error("No checkout URL returned.");
  } catch (error) {
    button.disabled = false;
    if (title) {
      title.textContent = originalTitle;
    }
    setTrialFeedback(
      (error && error.message) || "We could not start checkout. Try again in a moment.",
    );
  }
}

function initQuickClaim() {
  const form = document.getElementById(FORM_ID);
  if (!form) {
    return;
  }
  trackFunnelEvent("claim_page_viewed", {});

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

  // If the page was reached from a "claim this listing" link on a
  // therapist profile, the slug arrives in ?confirm=<slug>. Prefill
  // the search input with the last-name portion of the slug and let
  // the existing search flow surface the match.
  try {
    const params = new URLSearchParams(window.location.search);
    const confirmSlug = (params.get("confirm") || "").trim();
    if (confirmSlug && searchInput && !searchInput.value) {
      const namePart = confirmSlug.split("-").filter(Boolean).slice(0, 2).join(" ");
      if (namePart) {
        searchInput.value = namePart;
      }
    }
  } catch (_error) {
    // noop — prefill is best-effort
  }

  const quickResend = document.getElementById(QUICK_RESEND_ID);
  const quickResendLink = document.getElementById(QUICK_RESEND_LINK_ID);
  const confirmResend = document.getElementById(CONFIRM_RESEND_ID);
  const confirmResendLink = document.getElementById(CONFIRM_RESEND_LINK_ID);

  let lastSend = null;

  function showResend(target) {
    if (target === "quick" && quickResend) {
      quickResend.hidden = false;
      if (quickResendLink) {
        quickResendLink.removeAttribute("aria-disabled");
        quickResendLink.textContent = "resend the link";
      }
    }
    if (target === "confirm" && confirmResend) {
      confirmResend.hidden = false;
      if (confirmResendLink) {
        confirmResendLink.removeAttribute("aria-disabled");
        confirmResendLink.textContent = "resend the link";
      }
    }
  }

  function hideResend() {
    if (quickResend) quickResend.hidden = true;
    if (confirmResend) confirmResend.hidden = true;
  }

  async function replayLastSend() {
    if (!lastSend) {
      return;
    }
    const link = lastSend.target === "quick" ? quickResendLink : confirmResendLink;
    if (link) {
      link.setAttribute("aria-disabled", "true");
      link.textContent = "sending...";
    }
    try {
      if (lastSend.kind === "slug") {
        await sendClaimLinkToSlug(lastSend.slug);
      } else if (lastSend.kind === "quick") {
        await requestTherapistQuickClaim(lastSend.payload);
      }
      if (link) {
        link.textContent = "sent again — check your inbox";
        window.setTimeout(function () {
          link.removeAttribute("aria-disabled");
          link.textContent = "resend the link";
        }, 4000);
      }
    } catch (error) {
      if (link) {
        link.removeAttribute("aria-disabled");
        link.textContent = "resend the link";
      }
      const target = lastSend.target === "quick" ? status : null;
      if (target) {
        setStatus(
          target,
          "warn",
          "Couldn't resend.",
          (error && error.message) || "Try again in a moment.",
        );
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

  const confirmPanel = document.getElementById(CONFIRM_PANEL_ID);
  const confirmName = document.getElementById(CONFIRM_NAME_ID);
  const confirmMeta = document.getElementById(CONFIRM_META_ID);
  const confirmEmail = document.getElementById(CONFIRM_EMAIL_ID);
  const confirmSend = document.getElementById(CONFIRM_SEND_ID);
  const confirmTrial = document.getElementById(CONFIRM_TRIAL_ID);
  const confirmChange = document.getElementById(CONFIRM_CHANGE_ID);
  const confirmUseOther = document.getElementById(CONFIRM_USE_OTHER_ID);
  const confirmStatus = document.getElementById(CONFIRM_STATUS_ID);

  let pickedResult = null;

  function setConfirmStatus(tone, message) {
    if (!confirmStatus) {
      return;
    }
    if (!message) {
      confirmStatus.hidden = true;
      confirmStatus.innerHTML = "";
      delete confirmStatus.dataset.tone;
      return;
    }
    confirmStatus.hidden = false;
    confirmStatus.dataset.tone = tone;
    confirmStatus.innerHTML = message;
  }

  function showConfirmPanel(result) {
    pickedResult = result;
    if (!confirmPanel) {
      return;
    }
    if (confirmName) {
      const credentialBit = result.credentials ? ", " + result.credentials : "";
      confirmName.textContent = (result.name || "") + credentialBit;
    }
    if (confirmMeta) {
      const location = [result.city, result.state].filter(Boolean).join(", ");
      const licenseBit = result.license_number ? " · License " + result.license_number : "";
      confirmMeta.textContent = location + licenseBit;
    }
    if (confirmEmail) {
      const hint = typeof result.email_hint === "string" ? result.email_hint.trim() : "";
      confirmEmail.textContent = hint || "the email on your listing";
    }
    if (confirmSend) {
      // Secondary "just claim free" link. If email is missing, fall back to
      // the form below where they can type one manually.
      confirmSend.textContent = result.has_email
        ? "Just claim free basic controls →"
        : "No email on file — use form below";
    }
    if (confirmTrial) {
      // Primary "Start trial" button. Only usable if we have an on-file
      // email to pre-fill Stripe with and send the activation link to.
      confirmTrial.disabled = !result.has_email;
      if (!result.has_email) {
        confirmTrial.textContent = "No email on file — use form below";
      } else {
        confirmTrial.textContent = "Start 14-day free trial — $0 today";
      }
    }
    setConfirmStatus("", "");
    confirmPanel.hidden = false;
    // Keep the form visible so picked name/license stay populated as a reference.
    form.hidden = false;
  }

  function hideConfirmPanel() {
    pickedResult = null;
    if (confirmPanel) {
      confirmPanel.hidden = true;
      setConfirmStatus("", "");
    }
    form.hidden = false;
  }

  function applyPickedResult(result) {
    trackFunnelEvent("claim_listing_picked", {
      therapist_slug: result && result.slug,
      has_email: Boolean(result && result.has_email),
      claim_status: (result && result.claim_status) || "unclaimed",
    });
    clearSearchResults(searchResults);
    if (searchInput) {
      searchInput.value = result.name || "";
    }
    if (fullNameInput) {
      fullNameInput.value = result.name || "";
    }
    if (licenseInput) {
      licenseInput.value = result.license_number || "";
    }
    setEmailHint(emailHint, result.email_hint || "");
    if (result.has_email && confirmPanel) {
      showConfirmPanel(result);
    } else {
      hideConfirmPanel();
      if (emailInput) {
        emailInput.focus();
      }
    }
  }

  async function handleConfirmSend(event) {
    // claimConfirmSend is an <a> now — intercept navigation.
    if (event && typeof event.preventDefault === "function") {
      event.preventDefault();
    }
    if (!pickedResult || !pickedResult.slug || !confirmSend) {
      return;
    }
    const originalLabel = confirmSend.textContent;
    confirmSend.textContent = "Sending...";
    confirmSend.setAttribute("aria-disabled", "true");
    setConfirmStatus("", "");
    hideResend();
    try {
      const result = await sendClaimLinkToSlug(pickedResult.slug);
      const hint = (result && result.email_hint) || pickedResult.email_hint || "your inbox";
      setConfirmStatus(
        "success",
        "<strong>Link sent.</strong> Check " +
          escapeHtml(hint) +
          " for your one-time sign-in link.",
      );
      trackFunnelEvent("quick_claim_sent", {
        therapist_slug: pickedResult.slug,
        method: "slug_picked",
      });
      lastSend = { kind: "slug", slug: pickedResult.slug, target: "confirm" };
      showResend("confirm");
      const trialSlug = (result && result.therapist_slug) || pickedResult.slug;
      const trialEmailHint = (result && result.email_hint) || pickedResult.email_hint || "";
      if (trialSlug) {
        showTrialOffer(trialSlug, trialEmailHint);
      }
    } catch (error) {
      const reason = (error && error.payload && error.payload.reason) || "";
      confirmSend.removeAttribute("aria-disabled");
      confirmSend.textContent = originalLabel;
      if (reason === "no_email_on_file") {
        setConfirmStatus(
          "warn",
          "No email is on file for this profile. Use the form below to verify ownership another way.",
        );
        hideConfirmPanel();
        if (emailInput) {
          emailInput.focus();
        }
      } else {
        setConfirmStatus(
          "warn",
          (error && error.message) || "We couldn't send the link. Try again in a moment.",
        );
      }
    }
  }

  // One-click trial path: POST /portal/claim-trial fires both the
  // activation magic link AND creates a Stripe Checkout session. On
  // success we redirect directly to Stripe. The user returns to the
  // portal post-payment with the activation email waiting.
  async function handleStartTrial() {
    if (!pickedResult || !pickedResult.slug || !confirmTrial) {
      return;
    }
    if (confirmTrial.disabled) {
      return;
    }
    const originalLabel = confirmTrial.textContent;
    confirmTrial.disabled = true;
    confirmTrial.textContent = "Opening secure checkout...";
    setConfirmStatus("", "");
    try {
      trackFunnelEvent("claim_trial_clicked", {
        therapist_slug: pickedResult.slug,
      });
      const result = await startClaimTrial({ slug: pickedResult.slug });
      if (result && result.stripe_url) {
        trackFunnelEvent("claim_trial_checkout_opened", {
          therapist_slug: result.therapist_slug || pickedResult.slug,
        });
        window.location.href = result.stripe_url;
        return;
      }
      throw new Error("No checkout URL returned.");
    } catch (error) {
      const reason = (error && error.payload && error.payload.reason) || "";
      confirmTrial.disabled = false;
      confirmTrial.textContent = originalLabel;
      if (reason === "no_email_on_file") {
        setConfirmStatus(
          "warn",
          "No email is on file for this profile. Use the form below to claim with a different email.",
        );
      } else {
        setConfirmStatus(
          "warn",
          (error && error.message) || "We couldn't start your trial. Try again in a moment.",
        );
      }
    }
  }

  if (confirmTrial) {
    confirmTrial.addEventListener("click", handleStartTrial);
  }
  if (confirmSend) {
    confirmSend.addEventListener("click", handleConfirmSend);
  }
  if (confirmChange) {
    confirmChange.addEventListener("click", function (event) {
      event.preventDefault();
      hideConfirmPanel();
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
    });
  }
  if (confirmUseOther) {
    confirmUseOther.addEventListener("click", function (event) {
      event.preventDefault();
      hideConfirmPanel();
      if (emailInput) {
        emailInput.focus();
      }
    });
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
    hideResend();

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
      const verifiedByDomain = result && result.verification_method === "email_domain_match";
      setStatus(
        status,
        "success",
        "Check your inbox.",
        verifiedByDomain
          ? "Your email matched your practice website's domain, so we verified ownership automatically and sent a one-time sign-in link."
          : "We sent a one-time link that signs you into your profile for the next 24 hours.",
      );
      lastSend = { kind: "quick", payload: { ...payload }, target: "quick" };
      showResend("quick");
      const slugForTrial = result && result.therapist_slug ? result.therapist_slug : "";
      if (slugForTrial) {
        showTrialOffer(slugForTrial, payload.email);
      } else {
        hideTrialOffer();
      }
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

  [TRIAL_FOUNDING_ID, TRIAL_STANDARD_ID].forEach(function (id) {
    const button = document.getElementById(id);
    if (button) {
      button.addEventListener("click", function () {
        handleTrialCheckout(button);
      });
    }
  });

  const trialOfferEl = document.getElementById(TRIAL_OFFER_ID);
  if (trialOfferEl) {
    trialOfferEl.addEventListener("click", function (event) {
      const button = event.target.closest(".claim-trial-cta[data-plan]");
      if (!button || !trialOfferEl.contains(button)) {
        return;
      }
      if (button.id === TRIAL_FOUNDING_ID || button.id === TRIAL_STANDARD_ID) {
        return;
      }
      event.preventDefault();
      handleTrialCheckout(button);
    });
  }

  const dismissLink = document.getElementById(TRIAL_DISMISS_ID);
  if (dismissLink) {
    dismissLink.addEventListener("click", function (event) {
      event.preventDefault();
      hideTrialOffer();
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initQuickClaim);
} else {
  initQuickClaim();
}
