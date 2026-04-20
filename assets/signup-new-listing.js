// Client-side wiring for the short-form "list my practice" intake on
// /signup. Five fields: full_name, email, license_number, zip,
// treats_bipolar (checkbox). Posts to /applications/intake which
// creates a minimal therapistApplication in the review queue.
//
// Keeps the handler simple: inline validation on submit, optimistic
// button label swap, clear success / error states. Does not try to
// verify the CA license on the client — server does that asynchronously
// against the DCA API after the application is created.

import { trackFunnelEvent } from "./funnel-analytics.js";

const INTAKE_ENDPOINT = "/api/review/applications/intake";

function parseZip(raw) {
  const match = String(raw || "").match(/\d{5}/);
  return match ? match[0] : "";
}

function setStatus(node, message, tone) {
  if (!node) return;
  node.hidden = !message;
  node.textContent = message || "";
  node.classList.remove("is-success", "is-error");
  if (tone === "success") node.classList.add("is-success");
  if (tone === "error") node.classList.add("is-error");
}

async function submitIntake(form, status) {
  const treatsBipolar = Boolean(
    form.elements.treats_bipolar && form.elements.treats_bipolar.checked,
  );
  const fullName = form.elements.full_name.value.trim();
  const email = form.elements.email.value.trim();
  const licenseNumber = form.elements.license_number.value.trim();
  const zipRaw = form.elements.zip.value.trim();
  const zip = parseZip(zipRaw);

  trackFunnelEvent("signup_new_listing_submit_attempted", {
    has_all_fields: Boolean(fullName && email && licenseNumber && zip),
    treats_bipolar_checked: treatsBipolar,
  });

  if (!fullName || !email || !licenseNumber || !zipRaw) {
    setStatus(status, "Fill in all four fields above before submitting.", "error");
    return;
  }
  if (!zip) {
    setStatus(status, "Enter a valid 5-digit ZIP code for your practice.", "error");
    return;
  }
  if (!treatsBipolar) {
    setStatus(
      status,
      "Please confirm you're a CA-licensed clinician who treats bipolar disorder. We review every application individually.",
      "error",
    );
    return;
  }

  const payload = {
    name: fullName,
    email,
    license_number: licenseNumber,
    license_state: "CA",
    state: "CA",
    zip,
    treats_bipolar: true,
    intake_source: "signup_short_form",
  };

  const submit = form.querySelector('button[type="submit"]');
  const priorLabel = submit ? submit.textContent : "";
  if (submit) {
    submit.disabled = true;
    submit.textContent = "Submitting...";
  }
  setStatus(status, "", null);

  try {
    const response = await fetch(INTAKE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (response.status === 409) {
      let data = {};
      try {
        data = await response.json();
      } catch (_error) {
        /* ignore */
      }
      if (data && data.recommended_intake_type === "claim_existing" && data.duplicate_slug) {
        trackFunnelEvent("signup_duplicate_redirect_to_claim", {
          duplicate_slug: data.duplicate_slug,
        });
        setStatus(
          status,
          "Looks like you're already listed. Taking you to claim your profile...",
          "success",
        );
        const target = "/claim?slug=" + encodeURIComponent(data.duplicate_slug);
        window.setTimeout(function () {
          window.location.href = target;
        }, 900);
        return;
      }
      const msg =
        (data && data.error) ||
        "A record for this therapist already exists. Try the claim flow instead.";
      setStatus(status, msg, "error");
      return;
    }
    if (!response.ok) {
      let data = {};
      try {
        data = await response.json();
      } catch (_error) {
        /* ignore */
      }
      setStatus(
        status,
        (data && data.error) ||
          "We couldn't submit your application. Double-check the fields and try again.",
        "error",
      );
      return;
    }
    setStatus(
      status,
      "Got it. We'll review your application and email you at " +
        email +
        " within 2-3 business days. No action needed until then.",
      "success",
    );
    trackFunnelEvent("signup_new_listing_submitted", {
      zip: zip || null,
    });
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

function bindIntakeForm() {
  const form = document.getElementById("newListingForm");
  if (!form) return;
  trackFunnelEvent("signup_page_viewed", {});
  const status = document.getElementById("newListingStatus");
  let firstInputTracked = false;
  form.addEventListener("input", function () {
    if (!firstInputTracked) {
      firstInputTracked = true;
      trackFunnelEvent("signup_new_listing_form_started", {});
    }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitIntake(form, status);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bindIntakeForm);
} else {
  bindIntakeForm();
}

// Exported for tests.
export { parseZip, submitIntake };
