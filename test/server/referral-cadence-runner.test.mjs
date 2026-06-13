import test from "node:test";
import assert from "node:assert/strict";

import { runReferralCadence } from "../../server/referral-cadence-runner.mjs";

const NOW = "2026-06-13T12:00:00.000Z";

// Fake Sanity client: fetch returns the canned contact list; getDocument/patch
// support the send path. Records patches for assertions.
function fakeClient(contacts) {
  const patches = [];
  const byId = new Map(contacts.map((c) => [c._id, c]));
  return {
    patches,
    async fetch() {
      return contacts;
    },
    async getDocument(id) {
      return byId.get(id) || null;
    },
    patch(id) {
      const op = { id, set: null };
      const builder = {
        set(value) {
          op.set = value;
          return builder;
        },
        commit() {
          patches.push(op);
          return Promise.resolve({ _id: id });
        },
      };
      return builder;
    },
  };
}

function withEnv(overrides, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(overrides)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });
}

test("no-ops when REFERRAL_CADENCE_ENABLED is unset", async () => {
  await withEnv({ REFERRAL_CADENCE_ENABLED: undefined }, async () => {
    const result = await runReferralCadence({ client: fakeClient([]), nowIso: NOW });
    assert.equal(result.enabled, false);
    assert.equal(result.sent, 0);
  });
});

test("enabled but missing send config returns an error, sends nothing", async () => {
  await withEnv(
    {
      REFERRAL_CADENCE_ENABLED: "true",
      RESEND_API_KEY: undefined,
    },
    async () => {
      const result = await runReferralCadence({ client: fakeClient([]), nowIso: NOW });
      assert.equal(result.enabled, true);
      assert.equal(result.sent, 0);
      assert.ok(result.error);
    },
  );
});

test("sends the due touch end-to-end and records it", async () => {
  const contacts = [
    { _id: "c1", _type: "referralContact", email: "nobody@example.org", status: "new" },
  ];
  const client = fakeClient(contacts);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ id: "re_test" }) });
  try {
    await withEnv(
      {
        REFERRAL_CADENCE_ENABLED: "true",
        RESEND_API_KEY: "key",
        OUTREACH_REFERRAL_EMAIL_FROM: undefined,
        OUTREACH_EMAIL_FROM: "Founder <founder@bipolartherapyhub.com>",
        OUTREACH_FOOTER_ADDRESS: "PO Box 1, CA",
      },
      async () => {
        const result = await runReferralCadence({ client, nowIso: NOW });
        assert.equal(result.enabled, true);
        assert.equal(result.sent, 1);
        assert.equal(result.failed, 0);
        // The send was recorded onto the contact.
        assert.equal(client.patches.length, 1);
        assert.equal(client.patches[0].set.status, "contacted");
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
