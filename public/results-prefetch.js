/* Early-start the public-therapists fetch as soon as this script runs, so
   the /results data request overlaps stylesheet/script download instead of
   waiting until results.js's module graph downloads + executes. cms.js
   consumes window.__bthPublicTherapistsPromise; if a fresh cached payload
   already exists this skips the network entirely.

   This matters most on the COLD first arrival — a patient clicking a
   clinician's referral link lands on /results with nothing cached, and
   without this the fetch starts only after ~20 modules load and run.

   Lives as an external same-origin file (not an inline <script>) because
   the site's Content-Security-Policy is `script-src 'self'` with no
   'unsafe-inline' / nonce / hash — inline scripts are blocked in
   production. Referenced as a parser-blocking classic script in
   results.html's <head> (after the stylesheet links, so CSS discovery
   isn't delayed), which guarantees the promise is set before the deferred
   module scripts run. Mirrors public/directory-prefetch.js.

   Cache key + TTL are kept in sync with assets/cms.js. */
(function () {
  try {
    const KEY = "bth_public_therapists_cache_v1";
    const TTL = 60 * 60 * 1000;
    try {
      const raw = window.sessionStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.timestamp === "number" && Date.now() - parsed.timestamp < TTL) {
          return; /* fresh cache hit — cms.js reads it, no network */
        }
      }
    } catch (_cacheError) {
      /* sessionStorage blocked — fall through to the live fetch */
    }
    const host = window.location.hostname;
    const base =
      host === "localhost" || host === "127.0.0.1"
        ? "http://localhost:8787/api/public"
        : "/api/public";
    window.__bthPublicTherapistsPromise = fetch(base + "/therapists", {
      method: "GET",
      headers: { Accept: "application/json" },
    })
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .catch(function () {
        return null;
      });
  } catch (_error) {
    /* Non-fatal: cms.js falls back to its own cache/fetch path when the
       promise is absent or resolves null. */
  }
})();
