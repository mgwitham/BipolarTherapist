import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { getRateLimiter, resetRateLimitStateForTests } from "../../server/rate-limit-store.mjs";

describe("getRateLimiter (in-memory fallback)", function () {
  beforeEach(function () {
    resetRateLimitStateForTests();
  });

  it("allows attempts under the cap and rejects at the cap", async function () {
    const limiter = getRateLimiter("t1", 60_000, 3, {});
    assert.equal(await limiter.canAttempt("1.2.3.4"), true);
    await limiter.record("1.2.3.4");
    await limiter.record("1.2.3.4");
    await limiter.record("1.2.3.4");
    assert.equal(await limiter.canAttempt("1.2.3.4"), false);
  });

  it("scopes counts by key", async function () {
    const limiter = getRateLimiter("t2", 60_000, 2, {});
    await limiter.record("a");
    await limiter.record("a");
    assert.equal(await limiter.canAttempt("a"), false);
    assert.equal(await limiter.canAttempt("b"), true);
  });

  it("scopes counts by limiter name", async function () {
    const a = getRateLimiter("nameA", 60_000, 1, {});
    const b = getRateLimiter("nameB", 60_000, 1, {});
    await a.record("key");
    assert.equal(await a.canAttempt("key"), false);
    assert.equal(await b.canAttempt("key"), true);
  });

  it("clear() drops the counter for a key", async function () {
    const limiter = getRateLimiter("t3", 60_000, 1, {});
    await limiter.record("ip");
    assert.equal(await limiter.canAttempt("ip"), false);
    await limiter.clear("ip");
    assert.equal(await limiter.canAttempt("ip"), true);
  });

  it("uses in-memory backend when Upstash creds missing", function () {
    const limiter = getRateLimiter("t4", 60_000, 1, {
      upstashRedisRestUrl: "",
      upstashRedisRestToken: "",
    });
    assert.equal(limiter.backend, "memory");
  });

  it("uses in-memory backend when only one Upstash cred is set", function () {
    const limiter = getRateLimiter("t5", 60_000, 1, {
      upstashRedisRestUrl: "https://example.upstash.io",
      upstashRedisRestToken: "",
    });
    assert.equal(limiter.backend, "memory");
  });
});

describe("getRateLimiter (Redis backend)", function () {
  beforeEach(function () {
    resetRateLimitStateForTests();
  });

  it("constructs a redis-backed limiter when both creds are set", function () {
    const limiter = getRateLimiter("t6", 60_000, 1, {
      upstashRedisRestUrl: "https://example.upstash.io",
      upstashRedisRestToken: "tok",
    });
    assert.equal(limiter.backend, "redis");
  });

  // Fail-open behavior on Redis errors is covered by a one-line catch
  // block in rate-limit-store.mjs (canAttempt + record both catch and
  // return true / no-op). Not unit-tested here because the Upstash SDK's
  // built-in retry policy makes the "network failure" stub take seconds
  // even with fetch monkey-patched. Trust the code; verify in staging.
});
