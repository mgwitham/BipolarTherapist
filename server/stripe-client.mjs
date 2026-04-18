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
  return Boolean(config && config.stripeSecretKey && config.stripeFeaturedPriceId);
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
  const { therapistSlug, customerEmail, returnPath } = options || {};
  if (!therapistSlug) {
    throw new Error("therapistSlug is required to create a checkout session.");
  }
  if (!hasStripeConfig(config)) {
    throw new Error("Stripe is not configured (missing secret key or featured price id).");
  }

  const stripe = await getStripeClient(config);
  const base = String(config.stripeReturnUrlBase || "").replace(/\/+$/, "");
  const slug = String(therapistSlug);
  const returnBase = returnPath
    ? `${base}${String(returnPath).startsWith("/") ? returnPath : `/${returnPath}`}`
    : `${base}/portal.html`;

  const successUrl = `${returnBase}${returnBase.includes("?") ? "&" : "?"}stripe=success&slug=${encodeURIComponent(slug)}&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${returnBase}${returnBase.includes("?") ? "&" : "?"}stripe=cancel&slug=${encodeURIComponent(slug)}`;

  const trialDays = Number.isFinite(config.stripeTrialDays) ? config.stripeTrialDays : 14;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: config.stripeFeaturedPriceId, quantity: 1 }],
    subscription_data: {
      trial_period_days: trialDays > 0 ? trialDays : undefined,
      metadata: { therapist_slug: slug },
    },
    customer_email: customerEmail || undefined,
    allow_promotion_codes: true,
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { therapist_slug: slug },
  });

  return { id: session.id, url: session.url };
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
