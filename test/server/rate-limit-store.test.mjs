import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  getRateLimiter,
  makeRedisLimiter,
  resetRateLimitStateForTests,
} from "../../server/rate-limit-store.mjs";

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

  it("aligns the window to fixed boundaries so it resets at the next boundary, not first-attempt + windowMs", function (t) {
    t.mock.timers.enable({ apis: ["Date"] });
    // First attempt lands 7s into a 10s-aligned window [0, 10000).
    t.mock.timers.setTime(7_000);
    const limiter = getRateLimiter("align", 10_000, 2, {});
    return (async function () {
      await limiter.record("ip");
      await limiter.record("ip");
      assert.equal(await limiter.canAttempt("ip"), false, "at cap within the window");

      // Just before the aligned boundary at 10000 — still blocked.
      t.mock.timers.setTime(9_999);
      assert.equal(await limiter.canAttempt("ip"), false, "still within the aligned window");

      // Past the aligned boundary — window resets. With a first-attempt-anchored
      // window this would not reset until 17000, so this distinguishes the two.
      t.mock.timers.setTime(10_001);
      assert.equal(await limiter.canAttempt("ip"), true, "resets at the aligned boundary");
    })();
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

  it("falls back to an in-memory limiter (not fail-open) when Redis errors", async function () {
    // Stub client whose every op rejects, simulating an Upstash outage.
    const failingClient = {
      get: async () => {
        throw new Error("redis down");
      },
      incr: async () => {
        throw new Error("redis down");
      },
      expire: async () => {
        throw new Error("redis down");
      },
      del: async () => {
        throw new Error("redis down");
      },
    };
    const limiter = makeRedisLimiter("outage", 60_000, 2, failingClient);
    // Under the cap, attempts are allowed via the in-memory fallback...
    assert.equal(await limiter.canAttempt("ip"), true);
    await limiter.record("ip");
    await limiter.record("ip");
    // ...and the cap is still enforced, rather than failing open forever.
    assert.equal(await limiter.canAttempt("ip"), false);
  });
});
