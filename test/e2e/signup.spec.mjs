import { expect, test } from "@playwright/test";

// Money path 2: therapist signup. Uses the dev sentinel license TEST-0000,
// which the intake route accepts without calling the CA DCA API when the
// harness runs with NODE_ENV=development + allowDevLogin (it does — see
// test/e2e/e2e-api-server.mjs). The server creates a therapistApplication
// audit doc plus a pending-profile therapist doc in the memory client, then
// returns a claim token; the page shows the success status and redirects
// into the portal with that token.
test("signup form verifies the sentinel license and lands in the portal", async ({ page }) => {
  await page.goto("/signup.html");

  const form = page.locator("#newListingForm");
  await form.scrollIntoViewIfNeeded();
  // Two plain name tokens: the sentinel verification derives the licensee
  // name from the submitted name, and the name-match gate compares
  // first/last tokens.
  await form.locator("input[name='full_name']").fill("Jordan Tester");
  await form.locator("input[name='email']").fill("jordan.e2e@example.test");
  await form.locator("input[name='license_number']").fill("TEST-0000");
  await form.locator("input[name='zip']").fill("90025");

  await page.locator(".new-listing-submit").click();

  // The progress stepper shows while the server verifies.
  await expect(page.locator("#newListingProgress")).toBeVisible();

  // Success state: the form swaps to "Opening your dashboard..." and then
  // navigates to /portal with the claim token from the intake response.
  // The success status only stays on screen for ~250ms before the
  // redirect, so the durable assertion is the portal URL itself; the
  // portal consumes the token (claim-accept/claim-session) and leaves the
  // therapist's freshly minted slug in the URL.
  await page.waitForURL(/\/portal(\.html)?\?/, { timeout: 20_000 });
  await expect(page).toHaveURL(/slug=jordan-tester/);
});
