// Builders for GA4 Measurement Protocol events sent from the server. Browser
// tracking misses revenue events (ad blockers, Do Not Track, the checkout
// happening on Stripe's domain), so subscription lifecycle events are sent from
// the Stripe webhook instead. Pure: no I/O, no env.
//
// The client_id is derived from the Stripe customer, so these events appear as
// their own users in GA4 (revenue counts correctly; they are not stitched to
// the visitor's web session).

/**
 * @typedef {Object} SubscriptionLike
 * @property {string} [therapistSlug]
 * @property {string} [stripeCustomerId]
 * @property {string} [stripeSubscriptionId]
 * @property {number} [priceCents]
 * @property {string} [currency]
 * @property {string} [tier]
 * @property {string} [interval]
 */

/**
 * @param {"trial_started" | "purchase"} kind
 * @param {SubscriptionLike} subscription
 * @returns {{ clientId: string, name: string, params: Record<string, unknown> } | null}
 */
export function buildTherapistLifecycleGaEvent(kind, subscription) {
  const sub = subscription || {};
  const customer = String(sub.stripeCustomerId || "").trim();
  const subscriptionId = String(sub.stripeSubscriptionId || "").trim();
  if (!customer || !subscriptionId) return null;

  const currency = String(sub.currency || "usd")
    .trim()
    .toUpperCase();
  const value = Number.isFinite(Number(sub.priceCents)) ? Number(sub.priceCents) / 100 : 0;
  const base = {
    // Required for the event to show in GA4 Realtime and reports.
    engagement_time_msec: 1,
    therapist_slug: String(sub.therapistSlug || ""),
    plan_tier: String(sub.tier || ""),
    plan_interval: String(sub.interval || ""),
  };

  if (kind === "trial_started") {
    return {
      clientId: "stripe." + customer,
      name: "trial_started",
      params: { ...base, value, currency },
    };
  }
  if (kind === "purchase") {
    return {
      clientId: "stripe." + customer,
      name: "purchase",
      params: {
        ...base,
        // transaction_id dedupes GA4 purchases if Stripe redelivers a webhook.
        transaction_id: subscriptionId + "_first_paid",
        value,
        currency,
        items: [
          {
            item_id: "featured_" + (sub.tier || "plan") + "_" + (sub.interval || "period"),
            item_name: "Featured listing",
            price: value,
            quantity: 1,
          },
        ],
      },
    };
  }
  return null;
}

/**
 * @param {{ measurementId: string, apiSecret: string }} credentials
 * @param {{ clientId: string, name: string, params: Record<string, unknown> }} event
 * @returns {{ url: string, body: string } | null}
 */
export function buildMeasurementProtocolRequest(credentials, event) {
  const { measurementId, apiSecret } = credentials || {};
  if (!measurementId || !apiSecret || !event || !event.clientId || !event.name) return null;
  const url =
    "https://www.google-analytics.com/mp/collect?measurement_id=" +
    encodeURIComponent(measurementId) +
    "&api_secret=" +
    encodeURIComponent(apiSecret);
  const body = JSON.stringify({
    client_id: event.clientId,
    non_personalized_ads: true,
    events: [{ name: event.name, params: event.params || {} }],
  });
  return { url, body };
}
