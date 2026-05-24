var measurementId = "G-Q22R5G7VB5";

// Query params that carry patient search context or single-use tokens.
// The match flow passes the ZIP and care type as URL query params
// (/match?location_query=90019&care_intent=Therapy), so the raw URL
// must never reach an analytics property or session recording. We
// redact the *values* (keeping the key so funnels still see "a ZIP was
// entered") before any URL leaves the page.
var SENSITIVE_QUERY_PARAMS = [
  "location_query",
  "care_intent",
  "zip",
  "token",
  "claim_token",
  "dev_login",
  "shortlist",
];

function redactSensitiveUrl(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl) {
    return rawUrl;
  }
  var queryIndex = rawUrl.indexOf("?");
  if (queryIndex < 0) {
    return rawUrl;
  }
  try {
    var base = rawUrl.slice(0, queryIndex);
    var rest = rawUrl.slice(queryIndex + 1);
    var hashIndex = rest.indexOf("#");
    var query = hashIndex < 0 ? rest : rest.slice(0, hashIndex);
    var hash = hashIndex < 0 ? "" : rest.slice(hashIndex);
    var params = new URLSearchParams(query);
    var changed = false;
    SENSITIVE_QUERY_PARAMS.forEach(function (key) {
      if (params.has(key)) {
        params.set(key, "redacted");
        changed = true;
      }
    });
    if (!changed) {
      return rawUrl;
    }
    var nextQuery = params.toString();
    return base + (nextQuery ? "?" + nextQuery : "") + hash;
  } catch (_err) {
    // If parsing fails, drop the query string entirely rather than risk
    // leaking it.
    return rawUrl.slice(0, queryIndex);
  }
}

function hasAnalyticsOptOut() {
  if (typeof navigator === "undefined") {
    return true;
  }

  return (
    navigator.globalPrivacyControl === true ||
    navigator.doNotTrack === "1" ||
    window.doNotTrack === "1"
  );
}

function loadGoogleAnalytics() {
  if (typeof window === "undefined" || hasAnalyticsOptOut()) {
    return;
  }

  window.dataLayer = window.dataLayer || [];
  window.gtag = function () {
    window.dataLayer.push(arguments);
  };

  var script = document.createElement("script");
  script.async = true;
  script.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(measurementId);
  document.head.appendChild(script);

  window.gtag("js", new Date());
  // Disable Google Signals + ad-personalization so GA collects only
  // first-party measurement data and never shares it with Google's
  // advertising graph (the stats.g.doubleclick.net beacon). Under CCPA
  // that beacon would count as "sharing for cross-context behavioral
  // advertising" and require a Do Not Sell or Share opt-out link.
  // Turning it off keeps us aligned with the site's "we don't sell or
  // share" posture and lets us drop doubleclick from the CSP.
  //
  // page_location is overridden with a redacted URL so the patient ZIP
  // and care type (passed as query params on /match) never enter GA's
  // page_location dimension.
  window.gtag("config", measurementId, {
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    page_location: redactSensitiveUrl(window.location.href),
  });
}

// Path-gate: PostHog session recordings only run on patient-facing
// pages. Therapist-facing surfaces (signup, claim, recover, remove,
// portal, admin) handle therapist PII and aren't useful for patient
// behavior research anyway. This lets every page safely import
// site-analytics.js for GA without accidentally exposing therapist
// flows to session replay.
const PATIENT_PATH_PATTERNS = [
  /^\/$/,
  /^\/match(\b|\/)/,
  /^\/results(\b|\/)/,
  /^\/directory(\b|\/)/,
  /^\/therapists?\//,
  /^\/about(\b|\/)/,
];

function isPatientFacingPath() {
  try {
    const path = window.location.pathname || "/";
    return PATIENT_PATH_PATTERNS.some(function (re) {
      return re.test(path);
    });
  } catch (_err) {
    return false;
  }
}

// PostHog session recordings + autocapture. Lazy-loaded (dynamic import)
// so the ~50KB SDK only ships to clients that have consent + a key set,
// and never blocks initial render. No-op when VITE_POSTHOG_KEY is unset,
// so this can ship before the PostHog project is created.
function loadPostHog() {
  if (typeof window === "undefined" || hasAnalyticsOptOut()) {
    return;
  }
  if (!isPatientFacingPath()) {
    return;
  }
  var key = "";
  var host = "https://us.i.posthog.com";
  try {
    if (import.meta.env) {
      key = import.meta.env.VITE_POSTHOG_KEY || "";
      host = import.meta.env.VITE_POSTHOG_HOST || host;
    }
  } catch (_err) {
    return;
  }
  if (!key) return;

  import("posthog-js")
    .then(function (mod) {
      var posthog = mod.default || mod;
      posthog.init(key, {
        api_host: host,
        // Honor browser-level privacy signals at PostHog's layer too.
        respect_dnt: true,
        // Redact patient search context (ZIP, care type) and single-use
        // tokens from any URL-bearing property before the event is sent.
        // maskAllInputs below covers typed fields in the replay DOM;
        // this covers $current_url / $referrer in pageview + autocapture
        // events, which is where the /match query string would otherwise
        // land. $pathname has no query string so it's left alone.
        sanitize_properties: function (properties) {
          if (!properties || typeof properties !== "object") {
            return properties;
          }
          ["$current_url", "$referrer", "$initial_current_url", "$initial_referrer"].forEach(
            function (prop) {
              if (typeof properties[prop] === "string") {
                properties[prop] = redactSensitiveUrl(properties[prop]);
              }
            },
          );
          return properties;
        },
        // Session replay and surveys are not used yet, so keep their modules
        // (~54KB recorder + ~34KB surveys of third-party JS) from loading at
        // all — a meaningful perf win on patient pages. The masking config
        // below is retained so replay is privacy-safe the moment it's enabled
        // (flip disable_session_recording back to false).
        disable_session_recording: true,
        disable_surveys: true,
        session_recording: {
          maskAllInputs: true,
          maskInputOptions: { password: true, email: true },
        },
        autocapture: true,
        capture_pageview: true,
        capture_pageleave: true,
        persistence: "localStorage+cookie",
        loaded: function () {
          window.posthog = posthog;
        },
      });
    })
    .catch(function (err) {
      console.warn("posthog: failed to load, continuing without it", err);
    });
}

function loadAll() {
  loadGoogleAnalytics();
  loadPostHog();
}

if ("requestIdleCallback" in window) {
  window.requestIdleCallback(loadAll, { timeout: 3000 });
} else {
  window.setTimeout(loadAll, 1500);
}
