(function () {
  var btn = document.querySelector(".nav-hamburger");
  var mobileNav = document.querySelector(".public-mobile-nav");
  if (btn && mobileNav) {
    btn.addEventListener("click", function () {
      var isOpen = mobileNav.classList.toggle("is-open");
      btn.setAttribute("aria-expanded", String(isOpen));
      document.body.style.overflow = isOpen ? "hidden" : "";
    });

    document.addEventListener("click", function (e) {
      if (!btn.contains(e.target) && !mobileNav.contains(e.target)) {
        mobileNav.classList.remove("is-open");
        btn.setAttribute("aria-expanded", "false");
        document.body.style.overflow = "";
      }
    });
  }

  // Update "Get matched" nav links. A saved homepage ZIP can prefill the
  // guided form, but only a rendered match results URL earns "Your Matches".
  // Runs synchronously on module parse (modules are deferred, so DOM is ready).
  try {
    var DEFAULT_MATCH_HREF = "/match?mode=form";
    var storedResultsUrl = "";
    try {
      storedResultsUrl = window.sessionStorage.getItem("matchResultsUrl") || "";
    } catch (_storageError) {
      storedResultsUrl = "";
    }

    function getSafeMatchResultsHref(value) {
      if (!value) {
        return "";
      }
      try {
        var url = new URL(value, window.location.origin);
        var isMatchPath = url.pathname === "/match" || url.pathname === "/match.html";
        if (url.origin !== window.location.origin || !isMatchPath) {
          return "";
        }
        return url.pathname + url.search + url.hash;
      } catch (_error) {
        return "";
      }
    }

    var lastSearch = JSON.parse(
      window.sessionStorage.getItem("bth_last_search") ||
        window.localStorage.getItem("bth_last_search") ||
        "null",
    );
    var hasSearch = Boolean(lastSearch && lastSearch.location_query);
    var zip = hasSearch ? String(lastSearch.location_query) : "";
    var resultsHref = getSafeMatchResultsHref(storedResultsUrl);
    var hasMatchResults = Boolean(resultsHref);
    var matchHref = hasMatchResults
      ? resultsHref
      : hasSearch
        ? DEFAULT_MATCH_HREF + "&location_query=" + encodeURIComponent(zip)
        : DEFAULT_MATCH_HREF;

    // Desktop link
    var desktopLink = document.getElementById("navBrowseLink");
    if (desktopLink) {
      desktopLink.href = matchHref;
      desktopLink.textContent = hasMatchResults ? "Your Matches" : "Get Matched";
      desktopLink.dataset.matchNavManaged = hasMatchResults ? "results" : "start";
    }

    // Mobile link — locate by title span content
    var mobileLinks = document.querySelectorAll(".public-mobile-nav-link");
    for (var i = 0; i < mobileLinks.length; i++) {
      var link = mobileLinks[i];
      var titleEl = link.querySelector(".public-mobile-nav-title");
      if (!titleEl) continue;
      var titleText = titleEl.textContent.trim().toLowerCase();
      if (titleText === "get matched" || titleText === "your matches") {
        link.href = matchHref;
        titleEl.textContent = hasMatchResults ? "Your matches" : "Get matched";
        var copyEl = link.querySelector(".public-mobile-nav-copy");
        if (copyEl) {
          copyEl.textContent = hasMatchResults ? "Resume your matches" : "Start guided match";
        }
        break;
      }
    }
  } catch (_e) {
    // localStorage unavailable — keep static defaults
  }
})();
