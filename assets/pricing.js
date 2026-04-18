import "./funnel-analytics.js";
import { fetchFoundingSpotsRemaining } from "./cms.js";
import { createStripeFeaturedCheckoutSession } from "./review-api.js";
import { trackFunnelEvent } from "./funnel-analytics.js";

var PRICE_DISPLAY = {
  founding_monthly: { amount: "$19", unit: "/ month" },
  founding_annual: { amount: "$190", unit: "/ year" },
  regular_monthly: { amount: "$39", unit: "/ month" },
  regular_annual: { amount: "$390", unit: "/ year" },
};

var params = new URLSearchParams(window.location.search);
var slug = (params.get("slug") || "").trim();
var email = (params.get("email") || "").trim();
var currentInterval = "month";
var foundingSpotsState = null;

function setActiveInterval(interval) {
  currentInterval = interval === "year" ? "year" : "month";
  var toggles = document.querySelectorAll(".pricing-toggle button");
  toggles.forEach(function (button) {
    if (button.getAttribute("data-interval") === currentInterval) {
      button.classList.add("is-active");
    } else {
      button.classList.remove("is-active");
    }
  });

  var foundingPlan = currentInterval === "year" ? "founding_annual" : "founding_monthly";
  var regularPlan = currentInterval === "year" ? "regular_annual" : "regular_monthly";

  var foundingPrice = document.querySelector("[data-founding-price]");
  var foundingUnit = document.querySelector("[data-founding-unit]");
  var regularPrice = document.querySelector("[data-regular-price]");
  var regularUnit = document.querySelector("[data-regular-unit]");
  if (foundingPrice) {
    foundingPrice.textContent = PRICE_DISPLAY[foundingPlan].amount;
  }
  if (foundingUnit) {
    foundingUnit.textContent = PRICE_DISPLAY[foundingPlan].unit;
  }
  if (regularPrice) {
    regularPrice.textContent = PRICE_DISPLAY[regularPlan].amount;
  }
  if (regularUnit) {
    regularUnit.textContent = PRICE_DISPLAY[regularPlan].unit;
  }

  var foundingCta = document.querySelector("[data-founding-cta]");
  var regularCta = document.querySelector("[data-regular-cta]");
  if (foundingCta) {
    foundingCta.setAttribute("data-checkout-plan", foundingPlan);
  }
  if (regularCta) {
    regularCta.setAttribute("data-checkout-plan", regularPlan);
  }
}

function updateFoundingAvailability(spots) {
  foundingSpotsState = spots || null;
  var label = document.querySelector("[data-founding-spots]");
  var cta = document.querySelector("[data-founding-cta]");
  var card = document.querySelector('[data-plan-card="founding"]');
  if (!label) {
    return;
  }
  if (!spots) {
    label.textContent = "Spots available.";
    return;
  }
  if (spots.remaining <= 0) {
    label.textContent = "Founding rate is fully claimed. Standard rate applies.";
    if (cta) {
      cta.disabled = true;
      cta.textContent = "Founding spots full";
    }
    if (card) {
      card.style.opacity = "0.55";
    }
    return;
  }
  label.textContent =
    spots.remaining + " of " + spots.cap + " founding spots left. Lock your rate for 24 months.";
}

async function loadFoundingSpots() {
  try {
    var result = await fetchFoundingSpotsRemaining();
    updateFoundingAvailability(result);
  } catch (_error) {
    updateFoundingAvailability(null);
  }
}

function showFeedback(tier, message) {
  var node = document.querySelector('[data-feedback="' + tier + '"]');
  if (node) {
    node.textContent = message || "";
  }
}

async function handleCheckoutClick(event) {
  var button = event.currentTarget;
  var plan = button.getAttribute("data-checkout-plan") || "";
  var tier = plan.indexOf("founding") === 0 ? "founding" : "regular";
  if (!slug) {
    showFeedback(tier, "Claim your profile first so we know who the subscription is for.");
    return;
  }
  if (!plan) {
    return;
  }
  if (
    tier === "founding" &&
    foundingSpotsState &&
    Number.isFinite(foundingSpotsState.remaining) &&
    foundingSpotsState.remaining <= 0
  ) {
    showFeedback(tier, "Founding spots are full. Try the standard rate.");
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
    interval: currentInterval,
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
  var toggleButtons = document.querySelectorAll(".pricing-toggle button");
  toggleButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      setActiveInterval(button.getAttribute("data-interval") || "month");
    });
  });
  var ctas = document.querySelectorAll("[data-checkout-plan]");
  ctas.forEach(function (button) {
    button.addEventListener("click", handleCheckoutClick);
  });
}

(function init() {
  setActiveInterval("month");
  bind();
  trackFunnelEvent("pricing_page_viewed", {
    therapist_slug: slug || "",
  });
  loadFoundingSpots();
})();
