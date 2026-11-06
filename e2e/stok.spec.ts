import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { CEO } from "./global-setup";

// Stok on a phone (390 px): the list shows, and the page never scrolls sideways.
test("Stok fits a 390 px screen without sideways scrolling", async ({ browser }) => {
  const ctx = await browser.newContext({
    baseURL: process.env.E2E_BASE as string,
    viewport: { width: 390, height: 844 },
    storageState: { cookies: [], origins: [] },
  });
  const page = await ctx.newPage();
  const sql = postgres(process.env.DATABASE_URL_E2E as string, { max: 1 });
  try {
    await sql`
      WITH a AS (INSERT INTO products (sku, name, product_line, list_price)
                 VALUES ('E2E-PHONE', 'Layar sentuh interaktif dengan nama produk yang sangat panjang sekali supaya baris harus turun', 'IFP', 1000) RETURNING id)
      INSERT INTO inventory_snapshots (product_id, snapshot_date, qty_on_hand)
      SELECT id, (now() AT TIME ZONE 'Asia/Jakarta')::date - 8, 2 FROM a`;
    await page.goto("/masuk?next=/stok");
    await page.getByLabel("Email").fill(CEO.email);
    await page.getByLabel("Password").fill(CEO.password);
    await page.getByRole("button", { name: "Masuk", exact: true }).click();
    await page.waitForURL("**/stok");
    const row = page.getByRole("list", { name: "Stok per SKU" }).locator("li").filter({ hasText: "E2E-PHONE" });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Data per");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  } finally {
    await sql`DELETE FROM inventory_snapshots WHERE product_id IN (SELECT id FROM products WHERE sku = 'E2E-PHONE')`;
    await sql`DELETE FROM products WHERE sku = 'E2E-PHONE'`;
    await sql.end();
    await ctx.close();
  }
});
