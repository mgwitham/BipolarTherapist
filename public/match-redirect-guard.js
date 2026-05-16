// Cold-visit redirect guard for /match. Runs synchronously in <head>
// (loaded as a non-module <script>) so it can redirect before the page
// renders. Vercel has an edge-level redirect for /match without
// ?shortlist, but this client-side check also allows full intake
// params through (e.g. /match?care_intent=therapy&location_query=90210)
// which the edge rule would otherwise bounce.
//
// Lives in public/ so the filename stays unhashed and the HTML can
// reference it as /match-redirect-guard.js. Extracted from an inline
// <script> block in match.html so we can drop 'unsafe-inline' from
// CSP script-src.
(function () {
  try {
    var params = new URLSearchParams(window.location.search);
    if (params.get("qa") === "1") return;
    if (params.get("mode") === "form") return;
    if ((params.get("shortlist") || "").trim()) return;
    var hasCare = (params.get("care_intent") || "").trim();
    var hasZip = (params.get("location_query") || params.get("zip") || "").trim();
    if (!hasCare || !hasZip) {
      window.location.replace("/");
    }
  } catch (_e) {
    // Swallow, never block render on an unexpected URL parsing
    // failure. Worst case we render the page and the JS path
    // takes over.
  }
})();
