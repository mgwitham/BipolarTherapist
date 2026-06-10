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

import { log } from "./logger.mjs";
import {
  FUNNEL_LOG_ID,
  FUNNEL_LOG_MAX_EVENTS,
  appendFunnelLogEvents,
} from "./funnel-event-log.mjs";

// Re-exported under the historical name for the analytics test that imports it.
const MAX_EVENTS = FUNNEL_LOG_MAX_EVENTS;
const MAX_PAYLOAD_BYTES = 1024;
const MAX_EVENT_TYPE_LEN = 80;
const MAX_BATCH_SIZE = 50;

// High-volume auto-fired events that drown out conversion signals.
// Each card render fires one of these, so a single browse session can
// produce dozens. Aggregate volume is interesting (we still track it
// via totalAppended), but per-event retention isn't — by the time a
// reviewer cares about contact funnels, we've usually lost the
// match_contact_modal_opened events to truncation. Filter at write
// time so the ring buffer stays focused on intent + conversion.
const FILTERED_NOISE_EVENTS = new Set(["directory_card_impression", "match_card_impression"]);

// Admin/internal navigation events. The admin user generates a steady
// stream of admin_login_*, admin_profile_edit_opened, admin_review_*,
// etc. while running the business. None of the patient or therapist
// dashboards consume these, so retaining them in the ring buffer just
// crowds out actual conversion signal. Drop on append; still counted
// in totalAppended.
function isAdminNavigationEvent(type) {
  return typeof type === "string" && type.startsWith("admin_");
}

function isNoiseEvent(type) {
  return FILTERED_NOISE_EVENTS.has(type) || isAdminNavigationEvent(type);
}

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

    // Drop noise events from the ring buffer but still count them in the
    // lifetime counter. Without this filter, impressions (~50% of all
    // events) squeeze out conversion-funnel events before reviewers can
    // act on them. See FILTERED_NOISE_EVENTS comment above.
    const retainable = sanitized.filter(function (ev) {
      return !isNoiseEvent(ev.type);
    });

    await appendFunnelLogEvents(client, retainable, sanitized.length);

    sendJson(
      response,
      200,
      {
        ok: true,
        appended: retainable.length,
        filtered: sanitized.length - retainable.length,
      },
      origin,
      config,
    );
    return true;
  }

  if (request.method === "GET" && routePath === "/analytics/events") {
    const authorized =
      isAuthorized && isAuthorized(request, config) && getAuthorizedActor(request, config);
    if (!authorized) {
      sendJson(response, 401, { error: "Admin session required." }, origin, config);
      return true;
    }
    const logDoc = await client.getDocument(FUNNEL_LOG_ID);
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

  // Outreach link click stream — flat [{slug, viewedAt}] derived from
  // outreach_profile_viewed events in the funnel log. Used by the
  // Outreach CRM to compute per-subject click rates in Subject
  // Performance. Sits in the existing dispatcher (vs. its own Vercel
  // function) so we stay under the Hobby plan's function cap.
  if (request.method === "GET" && routePath === "/admin/outreach-clicks") {
    const authorized =
      isAuthorized && isAuthorized(request, config) && getAuthorizedActor(request, config);
    if (!authorized) {
      sendJson(response, 401, { error: "Admin session required." }, origin, config);
      return true;
    }
    let logDoc;
    try {
      logDoc = await client.getDocument(FUNNEL_LOG_ID);
    } catch (err) {
      sendJson(
        response,
        500,
        { error: "Failed to read funnel log", detail: err?.message || String(err) },
        origin,
        config,
      );
      return true;
    }
    const events = Array.isArray(logDoc?.events) ? logDoc.events : [];
    const out = [];
    for (const event of events) {
      if (event?.type !== "outreach_profile_viewed") continue;
      const payload =
        typeof event.payload === "string"
          ? safeParseJson(event.payload) || {}
          : event.payload && typeof event.payload === "object"
            ? event.payload
            : {};
      const slug = String(payload.therapist_slug || "").trim();
      const viewedAt = String(event.occurredAt || event.created_at || event.createdAt || "").trim();
      if (!slug || !viewedAt) continue;
      out.push({ slug, viewedAt });
    }
    sendJson(response, 200, { events: out }, origin, config);
    return true;
  }

  return false;
}

function safeParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
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
    await appendFunnelLogEvents(client, [event], 1);
  } catch (error) {
    // Analytics is best-effort; never block the caller. Logged so a
    // sustained write failure (the funnel dashboard quietly going stale)
    // is visible instead of silent.
    log.warn("analytics: failed to append funnel event", {
      err: error?.message || String(error),
    });
  }
}

// Exported for tests.
export { MAX_EVENTS, MAX_BATCH_SIZE, sanitizeEvent, sanitizePayload };
