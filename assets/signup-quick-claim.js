import {
  createStripeFeaturedCheckoutSession,
  lookupTherapistBySlug,
  requestAccountRecovery,
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

  // Deep-link auto-pick. Two URL params trigger this:
  //   ?slug=X  — signup search result click, directory "claim this
  //              listing" banner, outbound email CTAs
  //   ?confirm=X — legacy path from older therapist-profile links
  //
  // If either is present, fetch the therapist server-side and call
  // applyPickedResult directly — skipping the search step entirely.
  // Falls back silently to the search UI if the lookup fails.
  async function autoPickFromQueryParam() {
    try {
      const params = new URLSearchParams(window.location.search);
      const directSlug = (params.get("slug") || params.get("confirm") || "").trim();
      if (!directSlug) {
        return;
      }
      trackFunnelEvent("claim_deep_link_opened", { therapist_slug: directSlug });
      const response = await lookupTherapistBySlug(directSlug);
      const result = response && response.result;
      if (result && result.slug) {
        applyPickedResult(result);
        return;
      }
      // Not found — leave the search UI free for the user to find themselves.
      if (searchInput && !searchInput.value) {
        const namePart = directSlug.split("-").filter(Boolean).slice(0, 2).join(" ");
        if (namePart) {
          searchInput.value = namePart;
        }
      }
    } catch (_error) {
      // Best-effort — fall back to search UI.
    }
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

  // Trust signals — rendered above the "We'll email your activation
  // link to X" line in the confirm panel. Currently just DCA license
  // verification; can extend to "X of 50 founding spots left" or
  // "claimed by N this week" later without changing the call site.
  function renderTrustSignals(result) {
    const signals = document.getElementById("claimTrustSignals");
    if (!signals) {
      return;
    }
    const items = [];
    if (result && result.license_verified_current) {
      const licType = (result.credentials || "").trim();
      const licLabel = licType
        ? `CA ${escapeHtml(licType)} license verified by the Board`
        : "CA license verified by the Board";
      items.push(licLabel);
    }
    if (!items.length) {
      signals.hidden = true;
      signals.innerHTML = "";
      return;
    }
    signals.hidden = false;
    signals.innerHTML = items.map((text) => `<li>${text}</li>`).join("");
  }

  function showConfirmPanel(result) {
    pickedResult = result;
    if (!confirmPanel) {
      return;
    }

    // Already-claimed profiles get a re-entry skin: different heading,
    // different primary CTA, no trial offer (they can't restart one),
    // and a "Not you?" dispute link. Everything else stays wired so
    // the same endpoints work for both new claims and re-entries.
    const isAlreadyClaimed = result && result.claim_status === "claimed";

    if (confirmName) {
      const credentialBit = result.credentials ? ", " + result.credentials : "";
      confirmName.textContent = (result.name || "") + credentialBit;
    }
    if (confirmMeta) {
      const location = [result.city, result.state].filter(Boolean).join(", ");
      const licenseBit = result.license_number ? " · License " + result.license_number : "";
      confirmMeta.textContent = location + licenseBit;
    }

    const confirmLabel = document.getElementById("claimConfirmLabel");
    const confirmDestination = document.getElementById("claimConfirmDestination");
    const trialSubhint = document.getElementById("claimTrialSubhint");
    const disputeWrap = document.getElementById("claimConfirmDisputeWrap");

    if (confirmLabel) {
      confirmLabel.textContent = isAlreadyClaimed
        ? "This profile is already claimed"
        : "Found your listing";
    }
    if (confirmEmail) {
      const rawHint =
        typeof result.email_hint === "string"
          ? result.email_hint.trim()
          : result.email_hint
            ? String(result.email_hint).trim()
            : "";
      confirmEmail.textContent = rawHint || "the email on your listing";
    }
    if (confirmDestination) {
      // Re-frame the destination copy for re-entry. The <strong
      // id="claimConfirmEmail"> child is replaced on each render, so
      // rebuild the sentence and re-insert the hint span.
      const hintText = confirmEmail ? confirmEmail.textContent : "the email on your listing";
      if (!result.has_email) {
        // No email on file → email-based activation is impossible.
        // Route the therapist through identity verification instead of
        // promising a link we can't send.
        confirmDestination.innerHTML =
          "No email is on file for this listing, so we can't send an activation link. " +
          "Verify your identity against your CA license to claim it.";
      } else if (isAlreadyClaimed) {
        confirmDestination.innerHTML =
          "If that's you, we'll send a fresh sign-in link to <strong id=\"claimConfirmEmail\">" +
          escapeHtml(hintText) +
          "</strong> so you can get back into your portal.";
      } else {
        confirmDestination.innerHTML =
          'We\'ll email your activation link to <strong id="claimConfirmEmail">' +
          escapeHtml(hintText) +
          "</strong>.";
      }
    }

    renderTrustSignals(result);

    if (confirmSend) {
      if (!result.has_email) {
        // No-email case: confirmSend becomes the primary identity-
        // verification CTA. handleConfirmSend detects has_email=false
        // and routes to the recovery modal instead of the email API.
        confirmSend.textContent = "Verify your identity to claim →";
      } else if (isAlreadyClaimed) {
        // Re-entry mode: the "Just claim" link becomes the primary path
        // since the trial button is hidden.
        confirmSend.textContent = "Email me a sign-in link";
      } else {
        confirmSend.textContent = "Just claim free basic controls →";
      }
    }
    if (confirmTrial) {
      // Hide the trial button for already-claimed profiles (can't
      // restart a trial) and for no-email profiles (can't activate
      // until identity is verified — trial would be a dead button).
      confirmTrial.hidden = isAlreadyClaimed || !result.has_email;
      if (!confirmTrial.hidden) {
        confirmTrial.disabled = false;
        confirmTrial.textContent = "Start 14-day free trial — $0 today";
      }
    }
    if (trialSubhint) {
      trialSubhint.hidden = isAlreadyClaimed || !result.has_email;
    }
    const recoveryLink = document.getElementById("claimConfirmRequestRecovery");
    if (recoveryLink && recoveryLink.parentElement) {
      // Hide the tertiary recovery link when it would duplicate the
      // primary CTA (no-email case already routes through recovery).
      recoveryLink.parentElement.hidden = !result.has_email;
    }
    if (disputeWrap) {
      // Dispute link surfaces only in re-entry mode so non-owners have
      // a route and legitimate owners aren't distracted by it.
      disputeWrap.hidden = !isAlreadyClaimed;
    }

    setConfirmStatus("", "");
    confirmPanel.hidden = false;
    form.hidden = true;
  }

  function hideConfirmPanel() {
    pickedResult = null;
    if (confirmPanel) {
      confirmPanel.hidden = true;
      setConfirmStatus("", "");
    }
    form.hidden = false;
  }

  // Updates the fallback form's email-section copy based on why the
  // user is seeing the form:
  //   "on_file_missing" → no email on file at all for this listing
  //   "default"         → generic fallback (license-based quick claim)
  //
  // The "use_different" mode was removed when the self-service
  // different-email path was killed — all email changes now flow
  // through the admin-reviewed recovery queue (see openRecoveryModal).
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
        ".</strong> Enter the email you want to use.";
      emailLabel.textContent = "Your email address";
    } else {
      banner.hidden = true;
      banner.innerHTML = "";
      emailLabel.textContent = "Email on your current listing";
    }
  }

  // Pre-fill + open the recovery modal when the user clicks
  // "Can't access the email on file? Request account recovery".
  // Uses the already-picked listing (pickedResult) to seed name +
  // license so the therapist only has to type their new email + reason.
  function openRecoveryModal(fromResult) {
    const modal = document.getElementById("claimRecoveryModal");
    if (!modal) return;
    const name = fromResult && fromResult.name ? String(fromResult.name) : "";
    const license =
      fromResult && fromResult.license_number ? String(fromResult.license_number) : "";
    const nameField = document.getElementById("claimRecoveryFullName");
    const licenseField = document.getElementById("claimRecoveryLicense");
    const statusBox = document.getElementById("claimRecoveryStatus");
    if (nameField) nameField.value = name;
    if (licenseField) licenseField.value = license;
    if (statusBox) {
      statusBox.hidden = true;
      statusBox.textContent = "";
    }
    modal.hidden = false;
    // Focus the first empty field so keyboard users can start typing.
    const firstEmpty = modal.querySelector("input:not([value])");
    const requestedEmailField = document.getElementById("claimRecoveryRequestedEmail");
    (firstEmpty || requestedEmailField || nameField || licenseField || null)?.focus();
    trackFunnelEvent("claim_recovery_opened", {
      therapist_slug: fromResult && fromResult.slug,
    });
  }

  function closeRecoveryModal() {
    const modal = document.getElementById("claimRecoveryModal");
    if (modal) modal.hidden = true;
  }

  function initRecoveryModal() {
    const modal = document.getElementById("claimRecoveryModal");
    if (!modal) return;
    const form = document.getElementById("claimRecoveryForm");
    const submit = document.getElementById("claimRecoverySubmit");
    const statusBox = document.getElementById("claimRecoveryStatus");
    const closeBtn = document.getElementById("claimRecoveryClose");
    const backdrop = document.getElementById("claimRecoveryBackdrop");

    if (closeBtn) closeBtn.addEventListener("click", closeRecoveryModal);
    if (backdrop) backdrop.addEventListener("click", closeRecoveryModal);
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !modal.hidden) closeRecoveryModal();
    });

    if (!form) return;
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      const formData = new FormData(form);
      const payload = {
        full_name: String(formData.get("full_name") || "").trim(),
        license_number: String(formData.get("license_number") || "").trim(),
        requested_email: String(formData.get("requested_email") || "").trim(),
        prior_email: String(formData.get("prior_email") || "").trim(),
      };
      if (!payload.full_name || !payload.license_number || !payload.requested_email) {
        if (statusBox) {
          statusBox.hidden = false;
          statusBox.setAttribute("data-tone", "warn");
          statusBox.textContent = "Name, license, and recovery email are all required.";
        }
        return;
      }
      if (submit) {
        submit.disabled = true;
        submit.textContent = "Sending...";
      }
      try {
        const result = await requestAccountRecovery(payload);
        if (statusBox) {
          statusBox.hidden = false;
          statusBox.setAttribute("data-tone", "success");
          statusBox.innerHTML =
            "<strong>Got it.</strong> Check your inbox for a confirmation. We'll email a verified decision within one business day.";
        }
        trackFunnelEvent("claim_recovery_submitted", {
          therapist_slug: pickedResult && pickedResult.slug,
          id: result && result.id,
        });
        form.reset();
        if (submit) {
          submit.textContent = "Request sent";
        }
      } catch (error) {
        if (statusBox) {
          statusBox.hidden = false;
          statusBox.setAttribute("data-tone", "warn");
          statusBox.textContent =
            (error && error.message) ||
            "We couldn't submit your request. Please try again or email us directly.";
        }
        if (submit) {
          submit.disabled = false;
          submit.textContent = "Send recovery request";
        }
      }
    });
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
      setFormMode("default", result);
      showConfirmPanel(result);
    } else {
      // No on-file email — show the form with a clear banner so the
      // user understands why they're being asked to type an email.
      setFormMode("on_file_missing", result);
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
    // No email on file → can't send an activation link. Route to the
    // identity-verification flow (recovery queue) as the primary path.
    if (!pickedResult.has_email) {
      openRecoveryModal(pickedResult);
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
  const disputeLink = document.getElementById("claimConfirmDispute");
  if (disputeLink) {
    disputeLink.addEventListener("click", function () {
      // Don't preventDefault — the mailto: should actually open. Just
      // log the event so admin can see how often non-owners bounce
      // into this flow.
      trackFunnelEvent("claim_dispute_clicked", {
        therapist_slug: pickedResult && pickedResult.slug,
      });
    });
  }
  // "Request account recovery" replaces the old "Use a different email"
  // path. Opens a modal that files a therapistRecoveryRequest doc for
  // admin to review manually. We removed the self-service "type any
  // email" path because it had a social-engineering hole — anyone
  // controlling a domain listed on a therapist profile could take it
  // over. All email changes now flow through human verification.
  const requestRecoveryLink = document.getElementById("claimConfirmRequestRecovery");
  if (requestRecoveryLink) {
    requestRecoveryLink.addEventListener("click", function (event) {
      event.preventDefault();
      openRecoveryModal(pickedResult);
    });
  }

  initRecoveryModal();

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

  // Kick off deep-link auto-pick after applyPickedResult and search
  // handlers are wired up. Runs async — best-effort, no blocking.
  autoPickFromQueryParam();

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
      const verificationMethod = (result && result.verification_method) || "";
      const verifiedByDomain = verificationMethod === "email_domain_match";
      const manualReview = verificationMethod === "manual_review";
      if (manualReview) {
        setStatus(
          status,
          "info",
          "Sent to manual review.",
          "We couldn't auto-verify your email against the listed practice website, so a human will check it. Watch for a confirmation email — we'll email a decision within one business day.",
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
            ? "Your email matched your practice website's domain, so we verified ownership automatically and sent a one-time sign-in link."
            : "We sent a one-time link that signs you into your profile for the next 24 hours.",
        );
      }
      lastSend = { kind: "quick", payload: { ...payload }, target: "quick" };
      if (!manualReview) {
        showResend("quick");
      }
      const slugForTrial = result && result.therapist_slug ? result.therapist_slug : "";
      if (slugForTrial && !manualReview) {
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
