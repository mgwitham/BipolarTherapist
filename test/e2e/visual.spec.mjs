import { expect, test } from "@playwright/test";

// Visual regression baseline.
//
// Purpose: make it safe to delete CSS. assets/styles.css is an @import
// manifest stacking four generations of directory styles
// (directory-classic, -v2, -variant-b, -redesign-components) totalling ~80KB
// raw, of which only about a third of the declared classes are referenced
// anywhere in the built output. That dead weight is render-blocking on every
// page loading styles.css and is the directory page's main cost — but class
// usage cannot be proven statically, because class names are also composed at
// runtime (`"dir-" + variant`). Deleting a generation is therefore only safe
// behind screenshots.
//
// These run against the hermetic E2E stack (seeded in-memory API, four fixed
// therapists, no dates/photos/randomness in the fixtures), so the only source
// of variance is rendering itself.
//
// PLATFORM NOTE: font rasterisation differs between macOS and Linux, so
// baselines are stored per-platform (see snapshotPathTemplate in
// playwright.config.mjs). Committed baselines here are whatever platform
// generated them; CI seeds its own on first run. Update with:
//   npm run test:visual -- --update-snapshots

const VIEWPORTS = [
  { label: "mobile", width: 390, height: 844 },
  { label: "desktop", width: 1280, height: 800 },
];

// Pages whose layout the CSS consolidation could plausibly break. Each waits
// on a selector that only exists once the page has rendered its real content,
// so a screenshot can never capture a half-built DOM.
const PAGES = [
  { name: "home", path: "/index.html", ready: "#startMatch .search-btn" },
  { name: "directory", path: "/directory.html", ready: "#resultsGrid [data-card-slug]" },
  {
    name: "profile",
    path: "/therapist.html?slug=maya-hernandez-lmft",
    ready: "#profileWrap .profile-layout",
  },
  {
    name: "results",
    path: "/results.html?care_intent=Therapy&location_query=90210&care_state=CA",
    ready: "#resultsRoot, .results-grid, main",
  },
];

// The directory's default sort is `stable_random`: it draws a seed once per
// session (sessionStorage "bth_stable_sort_seed_v1") and shuffles listings
// with it, so the same therapists don't always occupy the top slots. That is
// a deliberate fairness feature and it IS stable within a session — but every
// Playwright context is a new session, so card order changed between runs and
// made the directory screenshots flake at 3-7% of pixels. Pin the seed instead
// of disabling the sort, so the shuffle is exercised exactly as in production
// and simply lands the same way each time.
//
// Experiment assignments are pinned for the same reason: variants are drawn at
// random per session and several change visible copy.
const STABLE_SORT_SEED = "1234567890";

async function pinSessionRandomness(page) {
  await page.addInitScript((seed) => {
    try {
      globalThis.sessionStorage.setItem("bth_stable_sort_seed_v1", seed);
      globalThis.localStorage.setItem("bth_experiment_assignments_v1", JSON.stringify({}));
    } catch (_error) {
      // Storage unavailable — the screenshot may flake, but nothing breaks.
    }
  }, STABLE_SORT_SEED);
}

// Freeze anything that would otherwise make two runs of the same page differ.
async function stabilize(page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        scroll-behavior: auto !important;
      }
      /* The caret blinks; it lands inside screenshots of focused inputs. */
      * { caret-color: transparent !important; }
    `,
  });
  // Webfonts swap in after first paint; capturing mid-swap produces a diff
  // that has nothing to do with the change under test.
  await page.evaluate(() => globalThis.document.fonts.ready);
  // Let the idle-deferred analytics bundles settle so a late paint can't land
  // between the wait and the capture.
  await page.waitForTimeout(300);
}

for (const viewport of VIEWPORTS) {
  test.describe(`@visual ${viewport.label} (${viewport.width}x${viewport.height})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const target of PAGES) {
      test(`${target.name} renders unchanged`, async ({ page }) => {
        await pinSessionRandomness(page);
        await page.goto(target.path);
        await page.locator(target.ready).first().waitFor({ state: "visible", timeout: 15_000 });
        await stabilize(page);

        await expect(page).toHaveScreenshot(`${target.name}-${viewport.label}.png`, {
          fullPage: true,
          // A handful of antialiasing pixels differ between otherwise
          // identical runs; a real layout break moves far more than this.
          maxDiffPixelRatio: 0.01,
          animations: "disabled",
        });
      });
    }
  });
}
