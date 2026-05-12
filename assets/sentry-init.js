const dsn = import.meta.env.VITE_SENTRY_DSN;
if (dsn) {
  import("@sentry/browser")
    .then(function (Sentry) {
      Sentry.init({
        dsn,
        environment: import.meta.env.MODE,
        // Capture 100% of errors; set tracesSampleRate to enable performance monitoring.
        tracesSampleRate: 0,
      });
    })
    .catch(function () {
      // Error monitoring is best-effort and should never block the page.
    });
}
