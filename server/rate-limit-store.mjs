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
// Fixed-window counter: a window starts when the first attempt arrives,
// and the counter increments until the window expires. This is the same
// algorithm the in-memory implementation used; just persisted.

import { Redis } from "@upstash/redis";

let cachedClient = null;

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
        store.set(key, { count: 1, windowStartedAt: Date.now() });
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

function makeRedisLimiter(name, windowMs, maxAttempts, client) {
  const ttlSeconds = Math.max(1, Math.ceil(windowMs / 1000));
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
      } catch (_err) {
        // Fail-open on Redis errors. Better to let a real user through
        // than to lock everyone out during an Upstash outage.
        return true;
      }
    },
    async record(key) {
      try {
        const k = bucketKey(key);
        const count = await client.incr(k);
        if (count === 1) {
          await client.expire(k, ttlSeconds);
        }
      } catch (_err) {
        // Fail-silent on record errors. The next canAttempt will
        // re-evaluate; this attempt just doesn't get persisted.
      }
    },
    async clear(key) {
      try {
        await client.del(bucketKey(key));
      } catch (_err) {
        // Best-effort.
      }
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
}
