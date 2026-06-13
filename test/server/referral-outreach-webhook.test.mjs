import assert from "node:assert/strict";
import test from "node:test";

import {
  applyReferralDeliveryEvent,
  stampReferralOpen,
} from "../../server/referral-outreach-webhook.mjs";

// Minimal Sanity client double, keyed by query shape (the real GROQ is richer
// than the shared in-memory client models). Records every patch for assertions.
function fakeClient({ openedDoc = null, byResendId = [], byEmail = [] } = {}) {
  const patches = [];
  return {
    patches,
    async fetch(query) {
      if (query.includes("emailLog[].resendId") && query.includes("[0]")) return openedDoc;
      if (query.includes("emailLog[].resendId")) return byResendId;
      if (query.includes("lower(email) in $emails")) return byEmail;
      return [];
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

test("stampReferralOpen stamps openedAt on the matching log entry", async () => {
  const client = fakeClient({
    openedDoc: { _id: "c1", emailLog: [{ resendId: "re_1" }, { resendId: "re_2" }] },
  });
  const result = await stampReferralOpen(client, "re_2");
  assert.equal(result.opened, 1);
  assert.equal(client.patches.length, 1);
  assert.ok("emailLog[1].openedAt" in client.patches[0].set);
});

test("stampReferralOpen is idempotent when already opened", async () => {
  const client = fakeClient({
    openedDoc: { _id: "c1", emailLog: [{ resendId: "re_1", openedAt: "2026-06-01T00:00:00Z" }] },
  });
  const result = await stampReferralOpen(client, "re_1");
  assert.equal(result.alreadyOpened, true);
  assert.equal(client.patches.length, 0);
});

test("stampReferralOpen reports no match", async () => {
  const result = await stampReferralOpen(fakeClient({ openedDoc: null }), "re_x");
  assert.equal(result.matched, 0);
});

test("applyReferralDeliveryEvent: complaint opts the contact out", async () => {
  const client = fakeClient({ byResendId: [{ _id: "c1", status: "contacted", emailLog: [] }] });
  const result = await applyReferralDeliveryEvent(client, {
    type: "email.complained",
    resendId: "re_1",
    recipients: ["a@b.com"],
    newStatus: "opted_out",
    noteSuffix: "complaint",
    now: "2026-06-13T12:00:00.000Z",
  });
  assert.equal(result.patched, 1);
  const set = client.patches[0].set;
  assert.equal(set.status, "opted_out");
  assert.equal(set.optedOut, true);
  assert.equal(set.optedOutReason, "spam complaint (Resend)");
});

test("applyReferralDeliveryEvent: bounce flips status to bounced", async () => {
  const client = fakeClient({ byResendId: [{ _id: "c1", status: "contacted", emailLog: [] }] });
  const result = await applyReferralDeliveryEvent(client, {
    type: "email.bounced",
    resendId: "re_1",
    recipients: [],
    newStatus: "bounced",
    noteSuffix: "bounce",
    now: "2026-06-13T12:00:00.000Z",
  });
  assert.equal(result.patched, 1);
  assert.equal(client.patches[0].set.status, "bounced");
  assert.equal(client.patches[0].set.optedOut, undefined);
});

test("applyReferralDeliveryEvent: a bounce does not overwrite a replied contact", async () => {
  const client = fakeClient({ byResendId: [{ _id: "c1", status: "replied", emailLog: [] }] });
  const result = await applyReferralDeliveryEvent(client, {
    type: "email.bounced",
    resendId: "re_1",
    recipients: [],
    newStatus: "bounced",
    noteSuffix: "bounce",
    now: "2026-06-13T12:00:00.000Z",
  });
  assert.equal(result.patched, 0);
  assert.equal(result.skippedTerminal, 1);
  assert.equal(client.patches.length, 0);
});

test("applyReferralDeliveryEvent: falls back to address match when no resendId hit", async () => {
  const client = fakeClient({
    byResendId: [],
    byEmail: [{ _id: "c2", status: "new", emailLog: [] }],
  });
  const result = await applyReferralDeliveryEvent(client, {
    type: "email.complained",
    resendId: "",
    recipients: ["A@B.com"],
    newStatus: "opted_out",
    noteSuffix: "complaint",
    now: "2026-06-13T12:00:00.000Z",
  });
  assert.equal(result.matched, 1);
  assert.equal(client.patches[0].id, "c2");
});

test("applyReferralDeliveryEvent: no match is a clean no-op", async () => {
  const result = await applyReferralDeliveryEvent(fakeClient(), {
    type: "email.bounced",
    resendId: "re_x",
    recipients: ["none@x.com"],
    newStatus: "bounced",
    noteSuffix: "bounce",
    now: "2026-06-13T12:00:00.000Z",
  });
  assert.equal(result.matched, 0);
  assert.equal(result.patched, 0);
});
