import assert from "node:assert/strict";
import test from "node:test";

import {
  FEATURED_PLAN_CODES,
  buildSubscriptionId,
  deriveSubscriptionDocumentFromStripe,
  hasActiveFeatured,
  isLapsedFeatured,
  mergeSubscriptionDocuments,
  parsePlanCode,
  resolveFeaturedPriceId,
  shouldApplyEvent,
} from "../../shared/therapist-subscription-domain.mjs";

function buildStripeSubscription(overrides) {
  return {
    id: "sub_test_123",
    status: "trialing",
    customer: "cus_test_456",
    current_period_end: 1_800_000_000,
    trial_end: 1_700_000_000,
    cancel_at_period_end: false,
    metadata: { therapist_slug: "jamie-rivera" },
    items: { data: [{ price: { id: "price_featured_monthly" } }] },
    ...overrides,
  };
}

test("buildSubscriptionId normalizes the slug and produces a deterministic id", () => {
  assert.equal(buildSubscriptionId("Jamie-Rivera"), "therapistSubscription-jamie-rivera");
  assert.equal(buildSubscriptionId("  alex  "), "therapistSubscription-alex");
});

test("buildSubscriptionId throws when slug is missing", () => {
  assert.throws(() => buildSubscriptionId(""));
  assert.throws(() => buildSubscriptionId(null));
});

test("deriveSubscriptionDocumentFromStripe produces a canonical doc", () => {
  const doc = deriveSubscriptionDocumentFromStripe({
    therapistSlug: "jamie-rivera",
    stripeSubscription: buildStripeSubscription(),
    eventId: "evt_1",
    eventCreatedAt: "2026-04-17T00:00:00.000Z",
  });

  assert.equal(doc._id, "therapistSubscription-jamie-rivera");
  assert.equal(doc._type, "therapistSubscription");
  assert.equal(doc.plan, "featured");
  assert.equal(doc.status, "trialing");
  assert.equal(doc.stripeSubscriptionId, "sub_test_123");
  assert.equal(doc.stripeCustomerId, "cus_test_456");
  assert.equal(doc.stripePriceId, "price_featured_monthly");
  assert.equal(doc.trialEndsAt, new Date(1_700_000_000_000).toISOString());
  assert.equal(doc.currentPeriodEndsAt, new Date(1_800_000_000_000).toISOString());
  assert.equal(doc.lastEventId, "evt_1");
});

test("deriveSubscriptionDocumentFromStripe downgrades plan to none for lapsed statuses", () => {
  const doc = deriveSubscriptionDocumentFromStripe({
    therapistSlug: "jamie-rivera",
    stripeSubscription: buildStripeSubscription({ status: "canceled" }),
    eventId: "evt_2",
    eventCreatedAt: "2026-04-17T00:00:00.000Z",
  });
  assert.equal(doc.plan, "none");
  assert.equal(doc.status, "canceled");
});

test("hasActiveFeatured is true for trialing and active featured plans", () => {
  assert.equal(hasActiveFeatured({ plan: "featured", status: "trialing" }), true);
  assert.equal(hasActiveFeatured({ plan: "featured", status: "active" }), true);
  assert.equal(hasActiveFeatured({ plan: "featured", status: "past_due" }), false);
  assert.equal(hasActiveFeatured({ plan: "none", status: "active" }), false);
  assert.equal(hasActiveFeatured(null), false);
});

test("isLapsedFeatured detects canceled/unpaid/incomplete_expired", () => {
  assert.equal(isLapsedFeatured({ status: "canceled" }), true);
  assert.equal(isLapsedFeatured({ status: "unpaid" }), true);
  assert.equal(isLapsedFeatured({ status: "incomplete_expired" }), true);
  assert.equal(isLapsedFeatured({ status: "trialing" }), false);
});

test("shouldApplyEvent skips events that have already been processed", () => {
  const existing = {
    lastEventId: "evt_old",
    lastEventAt: "2026-04-17T12:00:00.000Z",
  };
  assert.equal(shouldApplyEvent(existing, "evt_old", "2026-04-17T12:05:00.000Z"), false);
  assert.equal(shouldApplyEvent(existing, "evt_new", "2026-04-17T12:05:00.000Z"), true);
  assert.equal(shouldApplyEvent(existing, "evt_new", "2026-04-17T11:00:00.000Z"), false);
  assert.equal(shouldApplyEvent(null, "evt_first", "2026-04-17T12:00:00.000Z"), true);
});

test("mergeSubscriptionDocuments preserves existing fields not in next", () => {
  const existing = {
    _id: "therapistSubscription-alex",
    therapistSlug: "alex",
    stripeCustomerId: "cus_old",
    lastEventId: "evt_old",
    preservedExtra: "keep-me",
  };
  const next = {
    _id: "therapistSubscription-alex",
    therapistSlug: "alex",
    stripeCustomerId: "cus_new",
    lastEventId: "evt_new",
  };
  const merged = mergeSubscriptionDocuments(existing, next);
  assert.equal(merged.stripeCustomerId, "cus_new");
  assert.equal(merged.lastEventId, "evt_new");
  assert.equal(merged.preservedExtra, "keep-me");
});

test("FEATURED_PLAN_CODES exports the four supported plan codes", () => {
  assert.deepEqual(FEATURED_PLAN_CODES.slice().sort(), [
    "founding_annual",
    "founding_monthly",
    "regular_annual",
    "regular_monthly",
  ]);
});

test("parsePlanCode derives tier and interval for each supported code", () => {
  assert.deepEqual(parsePlanCode("founding_monthly"), {
    plan: "founding_monthly",
    tier: "founding",
    interval: "month",
  });
  assert.deepEqual(parsePlanCode("founding_annual"), {
    plan: "founding_annual",
    tier: "founding",
    interval: "year",
  });
  assert.deepEqual(parsePlanCode("regular_monthly"), {
    plan: "regular_monthly",
    tier: "regular",
    interval: "month",
  });
  assert.deepEqual(parsePlanCode("regular_annual"), {
    plan: "regular_annual",
    tier: "regular",
    interval: "year",
  });
});

test("parsePlanCode returns null for unknown codes", () => {
  assert.equal(parsePlanCode(""), null);
  assert.equal(parsePlanCode("vip"), null);
  assert.equal(parsePlanCode(null), null);
});

test("resolveFeaturedPriceId maps plan codes to configured price ids", () => {
  const config = {
    stripeFeaturedFoundingMonthlyPriceId: "price_fm",
    stripeFeaturedFoundingAnnualPriceId: "price_fa",
    stripeFeaturedRegularMonthlyPriceId: "price_rm",
    stripeFeaturedRegularAnnualPriceId: "price_ra",
  };
  assert.deepEqual(resolveFeaturedPriceId(config, "founding_monthly"), {
    priceId: "price_fm",
    tier: "founding",
    interval: "month",
  });
  assert.deepEqual(resolveFeaturedPriceId(config, "regular_annual"), {
    priceId: "price_ra",
    tier: "regular",
    interval: "year",
  });
});

test("resolveFeaturedPriceId falls back to legacy stripeFeaturedPriceId when plan is missing", () => {
  const config = { stripeFeaturedPriceId: "price_legacy" };
  assert.deepEqual(resolveFeaturedPriceId(config, ""), {
    priceId: "price_legacy",
    tier: "regular",
    interval: "month",
  });
});

test("resolveFeaturedPriceId returns null when no price is configured for the requested plan", () => {
  assert.equal(resolveFeaturedPriceId({}, "founding_monthly"), null);
  assert.equal(resolveFeaturedPriceId({}, "not-a-plan"), null);
});

test("deriveSubscriptionDocumentFromStripe extracts tier and interval from subscription metadata", () => {
  const document = deriveSubscriptionDocumentFromStripe({
    therapistSlug: "jamie-rivera",
    stripeSubscription: {
      id: "sub_x",
      status: "trialing",
      customer: "cus_x",
      current_period_end: 1_800_000_000,
      trial_end: 1_700_000_000,
      cancel_at_period_end: false,
      metadata: { therapist_slug: "jamie-rivera", tier: "founding", interval: "month" },
      items: {
        data: [{ price: { id: "price_fm", recurring: { interval: "month" } } }],
      },
    },
    eventId: "evt_1",
    eventCreatedAt: "2026-04-18T00:00:00.000Z",
  });
  assert.equal(document.tier, "founding");
  assert.equal(document.interval, "month");
  assert.equal(document.stripePriceId, "price_fm");
});

test("deriveSubscriptionDocumentFromStripe infers interval from recurring.interval when metadata is absent", () => {
  const document = deriveSubscriptionDocumentFromStripe({
    therapistSlug: "jamie-rivera",
    stripeSubscription: {
      id: "sub_x",
      status: "active",
      customer: "cus_x",
      current_period_end: 1_800_000_000,
      cancel_at_period_end: false,
      metadata: {},
      items: {
        data: [{ price: { id: "price_ra", recurring: { interval: "year" } } }],
      },
    },
    eventId: "evt_2",
    eventCreatedAt: "2026-04-18T00:00:00.000Z",
  });
  assert.equal(document.interval, "year");
  assert.equal(document.tier, "");
});
