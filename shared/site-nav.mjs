/**
 * Single source of truth for the public site navigation.
 *
 * The site has two audience "zones", each with its own nav:
 *  - PATIENT zone (home, directory, therapist, match, about, …):
 *    find-care links + a "For therapists →" zone switch.
 *  - THERAPIST zone (signup, pricing, claim, portal):
 *    list/manage-a-practice links + a "← For patients" zone switch.
 *
 * These canonical markup strings are injected into every page by
 * scripts/sync-site-nav.mjs, and test/scripts/site-nav.test.mjs asserts
 * each page still embeds the block for its zone — so the nav can't drift
 * page to page the way it did before.
 *
 * IMPORTANT — preserved JS hooks (do not rename without updating the JS):
 *  - #navBrowseLink            nav.js rewrites the desktop match link
 *                              (→ "Your matches" when results exist)
 *  - .nav-crisis-link          nav.js promotes this to the crisis ribbon
 *  - .nav-hamburger            nav.js mobile-menu toggle
 *  - .public-mobile-nav,       nav.js mobile sheet + per-link rewrite
 *    .public-mobile-nav-link,
 *    .public-mobile-nav-title
 *  - [data-shortlist-link],    shortlist-nav.js saved-list count
 *    [data-shortlist-count]
 *  - #navCtaLink               zone-switch (patient → therapist)
 */

// ─── Patient zone ────────────────────────────────────────────────────

export const PATIENT_NAV = `<nav aria-label="Main navigation" class="nav-dark">
      <a href="/" class="nav-logo" aria-label="BipolarTherapyHub, home">
        <img class="logo-mark" src="/favicon.svg" alt="" aria-hidden="true" width="32" height="32" />
        <span class="logo-wordmark">BipolarTherapy<span>Hub</span></span>
      </a>
      <button class="nav-hamburger" aria-label="Open menu" aria-expanded="false" aria-controls="mobileNav">
        <span></span>
        <span></span>
        <span></span>
      </button>
      <ul class="nav-links">
        <li><a href="tel:988" class="nav-crisis-link" aria-label="In crisis? Call or text the Suicide and Crisis Lifeline at 988">In crisis? Call or text 988</a></li>
        <li><a href="/#startMatch" id="navBrowseLink">Get matched</a></li>
        <li><a href="/directory">Browse directory</a></li>
        <li><a href="/about">About</a></li>
        <li><a href="/signup" id="navCtaLink" class="nav-zone-switch">For therapists →</a></li>
      </ul>
    </nav>`;

export const PATIENT_MOBILE_NAV = `<div class="public-mobile-nav" id="mobileNav" aria-label="Mobile navigation">
      <a href="/" class="public-mobile-nav-link">
        <span class="public-mobile-nav-title">Home</span>
      </a>
      <a href="/#startMatch" class="public-mobile-nav-link" id="navBrowseLinkMobile">
        <span class="public-mobile-nav-title">Get matched</span>
      </a>
      <a href="/directory" class="public-mobile-nav-link">
        <span class="public-mobile-nav-title">Browse directory</span>
      </a>
      <a href="/directory" class="public-mobile-nav-link mobile-shortlist-nav" data-shortlist-link>
        <span class="public-mobile-nav-title">My list <span class="nav-shortlist-count" data-shortlist-count hidden>0</span></span>
      </a>
      <a href="/about" class="public-mobile-nav-link">
        <span class="public-mobile-nav-title">About</span>
      </a>
      <a href="/signup" class="public-mobile-nav-link nav-zone-switch">
        <span class="public-mobile-nav-title">For therapists →</span>
      </a>
    </div>`;

// ─── Therapist zone ──────────────────────────────────────────────────

export const THERAPIST_NAV = `<nav aria-label="Main navigation" class="nav-light">
      <a href="/" class="nav-logo" aria-label="BipolarTherapyHub, home">
        <img class="logo-mark" src="/favicon.svg" alt="" aria-hidden="true" width="32" height="32" />
        <span class="logo-wordmark">BipolarTherapy<span>Hub</span></span>
      </a>
      <button class="nav-hamburger" aria-label="Open menu" aria-expanded="false" aria-controls="mobileNav">
        <span></span>
        <span></span>
        <span></span>
      </button>
      <ul class="nav-links">
        <li><a href="/signup">List your practice</a></li>
        <li><a href="/pricing">Pricing</a></li>
        <li><a href="/claim">Claim a listing</a></li>
        <li><a href="/portal" class="nav-signin-link">Sign in</a></li>
        <li><a href="/" id="navCtaLink" class="nav-zone-switch">← For patients</a></li>
      </ul>
    </nav>`;

export const THERAPIST_MOBILE_NAV = `<div class="public-mobile-nav public-mobile-nav--light" id="mobileNav" aria-label="Mobile navigation">
      <a href="/signup" class="public-mobile-nav-link">
        <span class="public-mobile-nav-title">List your practice</span>
      </a>
      <a href="/pricing" class="public-mobile-nav-link">
        <span class="public-mobile-nav-title">Pricing</span>
      </a>
      <a href="/claim" class="public-mobile-nav-link">
        <span class="public-mobile-nav-title">Claim a listing</span>
      </a>
      <a href="/portal" class="public-mobile-nav-link">
        <span class="public-mobile-nav-title">Sign in</span>
      </a>
      <a href="/" class="public-mobile-nav-link nav-zone-switch">
        <span class="public-mobile-nav-title">← For patients</span>
      </a>
    </div>`;

// ─── Zone map ────────────────────────────────────────────────────────
// Which page (by root html filename) belongs to which zone. Pages not
// listed (admin, legal, account-utility) are intentionally left alone.

export const PATIENT_PAGES = [
  "index.html",
  "directory.html",
  "therapist.html",
  "match.html",
  "about.html",
  "results.html",
  "404.html",
];

export const THERAPIST_PAGES = ["signup.html", "pricing.html", "claim.html", "portal.html"];

export const ZONE_NAV = {
  patient: { desktop: PATIENT_NAV, mobile: PATIENT_MOBILE_NAV },
  therapist: { desktop: THERAPIST_NAV, mobile: THERAPIST_MOBILE_NAV },
};

export function zoneForFile(fileName) {
  if (PATIENT_PAGES.includes(fileName)) return "patient";
  if (THERAPIST_PAGES.includes(fileName)) return "therapist";
  return null;
}
