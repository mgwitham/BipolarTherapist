import "./sentry-init.js";
import { requestAccountRecovery } from "./review-api.js";
import { trackFunnelEvent } from "./funnel-analytics.js";
import { mountTurnstile } from "./turnstile-widget.js";

let turnstileHandle = null;

function isLikelyEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function showStatus(el, tone, title, body) {
  if (!el) return;
  el.hidden = false;
  el.dataset.tone = tone;
  el.textContent = "";
  if (title) {
    const strong = document.createElement("strong");
    strong.textContent = title;
    el.appendChild(strong);
  }
  if (body) {
    if (title) el.appendChild(document.createTextNode(" "));
    el.appendChild(document.createTextNode(body));
  }
}

function clearStatus(el) {
  if (!el) return;
  el.hidden = true;
  el.textContent = "";
  delete el.dataset.tone;
}

function initRecoverPage() {
  trackFunnelEvent("recovery_page_viewed", {});

  // Pre-fill from URL params (?name=X&license=Y) passed from claim.html
  const params = new URLSearchParams(window.location.search);
  const nameEl = document.getElementById("recoverFullName");
  const licenseEl = document.getElementById("recoverLicense");
  if (nameEl && params.get("name")) nameEl.value = params.get("name");
  if (licenseEl && params.get("license")) licenseEl.value = params.get("license");

  // Focus the first empty required field
  const requestedEmailEl = document.getElementById("recoverRequestedEmail");
  const firstEmpty = [nameEl, licenseEl, requestedEmailEl].find((el) => el && !el.value);
  (firstEmpty || requestedEmailEl || nameEl)?.focus();

  const form = document.getElementById("recoverForm");
  if (!form) return;

  const submit = document.getElementById("recoverSubmit");
  const status = document.getElementById("recoverStatus");

  const turnstileContainer = document.createElement("div");
  turnstileContainer.className = "turnstile-container";
  if (submit && submit.parentNode) {
    submit.parentNode.insertBefore(turnstileContainer, submit);
  } else {
    form.appendChild(turnstileContainer);
  }
  mountTurnstile(turnstileContainer).then((handle) => {
    turnstileHandle = handle;
  });

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    clearStatus(status);

    const payload = {
      full_name: (form.elements.full_name?.value || "").trim(),
      license_number: (form.elements.license_number?.value || "").trim(),
      requested_email: (form.elements.requested_email?.value || "").trim(),
      prior_email: (form.elements.prior_email?.value || "").trim(),
      turnstile_token:
        turnstileHandle && turnstileHandle.getToken ? turnstileHandle.getToken() : null,
    };

    if (!payload.full_name || !payload.license_number || !payload.requested_email) {
      showStatus(status, "warn", "Name, license, and recovery email are all required.");
      return;
    }

    if (!isLikelyEmail(payload.requested_email)) {
      showStatus(status, "warn", "Enter a valid recovery email address.");
      return;
    }

    if (submit) {
      submit.disabled = true;
      submit.textContent = "Sending...";
    }

    try {
      const result = await requestAccountRecovery(payload);
      showStatus(
        status,
        "success",
        "Recovery request received.",
        "We'll review it and email next steps within one business day.",
      );
      trackFunnelEvent("recovery_form_submitted", { id: result && result.id });
      form.reset();
      if (submit) submit.textContent = "Request sent";
    } catch (error) {
      const status403 =
        error && (error.status === 403 || /verification/i.test(error.message || ""));
      if (status403 && turnstileHandle && turnstileHandle.reset) turnstileHandle.reset();
      showStatus(
        status,
        "warn",
        "",
        (error && error.message) ||
          "We couldn't submit your request. Please try again or email us directly.",
      );
      if (submit) {
        submit.disabled = false;
        submit.textContent = "Send recovery request";
      }
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initRecoverPage);
} else {
  initRecoverPage();
}
