const THERAPIST_SESSION_HINT_KEY = "bt_therapist_session_hint_v1";

function hasTherapistSessionHint() {
  try {
    return Boolean(window.localStorage.getItem(THERAPIST_SESSION_HINT_KEY));
  } catch (_error) {
    return false;
  }
}

async function sendClaimLinkToSlug(slug) {
  const response = await fetch("/api/review/portal/claim-by-slug", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ slug: slug }),
  });
  if (!response.ok) {
    throw new Error("Resend failed.");
  }
}

function hideElement(id) {
  const element = document.getElementById(id);
  if (element) {
    element.hidden = true;
  }
}

function bindDismiss(id, targetId) {
  const button = document.getElementById(id);
  if (!button) {
    return;
  }
  button.addEventListener("click", function () {
    hideElement(targetId);
  });
}

function showStripeSuccessBanner(params, slug) {
  if (params.get("stripe") !== "success") {
    return;
  }

  const bannerId = hasTherapistSessionHint() ? "checkoutSuccessClaimed" : "checkoutSuccess";
  const banner = document.getElementById(bannerId);
  if (banner) {
    banner.hidden = false;
    banner.dataset.slug = slug;
  }

  params.delete("stripe");
  params.delete("session_id");
  const clean =
    window.location.pathname +
    (params.toString() ? "?" + params.toString() : "") +
    window.location.hash;
  window.history.replaceState({}, "", clean);
}

function bindResend(slug) {
  const resend = document.getElementById("checkoutSuccessResend");
  if (!resend) {
    return;
  }

  resend.addEventListener("click", async function () {
    const banner = document.getElementById("checkoutSuccess");
    const resendSlug = (banner && banner.dataset && banner.dataset.slug) || slug;
    const status = document.getElementById("checkoutSuccessResendStatus");
    if (!resendSlug) {
      if (status) status.textContent = "No listing to resend for.";
      return;
    }

    resend.disabled = true;
    const original = resend.textContent;
    resend.textContent = "Sending...";
    if (status) status.textContent = "";

    try {
      await sendClaimLinkToSlug(resendSlug);
      resend.textContent = "Sent";
      if (status) status.textContent = "Check your inbox in a minute.";
    } catch (_error) {
      resend.disabled = false;
      resend.textContent = original;
      if (status) status.textContent = "Couldn't resend. Try again shortly.";
    }
  });
}

try {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get("slug") || "";
  showStripeSuccessBanner(params, slug);
  bindDismiss("checkoutSuccessDismiss", "checkoutSuccess");
  bindDismiss("checkoutSuccessClaimedDismiss", "checkoutSuccessClaimed");
  bindResend(slug);
} catch (_error) {
  // Checkout return banners are convenience UI and must not block portal load.
}
