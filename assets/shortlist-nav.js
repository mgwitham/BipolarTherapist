import { readList, subscribe } from "./saved-list.js";

var lastShortlistCount = null;

function buildShortlistHref(shortlist) {
  if (!shortlist.length) {
    return "directory.html";
  }
  return (
    "match.html?shortlist=" +
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
  var shortlist = readList();
  var count = shortlist.length;

  document.querySelectorAll("[data-shortlist-count]").forEach(function (element) {
    element.textContent = String(count);
    if (lastShortlistCount !== null && lastShortlistCount !== count) {
      element.classList.remove("motion-pulse");
      void element.offsetWidth;
      element.classList.add("motion-pulse");
    }
  });

  document.querySelectorAll("[data-shortlist-link]").forEach(function (element) {
    element.href = buildShortlistHref(shortlist);
    element.classList.toggle("is-filled", count > 0);
    element.setAttribute("title", count ? "Saved progress ready to reopen" : "Open shortlist");
    element.setAttribute(
      "aria-label",
      count
        ? "Open saved progress with " + count + " saved therapist" + (count > 1 ? "s" : "")
        : "Open shortlist",
    );
  });

  lastShortlistCount = count;
}

window.refreshShortlistNav = updateShortlistNav;
subscribe(updateShortlistNav);
updateShortlistNav();
