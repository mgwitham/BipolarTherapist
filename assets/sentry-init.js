// Strip single-use claim/sign-in tokens from any URL we send to Sentry.
// Magic-link emails land the user on /portal.html?token=...&slug=...; the
// portal scrubs the token from the address bar as fast as it can, but if
// an error fires before that scrub runs, Sentry's default capture pulls
// window.location.href and ships the token to error telemetry. Anyone with
// Sentry access could then impersonate the therapist until the token
// expires. Scrubbing here covers any URL string flowing through the SDK
// regardless of which page or code path produced it.
const SENSITIVE_URL_PARAMS = [
  "token",
  "claim_token",
  "dev_login",
  // Patient search context from the match flow. A JS error on /match
  // would otherwise ship the ZIP + care type to Sentry in the event URL.
  "location_query",
  "care_intent",
  "zip",
];

function scrubUrl(value) {
  if (typeof value !== "string" || !value) return value;
  const idx = value.indexOf("?");
  if (idx < 0) return value;
  try {
    const base = value.slice(0, idx);
    const rest = value.slice(idx + 1);
    const hashIdx = rest.indexOf("#");
    const query = hashIdx < 0 ? rest : rest.slice(0, hashIdx);
    const hash = hashIdx < 0 ? "" : rest.slice(hashIdx);
    const params = new URLSearchParams(query);
    let changed = false;
    SENSITIVE_URL_PARAMS.forEach(function (key) {
      if (params.has(key)) {
        params.set(key, "[REDACTED]");
        changed = true;
      }
    });
    if (!changed) return value;
    const next = params.toString();
    return base + (next ? "?" + next : "") + hash;
  } catch (_error) {
    return value;
  }
}

function scrubDataUrls(data) {
  if (!data || typeof data !== "object") return data;
  const next = { ...data };
  if (next.url) next.url = scrubUrl(next.url);
  if (next.to) next.to = scrubUrl(next.to);
  if (next.from) next.from = scrubUrl(next.from);
  return next;
}

function scrubEvent(event) {
  if (!event || typeof event !== "object") return event;
  if (event.request && event.request.url) {
    event.request.url = scrubUrl(event.request.url);
  }
  if (Array.isArray(event.breadcrumbs)) {
    event.breadcrumbs = event.breadcrumbs.map(function (b) {
      if (!b) return b;
      return { ...b, data: scrubDataUrls(b.data) };
    });
  }
  return event;
}

function scrubBreadcrumb(breadcrumb) {
  if (!breadcrumb) return breadcrumb;
  return { ...breadcrumb, data: scrubDataUrls(breadcrumb.data) };
}

const dsn = import.meta.env.VITE_SENTRY_DSN;
if (dsn) {
  // Defer loading the ~60KB Sentry SDK until the main thread is idle so it
  // never competes with first render. Error monitoring is best-effort; the
  // brief uninstrumented window at startup is an acceptable trade for not
  // blocking LCP with a third-party chunk on the critical path.
  const initSentry = function () {
    import("@sentry/browser")
      .then(function (Sentry) {
        Sentry.init({
          dsn,
          environment: import.meta.env.MODE,
          // Capture 100% of errors; set tracesSampleRate to enable performance monitoring.
          tracesSampleRate: 0,
          beforeSend: scrubEvent,
          beforeBreadcrumb: scrubBreadcrumb,
        });
      })
      .catch(function () {
        // Error monitoring is best-effort and should never block the page.
      });
  };
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    window.requestIdleCallback(initSentry, { timeout: 3000 });
  } else {
    setTimeout(initSentry, 2000);
  }
}
