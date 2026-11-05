import { expect, test } from "@playwright/test";
import { REP } from "./global-setup";

test("a sales rep sees only their own row and numbers in Laporan", async ({ page }) => {
  await page.goto("/laporan");
  await expect(page.getByRole("heading", { name: "Laporan" })).toBeVisible();
  await expect(page.getByText("Angka kamu sendiri")).toBeVisible();
  const table = page.getByRole("region", { name: "Kinerja sales" }).locator("tbody tr");
  await expect(table).toHaveCount(1);
  await expect(table.first()).toContainText(REP.name);
  // no way to pick another person from the table
  await expect(page.getByRole("region", { name: "Kinerja sales" }).getByRole("button", { name: REP.name })).toHaveCount(0);
  for (const label of ["Done deal bulan ini", "Unit layar bulan ini", "Perkiraan akhir bulan", "Perkiraan pipeline", "Win rate 90 hari"]) {
    await expect(page.locator("p", { hasText: new RegExp(`^${label}$`) })).toBeVisible();
  }
  await expect(page.getByRole("region", { name: "Done deal per bulan" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Pipeline per tahap" })).toBeVisible();
});

test("Laporan shows the rest of the panels, and the period select changes the key figures", async ({ page }) => {
  await page.goto("/laporan");
  for (const name of ["Perkiraan per bulan close", "Dari iklan ke CRM", "Demo dan alasan lost", "Permintaan per SKU", "Sumber prospek"]) {
    await expect(page.getByRole("region", { name })).toBeVisible();
  }
  await expect(page.locator("p", { hasText: /^Run rate bulanan$/ })).toBeVisible();
  await expect(page.locator("p", { hasText: /^Done deal bulan ini$/ })).toBeVisible();

  await page.getByRole("combobox", { name: "Periode" }).selectOption("quarter");
  await expect(page).toHaveURL(/periode=kuartal/);
  await expect(page.locator("p", { hasText: /^Done deal kuartal ini$/ })).toBeVisible();
  await expect(page.locator("p", { hasText: /^Perkiraan akhir kuartal$/ })).toBeVisible();

  await page.goto("/laporan?periode=tahun");
  await expect(page.getByRole("combobox", { name: "Periode" })).toHaveValue("year");
  await expect(page.locator("p", { hasText: /^Done deal tahun ini$/ })).toBeVisible();
  // an unknown value falls back to this month
  await page.goto("/laporan?periode=xx");
  await expect(page.locator("p", { hasText: /^Done deal bulan ini$/ })).toBeVisible();
});

test("a sales rep can't open Pengaturan and has no link to it", async ({ page }) => {
  await page.goto("/pengaturan");
  await expect(page.getByRole("alert").filter({ hasText: "Pengaturan hanya" })).toContainText("Pengaturan hanya untuk admin dan CEO");
  await expect(page.getByRole("link", { name: "Pengaturan" })).toHaveCount(0);
  const csv = await page.request.get("/pengaturan/ekspor/deals");
  expect(csv.status()).toBe(403);
});
