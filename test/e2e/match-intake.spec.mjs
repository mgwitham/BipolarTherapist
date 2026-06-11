import { expect, test } from "@playwright/test";

// Money path 1b: direct match re-entry + refine. Adaptation note vs the
// original plan ("/match.html?mode=form fill #care_intent_primary ..."):
// the standalone intake form no longer exists as a reachable surface. In
// production /match without a shortlist param redirects to / (vercel.json),
// and the in-page builder (.match-builder, which holds #matchForm's primary
// fields) is display:none until the refine drawer opens — and the drawer
// hides the .refine-primary row (#care_intent_primary/#location_query_primary)
// in favor of its own fields (see assets/match-page.css). The real user
// paths today are:
//   1. shortlist re-entry links (/match?shortlist=...) which populate
//      #matchResults in-page, and
//   2. the refine drawer, whose submit hands off to /results
//      (handleSubmit in assets/match.js).
// This spec exercises both.
test("shortlist re-entry populates match results and refine hands off to /results", async ({
  page,
}) => {
  await page.goto("/match.html?shortlist=maya-hernandez-lmft,daniel-okafor-psyd");

  // In-page render: #matchResults fills with the shortlisted fixtures.
  const results = page.locator("#matchResults");
  await expect(results).toContainText("Maya Hernandez");
  await expect(results).toContainText("Daniel Okafor");

  // Open the refine drawer (the only refinement surface) and re-run the
  // match with a ZIP. The drawer submit navigates to /results.
  await page.locator("[data-mx-refine-open='header']").click();
  const drawerZip = page.locator("#location_query_drawer");
  await expect(drawerZip).toBeVisible();
  await drawerZip.fill("94110");
  await page.locator("#matchForm button[type='submit']:visible").click();

  await page.waitForURL(/\/results\?/);
  const cards = page.locator("[data-card] .card-name");
  await expect(cards.first()).toBeVisible();
  await expect(page.locator("[data-results-cards]")).toContainText("Maya Hernandez");
});
