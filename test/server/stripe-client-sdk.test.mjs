import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import Stripe from "stripe";

import {
  cancelSubscriptionImmediately,
  createBillingPortalSession,
  createFeaturedCheckoutSession,
  retrieveSubscription,
  verifyAndParseWebhook,
} from "../../server/stripe-client.mjs";

// Drives server/stripe-client.mjs through the real Stripe SDK against a
// local fake API, so a Stripe SDK major bump that changes request shapes,
// the pinned API version header, or webhook verification fails here
// instead of in production checkout. (stripe-routes.test.mjs mocks this
// module out entirely, so it can't catch SDK regressions.)

const WEBHOOK_SECRET = "whsec_test_fake_secret";

async function startFakeStripe(t) {
  const requests = [];
  const server = http.createServer(function (req, res) {
    let body = "";
    req.on("data", function (chunk) {
      body += chunk;
    });
    req.on("end", function () {
      requests.push({
        method: req.method,
        path: req.url,
        stripeVersion: req.headers["stripe-version"],
        authorization: req.headers.authorization,
        params: new URLSearchParams(body),
      });
      let payload = { id: "unknown", object: "unknown" };
      if (req.url === "/v1/checkout/sessions") {
        payload = {
          id: "cs_test_1",
          object: "checkout.session",
          url: "https://checkout.stripe.test/cs_test_1",
        };
      } else if (req.url === "/v1/billing_portal/sessions") {
        payload = {
          id: "bps_test_1",
          object: "billing_portal.session",
          url: "https://billing.stripe.test/bps_test_1",
        };
      } else if (req.url.startsWith("/v1/subscriptions/sub_test_1")) {
        payload = {
          id: "sub_test_1",
          object: "subscription",
          status: req.method === "DELETE" ? "canceled" : "trialing",
        };
      }
      res.writeHead(200, { "content-type": "application/json", "request-id": "req_test" });
      res.end(JSON.stringify(payload));
    });
  });
  await new Promise(function (resolve) {
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(function () {
    server.close();
  });
  return { requests, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

function buildConfig(baseUrl) {
  return {
    stripeSecretKey: "sk_test_fake",
    stripeWebhookSecret: WEBHOOK_SECRET,
    stripeFeaturedPriceId: "price_test_featured",
    stripeReturnUrlBase: "https://example.com/",
    stripeTrialDays: 14,
    stripeApiBaseUrl: baseUrl,
  };
}

test("createFeaturedCheckoutSession sends the expected request through the SDK", async (t) => {
  const fake = await startFakeStripe(t);
  const result = await createFeaturedCheckoutSession(buildConfig(fake.baseUrl), {
    therapistSlug: "jamie-rivera",
    customerEmail: "jamie@example.com",
  });

  assert.equal(result.id, "cs_test_1");
  assert.equal(result.url, "https://checkout.stripe.test/cs_test_1");
  assert.equal(fake.requests.length, 1);
  const req = fake.requests[0];
  assert.equal(req.method, "POST");
  assert.equal(req.path, "/v1/checkout/sessions");
  assert.equal(req.stripeVersion, "2025-03-31.basil");
  assert.equal(req.authorization, "Bearer sk_test_fake");
  assert.equal(req.params.get("mode"), "subscription");
  assert.equal(req.params.get("line_items[0][price]"), "price_test_featured");
  assert.equal(req.params.get("line_items[0][quantity]"), "1");
  assert.equal(req.params.get("subscription_data[trial_period_days]"), "14");
  assert.equal(req.params.get("subscription_data[metadata][therapist_slug]"), "jamie-rivera");
  assert.equal(req.params.get("metadata[therapist_slug]"), "jamie-rivera");
  assert.equal(req.params.get("customer_email"), "jamie@example.com");
  assert.equal(req.params.get("allow_promotion_codes"), "true");
  assert.equal(
    req.params.get("success_url"),
    "https://example.com/portal?stripe=success&slug=jamie-rivera&session_id={CHECKOUT_SESSION_ID}",
  );
  assert.equal(
    req.params.get("cancel_url"),
    "https://example.com/portal?stripe=cancel&slug=jamie-rivera",
  );
});

test("createBillingPortalSession sends the expected request through the SDK", async (t) => {
  const fake = await startFakeStripe(t);
  const result = await createBillingPortalSession(buildConfig(fake.baseUrl), {
    customerId: "cus_test_1",
    returnPath: "/portal?slug=jamie-rivera",
  });

  assert.equal(result.url, "https://billing.stripe.test/bps_test_1");
  const req = fake.requests[0];
  assert.equal(req.method, "POST");
  assert.equal(req.path, "/v1/billing_portal/sessions");
  assert.equal(req.stripeVersion, "2025-03-31.basil");
  assert.equal(req.params.get("customer"), "cus_test_1");
  assert.equal(req.params.get("return_url"), "https://example.com/portal?slug=jamie-rivera");
});

test("retrieveSubscription and cancelSubscriptionImmediately hit the subscription resource", async (t) => {
  const fake = await startFakeStripe(t);
  const config = buildConfig(fake.baseUrl);

  const retrieved = await retrieveSubscription(config, "sub_test_1");
  assert.equal(retrieved.status, "trialing");
  const canceled = await cancelSubscriptionImmediately(config, "sub_test_1");
  assert.equal(canceled.status, "canceled");

  assert.deepEqual(
    fake.requests.map((req) => `${req.method} ${req.path}`),
    ["GET /v1/subscriptions/sub_test_1", "DELETE /v1/subscriptions/sub_test_1"],
  );
});

test("verifyAndParseWebhook accepts a valid signature and rejects bad or stale ones", async () => {
  const config = buildConfig("http://127.0.0.1:1");
  const payload = JSON.stringify({
    id: "evt_test_1",
    object: "event",
    type: "customer.subscription.updated",
    data: { object: { id: "sub_test_1", object: "subscription" } },
  });

  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const event = await verifyAndParseWebhook(config, payload, header);
  assert.equal(event.id, "evt_test_1");
  assert.equal(event.type, "customer.subscription.updated");

  const wrongSecret = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: "whsec_someone_else",
  });
  await assert.rejects(() => verifyAndParseWebhook(config, payload, wrongSecret));

  await assert.rejects(() =>
    verifyAndParseWebhook(config, payload.replace("evt_test_1", "evt_forged"), header),
  );

  // Default tolerance is 300s; a 10-minute-old signature must be rejected.
  const stale = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
    timestamp: Math.floor(Date.now() / 1000) - 600,
  });
  await assert.rejects(() => verifyAndParseWebhook(config, payload, stale));
});
