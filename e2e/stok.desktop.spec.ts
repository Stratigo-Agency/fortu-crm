import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { CEO } from "./global-setup";

test("a sales rep is refused on Stok and the export", async ({ page }) => {
  await page.goto("/stok");
  await expect(page.getByText("Stok hanya untuk admin, CEO, dan sales lead.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Stok", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Stok per SKU" })).toHaveCount(0);
  const res = await page.request.get("/stok/ekspor");
  expect(res.status()).toBe(403);
});

test("the CEO sees the empty state, then the table with the risky SKU first and the filters working", async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: "http://localhost:3100", storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await page.goto("/masuk?next=/stok");
  await page.getByLabel("Email").fill(CEO.email);
  await page.getByLabel("Password").fill(CEO.password);
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await page.waitForURL("**/stok");
  await expect(page.getByRole("heading", { name: "Stok & Permintaan" })).toBeVisible();
  await expect(page.getByText("Belum ada data stok dari Accurate")).toBeVisible();
  await expect(page.getByRole("link", { name: "Stok", exact: true })).toBeVisible();

  const sql = postgres(process.env.DATABASE_URL_E2E as string, { max: 1 });
  try {
    await sql`
      WITH a AS (INSERT INTO products (sku, name, product_line, list_price) VALUES ('E2E-THIN', 'Layar tipis', 'IFP', 1000) RETURNING id),
           b AS (INSERT INTO products (sku, name, product_line, list_price) VALUES ('E2E-FULL', 'Layar aman', 'LED', 1000) RETURNING id),
           sa AS (INSERT INTO inventory_snapshots (product_id, snapshot_date, qty_on_hand) SELECT id, current_date, 2 FROM a),
           sb AS (INSERT INTO inventory_snapshots (product_id, snapshot_date, qty_on_hand) SELECT id, current_date, 90 FROM b)
      INSERT INTO sales_monthly (product_id, period_month, qty_sold)
      SELECT id, (date_trunc('month', now()) - interval '1 month')::date, 6 FROM a
      UNION ALL SELECT id, (date_trunc('month', now()) - interval '1 month')::date, 1 FROM b`;
    await page.reload();
    // other specs leave products in this database, so only look at the rows made here
    const rows = page.getByRole("region", { name: "Stok per SKU" }).locator("tbody tr").filter({ hasText: "E2E-" });
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("E2E-THIN");
    await expect(rows.first()).toContainText("Stok tipis");
    await expect(rows.first()).toContainText("0,3 bulan");

    await page.getByRole("checkbox", { name: "Hanya yang berisiko" }).click();
    await expect(page).toHaveURL(/berisiko=1/);
    await expect(rows).toHaveCount(1);
    await page.getByRole("checkbox", { name: "Hanya yang berisiko" }).click();
    await expect(rows).toHaveCount(2);

    const res = await ctx.request.get("/stok/ekspor?lini=IFP");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    const body = await res.text();
    expect(body).toContain("E2E-THIN");
    expect(body).not.toContain("E2E-FULL");
  } finally {
    await sql`DELETE FROM sales_monthly WHERE product_id IN (SELECT id FROM products WHERE sku LIKE 'E2E-%')`;
    await sql`DELETE FROM inventory_snapshots WHERE product_id IN (SELECT id FROM products WHERE sku LIKE 'E2E-%')`;
    await sql`DELETE FROM products WHERE sku LIKE 'E2E-%'`;
    await sql.end();
    await ctx.close();
  }
});
