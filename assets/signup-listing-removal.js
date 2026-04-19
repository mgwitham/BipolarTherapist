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
    bindRemovalForm();
  });
} else {
  renderToast();
  bindRemovalForm();
}

// Exported for tests / future reuse.
export { escapeHtml, submitRemovalRequest };
