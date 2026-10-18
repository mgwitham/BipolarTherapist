import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMeasurementProtocolRequest,
  buildTherapistLifecycleGaEvent,
} from "../../shared/ga-measurement-protocol.mjs";

const SUB = {
  therapistSlug: "jamie-rivera",
  stripeCustomerId: "cus_1",
  stripeSubscriptionId: "sub_1",
  priceCents: 4900,
  currency: "usd",
  tier: "regular",
  interval: "month",
};

test("trial_started carries plan and value under a stripe-derived client id", () => {
  const event = buildTherapistLifecycleGaEvent("trial_started", SUB);
  assert.equal(event.clientId, "stripe.cus_1");
  assert.equal(event.name, "trial_started");
  assert.equal(event.params.value, 49);
  assert.equal(event.params.currency, "USD");
  assert.equal(event.params.plan_interval, "month");
  assert.equal(event.params.engagement_time_msec, 1);
});

test("purchase has a stable transaction id for redelivery dedupe and an item", () => {
  const event = buildTherapistLifecycleGaEvent("purchase", SUB);
  assert.equal(event.name, "purchase");
  assert.equal(event.params.transaction_id, "sub_1_first_paid");
  assert.equal(event.params.value, 49);
  assert.equal(event.params.items.length, 1);
  assert.equal(event.params.items[0].price, 49);
});

test("missing customer or subscription yields no event", () => {
  assert.equal(buildTherapistLifecycleGaEvent("purchase", { ...SUB, stripeCustomerId: "" }), null);
  assert.equal(
    buildTherapistLifecycleGaEvent("purchase", { ...SUB, stripeSubscriptionId: "" }),
    null,
  );
  assert.equal(buildTherapistLifecycleGaEvent("nope", SUB), null);
  assert.equal(buildTherapistLifecycleGaEvent("purchase", undefined), null);
});

test("measurement protocol request needs both credentials", () => {
  const event = buildTherapistLifecycleGaEvent("purchase", SUB);
  assert.equal(
    buildMeasurementProtocolRequest({ measurementId: "G-X", apiSecret: "" }, event),
    null,
  );
  const req = buildMeasurementProtocolRequest(
    { measurementId: "G-X", apiSecret: "s3 cret" },
    event,
  );
  assert.match(
    req.url,
    /^https:\/\/www\.google-analytics\.com\/mp\/collect\?measurement_id=G-X&api_secret=s3%20cret$/,
  );
  const body = JSON.parse(req.body);
  assert.equal(body.client_id, "stripe.cus_1");
  assert.equal(body.events[0].name, "purchase");
});
