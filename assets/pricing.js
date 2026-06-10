import "./sentry-init.js";
import "./site-analytics.js";
import "./funnel-analytics.js";
import { trackFunnelEvent } from "./funnel-analytics.js";
import { safeStripeRedirectUrl } from "./safe-url.js";
import { fetchPublicTherapistCount } from "./cms.js";
import {
  createStripeBillingPortalSession,
  createStripeFeaturedCheckoutSession,
  fetchTherapistMe,
  fetchTherapistSubscription,
  getTherapistSessionToken,
} from "./review-api.js";

var searchParams = new URLSearchParams(window.location.search);
var slugParam = String(searchParams.get("slug") || "").trim();
var emailParam = String(searchParams.get("email") || "").trim();
var therapistSessionToken = getTherapistSessionToken();

var therapistCountEl = document.getElementById("pricingTherapistCount");

var freeCard = document.querySelector('[data-plan-card="free"]');
var paidCard = document.querySelector('[data-plan-card="paid"]');
var freeCta = document.getElementById("pricingFreeCta");
var paidCta = document.getElementById("pricingPaidCta");
var freeBadge = document.getElementById("pricingFreePlanBadge");
var paidBadge = document.getElementById("pricingPaidPlanBadge");
var freeState = document.getElementById("pricingFreeState");
var paidState = document.getElementById("pricingPaidState");
var paidHelper = document.getElementById("pricingPaidHelper");
var trialClarity = document.getElementById("pricingTrialClarity");
var freeFeedback = document.getElementById("pricingFreeFeedback");
var paidFeedback = document.getElementById("pricingPaidFeedback");
var previewCard = document.getElementById("pricingPreviewCard");
var freeFeatureClaim = document.getElementById("pricingFreeFeatureClaim");

var pricingState = {
  branch: therapistSessionToken ? "signed_in_loading" : "logged_out",
  therapist: null,
  subscription: null,
  freeMode: "claim",
  paidMode: "signup",
};

trackFunnelEvent("pricing_page_viewed", {
  has_session_token: Boolean(therapistSessionToken),
  source: "pricing_page",
});

function setFeedback(node, message, tone) {
  if (!node) {
    return;
  }
  node.textContent = message || "";
  if (tone) {
    node.dataset.tone = tone;
  } else {
    delete node.dataset.tone;
  }
}

function setCardCurrent(card, isCurrent) {
  if (!card) {
    return;
  }
  card.classList.toggle("is-current", Boolean(isCurrent));
}

function buildHref(path, params) {
  var query = new URLSearchParams();
  Object.keys(params || {}).forEach(function (key) {
    var value = params[key];
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, String(value));
    }
  });
  return path + (query.toString() ? "?" + query.toString() : "");
}

function buildClaimHref() {
  return buildHref("claim.html", {
    slug: slugParam || "",
    email: emailParam || "",
  });
}

function buildSignupHref() {
  return buildHref("signup.html", {
    slug: slugParam || "",
    email: emailParam || "",
  });
}

function buildPortalHref(slug) {
  return buildHref("portal.html", {
    slug: slug || slugParam || "",
  });
}

function updateCtaLink(node, label, href) {
  if (!node) {
    return;
  }
  node.textContent = label;
  node.setAttribute("href", href);
  node.removeAttribute("aria-disabled");
  node.dataset.busy = "false";
}

function setCtaBusy(node, message) {
  if (!node) {
    return;
  }
  node.dataset.busy = "true";
  node.setAttribute("aria-disabled", "true");
  node.textContent = message;
}

function applyLoggedOutState() {
  pricingState.branch = slugParam ? "logged_out_known_listing" : "logged_out";
  pricingState.freeMode = "claim";
  pricingState.paidMode = slugParam ? "claim" : "signup";

  updateCtaLink(freeCta, "Claim free listing", buildClaimHref());
  updateCtaLink(paidCta, "Start free trial", slugParam ? buildClaimHref() : buildSignupHref());

  if (freeBadge) {
    freeBadge.textContent = "Always available";
  }
  if (paidBadge) {
    paidBadge.textContent = "14-day free trial";
  }
  if (freeState) {
    freeState.textContent = "Best if you want to be listed and keep your profile current.";
  }
  if (paidState) {
    paidState.textContent =
      "Useful if you want better visibility into how patients find and contact you.";
  }
  if (paidHelper) {
    paidHelper.textContent = slugParam
      ? "We found a listing context for you, so we'll take you into the claim flow first."
      : "New to the directory? We verify your California license before you go live.";
  }
  if (trialClarity) {
    trialClarity.textContent =
      "Card required to start. No charge until day 15. Cancel anytime from your dashboard before billing begins.";
  }

  if (freeFeatureClaim) {
    freeFeatureClaim.innerHTML =
      "<strong>Claim and manage your listing</strong> from the dashboard";
  }
  setCardCurrent(freeCard, false);
  setCardCurrent(paidCard, false);
  setFeedback(freeFeedback, "", "");
  setFeedback(paidFeedback, "", "");
}

function applySignedInFreeState(me, subscription) {
  var therapist = (me && me.therapist) || {};
  var therapistSlug = therapist.slug || slugParam || "";
  pricingState.branch = "signed_in_free";
  pricingState.therapist = me;
  pricingState.subscription = subscription;
  pricingState.freeMode = "dashboard";
  pricingState.paidMode = "direct_checkout";

  updateCtaLink(freeCta, "Open dashboard", buildPortalHref(therapistSlug));
  updateCtaLink(paidCta, "Start free trial", buildPortalHref(therapistSlug));

  if (freeBadge) {
    freeBadge.textContent = "Your current plan";
  }
  if (paidBadge) {
    paidBadge.textContent = "14-day free trial";
  }
  if (freeState) {
    freeState.textContent =
      "You already have free listing controls. Stay here if listing and profile management are enough.";
  }
  if (paidState) {
    paidState.textContent =
      "Upgrade only if you want ongoing visibility into sources, contact methods, and weekly change.";
  }
  if (paidHelper) {
    paidHelper.textContent =
      "Already listed? Checkout opens directly without repeating onboarding.";
  }
  if (trialClarity) {
    trialClarity.textContent =
      "Card required to start. No charge until day 15. Cancel anytime from your dashboard before billing begins.";
  }

  if (freeFeatureClaim) {
    freeFeatureClaim.innerHTML =
      "<strong>Edit your profile details</strong> directly from your dashboard";
  }
  setCardCurrent(freeCard, true);
  setCardCurrent(paidCard, false);
  setFeedback(freeFeedback, "", "");
  setFeedback(paidFeedback, "", "");
}

function applySignedInPaidState(me, subscription) {
  var therapist = (me && me.therapist) || {};
  var therapistSlug = therapist.slug || slugParam || "";
  var isTrial = Boolean(subscription && subscription.status === "trialing");

  pricingState.branch = isTrial ? "signed_in_trial" : "signed_in_paid";
  pricingState.therapist = me;
  pricingState.subscription = subscription;
  pricingState.freeMode = "dashboard";
  pricingState.paidMode = "manage_subscription";

  updateCtaLink(freeCta, "Open dashboard", buildPortalHref(therapistSlug));
  updateCtaLink(
    paidCta,
    isTrial ? "Manage trial" : "Manage subscription",
    buildPortalHref(therapistSlug),
  );

  if (freeBadge) {
    freeBadge.textContent = "Included now";
  }
  if (paidBadge) {
    paidBadge.textContent = isTrial ? "Trial active" : "Insights active";
  }
  if (freeState) {
    freeState.textContent = "Your listing still keeps its free controls and fit-based ranking.";
  }
  if (paidState) {
    paidState.textContent = isTrial
      ? "Your Insights trial is active. Keep it, or cancel before billing begins."
      : "Your Insights plan is active. Open billing to update payment details or cancel.";
  }
  if (paidHelper) {
    paidHelper.textContent = isTrial
      ? "Your dashboard keeps the cancel path visible so you can end the trial before billing starts."
      : "Open billing to update payment details or manage cancellation.";
  }
  if (trialClarity) {
    trialClarity.textContent = isTrial
      ? "Trial active now. No charge until day 15. Cancellation stays available from your dashboard."
      : "Billing is active. You can manage or cancel the subscription from your dashboard.";
  }

  if (freeFeatureClaim) {
    freeFeatureClaim.innerHTML =
      "<strong>Edit your profile details</strong> directly from your dashboard";
  }
  setCardCurrent(freeCard, false);
  setCardCurrent(paidCard, true);
  setFeedback(freeFeedback, "", "");
  setFeedback(paidFeedback, "", "");
}

function applyResolvedBranchTracking() {
  trackFunnelEvent("pricing_branch_resolved", {
    branch: pricingState.branch,
    has_subscription: Boolean(
      pricingState.subscription && pricingState.subscription.plan !== "none",
    ),
    source: "pricing_page",
  });
}

function applyPricingState(me, subscription) {
  var hasActivePaid = Boolean(subscription && subscription.has_active_featured);
  if (me && me.therapist && hasActivePaid) {
    applySignedInPaidState(me, subscription);
  } else if (me && me.therapist) {
    applySignedInFreeState(me, subscription);
  } else {
    applyLoggedOutState();
  }
  applyResolvedBranchTracking();
}

function handleFreeCtaClick(_event) {
  trackFunnelEvent("pricing_free_cta_clicked", {
    branch: pricingState.branch,
    source: "pricing_page",
  });

  if (pricingState.freeMode === "dashboard") {
    setFeedback(freeFeedback, "Opening your dashboard...", "success");
    return;
  }

  setFeedback(freeFeedback, "Opening the free claim flow...", "success");
}

async function handleDirectCheckout(event) {
  event.preventDefault();

  var me = pricingState.therapist;
  var therapist = me && me.therapist;
  if (!therapist || !therapist.slug) {
    window.location.href = buildSignupHref();
    return;
  }

  var originalLabel = "Start free trial";
  setCtaBusy(paidCta, "Opening secure checkout...");
  setFeedback(
    paidFeedback,
    "Starting your 14-day free trial. You'll review billing in secure checkout.",
    "success",
  );

  trackFunnelEvent("pricing_paid_cta_clicked", {
    branch: pricingState.branch,
    source: "pricing_page",
  });

  try {
    var checkout = await createStripeFeaturedCheckoutSession({
      therapist_slug: therapist.slug,
      email: (me && me.session && me.session.email) || therapist.email || emailParam || "",
      plan: "paid_monthly",
      return_path: "/portal.html?slug=" + encodeURIComponent(therapist.slug),
    });
    trackFunnelEvent("pricing_checkout_clicked", {
      branch: pricingState.branch,
      source: "pricing_page",
      therapist_slug: therapist.slug,
    });
    var checkoutUrl = checkout && checkout.url ? safeStripeRedirectUrl(checkout.url) : "";
    if (checkoutUrl) {
      window.location.href = checkoutUrl;
      return;
    }
    throw new Error("No checkout URL returned.");
  } catch (error) {
    updateCtaLink(paidCta, originalLabel, buildPortalHref(therapist.slug));
    setFeedback(
      paidFeedback,
      (error && error.message) ||
        "We couldn't open checkout right now. Try again in a moment from your dashboard.",
      "error",
    );
  }
}

async function handleManageSubscription(event) {
  event.preventDefault();

  var me = pricingState.therapist;
  var therapist = me && me.therapist;
  if (!therapist || !therapist.slug) {
    window.location.href = buildPortalHref("");
    return;
  }

  var originalLabel =
    pricingState.branch === "signed_in_trial" ? "Manage trial" : "Manage subscription";
  setCtaBusy(paidCta, "Opening billing...");
  setFeedback(paidFeedback, "Opening billing and cancellation controls...", "success");

  trackFunnelEvent("pricing_paid_cta_clicked", {
    branch: pricingState.branch,
    source: "pricing_page",
  });

  try {
    var session = await createStripeBillingPortalSession({
      return_path: "/portal.html?slug=" + encodeURIComponent(therapist.slug),
    });
    var sessionUrl = session && session.url ? safeStripeRedirectUrl(session.url) : "";
    if (sessionUrl) {
      window.location.href = sessionUrl;
      return;
    }
    throw new Error("No billing portal URL returned.");
  } catch (error) {
    updateCtaLink(paidCta, originalLabel, buildPortalHref(therapist.slug));
    setFeedback(
      paidFeedback,
      (error && error.message) ||
        "We couldn't open billing right now. Try again from your dashboard in a moment.",
      "error",
    );
  }
}

function handlePaidCtaClick(event) {
  if (pricingState.paidMode === "direct_checkout") {
    handleDirectCheckout(event);
    return;
  }

  if (pricingState.paidMode === "manage_subscription") {
    handleManageSubscription(event);
    return;
  }

  trackFunnelEvent("pricing_paid_cta_clicked", {
    branch: pricingState.branch,
    source: "pricing_page",
  });

  setFeedback(
    paidFeedback,
    pricingState.paidMode === "claim"
      ? "Opening the claim flow so you can start your trial from the right listing..."
      : "Opening trial setup...",
    "success",
  );
}

async function resolveSignedInState() {
  if (!therapistSessionToken) {
    applyLoggedOutState();
    applyResolvedBranchTracking();
    return;
  }

  try {
    var results = await Promise.all([fetchTherapistMe(), fetchTherapistSubscription()]);
    var me = results[0];
    var subscriptionPayload = results[1];
    var subscription = subscriptionPayload && subscriptionPayload.subscription;
    if (me && me.therapist && me.therapist.slug) {
      slugParam = me.therapist.slug;
    }
    applyPricingState(me, subscription || null);
  } catch (_error) {
    applyLoggedOutState();
    pricingState.branch = "logged_out_fallback";
    applyResolvedBranchTracking();
  }
}

if (freeCta) {
  freeCta.addEventListener("click", handleFreeCtaClick);
}

if (paidCta) {
  paidCta.addEventListener("click", handlePaidCtaClick);
}

if (previewCard) {
  previewCard.addEventListener("click", function () {
    trackFunnelEvent("pricing_paid_preview_interacted", {
      branch: pricingState.branch,
      source: "pricing_page",
    });
  });
}

applyLoggedOutState();
resolveSignedInState();

// Count comes through the public content API, never a direct dataset
// query from the browser — public pages must only see what the API's
// projections expose. (The old direct apicdn.sanity.io fetch was also
// blocked by the CSP connect-src in production.)
async function fetchLiveTherapistCount() {
  try {
    var count = await fetchPublicTherapistCount();
    if (typeof count === "number" && count > 0 && therapistCountEl) {
      var rounded = Math.floor(count / 10) * 10;
      therapistCountEl.textContent = rounded + "+";
    }
  } catch (_e) {
    // silently fail, static fallback remains
  }
}

fetchLiveTherapistCount();
