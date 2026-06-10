import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { handleResendWebhookRoutes } from "../../server/review-resend-webhook-routes.mjs";
import { createResponseCapture } from "./test-helpers.mjs";

// The Resend webhook is an inbound, Svix-signed endpoint that flips a
// therapist's outreach status on bounce/complaint and stamps opens — and it
// had zero tests. It's a classic silent-failure surface: a signature-verify
// regression would either reject every real Resend event (CRM stops learning
// about bounces) or, worse, accept forged ones (an attacker could mark any
// therapist as bounced/opted-out and kill outreach). These tests pin the
// signature gate, the event routing, and the bounce-protection rules.

const SECRET = "whsec_" + Buffer.from("resend-test-signing-key").toString("base64");

// Mirror of verifySvixSignature in the route: HMAC-SHA256 over
// `${id}.${timestamp}.${body}` with the base64-decoded secret, base64 result,
// emitted as a `v1,<sig>` header entry.
function signSvix(body, { id = "msg_1", timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const cleaned = SECRET.slice("whsec_".length);
  const secretBytes = Buffer.from(cleaned, "base64");
  const sig = crypto
    .createHmac("sha256", secretBytes)
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  return { id, timestamp: String(timestamp), signature: `v1,${sig}` };
}

// Minimal Sanity client double. The handler's GROQ (`$resendId in
// outreach.emailLog[].resendId`, `lower(email) in $emails`) is richer than the
// shared in-memory client models, so we resolve fetches from canned results
// keyed by query shape and record every patch for assertions.
function fakeClient({ byResendId = [], byEmail = [], opened = null } = {}) {
  const patches = [];
  return {
    patches,
    async fetch(query) {
      const isOpenedLookup = query.includes("emailLog[].resendId") && query.includes("[0]");
      if (isOpenedLookup) return opened;
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

function runWebhook({ client, body, headers, method = "POST" }) {
  const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
  const response = createResponseCapture();
  const request = { method, headers: headers || {} };
  const context = {
    client,
    request,
    response,
    routePath: "/webhooks/resend",
    deps: { parseRawBody: async () => bodyStr },
  };
  return { promise: handleResendWebhookRoutes(context), response };
}

function signedHeaders(bodyStr, opts) {
  const { id, timestamp, signature } = signSvix(bodyStr, opts);
  return { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": signature };
}

function withSecret(run) {
  const original = process.env.RESEND_WEBHOOK_SECRET;
  process.env.RESEND_WEBHOOK_SECRET = SECRET;
  return Promise.resolve()
    .then(run)
    .finally(() => {
      if (original === undefined) delete process.env.RESEND_WEBHOOK_SECRET;
      else process.env.RESEND_WEBHOOK_SECRET = original;
    });
}

test("returns 503 when the signing secret is not configured", async () => {
  const original = process.env.RESEND_WEBHOOK_SECRET;
  delete process.env.RESEND_WEBHOOK_SECRET;
  try {
    const { promise, response } = runWebhook({ client: fakeClient(), body: { type: "x" } });
    await promise;
    assert.equal(response.statusCode, 503);
  } finally {
    if (original !== undefined) process.env.RESEND_WEBHOOK_SECRET = original;
  }
});

test("rejects non-POST methods with 405", async () => {
  await withSecret(async () => {
    const { promise, response } = runWebhook({
      client: fakeClient(),
      body: {},
      method: "GET",
    });
    await promise;
    assert.equal(response.statusCode, 405);
  });
});

test("rejects a forged/invalid signature with 401", async () => {
  await withSecret(async () => {
    const body = JSON.stringify({ type: "email.bounced", data: { to: ["x@y.com"] } });
    const { promise, response } = runWebhook({
      client: fakeClient(),
      body,
      headers: {
        "svix-id": "msg_1",
        "svix-timestamp": String(Math.floor(Date.now() / 1000)),
        "svix-signature": "v1,not-a-real-signature",
      },
    });
    await promise;
    assert.equal(response.statusCode, 401);
  });
});

test("rejects a stale timestamp (replay) even with an otherwise-valid signature", async () => {
  await withSecret(async () => {
    const body = JSON.stringify({ type: "email.bounced", data: { to: ["x@y.com"] } });
    const staleTs = Math.floor(Date.now() / 1000) - 6 * 60; // 6 min old, >5 min window
    const { promise, response } = runWebhook({
      client: fakeClient(),
      body,
      headers: signedHeaders(body, { timestamp: staleTs }),
    });
    await promise;
    assert.equal(response.statusCode, 401);
  });
});

test("returns 400 on a validly-signed but non-JSON body", async () => {
  await withSecret(async () => {
    const body = "this is not json";
    const { promise, response } = runWebhook({
      client: fakeClient(),
      body,
      headers: signedHeaders(body),
    });
    await promise;
    assert.equal(response.statusCode, 400);
  });
});

test("email.bounced flips the matched therapist to bounced and appends a log entry", async () => {
  await withSecret(async () => {
    const client = fakeClient({
      byEmail: [
        { _id: "therapist-1", name: "Dr. A", email: "a@x.com", outreach: { status: "sent" } },
      ],
    });
    const body = JSON.stringify({
      type: "email.bounced",
      data: { to: ["a@x.com"], bounce: { type: "hard", message: "mailbox not found" } },
    });
    const { promise, response } = runWebhook({ client, body, headers: signedHeaders(body) });
    await promise;
    assert.equal(response.statusCode, 200);
    assert.deepEqual(
      { matched: response.payload.matched, patched: response.payload.patched },
      { matched: 1, patched: 1 },
    );
    assert.equal(client.patches.length, 1);
    assert.equal(client.patches[0].set["outreach.status"], "bounced");
    assert.match(client.patches[0].set["outreach.notes"], /Resend bounce: hard/);
    assert.equal(client.patches[0].set["outreach.emailLog"].length, 1);
  });
});

test("email.bounced prefers the resendId match over address matching", async () => {
  await withSecret(async () => {
    const client = fakeClient({
      byResendId: [{ _id: "by-id", email: "a@x.com", outreach: { status: "sent" } }],
      byEmail: [{ _id: "by-email", email: "a@x.com", outreach: { status: "sent" } }],
    });
    const body = JSON.stringify({
      type: "email.bounced",
      data: { to: ["a@x.com"], email_id: "re_123", bounce: { type: "hard" } },
    });
    const { promise } = runWebhook({ client, body, headers: signedHeaders(body) });
    await promise;
    assert.equal(client.patches.length, 1);
    assert.equal(client.patches[0].id, "by-id", "resendId match must win over email match");
  });
});

test("a late bounce does NOT overwrite a terminal status (paid/claimed/replied)", async () => {
  await withSecret(async () => {
    const client = fakeClient({
      byEmail: [{ _id: "therapist-paid", email: "a@x.com", outreach: { status: "paid" } }],
    });
    const body = JSON.stringify({
      type: "email.bounced",
      data: { to: ["a@x.com"], bounce: { type: "hard" } },
    });
    const { promise, response } = runWebhook({ client, body, headers: signedHeaders(body) });
    await promise;
    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.patched, 0);
    assert.equal(response.payload.skippedTerminal, 1);
    assert.equal(client.patches.length, 0, "terminal status must be left untouched");
  });
});

test("email.complained flips to opted_out even when the prior status is terminal", async () => {
  await withSecret(async () => {
    const client = fakeClient({
      byEmail: [{ _id: "therapist-paid", email: "a@x.com", outreach: { status: "paid" } }],
    });
    const body = JSON.stringify({ type: "email.complained", data: { to: ["a@x.com"] } });
    const { promise, response } = runWebhook({ client, body, headers: signedHeaders(body) });
    await promise;
    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.patched, 1);
    assert.equal(client.patches[0].set["outreach.status"], "opted_out");
  });
});

test("email.opened stamps openedAt on the originating log entry (first open wins)", async () => {
  await withSecret(async () => {
    const client = fakeClient({
      opened: {
        _id: "therapist-1",
        outreach: { emailLog: [{ resendId: "re_open", sentAt: "2026-01-01T00:00:00.000Z" }] },
      },
    });
    const body = JSON.stringify({ type: "email.opened", data: { email_id: "re_open" } });
    const { promise, response } = runWebhook({ client, body, headers: signedHeaders(body) });
    await promise;
    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.opened, 1);
    assert.equal(client.patches.length, 1);
    assert.ok("outreach.emailLog[0].openedAt" in client.patches[0].set);
  });
});

test("email.opened is idempotent — a second open does not re-patch", async () => {
  await withSecret(async () => {
    const client = fakeClient({
      opened: {
        _id: "therapist-1",
        outreach: {
          emailLog: [{ resendId: "re_open", openedAt: "2026-01-02T00:00:00.000Z" }],
        },
      },
    });
    const body = JSON.stringify({ type: "email.opened", data: { email_id: "re_open" } });
    const { promise, response } = runWebhook({ client, body, headers: signedHeaders(body) });
    await promise;
    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.alreadyOpened, true);
    assert.equal(client.patches.length, 0);
  });
});

test("unrecognized event types are acked as a no-op without patching", async () => {
  await withSecret(async () => {
    const client = fakeClient({
      byEmail: [{ _id: "t1", email: "a@x.com", outreach: { status: "sent" } }],
    });
    const body = JSON.stringify({ type: "email.delivered", data: { to: ["a@x.com"] } });
    const { promise, response } = runWebhook({ client, body, headers: signedHeaders(body) });
    await promise;
    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.noop, true);
    assert.equal(client.patches.length, 0);
  });
});

test("a bounce that matches no therapist acks with matched: 0", async () => {
  await withSecret(async () => {
    const client = fakeClient({ byEmail: [] });
    const body = JSON.stringify({
      type: "email.bounced",
      data: { to: ["nobody@x.com"], bounce: { type: "hard" } },
    });
    const { promise, response } = runWebhook({ client, body, headers: signedHeaders(body) });
    await promise;
    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.matched, 0);
  });
});
