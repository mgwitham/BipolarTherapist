import { expect, test } from "@playwright/test";

// Money path 1c: browse the directory. All seeded therapists list, and a
// quick filter narrows the visible set.
test("directory lists seeded therapists and the telehealth filter narrows them", async ({
  page,
}) => {
  await page.goto("/directory.html");

  const grid = page.locator("#resultsGrid");
  await expect(grid.locator("[data-card-slug]").first()).toBeVisible();
  await expect(grid.locator("[data-card-slug]")).toHaveCount(4);
  await expect(grid).toContainText("Maya Hernandez");
  await expect(grid).toContainText("Grace Lin");

  // Grace Lin is the only in-person-only fixture (acceptsTelehealth false);
  // toggling the Telehealth chip must drop her and keep the other three.
  await page.locator(".dir-filter-chip[data-chip-for='telehealth']").click();

  await expect(grid.locator("[data-card-slug]")).toHaveCount(3);
  await expect(grid).not.toContainText("Grace Lin");
  await expect(grid).toContainText("Maya Hernandez");
});
