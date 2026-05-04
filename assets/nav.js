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

  // Update "Get matched" nav links based on prior search stored in localStorage.
  // Runs synchronously on module parse (modules are deferred, so DOM is ready).
  try {
    var lastSearch = JSON.parse(window.localStorage.getItem("bth_last_search") || "null");
    var hasSearch = Boolean(lastSearch && lastSearch.location_query);
    var zip = hasSearch ? String(lastSearch.location_query) : "";
    var matchHref = hasSearch ? "/match.html?mode=form&zip=" + encodeURIComponent(zip) : "/";

    // Desktop link
    var desktopLink = document.getElementById("navBrowseLink");
    if (desktopLink) {
      desktopLink.href = matchHref;
      desktopLink.textContent = hasSearch ? "Your Matches" : "Get Matched";
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
        titleEl.textContent = hasSearch ? "Your matches" : "Get matched";
        var copyEl = link.querySelector(".public-mobile-nav-copy");
        if (copyEl) {
          copyEl.textContent = hasSearch ? "Resume your search" : "Start here";
        }
        break;
      }
    }
  } catch (_e) {
    // localStorage unavailable — keep static defaults
  }
})();
