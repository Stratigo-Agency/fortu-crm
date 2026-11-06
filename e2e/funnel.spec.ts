import { expect, test } from "@playwright/test";

// Phones (390 px): Laporan, with the funnel as a list, never scrolls sideways.

test("Laporan fits a 390 px phone without horizontal scroll", async ({ page }) => {
  await page.goto("/laporan");
  await expect(page.getByRole("region", { name: "Lead dan funnel" })).toBeVisible();
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(client);
  await page.goto("/prospek?tab=semua");
  await expect(page.getByRole("combobox", { name: "Sumber" })).toBeVisible();
  const p = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(p).toBeLessThanOrEqual(0);
});
