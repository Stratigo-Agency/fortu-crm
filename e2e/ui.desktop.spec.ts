import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { REP } from "./global-setup";
import { pick, pickDate } from "./select";

const sql = postgres(process.env.DATABASE_URL_E2E as string, { max: 1 });
test.afterAll(() => sql.end());

const tag = `Ui${randomUUID().slice(0, 6)}`;
let dealId: string;

test.beforeAll(async () => {
  const [{ id }] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${REP.email}`;
  await sql`INSERT INTO products (sku, name, product_line, list_price) VALUES ('UI-01', 'Produk Uji Ui', 'IFP', 10000000) ON CONFLICT (sku) DO NOTHING`;
  const [c] = await sql<{ id: string }[]>`INSERT INTO contacts (phone_e164, full_name) VALUES (${`+62859${String(Date.now()).slice(-8)}`}, ${`Pak ${tag}`}) RETURNING id`;
  const [d] = await sql<{ id: string }[]>`
    INSERT INTO deals (name, contact_id, owner_user_id, stage_id, next_step, next_step_date)
    SELECT ${`Deal ${tag}`}, ${c.id}, ${id}, id, 'Telepon', jakarta_today() + 2 FROM pipeline_stages WHERE key = 'chat' RETURNING id`;
  dealId = d.id;
});

test.describe("our own dropdown", () => {
  test("opens with the keyboard, filters a long list, picks with Enter and closes with Esc without closing the panel", async ({ page }) => {
    await page.goto(`/deal/${dealId}`);
    const kind = page.getByRole("combobox", { name: "Jenis deal" });
    await kind.focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(kind).not.toHaveText("Deal baru");

    // Esc closes only the list
    await kind.click();
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: `Deal ${tag}` })).toBeVisible();
  });

  test("a click outside closes it, and there is no browser select on the page", async ({ page }) => {
    await page.goto(`/deal/${dealId}`);
    await page.getByRole("combobox", { name: "Jenis deal" }).click();
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.getByRole("heading", { name: `Deal ${tag}` }).click();
    await expect(page.getByRole("listbox")).toHaveCount(0);
    expect(await page.locator("select").count()).toBe(0);
  });
});

test.describe("the deal flow", () => {
  test("says what the next stage needs and ticks it off as the form fills", async ({ page }) => {
    await page.goto(`/deal/${dealId}`);
    const flow = page.getByText("Untuk pindah ke Quotation:");
    await expect(flow).toBeVisible();
    const products = page.getByRole("listitem").filter({ hasText: "Produk dengan harga" });
    await expect(products).toContainText("belum");
    await expect(page.getByRole("listitem").filter({ hasText: "Next step dan tanggalnya" })).toContainText("sudah");

    await page.getByRole("button", { name: "Produk", exact: true }).click();
    await pick(page.getByRole("combobox", { name: "Produk" }), /UI-01/);
    await expect(products).toContainText("sudah");
    await pickDate(page.getByLabel("Perkiraan close"), "2027-01-15");
    await expect(page.getByText("Siap pindah ke Quotation")).toBeVisible();
  });
});

test("every page lets the sidebar and page stay inside the window (no sideways scroll)", async ({ page }) => {
  for (const path of ["/beranda", "/pipeline", "/prospek", "/kontak", "/perusahaan", "/laporan"]) {
    await page.goto(path);
    await expect(page.locator("main").first()).toBeVisible();
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, path).toBeLessThanOrEqual(1);
  }
});
