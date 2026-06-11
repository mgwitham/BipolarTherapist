import { expect, test } from "@playwright/test";

// Money path 2b: existing-listing claim. Search a seeded therapist, pick
// the result, and send the activation link to the email on file. The
// harness sets EMAIL_KILL_SWITCH=true with dummy email config, so the
// server takes the full success path (rate-limit slot reserved,
// claimStatus stamped, 200 with the masked email hint) without any real
// Resend call.
test("claim flow finds a seeded therapist and sends the activation link", async ({ page }) => {
  await page.goto("/claim.html");

  await page.locator("#quickClaimSearchInput").fill("Maya Hernandez");

  const results = page.locator("#quickClaimSearchResults");
  const mayaResult = results.locator(".claim-result-card", { hasText: "Maya Hernandez" });
  await expect(mayaResult).toBeVisible();
  await mayaResult.click();

  const sendButton = page.locator("#claimConfirmSend");
  await expect(sendButton).toBeVisible();
  await sendButton.click();

  const status = page.locator("#claimConfirmStatus");
  await expect(status).toHaveAttribute("data-tone", "success", { timeout: 15_000 });
  await expect(status).toContainText("Activation link sent");
});
