import "./funnel-analytics.js";
import { createStripeFeaturedCheckoutSession } from "./review-api.js";
import { trackFunnelEvent } from "./funnel-analytics.js";

var params = new URLSearchParams(window.location.search);
var slug = (params.get("slug") || "").trim();
var email = (params.get("email") || "").trim();

function showFeedback(tier, message) {
  var node = document.querySelector('[data-feedback="' + tier + '"]');
  if (node) {
    node.textContent = message || "";
  }
}

async function handleCheckoutClick(event) {
  var button = event.currentTarget;
  var plan = button.getAttribute("data-checkout-plan") || "";
  var tier = "paid";
  if (!slug) {
    showFeedback(tier, "Claim your profile first so we know who the subscription is for.");
    return;
  }
  if (!plan) {
    return;
  }
  button.disabled = true;
  var originalLabel = button.textContent;
  button.textContent = "Opening secure checkout...";
  showFeedback(tier, "");
  trackFunnelEvent("pricing_checkout_clicked", {
    therapist_slug: slug,
    plan,
    tier,
  });
  try {
    var result = await createStripeFeaturedCheckoutSession({
      therapist_slug: slug,
      email: email,
      plan: plan,
      return_path: "/portal.html?slug=" + encodeURIComponent(slug),
    });
    if (result && result.url) {
      window.location.href = result.url;
      return;
    }
    throw new Error("No checkout URL returned.");
  } catch (error) {
    button.disabled = false;
    button.textContent = originalLabel;
    showFeedback(
      tier,
      (error && error.message) || "We could not start checkout. Try again in a moment.",
    );
  }
}

function bind() {
  var ctas = document.querySelectorAll("[data-checkout-plan]");
  ctas.forEach(function (button) {
    button.addEventListener("click", handleCheckoutClick);
  });
}

(function init() {
  bind();
  trackFunnelEvent("pricing_page_viewed", {
    therapist_slug: slug || "",
  });
})();
