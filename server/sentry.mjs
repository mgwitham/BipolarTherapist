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
  });
  initialized = true;
}

export { Sentry };
