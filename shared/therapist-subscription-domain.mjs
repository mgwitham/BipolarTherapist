const ACTIVE_STATUSES = new Set(["trialing", "active"]);
const LAPSED_STATUSES = new Set(["canceled", "incomplete_expired", "unpaid"]);

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
  const priceId =
    (stripeSubscription.items &&
      stripeSubscription.items.data &&
      stripeSubscription.items.data[0] &&
      stripeSubscription.items.data[0].price &&
      stripeSubscription.items.data[0].price.id) ||
    "";

  return {
    _id: buildSubscriptionId(slug),
    _type: "therapistSubscription",
    therapistSlug: slug,
    stripeCustomerId: String(stripeCustomerId || stripeSubscription.customer || ""),
    stripeSubscriptionId: String(stripeSubscription.id || ""),
    stripePriceId: priceId,
    plan: status && !LAPSED_STATUSES.has(status) ? "featured" : "none",
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
