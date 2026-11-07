import { expect, type Page, test } from "@playwright/test";
import { CEO } from "./global-setup";

// Pengaturan is a menu with one page per section. Each section has its own address, the sub-navigation
// shows where you are, and nothing scrolls to an anchor on the same page.

async function signInAsCeo(page: Page) {
  await page.goto("/masuk?next=/pengaturan");
  await page.getByLabel("Email").fill(CEO.email);
  await page.getByLabel("Password").fill(CEO.password);
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/pengaturan");
}

test.describe("the CEO", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the menu opens each section on its own page, with the current one highlighted", async ({ page }) => {
    await signInAsCeo(page);
    await expect(page.getByRole("heading", { name: "Pengaturan", level: 1 })).toBeVisible();
    for (const name of ["Target", "Aturan", "Peluang", "Definisi tahap", "Tim", "Katalog", "Data", "Iklan", "WhatsApp"]) {
      await expect(page.getByRole("link", { name: new RegExp(`^${name}`) })).toBeVisible();
    }

    await page.getByRole("link", { name: /^Tim/ }).click();
    await page.waitForURL((url) => url.pathname === "/pengaturan/tim");
    await expect(page.getByRole("heading", { name: "Tim", level: 1 })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Pengaturan" });
    await expect(nav.getByRole("link", { name: "Tim" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Target" })).not.toHaveAttribute("aria-current", "page");
    await expect(page.getByText("Lini produk")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Tambah orang" })).toBeVisible();

    await nav.getByRole("link", { name: "Aturan" }).click();
    await page.waitForURL((url) => url.pathname === "/pengaturan/aturan");
    await expect(page.getByRole("heading", { name: "Aturan", level: 1 })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Aturan" })).toHaveAttribute("aria-current", "page");
    expect(new URL(page.url()).hash).toBe("");
  });

  test("Target is a page of its own with the month in the address", async ({ page }) => {
    await signInAsCeo(page);
    await page.goto("/pengaturan/target?bulan=2031-03");
    await expect(page.getByRole("heading", { name: "Target", level: 1 })).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByRole("button", { name: "Simpan" })).toBeVisible();
  });
});

test.describe("a sales rep", () => {
  test("is refused on every section page", async ({ page }) => {
    for (const path of ["/pengaturan", "/pengaturan/target", "/pengaturan/tim", "/pengaturan/aturan"]) {
      await page.goto(path);
      await expect(page.getByRole("alert").filter({ hasText: "Pengaturan hanya untuk admin dan CEO." })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Pengaturan" })).toHaveCount(0);
    }
  });
});
