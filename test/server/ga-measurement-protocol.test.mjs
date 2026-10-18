import test from "node:test";
import assert from "node:assert/strict";

import { sendGaEvent } from "../../server/ga-measurement-protocol.mjs";

const EVENT = { clientId: "stripe.cus_1", name: "purchase", params: { value: 49 } };

test("sendGaEvent is a no-op without an API secret", async () => {
  let called = false;
  const ok = await sendGaEvent({ gaMeasurementId: "G-X", gaApiSecret: "" }, EVENT, {
    fetchImpl: async () => {
      called = true;
      return { ok: true };
    },
  });
  assert.equal(ok, false);
  assert.equal(called, false);
});

test("sendGaEvent posts the event when configured", async () => {
  let seen = null;
  const ok = await sendGaEvent({ gaMeasurementId: "G-X", gaApiSecret: "secret" }, EVENT, {
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return { ok: true };
    },
  });
  assert.equal(ok, true);
  assert.match(seen.url, /measurement_id=G-X&api_secret=secret/);
  assert.equal(JSON.parse(seen.init.body).events[0].name, "purchase");
});

test("sendGaEvent swallows network errors", async () => {
  const ok = await sendGaEvent({ gaMeasurementId: "G-X", gaApiSecret: "secret" }, EVENT, {
    fetchImpl: async () => {
      throw new Error("boom");
    },
  });
  assert.equal(ok, false);
});
