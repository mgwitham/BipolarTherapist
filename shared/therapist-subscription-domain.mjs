const ACTIVE_STATUSES = new Set(["trialing", "active"]);
const LAPSED_STATUSES = new Set(["canceled", "incomplete_expired", "unpaid"]);

// Plan codes the system recognizes.
//
// - "paid_monthly" is the CANONICAL plan for the current single-tier
//   pricing ($19/month, 14-day trial) introduced in PR #172.
// - The four founding/regular tier codes predate the pricing rewrite
//   and stay on this list so legacy Stripe subscriptions created under
//   the old tiering continue to round-trip through parsing and the
//   webhook handler. New signup flows should send "paid_monthly".
export const FEATURED_PLAN_CODES = Object.freeze([
  "paid_monthly",
  "founding_monthly",
  "founding_annual",
  "regular_monthly",
  "regular_annual",
]);

export function parsePlanCode(value) {
  const plan = String(value || "")
    .trim()
    .toLowerCase();
  if (!FEATURED_PLAN_CODES.includes(plan)) {
    return null;
  }
  // "paid_monthly" uses "paid" as the tier label. Legacy codes keep
  // their existing founding/regular tier + monthly/annual interval.
  const [tier, intervalKey] = plan.split("_");
  const interval = intervalKey === "annual" ? "year" : "month";
  return { plan, tier, interval };
}

export function resolveFeaturedPriceId(config, planCode) {
  const parsed = parsePlanCode(planCode);
  if (!parsed) {
    // Unknown plan code — fall back to the legacy generic price id if
    // the env is configured. Preserves the original behavior for any
    // callers still passing an empty/unknown plan.
    if (config && config.stripeFeaturedPriceId) {
      return { priceId: config.stripeFeaturedPriceId, tier: "regular", interval: "month" };
    }
    return null;
  }
  const lookup = {
    paid_monthly: config && config.stripePaidMonthlyPriceId,
    founding_monthly: config && config.stripeFeaturedFoundingMonthlyPriceId,
    founding_annual: config && config.stripeFeaturedFoundingAnnualPriceId,
    regular_monthly: config && config.stripeFeaturedRegularMonthlyPriceId,
    regular_annual: config && config.stripeFeaturedRegularAnnualPriceId,
  };
  // Prefer the plan-specific env var. Fall back to the legacy
  // stripeFeaturedPriceId for any plan whose env is unset — useful
  // while migrating between the old and new plan models.
  const priceId = lookup[parsed.plan] || (config && config.stripeFeaturedPriceId) || "";
  if (!priceId) {
    return null;
  }
  return { priceId, tier: parsed.tier, interval: parsed.interval };
}

function normalizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function toIsoFromSeconds(value) {
  if (value === null || value === undefined) {
    return "";
  }
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "";
  }
  return new Date(seconds * 1000).toISOString();
}

export function buildSubscriptionId(slug) {
  const cleanSlug = normalizeSlug(slug);
  if (!cleanSlug) {
    throw new Error("Cannot build subscription id without a therapist slug.");
  }
  return `therapistSubscription-${cleanSlug}`;
}

export function hasActiveFeatured(document) {
  if (!document) {
    return false;
  }
  if (document.plan !== "featured") {
    return false;
  }
  return ACTIVE_STATUSES.has(String(document.status || ""));
}

export function isLapsedFeatured(document) {
  if (!document) {
    return false;
  }
  return LAPSED_STATUSES.has(String(document.status || ""));
}

export function deriveSubscriptionDocumentFromStripe(options) {
  const { therapistSlug, stripeSubscription, stripeCustomerId, eventId, eventCreatedAt } =
    options || {};

  const slug = normalizeSlug(therapistSlug);
  if (!slug) {
    throw new Error("therapistSlug is required to derive a subscription document.");
  }
  if (!stripeSubscription) {
    throw new Error("stripeSubscription payload is required.");
  }

  const status = String(stripeSubscription.status || "").toLowerCase();
  const firstItem =
    stripeSubscription.items && stripeSubscription.items.data && stripeSubscription.items.data[0];
  const priceId = (firstItem && firstItem.price && firstItem.price.id) || "";
  const recurringInterval =
    (firstItem &&
      firstItem.price &&
      firstItem.price.recurring &&
      firstItem.price.recurring.interval) ||
    "";
  const metadataTier = String(
    (stripeSubscription.metadata && stripeSubscription.metadata.tier) || "",
  )
    .trim()
    .toLowerCase();
  const metadataInterval = String(
    (stripeSubscription.metadata && stripeSubscription.metadata.interval) || "",
  )
    .trim()
    .toLowerCase();
  const tier = metadataTier === "founding" || metadataTier === "regular" ? metadataTier : "";
  const interval =
    metadataInterval === "year" || metadataInterval === "month"
      ? metadataInterval
      : recurringInterval === "year" || recurringInterval === "month"
        ? recurringInterval
        : "";

  return {
    _id: buildSubscriptionId(slug),
    _type: "therapistSubscription",
    therapistSlug: slug,
    stripeCustomerId: String(stripeCustomerId || stripeSubscription.customer || ""),
    stripeSubscriptionId: String(stripeSubscription.id || ""),
    stripePriceId: priceId,
    plan: status && !LAPSED_STATUSES.has(status) ? "featured" : "none",
    tier,
    interval,
    status,
    trialEndsAt: toIsoFromSeconds(stripeSubscription.trial_end),
    currentPeriodEndsAt: toIsoFromSeconds(stripeSubscription.current_period_end),
    cancelAtPeriodEnd: Boolean(stripeSubscription.cancel_at_period_end),
    lastEventId: eventId ? String(eventId) : "",
    lastEventAt: eventCreatedAt || new Date().toISOString(),
  };
}

export function shouldApplyEvent(existing, incomingEventId, incomingEventCreatedAt) {
  if (!existing || !existing.lastEventId) {
    return true;
  }
  if (existing.lastEventId === incomingEventId) {
    return false;
  }
  if (!existing.lastEventAt || !incomingEventCreatedAt) {
    return true;
  }
  return new Date(incomingEventCreatedAt).getTime() >= new Date(existing.lastEventAt).getTime();
}

export function mergeSubscriptionDocuments(existing, next) {
  const base = existing && existing._id ? { ...existing } : {};
  return {
    ...base,
    ...next,
  };
}
