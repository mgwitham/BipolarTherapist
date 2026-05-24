(function () {
  // Crisis ribbon: inject above nav on mobile if the page has a
  // .nav-crisis-link (signals a patient-facing page). The inline link
  // stays in markup as the no-JS fallback. The mobile CSS hides the
  // inline link's parent <ul> anyway, so no visible duplication.
  try {
    var inlineCrisis = document.querySelector(".nav-crisis-link");
    if (inlineCrisis && !document.querySelector(".crisis-ribbon")) {
      var ribbon = document.createElement("a");
      ribbon.className = "crisis-ribbon";
      ribbon.href = "tel:988";
      ribbon.setAttribute(
        "aria-label",
        "In crisis? Call or text 988, the Suicide and Crisis Lifeline",
      );
      ribbon.textContent = "In crisis? Call or text 988";
      document.body.insertBefore(ribbon, document.body.firstChild);
      document.body.classList.add("has-crisis-ribbon");
    }
  } catch (_ribbonError) {
    // Non-fatal — page still works, inline crisis link remains.
  }

  // Hide-on-scroll-down, reveal-on-scroll-up. Mobile widths only.
  try {
    var mq = window.matchMedia("(max-width: 640px)");
    var lastY = window.scrollY;
    var ticking = false;
    function updateNavCollapse() {
      ticking = false;
      if (!mq.matches) {
        document.body.classList.remove("nav-collapsed");
        return;
      }
      var y = window.scrollY;
      var delta = y - lastY;
      if (y < 24) {
        document.body.classList.remove("nav-collapsed");
      } else if (delta > 6) {
        document.body.classList.add("nav-collapsed");
      } else if (delta < -6) {
        document.body.classList.remove("nav-collapsed");
      }
      lastY = y;
    }
    window.addEventListener(
      "scroll",
      function () {
        if (!ticking) {
          window.requestAnimationFrame(updateNavCollapse);
          ticking = true;
        }
      },
      { passive: true },
    );
  } catch (_scrollError) {
    // Non-fatal.
  }

  // Append a small footer to the mobile sheet so it never reads as empty,
  // and so the crisis 988 link is always one tap from inside the menu.
  try {
    var sheet = document.querySelector(".public-mobile-nav");
    if (sheet && !sheet.querySelector(".public-mobile-nav-footer")) {
      var footer = document.createElement("div");
      footer.className = "public-mobile-nav-footer";
      footer.innerHTML =
        'Need help now? <a href="tel:988" aria-label="Call or text 988">Call or text 988</a>';
      sheet.appendChild(footer);
    }
  } catch (_footerError) {
    // Non-fatal.
  }

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
    var DEFAULT_MATCH_HREF = "/#startMatch";
    var MATCH_RESULTS_URL_KEY = "matchResultsUrl";
    var storedResultsUrl = "";
    try {
      // sessionStorage is the original source (written by match.js), but it
      // dies when the tab closes, leaving "Your matches" stranded the next
      // day. Mirror into localStorage on read so the link survives tab
      // restarts. Reads fall back to localStorage when sessionStorage is empty.
      storedResultsUrl = window.sessionStorage.getItem(MATCH_RESULTS_URL_KEY) || "";
      if (storedResultsUrl) {
        try {
          window.localStorage.setItem(MATCH_RESULTS_URL_KEY, storedResultsUrl);
        } catch (_mirrorError) {
          // localStorage full or unavailable, keep sessionStorage value.
        }
      } else {
        try {
          storedResultsUrl = window.localStorage.getItem(MATCH_RESULTS_URL_KEY) || "";
        } catch (_fallbackError) {
          storedResultsUrl = "";
        }
      }
    } catch (_storageError) {
      storedResultsUrl = "";
    }

    function getSafeMatchResultsHref(value) {
      if (!value) {
        return "";
      }
      try {
        var url = new URL(value, window.location.origin);
        var isMatchPath =
          url.pathname === "/match" ||
          url.pathname === "/match.html" ||
          url.pathname === "/results" ||
          url.pathname === "/results.html";
        if (url.origin !== window.location.origin || !isMatchPath) {
          return "";
        }
        return url.pathname + url.search + url.hash;
      } catch (_error) {
        return "";
      }
    }

    var resultsHref = getSafeMatchResultsHref(storedResultsUrl);
    var hasMatchResults = Boolean(resultsHref);
    // No-results path always points to the homepage form (#startMatch).
    // The homepage itself reads localStorage.bth_last_search and prefills
    // location, so we don't need to thread it through the URL.
    var matchHref = hasMatchResults ? resultsHref : DEFAULT_MATCH_HREF;

    // Desktop link
    var desktopLink = document.getElementById("navBrowseLink");
    if (desktopLink) {
      desktopLink.href = matchHref;
      desktopLink.textContent = hasMatchResults ? "Your Matches" : "Get Matched";
      desktopLink.dataset.matchNavManaged = hasMatchResults ? "results" : "start";
    }

    // Mobile link, locate by title span content
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
    // localStorage unavailable, keep static defaults
  }
})();
