import assert from "node:assert/strict";
import test from "node:test";

import { isAuthorizedCronRequest } from "../../server/cron-auth.mjs";

// This is the auth gate for every scheduled job (DCA freshness checks,
// license-expiration warnings, digests). It must fail CLOSED: a missing
// CRON_SECRET rejects all traffic rather than running the cron wide open.

function request(authorization) {
  return { headers: authorization === undefined ? {} : { authorization } };
}

test("accepts the exact Bearer token", () => {
  assert.equal(
    isAuthorizedCronRequest(request("Bearer cron-secret-1"), { cronSecret: "cron-secret-1" }),
    true,
  );
});

test("rejects a wrong token of the same length", () => {
  assert.equal(
    isAuthorizedCronRequest(request("Bearer cron-secret-2"), { cronSecret: "cron-secret-1" }),
    false,
  );
});

test("rejects a token with the wrong length", () => {
  assert.equal(
    isAuthorizedCronRequest(request("Bearer short"), { cronSecret: "cron-secret-1" }),
    false,
  );
});

test("rejects the bare secret without the Bearer prefix", () => {
  assert.equal(
    isAuthorizedCronRequest(request("cron-secret-1"), { cronSecret: "cron-secret-1" }),
    false,
  );
});

test("scheme is case-sensitive: 'bearer' is rejected", () => {
  assert.equal(
    isAuthorizedCronRequest(request("bearer cron-secret-1"), { cronSecret: "cron-secret-1" }),
    false,
  );
});

test("rejects when the Authorization header is missing", () => {
  assert.equal(isAuthorizedCronRequest(request(undefined), { cronSecret: "cron-secret-1" }), false);
});

test("fails closed when CRON_SECRET is not configured, even if a header is sent", () => {
  assert.equal(isAuthorizedCronRequest(request("Bearer anything"), { cronSecret: "" }), false);
  assert.equal(isAuthorizedCronRequest(request("Bearer anything"), {}), false);
  assert.equal(isAuthorizedCronRequest(request("Bearer anything"), null), false);
});

test("fails closed when the secret is unset and the header is an empty Bearer", () => {
  // The degenerate pair (no secret, "Bearer ") must not slip through any
  // string-concatenation equality.
  assert.equal(isAuthorizedCronRequest(request("Bearer "), { cronSecret: "" }), false);
});

test("tolerates a malformed request object", () => {
  assert.equal(isAuthorizedCronRequest(null, { cronSecret: "cron-secret-1" }), false);
  assert.equal(isAuthorizedCronRequest({}, { cronSecret: "cron-secret-1" }), false);
});
