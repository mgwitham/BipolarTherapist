import "./site-analytics.js";
import { readList, subscribe } from "./saved-list.js";
import { initSavedListPanel } from "./saved-list-panel.js";
import { captureReferralFromUrl } from "./referral-attribution.js";

// Capture ?ref= on every public page a clinician's referral link can reach: the
// generated city pages and directory (both load this module via
// directory.html), the homepage, therapist profiles, the match flow, and
// /refer. nav.js would be the wider hook, but its test harness evaluates it as
// a classic script, so it cannot carry an import.
try {
  captureReferralFromUrl();
} catch (_referralError) {
  // Attribution is best-effort; never let it block the page.
}

let lastShortlistCount = null;

function buildShortlistHref(shortlist) {
  if (!shortlist.length) {
    return "/directory";
  }
  return (
    "/match?shortlist=" +
    encodeURIComponent(
      shortlist
        .map(function (item) {
          return item.slug;
        })
        .join(","),
    )
  );
}

function updateShortlistNav() {
  const shortlist = readList();
  const count = shortlist.length;

  document.querySelectorAll("[data-shortlist-count]").forEach(function (element) {
    element.textContent = String(count);
    element.hidden = count === 0;
    if (lastShortlistCount !== null && lastShortlistCount !== count) {
      element.classList.remove("motion-pulse");
      void element.offsetWidth;
      element.classList.add("motion-pulse");
    }
  });

  document.querySelectorAll("[data-shortlist-link]").forEach(function (element) {
    element.href = buildShortlistHref(shortlist);
    element.classList.toggle("is-filled", count > 0);
    element.setAttribute("title", count ? "View Saved (" + count + " saved)" : "View Saved");
    element.setAttribute(
      "aria-label",
      count
        ? "View Saved with " + count + " saved therapist" + (count > 1 ? "s" : "")
        : "View Saved (empty)",
    );
  });

  lastShortlistCount = count;
}

window.refreshShortlistNav = updateShortlistNav;
subscribe(updateShortlistNav);
updateShortlistNav();
initSavedListPanel();
