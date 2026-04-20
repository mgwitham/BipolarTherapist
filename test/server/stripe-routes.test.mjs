import assert from "node:assert/strict";
import test from "node:test";

import { handleStripeRoutes } from "../../server/review-stripe-routes.mjs";
import {
  createMemoryClient,
  createResponseCapture,
  createTestApiConfig,
  deepClone,
} from "./test-helpers.mjs";

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

function buildContext(options) {
  const response = createResponseCapture();
  const request = {
    method: options.method,
    headers: options.headers || {},
    on() {
      return request;
    },
    destroy() {},
  };
  const sendJson = function sendJson(_res, statusCode, payload) {
    response.statusCode = statusCode;
    response.payload = payload;
  };
  const deps = { ...options.deps, sendJson };
  return {
    response,
    request,
    context: {
      client: options.client,
      config: options.config || {
        ...createTestApiConfig(),
        stripeReturnUrlBase: "https://example.com",
      },
      deps,
      origin: "",
      request,
      response,
      routePath: options.routePath,
    },
  };
}

test("checkout-session endpoint returns the checkout URL from Stripe", async () => {
  const { client } = createMemoryClient();
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/stripe/checkout-session",
    client,
    deps: {
      parseBody: async () => ({
        therapist_slug: "jamie-rivera",
        email: "jamie@example.com",
      }),
      parseRawBody: async () => Buffer.alloc(0),
      createFeaturedCheckoutSession: async (_config, options) => {
        assert.equal(options.therapistSlug, "jamie-rivera");
        assert.equal(options.customerEmail, "jamie@example.com");
        return { id: "cs_test_1", url: "https://checkout.stripe.test/cs_test_1" };
      },
      verifyAndParseWebhook: async () => {
        throw new Error("not called in this test");
      },
      retrieveSubscription: async () => null,
    },
  });

  const handled = await handleStripeRoutes(context);
  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.ok, true);
  assert.equal(response.payload.url, "https://checkout.stripe.test/cs_test_1");
});

test("checkout-session endpoint forwards plan code to stripe-client", async () => {
  const { client } = createMemoryClient();
  let observedPlan = null;
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/stripe/checkout-session",
    client,
    deps: {
      parseBody: async () => ({
        therapist_slug: "jamie-rivera",
        email: "jamie@example.com",
        plan: "founding_annual",
      }),
      parseRawBody: async () => Buffer.alloc(0),
      createFeaturedCheckoutSession: async (_config, options) => {
        observedPlan = options.plan;
        return {
          id: "cs_test_2",
          url: "https://checkout.stripe.test/cs_test_2",
          tier: "founding",
          interval: "year",
        };
      },
      verifyAndParseWebhook: async () => null,
      retrieveSubscription: async () => null,
    },
  });

  await handleStripeRoutes(context);
  assert.equal(observedPlan, "founding_annual");
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.tier, "founding");
  assert.equal(response.payload.interval, "year");
});

test("checkout-session endpoint forwards the new paid_monthly plan code", async () => {
  const { client } = createMemoryClient();
  let observedPlan = null;
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/stripe/checkout-session",
    client,
    deps: {
      parseBody: async () => ({
        therapist_slug: "jamie-rivera",
        email: "jamie@example.com",
        plan: "paid_monthly",
      }),
      parseRawBody: async () => Buffer.alloc(0),
      createFeaturedCheckoutSession: async (_config, options) => {
        observedPlan = options.plan;
        return {
          id: "cs_test_paid",
          url: "https://checkout.stripe.test/cs_test_paid",
          tier: "paid",
          interval: "month",
        };
      },
      verifyAndParseWebhook: async () => null,
      retrieveSubscription: async () => null,
    },
  });

  await handleStripeRoutes(context);
  assert.equal(observedPlan, "paid_monthly");
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.tier, "paid");
  assert.equal(response.payload.interval, "month");
});

test("checkout-session endpoint rejects missing therapist_slug", async () => {
  const { client } = createMemoryClient();
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/stripe/checkout-session",
    client,
    deps: {
      parseBody: async () => ({ email: "no-slug@example.com" }),
      parseRawBody: async () => Buffer.alloc(0),
      createFeaturedCheckoutSession: async () => {
        throw new Error("should not be called");
      },
      verifyAndParseWebhook: async () => null,
      retrieveSubscription: async () => null,
    },
  });

  await handleStripeRoutes(context);
  assert.equal(response.statusCode, 400);
});

test("webhook endpoint rejects missing signature header", async () => {
  const { client } = createMemoryClient();
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/stripe/webhook",
    headers: {},
    client,
    deps: {
      parseBody: async () => null,
      parseRawBody: async () => Buffer.from("{}"),
      createFeaturedCheckoutSession: async () => null,
      verifyAndParseWebhook: async () => {
        throw new Error("should not be called");
      },
      retrieveSubscription: async () => null,
    },
  });

  await handleStripeRoutes(context);
  assert.equal(response.statusCode, 400);
});

test("webhook endpoint rejects invalid signature", async () => {
  const { client } = createMemoryClient();
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/stripe/webhook",
    headers: { "stripe-signature": "sig-bad" },
    client,
    deps: {
      parseBody: async () => null,
      parseRawBody: async () => Buffer.from("{}"),
      createFeaturedCheckoutSession: async () => null,
      verifyAndParseWebhook: async () => {
        throw new Error("No signatures found matching the expected signature");
      },
      retrieveSubscription: async () => null,
    },
  });

  await handleStripeRoutes(context);
  assert.equal(response.statusCode, 400);
  assert.match(response.payload.error, /Webhook verification failed/);
});

test("webhook: unrelated event type returns ok with handled=false", async () => {
  const { client } = createMemoryClient();
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/stripe/webhook",
    headers: { "stripe-signature": "sig-ok" },
    client,
    deps: {
      parseBody: async () => null,
      parseRawBody: async () => Buffer.from("{}"),
      createFeaturedCheckoutSession: async () => null,
      verifyAndParseWebhook: async () => ({
        id: "evt_ignored",
        type: "invoice.created",
        created: 1_700_000_000,
        data: { object: {} },
      }),
      retrieveSubscription: async () => null,
    },
  });

  await handleStripeRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.handled, false);
});

test("webhook: customer.subscription.created creates a subscription doc", async () => {
  const { client, state } = createMemoryClient();
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/stripe/webhook",
    headers: { "stripe-signature": "sig-ok" },
    client,
    deps: {
      parseBody: async () => null,
      parseRawBody: async () => Buffer.from("{}"),
      createFeaturedCheckoutSession: async () => null,
      verifyAndParseWebhook: async () => ({
        id: "evt_sub_created",
        type: "customer.subscription.created",
        created: 1_700_000_100,
        data: { object: buildStripeSubscription() },
      }),
      retrieveSubscription: async () => null,
    },
  });

  await handleStripeRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.handled, true);

  const doc = state.documents.get("therapistSubscription-jamie-rivera");
  assert.ok(doc);
  assert.equal(doc.status, "trialing");
  assert.equal(doc.plan, "featured");
  assert.equal(doc.stripeSubscriptionId, "sub_test_123");
  assert.equal(doc.lastEventId, "evt_sub_created");
});

test("webhook: duplicate event ID is skipped as stale", async () => {
  const { client, state } = createMemoryClient({
    "therapistSubscription-jamie-rivera": {
      _id: "therapistSubscription-jamie-rivera",
      _type: "therapistSubscription",
      therapistSlug: "jamie-rivera",
      status: "trialing",
      lastEventId: "evt_dup",
      lastEventAt: "2026-04-17T12:00:00.000Z",
    },
  });
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/stripe/webhook",
    headers: { "stripe-signature": "sig-ok" },
    client,
    deps: {
      parseBody: async () => null,
      parseRawBody: async () => Buffer.from("{}"),
      createFeaturedCheckoutSession: async () => null,
      verifyAndParseWebhook: async () => ({
        id: "evt_dup",
        type: "customer.subscription.updated",
        created: 1_700_000_200,
        data: { object: buildStripeSubscription({ status: "active" }) },
      }),
      retrieveSubscription: async () => null,
    },
  });

  await handleStripeRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.handled, false);
  // Doc unchanged — status still trialing, not updated to active.
  const doc = state.documents.get("therapistSubscription-jamie-rivera");
  assert.equal(doc.status, "trialing");
});

test("webhook: customer.subscription.deleted flips plan to none", async () => {
  const { client, state } = createMemoryClient({
    "therapistSubscription-jamie-rivera": deepClone({
      _id: "therapistSubscription-jamie-rivera",
      _type: "therapistSubscription",
      therapistSlug: "jamie-rivera",
      plan: "featured",
      status: "active",
      lastEventId: "evt_prev",
      lastEventAt: "2020-01-01T00:00:00.000Z",
    }),
  });
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/stripe/webhook",
    headers: { "stripe-signature": "sig-ok" },
    client,
    deps: {
      parseBody: async () => null,
      parseRawBody: async () => Buffer.from("{}"),
      createFeaturedCheckoutSession: async () => null,
      verifyAndParseWebhook: async () => ({
        id: "evt_cancel",
        type: "customer.subscription.deleted",
        created: 1_700_000_300,
        data: { object: buildStripeSubscription({ status: "canceled" }) },
      }),
      retrieveSubscription: async () => null,
    },
  });

  await handleStripeRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.handled, true);
  const doc = state.documents.get("therapistSubscription-jamie-rivera");
  assert.equal(doc.plan, "none");
  assert.equal(doc.status, "canceled");
});

test("webhook: missing therapist_slug in metadata returns handled=false", async () => {
  const { client } = createMemoryClient();
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/stripe/webhook",
    headers: { "stripe-signature": "sig-ok" },
    client,
    deps: {
      parseBody: async () => null,
      parseRawBody: async () => Buffer.from("{}"),
      createFeaturedCheckoutSession: async () => null,
      verifyAndParseWebhook: async () => ({
        id: "evt_no_slug",
        type: "customer.subscription.created",
        created: 1_700_000_400,
        data: { object: buildStripeSubscription({ metadata: {} }) },
      }),
      retrieveSubscription: async () => null,
    },
  });

  await handleStripeRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.handled, false);
  assert.equal(response.payload.reason, "no-therapist-slug");
});

test("subscription GET returns 401 when no therapist session is attached", async () => {
  const { client } = createMemoryClient();
  const { response, context } = buildContext({
    method: "GET",
    routePath: "/stripe/subscription",
    client,
    deps: {
      getAuthorizedTherapist: () => null,
      parseBody: async () => ({}),
      parseRawBody: async () => Buffer.alloc(0),
      createBillingPortalSession: async () => null,
      createFeaturedCheckoutSession: async () => null,
      verifyAndParseWebhook: async () => null,
      retrieveSubscription: async () => null,
    },
  });

  await handleStripeRoutes(context);
  assert.equal(response.statusCode, 401);
});

test("subscription GET returns shaped subscription for authed therapist", async () => {
  const { client } = createMemoryClient({
    "therapistSubscription-jamie-rivera": {
      _id: "therapistSubscription-jamie-rivera",
      _type: "therapistSubscription",
      therapistSlug: "jamie-rivera",
      plan: "featured",
      status: "active",
      stripeCustomerId: "cus_authed",
      currentPeriodEndsAt: "2027-01-01T00:00:00.000Z",
      trialEndsAt: null,
      cancelAtPeriodEnd: false,
    },
  });

  const { response, context } = buildContext({
    method: "GET",
    routePath: "/stripe/subscription",
    client,
    deps: {
      getAuthorizedTherapist: () => ({ slug: "jamie-rivera" }),
      parseBody: async () => ({}),
      parseRawBody: async () => Buffer.alloc(0),
      createBillingPortalSession: async () => null,
      createFeaturedCheckoutSession: async () => null,
      verifyAndParseWebhook: async () => null,
      retrieveSubscription: async () => null,
    },
  });

  await handleStripeRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.ok, true);
  assert.equal(response.payload.subscription.plan, "featured");
  assert.equal(response.payload.subscription.status, "active");
  assert.equal(response.payload.subscription.has_active_featured, true);
  assert.equal(response.payload.subscription.current_period_ends_at, "2027-01-01T00:00:00.000Z");
  assert.equal(response.payload.subscription.cancel_at_period_end, false);
});

test("subscription GET returns plan=none shape when no doc exists", async () => {
  const { client } = createMemoryClient();
  const { response, context } = buildContext({
    method: "GET",
    routePath: "/stripe/subscription",
    client,
    deps: {
      getAuthorizedTherapist: () => ({ slug: "unknown-therapist" }),
      parseBody: async () => ({}),
      parseRawBody: async () => Buffer.alloc(0),
      createBillingPortalSession: async () => null,
      createFeaturedCheckoutSession: async () => null,
      verifyAndParseWebhook: async () => null,
      retrieveSubscription: async () => null,
    },
  });

  await handleStripeRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.subscription.plan, "none");
  assert.equal(response.payload.subscription.has_active_featured, false);
});

test("portal-session returns Stripe billing portal URL for authed therapist with customer", async () => {
  const { client } = createMemoryClient({
    "therapistSubscription-jamie-rivera": {
      _id: "therapistSubscription-jamie-rivera",
      _type: "therapistSubscription",
      therapistSlug: "jamie-rivera",
      plan: "featured",
      status: "active",
      stripeCustomerId: "cus_portal_789",
    },
  });

  const { response, context } = buildContext({
    method: "POST",
    routePath: "/stripe/portal-session",
    client,
    deps: {
      getAuthorizedTherapist: () => ({ slug: "jamie-rivera" }),
      parseBody: async () => ({ return_path: "/portal.html" }),
      parseRawBody: async () => Buffer.alloc(0),
      createBillingPortalSession: async (_config, options) => {
        assert.equal(options.customerId, "cus_portal_789");
        assert.equal(options.returnPath, "/portal.html");
        return { id: "bps_1", url: "https://billing.stripe.test/bps_1" };
      },
      createFeaturedCheckoutSession: async () => null,
      verifyAndParseWebhook: async () => null,
      retrieveSubscription: async () => null,
    },
  });

  await handleStripeRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.ok, true);
  assert.equal(response.payload.url, "https://billing.stripe.test/bps_1");
});

test("portal-session returns 404 when therapist has no Stripe customer on file", async () => {
  const { client } = createMemoryClient();
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/stripe/portal-session",
    client,
    deps: {
      getAuthorizedTherapist: () => ({ slug: "jamie-rivera" }),
      parseBody: async () => ({}),
      parseRawBody: async () => Buffer.alloc(0),
      createBillingPortalSession: async () => {
        throw new Error("should not be called");
      },
      createFeaturedCheckoutSession: async () => null,
      verifyAndParseWebhook: async () => null,
      retrieveSubscription: async () => null,
    },
  });

  await handleStripeRoutes(context);
  assert.equal(response.statusCode, 404);
});

test("portal-session returns 401 for unauthed requests", async () => {
  const { client } = createMemoryClient();
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/stripe/portal-session",
    client,
    deps: {
      getAuthorizedTherapist: () => null,
      parseBody: async () => ({}),
      parseRawBody: async () => Buffer.alloc(0),
      createBillingPortalSession: async () => null,
      createFeaturedCheckoutSession: async () => null,
      verifyAndParseWebhook: async () => null,
      retrieveSubscription: async () => null,
    },
  });

  await handleStripeRoutes(context);
  assert.equal(response.statusCode, 401);
});

test("webhook: trial_will_end with claimed therapist sends AB 390 reminder (no cancel)", async () => {
  const { client } = createMemoryClient({
    "therapist-LMFT123": {
      _id: "therapist-LMFT123",
      _type: "therapist",
      name: "Jamie Rivera",
      email: "jamie@example.com",
      claimStatus: "claimed",
      slug: { current: "jamie-rivera", _type: "slug" },
    },
  });
  let reminderSent = null;
  let cancelCalled = false;
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/stripe/webhook",
    headers: { "stripe-signature": "sig-ok" },
    client,
    deps: {
      parseBody: async () => null,
      parseRawBody: async () => Buffer.from("{}"),
      createFeaturedCheckoutSession: async () => null,
      verifyAndParseWebhook: async () => ({
        id: "evt_trial_end_1",
        type: "customer.subscription.trial_will_end",
        created: 1_700_000_300,
        data: { object: buildStripeSubscription() },
      }),
      retrieveSubscription: async () => null,
      sendTrialEndingReminder: async (_config, therapist, trialEndsAt) => {
        reminderSent = { therapist, trialEndsAt };
      },
      sendUnverifiedTrialCanceledNotice: async () => {
        throw new Error("should not be called for claimed therapist");
      },
      cancelSubscriptionImmediately: async () => {
        cancelCalled = true;
      },
    },
  });
  await handleStripeRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.handled, true);
  assert.ok(reminderSent, "reminder email should fire");
  assert.equal(reminderSent.therapist.email, "jamie@example.com");
  assert.equal(cancelCalled, false, "subscription should NOT be canceled");
});

test("webhook: trial_will_end with unclaimed therapist cancels and notifies", async () => {
  const { client } = createMemoryClient({
    "therapist-LMFT123": {
      _id: "therapist-LMFT123",
      _type: "therapist",
      name: "Jamie Rivera",
      email: "jamie@example.com",
      claimStatus: "claim_requested",
      slug: { current: "jamie-rivera", _type: "slug" },
    },
  });
  let cancelCalledWith = null;
  let canceledNoticeSent = null;
  let reminderCalled = false;
  const { response, context } = buildContext({
    method: "POST",
    routePath: "/stripe/webhook",
    headers: { "stripe-signature": "sig-ok" },
    client,
    deps: {
      parseBody: async () => null,
      parseRawBody: async () => Buffer.from("{}"),
      createFeaturedCheckoutSession: async () => null,
      verifyAndParseWebhook: async () => ({
        id: "evt_trial_end_2",
        type: "customer.subscription.trial_will_end",
        created: 1_700_000_300,
        data: { object: buildStripeSubscription() },
      }),
      retrieveSubscription: async () => null,
      cancelSubscriptionImmediately: async (_config, subscriptionId) => {
        cancelCalledWith = subscriptionId;
      },
      sendTrialEndingReminder: async () => {
        reminderCalled = true;
      },
      sendUnverifiedTrialCanceledNotice: async (_config, therapist, activationUrl) => {
        canceledNoticeSent = { therapist, activationUrl };
      },
    },
  });
  await handleStripeRoutes(context);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.handled, true);
  assert.equal(cancelCalledWith, "sub_test_123", "should call cancel with Stripe subscription id");
  assert.ok(canceledNoticeSent, "cancellation notice email should fire");
  assert.equal(canceledNoticeSent.therapist.email, "jamie@example.com");
  assert.equal(reminderCalled, false, "reminder should NOT fire for unclaimed therapist");
});
