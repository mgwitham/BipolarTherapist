// Rate-limit storage backend.
//
// When UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set,
// rate limits use Upstash Redis (REST API), which survives Vercel
// serverless cold starts and is shared across concurrent function
// invocations.
//
// When the env vars are unset (e.g. local dev, or before Upstash is
// provisioned in prod), every call falls back to an in-process Map.
// Behavior is identical to the original in-memory implementation —
// resets on cold start, scoped to one process.
//
// All callers see the same async surface either way:
//   const limiter = await getRateLimiter(name, windowMs, maxAttempts, config);
//   const ok = await limiter.canAttempt(key);
//   await limiter.record(key);
//   await limiter.clear(key);  // intake/portal don't use clear; admin login does
//
// Fixed-window counter: windows are aligned to floor(now/windowMs)*windowMs
// boundaries (both the Redis and in-memory backends), and the counter
// increments until the window expires at the next boundary. Aligning the
// in-memory window to the same boundary the Redis bucket uses keeps the
// handler's Retry-After math (time to next boundary) accurate on either
// backend.

import { Redis } from "@upstash/redis";
import { log } from "./logger.mjs";
import { Sentry } from "./sentry.mjs";

let cachedClient = null;

// Throttle Redis-outage alerting so a sustained outage logs/reports once a
// minute per limiter rather than on every request. Keyed by limiter name.
const lastAlertAt = new Map();
function alertRedisFailure(name, err) {
  const now = Date.now();
  const last = lastAlertAt.get(name) || 0;
  if (now - last < 60_000) return;
  lastAlertAt.set(name, now);
  log.warn("[ratelimit] redis unavailable, falling back to in-memory limiter", {
    limiter: name,
    error: err && err.message ? err.message : String(err),
  });
  try {
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)), {
      tags: { subsystem: "rate-limit", limiter: name },
    });
  } catch (_err) {
    // never let alerting throw and break the rate-limit path
  }
}

function getRedisClient(config) {
  if (!config || !config.upstashRedisRestUrl || !config.upstashRedisRestToken) {
    return null;
  }
  if (cachedClient) return cachedClient;
  cachedClient = new Redis({
    url: config.upstashRedisRestUrl,
    token: config.upstashRedisRestToken,
  });
  return cachedClient;
}

// In-process fallback stores. One Map per limiter name so different
// limiters (intake, portal, admin-login) don't collide.
const inMemoryStores = new Map();
function getInMemoryStore(name) {
  let store = inMemoryStores.get(name);
  if (!store) {
    store = new Map();
    inMemoryStores.set(name, store);
  }
  return store;
}

function purgeExpired(store, windowMs) {
  const now = Date.now();
  for (const [key, value] of store.entries()) {
    if (!value || now - value.windowStartedAt > windowMs) {
      store.delete(key);
    }
  }
}

function makeInMemoryLimiter(name, windowMs, maxAttempts) {
  const store = getInMemoryStore(name);
  return {
    backend: "memory",
    async canAttempt(key) {
      purgeExpired(store, windowMs);
      const record = store.get(key);
      return !record || record.count < maxAttempts;
    },
    async record(key) {
      purgeExpired(store, windowMs);
      const existing = store.get(key);
      if (!existing) {
        // Anchor the window to the aligned boundary (floor(now/windowMs)*windowMs),
        // matching makeRedisLimiter's bucketKey. The handler computes Retry-After
        // as the time to the next aligned boundary, so both backends must use
        // aligned windows for that header to be accurate.
        const windowStartedAt = Math.floor(Date.now() / windowMs) * windowMs;
        store.set(key, { count: 1, windowStartedAt });
      } else {
        store.set(key, {
          count: existing.count + 1,
          windowStartedAt: existing.windowStartedAt,
        });
      }
    },
    async clear(key) {
      store.delete(key);
    },
  };
}

export function makeRedisLimiter(name, windowMs, maxAttempts, client) {
  const ttlSeconds = Math.max(1, Math.ceil(windowMs / 1000));
  // Per-instance fallback used only when Redis is unreachable. It can't see
  // attempts that landed on Redis before the outage, so it starts cold — but
  // it still bounds abuse to maxAttempts per window per serverless instance,
  // which is far safer than the old fail-open behavior (unlimited attempts).
  const fallback = makeInMemoryLimiter(name, windowMs, maxAttempts);
  // Bucket key by the window start so a single bucket only ever
  // tracks a single window's attempts. Avoids the need to clear
  // expired keys manually — Redis TTL does it for us.
  function bucketKey(key) {
    const now = Date.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;
    return `bth:ratelimit:${name}:${key}:${windowStart}`;
  }
  return {
    backend: "redis",
    async canAttempt(key) {
      try {
        const count = await client.get(bucketKey(key));
        const n = typeof count === "number" ? count : parseInt(count || "0", 10) || 0;
        return n < maxAttempts;
      } catch (err) {
        // Fail-closed-ish: defer to an in-memory limiter rather than letting
        // every request through. Alert so we notice the outage.
        alertRedisFailure(name, err);
        return fallback.canAttempt(key);
      }
    },
    async record(key) {
      try {
        const k = bucketKey(key);
        const count = await client.incr(k);
        if (count === 1) {
          await client.expire(k, ttlSeconds);
        }
      } catch (err) {
        // Mirror the attempt into the in-memory limiter so the fallback
        // canAttempt path can enforce the cap during the outage.
        alertRedisFailure(name, err);
        await fallback.record(key);
      }
    },
    async clear(key) {
      try {
        await client.del(bucketKey(key));
      } catch (_err) {
        // Best-effort.
      }
      await fallback.clear(key);
    },
  };
}

// Returns a rate limiter for the given logical name. Uses Upstash when
// configured, in-memory otherwise. Limiter is stable across calls within
// a process (the underlying store is cached by name).
export function getRateLimiter(name, windowMs, maxAttempts, config) {
  const client = getRedisClient(config);
  if (client) {
    return makeRedisLimiter(name, windowMs, maxAttempts, client);
  }
  return makeInMemoryLimiter(name, windowMs, maxAttempts);
}

// Test hook — drops the cached Redis client so tests can swap the
// config and get a fresh limiter.
export function resetRateLimitStateForTests() {
  cachedClient = null;
  inMemoryStores.clear();
  lastAlertAt.clear();
}
