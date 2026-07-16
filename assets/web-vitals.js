/* global PerformanceObserver, performance */
// Real-user web vitals → PostHog. Hand-rolled observers (no third-party
// lib: CSP is script-src 'self' and the whole module is <2KB) measuring
// LCP, FCP, TTFB, CLS, and a worst-interaction INP approximation.
//
// Measurement is passive and starts at import (buffered observers catch
// anything we missed). Reporting happens once, at first page-hide, and
// only when window.posthog exists — which site-analytics.js only sets on
// patient-facing paths, with a key configured, for visitors without an
// analytics opt-out. So this module inherits all consent gating for free
// and sends nothing otherwise. Only the pathname is attached (never the
// query string, which can carry patient search context).

// CLS per spec-lite: layout shifts (without recent input) group into
// "session windows" — shifts less than 1s apart, capped at 5s per window.
// Page CLS is the worst window. Pure; exported for tests.
export function createClsSessionAggregator() {
  let windowValue = 0;
  let windowFirst = 0;
  let windowLast = 0;
  let worst = 0;
  return {
    add(entry) {
      if (!entry || entry.hadRecentInput) return;
      const value = Number(entry.value) || 0;
      const now = Number(entry.startTime) || 0;
      if (windowValue > 0 && now - windowLast < 1000 && now - windowFirst < 5000) {
        windowValue += value;
        windowLast = now;
      } else {
        windowValue = value;
        windowFirst = now;
        windowLast = now;
      }
      if (windowValue > worst) worst = windowValue;
    },
    value() {
      return worst;
    },
  };
}

// Rounds and shapes the metrics payload. Nulls mean "not observed" (e.g.
// CLS unsupported in this browser) and are dropped. Pure; exported for tests.
export function summarizeWebVitals(raw) {
  const src = raw || {};
  const out = {};
  const ms = (key, value) => {
    if (Number.isFinite(value) && value >= 0) out[key] = Math.round(value);
  };
  ms("ttfb_ms", src.ttfb);
  ms("fcp_ms", src.fcp);
  ms("lcp_ms", src.lcp);
  ms("inp_ms", src.inp);
  if (Number.isFinite(src.cls) && src.cls >= 0) {
    out.cls = Math.round(src.cls * 1000) / 1000;
  }
  if (typeof src.pathname === "string" && src.pathname) {
    out.pathname = src.pathname;
  }
  if (typeof src.connection === "string" && src.connection) {
    out.connection = src.connection;
  }
  return out;
}

export function initWebVitals() {
  if (typeof window === "undefined" || typeof PerformanceObserver === "undefined") {
    return;
  }

  let lcp = null;
  let fcp = null;
  let inp = null;
  const cls = createClsSessionAggregator();
  let clsObserved = false;

  const observe = (type, callback, extra) => {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) callback(entry);
      });
      observer.observe(Object.assign({ type, buffered: true }, extra || {}));
    } catch (_error) {
      // Entry type unsupported in this browser — metric stays null.
    }
  };

  observe("largest-contentful-paint", (entry) => {
    lcp = entry.startTime;
  });
  observe("paint", (entry) => {
    if (entry.name === "first-contentful-paint") fcp = entry.startTime;
  });
  observe("layout-shift", (entry) => {
    clsObserved = true;
    cls.add(entry);
  });
  // Worst-interaction approximation of INP (true INP is a high percentile;
  // for our traffic volume the worst interaction is close enough to spot
  // jank regressions).
  observe(
    "event",
    (entry) => {
      if (!Number.isFinite(entry.duration)) return;
      if (inp === null || entry.duration > inp) inp = entry.duration;
    },
    { durationThreshold: 40 },
  );

  let sent = false;
  const report = () => {
    if (sent) return;
    const posthog = window.posthog;
    if (!posthog || typeof posthog.capture !== "function") return;
    sent = true;
    let ttfb = null;
    try {
      const nav = performance.getEntriesByType("navigation")[0];
      if (nav) ttfb = nav.responseStart;
    } catch (_error) {
      /* ignore */
    }
    let connection = "";
    try {
      connection = (navigator.connection && navigator.connection.effectiveType) || "";
    } catch (_error) {
      /* ignore */
    }
    const payload = summarizeWebVitals({
      ttfb,
      fcp,
      lcp,
      inp,
      cls: clsObserved ? cls.value() : null,
      pathname: window.location.pathname,
      connection,
    });
    try {
      posthog.capture("web_vitals", payload);
    } catch (_error) {
      /* analytics is best-effort */
    }
  };

  // First hide is the signal LCP/CLS are final. pagehide covers Safari.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") report();
  });
  window.addEventListener("pagehide", report);
}
