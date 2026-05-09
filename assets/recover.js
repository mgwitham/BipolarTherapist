import "./sentry-init.js";
import { requestAccountRecovery } from "./review-api.js";
import { trackFunnelEvent } from "./funnel-analytics.js";
import { escapeHtml } from "./escape-html.js";

function showStatus(el, tone, html) {
  if (!el) return;
  el.hidden = false;
  el.dataset.tone = tone;
  el.innerHTML = html;
}

function clearStatus(el) {
  if (!el) return;
  el.hidden = true;
  el.innerHTML = "";
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

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    clearStatus(status);

    const payload = {
      full_name: (form.elements.full_name?.value || "").trim(),
      license_number: (form.elements.license_number?.value || "").trim(),
      requested_email: (form.elements.requested_email?.value || "").trim(),
      prior_email: (form.elements.prior_email?.value || "").trim(),
    };

    if (!payload.full_name || !payload.license_number || !payload.requested_email) {
      showStatus(status, "warn", "Name, license, and recovery email are all required.");
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
        "<strong>Recovery request received.</strong> We'll review it and email next steps within one business day.",
      );
      trackFunnelEvent("recovery_form_submitted", { id: result && result.id });
      form.reset();
      if (submit) submit.textContent = "Request sent";
    } catch (error) {
      showStatus(
        status,
        "warn",
        escapeHtml(
          (error && error.message) ||
            "We couldn't submit your request. Please try again or email us directly.",
        ),
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
