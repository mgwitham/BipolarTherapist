var measurementId = "G-Q22R5G7VB5";

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
  window.gtag("config", measurementId);
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
        // Mask all input fields (zip, search queries, anything the
        // user types). The page text is still recorded — we want to
        // see what content the visitor saw, just not what they typed.
        // Especially important on a mental-health site.
        session_recording: {
          maskAllInputs: true,
          maskInputOptions: { password: true, email: true },
        },
        autocapture: true,
        capture_pageview: true,
        capture_pageleave: true,
        persistence: "localStorage+cookie",
        // Disable PostHog's own toolbar in prod — we don't need it
        // and it would only confuse the founder during a live session.
        disable_session_recording: false,
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
