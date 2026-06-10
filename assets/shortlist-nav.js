import "./site-analytics.js";
import { readList, subscribe } from "./saved-list.js";
import { initSavedListPanel } from "./saved-list-panel.js";

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
