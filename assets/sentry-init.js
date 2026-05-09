import * as Sentry from "@sentry/browser";

const dsn = import.meta.env.VITE_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    // Capture 100% of errors; set tracesSampleRate to enable performance monitoring
    tracesSampleRate: 0,
  });
}
