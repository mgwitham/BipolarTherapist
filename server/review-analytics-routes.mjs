// Analytics routes. Backs the admin funnel dashboard.
//
// Design: one singleton Sanity doc `funnelEventLog.singleton` with a
// ring buffer (array) of recent events, capped at MAX_EVENTS. Every
// client POST appends, then truncates. Keeps Sanity doc count at 1
// regardless of event volume.
//
// POST /analytics/events  { events: [{ type, payload, occurredAt,
// sessionId, userAgent }] } — open endpoint, rate-limited by
// bounded-array append. Anyone can POST because funnel events are
// anonymous anyway.
//
// GET /analytics/events  — admin-only, returns current log contents.

const SINGLETON_ID = "funnelEventLog.singleton";
const MAX_EVENTS = 500;
const MAX_PAYLOAD_BYTES = 1024;
const MAX_EVENT_TYPE_LEN = 80;
const MAX_BATCH_SIZE = 50;

function safeString(value, max) {
  const s = typeof value === "string" ? value : String(value || "");
  if (s.length > max) {
    return s.slice(0, max);
  }
  return s;
}

function sanitizePayload(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  try {
    let serialized = JSON.stringify(payload);
    if (serialized.length > MAX_PAYLOAD_BYTES) {
      serialized = serialized.slice(0, MAX_PAYLOAD_BYTES);
    }
    return serialized;
  } catch (_error) {
    return "";
  }
}

function sanitizeEvent(raw, defaultOccurredAt) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const type = safeString(raw.type, MAX_EVENT_TYPE_LEN).trim();
  if (!type) {
    return null;
  }
  return {
    _key: cryptoRandomKey(),
    type,
    occurredAt: safeString(raw.occurredAt, 40).trim() || defaultOccurredAt,
    sessionId: safeString(raw.sessionId, 80).trim() || "",
    payload: sanitizePayload(raw.payload),
    userAgent: safeString(raw.userAgent, 200).trim(),
  };
}

function cryptoRandomKey() {
  // Sanity array items need stable _key. Use a short random string.
  const bytes = new Uint8Array(8);
  if (typeof globalThis.crypto !== "undefined" && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes)
    .map(function (b) {
      return b.toString(16).padStart(2, "0");
    })
    .join("");
}

async function getOrCreateLog(client) {
  const existing = await client.getDocument(SINGLETON_ID);
  if (existing) {
    return existing;
  }
  return await client.createOrReplace({
    _id: SINGLETON_ID,
    _type: "funnelEventLog",
    updatedAt: new Date().toISOString(),
    totalAppended: 0,
    events: [],
  });
}

export async function handleAnalyticsRoutes(context) {
  const { client, config, deps, origin, request, response, routePath } = context;
  const { getAuthorizedActor, isAuthorized, parseBody, sendJson } = deps;

  if (request.method === "POST" && routePath === "/analytics/events") {
    let body;
    try {
      body = await parseBody(request);
    } catch (_error) {
      sendJson(response, 400, { error: "Invalid JSON body." }, origin, config);
      return true;
    }

    const rawEvents = Array.isArray(body && body.events) ? body.events : [];
    if (!rawEvents.length) {
      sendJson(response, 200, { ok: true, appended: 0 }, origin, config);
      return true;
    }

    const now = new Date().toISOString();
    const userAgent = safeString(request.headers["user-agent"] || "", 200);
    const sanitized = rawEvents
      .slice(0, MAX_BATCH_SIZE)
      .map(function (raw) {
        const ev = sanitizeEvent(raw, now);
        if (ev && !ev.userAgent) {
          ev.userAgent = userAgent;
        }
        return ev;
      })
      .filter(Boolean);

    if (!sanitized.length) {
      sendJson(response, 200, { ok: true, appended: 0 }, origin, config);
      return true;
    }

    const logDoc = await getOrCreateLog(client);
    const existing = Array.isArray(logDoc.events) ? logDoc.events : [];
    // Newest first. Prepend new batch, truncate tail.
    const merged = sanitized.concat(existing).slice(0, MAX_EVENTS);
    const totalAppended = Number(logDoc.totalAppended || 0) + sanitized.length;

    await client
      .patch(SINGLETON_ID)
      .set({
        events: merged,
        updatedAt: now,
        totalAppended,
      })
      .commit({ visibility: "async" });

    sendJson(response, 200, { ok: true, appended: sanitized.length }, origin, config);
    return true;
  }

  if (request.method === "GET" && routePath === "/analytics/events") {
    const authorized =
      isAuthorized && isAuthorized(request, config) && getAuthorizedActor(request, config);
    if (!authorized) {
      sendJson(response, 401, { error: "Admin session required." }, origin, config);
      return true;
    }
    const logDoc = await client.getDocument(SINGLETON_ID);
    if (!logDoc) {
      sendJson(
        response,
        200,
        { ok: true, events: [], updatedAt: null, totalAppended: 0 },
        origin,
        config,
      );
      return true;
    }
    sendJson(
      response,
      200,
      {
        ok: true,
        events: Array.isArray(logDoc.events) ? logDoc.events : [],
        updatedAt: logDoc.updatedAt || null,
        totalAppended: Number(logDoc.totalAppended || 0),
      },
      origin,
      config,
    );
    return true;
  }

  return false;
}

// Server-side append helper. Used by routes that record durable
// outcomes (e.g. listing_removal_confirmed) without a client round-trip.
// Fire-and-forget at the call site — failures are swallowed so the
// caller's primary response is never blocked on analytics.
export async function appendFunnelEvent(client, type, payload) {
  const now = new Date().toISOString();
  const event = sanitizeEvent({ type, payload, occurredAt: now }, now);
  if (!event) return;
  event.userAgent = "server";
  try {
    const logDoc = await getOrCreateLog(client);
    const existing = Array.isArray(logDoc.events) ? logDoc.events : [];
    const merged = [event].concat(existing).slice(0, MAX_EVENTS);
    const totalAppended = Number(logDoc.totalAppended || 0) + 1;
    await client
      .patch(SINGLETON_ID)
      .set({ events: merged, updatedAt: now, totalAppended })
      .commit({ visibility: "async" });
  } catch (_error) {
    // Analytics is best-effort; never block the caller.
  }
}

// Exported for tests.
export { MAX_EVENTS, MAX_BATCH_SIZE, sanitizeEvent, sanitizePayload };
