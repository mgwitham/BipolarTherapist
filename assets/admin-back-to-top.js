// Back-to-top FAB for the admin home. Visible after the page scrolls
// past THRESHOLD pixels; clicking smooths the scroll back to top.
// Extracted from an inline <script> in admin.html so we can drop
// 'unsafe-inline' from CSP script-src.

(function setupBackToTopFab() {
  const fab = document.getElementById("backToTopFab");
  if (!fab) return;
  const THRESHOLD = 600;
  function sync() {
    const y = window.scrollY || window.pageYOffset || 0;
    fab.classList.toggle("is-visible", y > THRESHOLD);
  }
  window.addEventListener("scroll", sync, { passive: true });
  fab.addEventListener("click", function () {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  sync();
})();
