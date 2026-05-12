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

if ("requestIdleCallback" in window) {
  window.requestIdleCallback(loadGoogleAnalytics, { timeout: 3000 });
} else {
  window.setTimeout(loadGoogleAnalytics, 1500);
}
