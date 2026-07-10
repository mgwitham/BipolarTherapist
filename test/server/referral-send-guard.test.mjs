import assert from "node:assert/strict";
import test from "node:test";

import { createReviewApiHandler } from "../../server/review-handler.mjs";
import { ADMIN_SESSION_COOKIE } from "../../server/review-http-auth.mjs";
import {
  createMemoryClient,
  createTestApiConfig,
  readSetCookieHeader,
  runHandlerRequest,
} from "./test-helpers.mjs";

async function loginAsAdmin(handler) {
  const res = await runHandlerRequest(handler, {
    body: { username: "architect", password: "secret-pass" },
    headers: { host: "localhost:8787" },
    method: "POST",
    url: "/auth/login",
  });
  assert.equal(res.statusCode, 200);
  const cookie = readSetCookieHeader(res, ADMIN_SESSION_COOKIE);
  assert.ok(cookie);
  return cookie;
}

function handlerWithContact(contact) {
  const { client } = createMemoryClient({ [contact._id]: contact });
  return createReviewApiHandler(createTestApiConfig(), client);
}

async function attemptSend(handler, cookie, contactId) {
  return runHandlerRequest(handler, {
    body: { contactId },
    headers: { cookie, host: "localhost:8787" },
    method: "POST",
    url: "/admin/send-referral-email",
  });
}

// A bounced or complained address must be refused by the manual send button,
// not only the automated cadence — otherwise a dead address stays sendable by
// hand and the list can never be kept clean.
for (const status of ["bounced", "complained", "opted_out"]) {
  test(`manual referral send is blocked for a ${status} contact`, async () => {
    const handler = handlerWithContact({
      _id: `referralContact.${status}`,
      _type: "referralContact",
      email: "dead@example.com",
      segment: "prescriber",
      status,
    });
    const cookie = await loginAsAdmin(handler);
    const res = await attemptSend(handler, cookie, `referralContact.${status}`);
    assert.equal(res.statusCode, 403, JSON.stringify(res.payload));
    assert.equal(res.payload.error, "suppressed");
  });
}

// An engaged contact is a live conversation — a manual reply must still go
// through. (It halts the automated cadence, but that is a different path.)
test("manual referral send is allowed for an engaged contact (not delivery-terminal)", async () => {
  const handler = handlerWithContact({
    _id: "referralContact.engaged",
    _type: "referralContact",
    email: "live@example.com",
    segment: "prescriber",
    status: "engaged",
  });
  const cookie = await loginAsAdmin(handler);
  const res = await attemptSend(handler, cookie, "referralContact.engaged");
  // Not a 403 suppression block. It may fail later for missing send config in
  // the test env, but it must get PAST the terminal-status guard.
  assert.notEqual(res.statusCode, 403);
});
