import * as Sentry from "@sentry/node";

import { buildSentryDataCollection } from "../shared/sentry-data-collection.mjs";

let initialized = false;

export function buildSentryNodeOptions(dsn) {
  return {
    dsn,
    environment: process.env.NODE_ENV || "production",
    // Capture 100% of errors; set tracesSampleRate > 0 to enable performance monitoring
    tracesSampleRate: 0,
    // Never attach IPs, cookies, headers, request bodies or local variables
    // to events. Sentry v11 collects all of these by default (sendDefaultPii
    // is gone), so the policy is explicit; see shared/sentry-data-collection.mjs.
    dataCollection: buildSentryDataCollection(),
    // Defense in depth: strip query strings from any request URL that
    // reaches an event, so patient ZIP / care type and single-use tokens
    // never persist in server-side error reports.
    beforeSend(event) {
      try {
        if (event.request && typeof event.request.url === "string") {
          event.request.url = event.request.url.split("?")[0];
        }
      } catch (_err) {
        // never let scrubbing throw and drop the event
      }
      return event;
    },
  };
}

export function initSentry() {
  if (initialized) return;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init(buildSentryNodeOptions(dsn));
  initialized = true;
}

export { Sentry };
