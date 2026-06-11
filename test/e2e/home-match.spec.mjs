import { expect, test } from "@playwright/test";

// Money path 1: patient lands on the homepage, picks a care type, enters a
// CA ZIP, and submits the hero search. The form hands off to /results,
// which fetches the seeded therapists from the hermetic API, ranks them,
// and renders match cards.
test("homepage search lands on /results with seeded therapists ranked", async ({ page }) => {
  await page.goto("/");

  await page.locator("#homepage_interest").selectOption("therapist");
  await page.locator("#location").fill("94110");
  await page.locator("#homeSearchForm button[type='submit']").click();

  await page.waitForURL(/\/results\?/);

  // The featured "Top match" card plus grid cards render seeded names.
  const cardNames = page.locator("[data-card] .card-name");
  await expect(cardNames.first()).toBeVisible();
  await expect
    .poll(async () => cardNames.allTextContents())
    .toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Maya Hernandez|Daniel Okafor|Priya Natarajan|Grace Lin/),
      ]),
    );

  // "Talk therapy" interest maps to care_intent=Therapy + medication_need=No,
  // which excludes the seeded psychiatrist (medication management) from the
  // ranked set — three of the four fixtures remain.
  await expect(page.locator("[data-results-count]")).toHaveText("3");
  await expect(page.locator("[data-results-cards]")).not.toContainText("Priya Natarajan");
});
