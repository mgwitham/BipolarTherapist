var DIRECTORY_SHORTLIST_KEY = "bth_directory_shortlist_v1";
var lastShortlistCount = null;
var DIRECTORY_LIST_LIMIT = 6;

function normalizeShortlist(value) {
  return (Array.isArray(value) ? value : [])
    .map(function (item) {
      if (typeof item === "string") {
        return {
          slug: item,
          priority: "",
          note: "",
        };
      }

      if (!item || !item.slug) {
        return null;
      }

      return {
        slug: String(item.slug),
        priority: String(item.priority || ""),
        note: String(item.note || ""),
      };
    })
    .filter(Boolean)
    .slice(0, DIRECTORY_LIST_LIMIT);
}

function readShortlist() {
  try {
    return normalizeShortlist(
      JSON.parse(window.localStorage.getItem(DIRECTORY_SHORTLIST_KEY) || "[]"),
    );
  } catch (_error) {
    return [];
  }
}

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
  var shortlist = readShortlist();
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

window.addEventListener("storage", function (event) {
  if (event.key === DIRECTORY_SHORTLIST_KEY) {
    updateShortlistNav();
  }
});

updateShortlistNav();
