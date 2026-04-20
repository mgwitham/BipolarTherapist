import { resolveFeaturedPriceId } from "../shared/therapist-subscription-domain.mjs";

let stripeModulePromise = null;

async function loadStripe() {
  if (!stripeModulePromise) {
    stripeModulePromise = import("stripe").then(function (module) {
      return module.default || module;
    });
  }
  return stripeModulePromise;
}

export function hasStripeConfig(config) {
  if (!config || !config.stripeSecretKey) {
    return false;
  }
  return Boolean(
    config.stripeFeaturedPriceId ||
    config.stripeFeaturedFoundingMonthlyPriceId ||
    config.stripeFeaturedFoundingAnnualPriceId ||
    config.stripeFeaturedRegularMonthlyPriceId ||
    config.stripeFeaturedRegularAnnualPriceId,
  );
}

export function hasStripeWebhookConfig(config) {
  return Boolean(config && config.stripeSecretKey && config.stripeWebhookSecret);
}

async function getStripeClient(config) {
  if (!config || !config.stripeSecretKey) {
    throw new Error("Stripe is not configured.");
  }
  const Stripe = await loadStripe();
  return new Stripe(config.stripeSecretKey, { apiVersion: "2025-03-31.basil" });
}

export async function createFeaturedCheckoutSession(config, options) {
  const { therapistSlug, customerEmail, returnPath, plan } = options || {};
  if (!therapistSlug) {
    throw new Error("therapistSlug is required to create a checkout session.");
  }
  if (!hasStripeConfig(config)) {
    throw new Error("Stripe is not configured (missing secret key or featured price id).");
  }

  const resolution =
    resolveFeaturedPriceId(config, plan) ||
    (config.stripeFeaturedPriceId
      ? { priceId: config.stripeFeaturedPriceId, tier: "regular", interval: "month" }
      : null);
  if (!resolution) {
    throw new Error("Requested featured plan is not configured on this Stripe account.");
  }

  const stripe = await getStripeClient(config);
  const base = String(config.stripeReturnUrlBase || "").replace(/\/+$/, "");
  const slug = String(therapistSlug);
  const returnBase = returnPath
    ? `${base}${String(returnPath).startsWith("/") ? returnPath : `/${returnPath}`}`
    : `${base}/portal.html`;

  // Build success/cancel URLs via URL API so we don't duplicate params
  // when returnPath already carries slug (was producing ?slug=x&stripe=...&slug=x).
  const buildReturnUrl = (stripeStatus, includeSessionId) => {
    const url = new URL(returnBase);
    url.searchParams.set("stripe", stripeStatus);
    url.searchParams.set("slug", slug);
    let str = url.toString();
    if (includeSessionId) {
      str += (str.includes("?") ? "&" : "?") + "session_id={CHECKOUT_SESSION_ID}";
    }
    return str;
  };
  const successUrl = buildReturnUrl("success", true);
  const cancelUrl = buildReturnUrl("cancel", false);

  const trialDays = Number.isFinite(config.stripeTrialDays) ? config.stripeTrialDays : 14;
  const metadata = {
    therapist_slug: slug,
    tier: resolution.tier,
    interval: resolution.interval,
  };

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: resolution.priceId, quantity: 1 }],
    subscription_data: {
      trial_period_days: trialDays > 0 ? trialDays : undefined,
      metadata,
    },
    customer_email: customerEmail || undefined,
    allow_promotion_codes: true,
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata,
  });

  return { id: session.id, url: session.url, tier: resolution.tier, interval: resolution.interval };
}

export async function createBillingPortalSession(config, options) {
  const { customerId, returnPath } = options || {};
  if (!customerId) {
    throw new Error("customerId is required to create a billing portal session.");
  }
  if (!config || !config.stripeSecretKey) {
    throw new Error("Stripe is not configured.");
  }

  const stripe = await getStripeClient(config);
  const base = String(config.stripeReturnUrlBase || "").replace(/\/+$/, "");
  const returnUrl = returnPath
    ? `${base}${String(returnPath).startsWith("/") ? returnPath : `/${returnPath}`}`
    : `${base}/portal.html`;

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });

  return { id: session.id, url: session.url };
}

export async function verifyAndParseWebhook(config, rawBody, signature) {
  if (!hasStripeWebhookConfig(config)) {
    throw new Error("Stripe webhook is not configured.");
  }
  const stripe = await getStripeClient(config);
  return stripe.webhooks.constructEvent(rawBody, signature, config.stripeWebhookSecret);
}

export async function retrieveSubscription(config, subscriptionId) {
  const stripe = await getStripeClient(config);
  return stripe.subscriptions.retrieve(subscriptionId);
}

// Immediate cancellation (not end-of-period). Used when a trial ends
// without ownership verification — we don't want to let an unverified
// subscription roll into a paid period.
export async function cancelSubscriptionImmediately(config, subscriptionId) {
  const stripe = await getStripeClient(config);
  return stripe.subscriptions.cancel(subscriptionId);
}
