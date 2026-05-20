import * as Sentry from "@sentry/node";

let initialized = false;

export function initSentry() {
  if (initialized) return;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "production",
    // Capture 100% of errors; set tracesSampleRate > 0 to enable performance monitoring
    tracesSampleRate: 0,
    // Never attach IPs, cookies, or request bodies to events. Default is
    // already false in @sentry/node v8+, but we set it explicitly so a
    // future SDK upgrade or a request-handler integration can't silently
    // start shipping therapist PII / patient query params.
    sendDefaultPii: false,
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
  });
  initialized = true;
}

export { Sentry };
