/* Early-start the directory data fetch as soon as this script runs, so the
   /directory network request overlaps stylesheet/script download instead of
   waiting until directory.js's module graph downloads + executes. cms.js
   consumes window.__bthDirectoryContentPromise; if a fresh cached payload
   already exists this skips the network entirely.

   This lives as an external same-origin file (not an inline <script>)
   because the site's Content-Security-Policy is `script-src 'self'` with no
   'unsafe-inline' / nonce / hash — inline scripts are blocked in production.
   It is referenced as a parser-blocking classic script in directory.html's
   <head> (after the stylesheet links, so CSS discovery isn't delayed), which
   guarantees window.__bthDirectoryContentPromise is set before the deferred
   module scripts run.

   Cache key + TTL are kept in sync with assets/cms.js. */
(function () {
  try {
    const KEY = "bth_directory_content_cache_v1";
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
    window.__bthDirectoryContentPromise = fetch(base + "/directory", {
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
    /* Any failure here is non-fatal: cms.js falls back to its own
       cache/fetch path when the promise is absent or resolves null. */
  }
})();
