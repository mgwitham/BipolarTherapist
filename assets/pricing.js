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

const searchParams = new URLSearchParams(window.location.search);
let slugParam = String(searchParams.get("slug") || "").trim();
const emailParam = String(searchParams.get("email") || "").trim();
const therapistSessionToken = getTherapistSessionToken();

const therapistCountEl = document.getElementById("pricingTherapistCount");

const freeCard = document.querySelector('[data-plan-card="free"]');
const paidCard = document.querySelector('[data-plan-card="paid"]');
// Hero, plan-card, and mobile-sticky CTAs all carry data-pricing-cta,
// so one state pass keeps every instance in sync.
const freeCtas = Array.prototype.slice.call(document.querySelectorAll('[data-pricing-cta="free"]'));
const paidCtas = Array.prototype.slice.call(document.querySelectorAll('[data-pricing-cta="paid"]'));
const freeBadge = document.getElementById("pricingFreePlanBadge");
const paidBadge = document.getElementById("pricingPaidPlanBadge");
const freeState = document.getElementById("pricingFreeState");
const paidState = document.getElementById("pricingPaidState");
// The static trial copy under the paid price ("Start with 14 days
// free…") is accurate for everyone who hasn't started a trial yet, so
// it is only overridden once a trial/subscription is actually active.
const trialClarity = document.getElementById("price-note");
const freeFeedback = document.getElementById("pricingFreeFeedback");
const paidFeedback = document.getElementById("pricingPaidFeedback");

const pricingState = {
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

// Badge chips and per-card status lines only exist for signed-in
// therapists; empty text hides the element so logged-out visitors see
// the static card design untouched.
function setPlanText(node, text) {
  if (!node) {
    return;
  }
  node.textContent = text || "";
  node.hidden = !text;
}

function buildHref(path, params) {
  const query = new URLSearchParams();
  Object.keys(params || {}).forEach(function (key) {
    const value = params[key];
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, String(value));
    }
  });
  return path + (query.toString() ? "?" + query.toString() : "");
}

function buildClaimHref() {
  return buildHref("/claim", {
    slug: slugParam || "",
    email: emailParam || "",
  });
}

function buildSignupHref(plan) {
  return buildHref("/signup", {
    slug: slugParam || "",
    email: emailParam || "",
    plan: plan || "",
  });
}

function buildPortalHref(slug) {
  return buildHref("/portal", {
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

function updateCtaLinks(nodes, label, href) {
  nodes.forEach(function (node) {
    updateCtaLink(node, label, href);
  });
}

function setCtasBusy(nodes, message) {
  nodes.forEach(function (node) {
    setCtaBusy(node, message);
  });
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

  updateCtaLinks(
    freeCtas,
    slugParam ? "Claim free listing" : "List your practice",
    slugParam ? buildClaimHref() : buildSignupHref(),
  );
  updateCtaLinks(
    paidCtas,
    "Start free trial",
    slugParam ? buildClaimHref() : buildSignupHref("paid"),
  );

  // Logged-out visitors see the static card design as authored; the
  // badges and status lines stay hidden and the static trial copy under
  // the paid price already says everything about card/no-charge timing.
  setPlanText(freeBadge, "");
  setPlanText(paidBadge, "");
  setPlanText(freeState, "");
  setPlanText(
    paidState,
    slugParam ? "We found your listing, so we'll take you through the claim flow first." : "",
  );
  setCardCurrent(freeCard, false);
  setCardCurrent(paidCard, false);
  setFeedback(freeFeedback, "", "");
  setFeedback(paidFeedback, "", "");
}

function applySignedInFreeState(me, subscription) {
  const therapist = (me && me.therapist) || {};
  const therapistSlug = therapist.slug || slugParam || "";
  pricingState.branch = "signed_in_free";
  pricingState.therapist = me;
  pricingState.subscription = subscription;
  pricingState.freeMode = "dashboard";
  pricingState.paidMode = "direct_checkout";

  updateCtaLinks(freeCtas, "Manage your listing", buildPortalHref(therapistSlug));
  updateCtaLinks(paidCtas, "Start free trial", buildPortalHref(therapistSlug));

  setPlanText(freeBadge, "Your current plan");
  setPlanText(paidBadge, "");
  setPlanText(freeState, "");
  setPlanText(paidState, "You're already listed, so checkout opens directly. No new onboarding.");
  setCardCurrent(freeCard, true);
  setCardCurrent(paidCard, false);
  setFeedback(freeFeedback, "", "");
  setFeedback(paidFeedback, "", "");
}

function applySignedInPaidState(me, subscription) {
  const therapist = (me && me.therapist) || {};
  const therapistSlug = therapist.slug || slugParam || "";
  const isTrial = Boolean(subscription && subscription.status === "trialing");

  pricingState.branch = isTrial ? "signed_in_trial" : "signed_in_paid";
  pricingState.therapist = me;
  pricingState.subscription = subscription;
  pricingState.freeMode = "dashboard";
  pricingState.paidMode = "manage_subscription";

  updateCtaLinks(freeCtas, "Open dashboard", buildPortalHref(therapistSlug));
  updateCtaLinks(
    paidCtas,
    isTrial ? "Manage trial" : "Manage subscription",
    buildPortalHref(therapistSlug),
  );

  setPlanText(freeBadge, "Included in your plan");
  setPlanText(paidBadge, isTrial ? "Trial active" : "Your current plan");
  setPlanText(freeState, "");
  setPlanText(
    paidState,
    isTrial
      ? "Your Insights trial is active. Keep it, or cancel before billing begins."
      : "Your Insights plan is active. Open billing to update payment details or cancel.",
  );
  if (trialClarity) {
    trialClarity.textContent = isTrial
      ? "Trial active now. No charge until day 15. Cancellation stays available from your dashboard."
      : "Billing is active. You can manage or cancel the subscription from your dashboard.";
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
  const hasActivePaid = Boolean(subscription && subscription.has_active_featured);
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

  const me = pricingState.therapist;
  const therapist = me && me.therapist;
  if (!therapist || !therapist.slug) {
    window.location.href = buildSignupHref("paid");
    return;
  }

  const originalLabel = "Start free trial";
  setCtasBusy(paidCtas, "Opening secure checkout...");
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
    const checkout = await createStripeFeaturedCheckoutSession({
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
    const checkoutUrl = checkout && checkout.url ? safeStripeRedirectUrl(checkout.url) : "";
    if (checkoutUrl) {
      window.location.href = checkoutUrl;
      return;
    }
    throw new Error("No checkout URL returned.");
  } catch (error) {
    updateCtaLinks(paidCtas, originalLabel, buildPortalHref(therapist.slug));
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

  const me = pricingState.therapist;
  const therapist = me && me.therapist;
  if (!therapist || !therapist.slug) {
    window.location.href = buildPortalHref("");
    return;
  }

  const originalLabel =
    pricingState.branch === "signed_in_trial" ? "Manage trial" : "Manage subscription";
  setCtasBusy(paidCtas, "Opening billing...");
  setFeedback(paidFeedback, "Opening billing and cancellation controls...", "success");

  trackFunnelEvent("pricing_paid_cta_clicked", {
    branch: pricingState.branch,
    source: "pricing_page",
  });

  try {
    const session = await createStripeBillingPortalSession({
      return_path: "/portal.html?slug=" + encodeURIComponent(therapist.slug),
    });
    const sessionUrl = session && session.url ? safeStripeRedirectUrl(session.url) : "";
    if (sessionUrl) {
      window.location.href = sessionUrl;
      return;
    }
    throw new Error("No billing portal URL returned.");
  } catch (error) {
    updateCtaLinks(paidCtas, originalLabel, buildPortalHref(therapist.slug));
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
    const results = await Promise.all([fetchTherapistMe(), fetchTherapistSubscription()]);
    const me = results[0];
    const subscriptionPayload = results[1];
    const subscription = subscriptionPayload && subscriptionPayload.subscription;
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

freeCtas.forEach(function (node) {
  node.addEventListener("click", handleFreeCtaClick);
});

paidCtas.forEach(function (node) {
  node.addEventListener("click", handlePaidCtaClick);
});

// Mobile sticky CTA: appears once the hero (which has its own CTAs)
// scrolls away, and hides again while the bottom CTA banner is in view
// so the two never stack. Desktop never shows it (display:none in CSS).
const stickyBar = document.querySelector("[data-pricing-sticky]");
const heroSection = document.querySelector(".pricing-hero");
const bannerSection = document.querySelector(".cta-banner");
if (stickyBar && heroSection && typeof window.IntersectionObserver === "function") {
  let heroVisible = true;
  let bannerVisible = false;
  const stickyObserver = new window.IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.target === heroSection) {
        heroVisible = entry.isIntersecting;
      }
      if (entry.target === bannerSection) {
        bannerVisible = entry.isIntersecting;
      }
    });
    stickyBar.setAttribute("aria-hidden", heroVisible || bannerVisible ? "true" : "false");
  });
  stickyObserver.observe(heroSection);
  if (bannerSection) {
    stickyObserver.observe(bannerSection);
  }
}

applyLoggedOutState();
resolveSignedInState();

// Count comes through the public content API, never a direct dataset
// query from the browser — public pages must only see what the API's
// projections expose. (The old direct apicdn.sanity.io fetch was also
// blocked by the CSP connect-src in production.)
async function fetchLiveTherapistCount() {
  try {
    const count = await fetchPublicTherapistCount();
    if (typeof count === "number" && count > 0 && therapistCountEl) {
      const rounded = Math.floor(count / 10) * 10;
      therapistCountEl.textContent = rounded + "+";
    }
  } catch (_e) {
    // silently fail, static fallback remains
  }
}

fetchLiveTherapistCount();
