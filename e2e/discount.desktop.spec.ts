import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { CEO, REP } from "./global-setup";

const sql = postgres(process.env.DATABASE_URL_E2E as string, { max: 1 });
test.afterAll(() => sql.end());

const tag = randomUUID().slice(0, 6);
const MSRP = 42_000_000;
const PRICE = 34_440_000; // 18% off, the limit is 15%
let dealId: string;
let dealName: string;

test.beforeAll(async () => {
  const [{ id: repId }] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${REP.email}`;
  const [p] = await sql<{ id: string }[]>`
    INSERT INTO products (sku, name, product_line, list_price, max_discount_pct)
    VALUES (${`DS${tag}`}, 'Signage Diskon Uji', 'DSS', ${MSRP}, 15) RETURNING id`;
  const [c] = await sql<{ id: string }[]>`
    INSERT INTO contacts (phone_e164, full_name) VALUES (${`+62816${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`}, 'Kontak Diskon') RETURNING id`;
  dealName = `Deal Diskon ${tag}`;
  [{ id: dealId }] = await sql<{ id: string }[]>`
    INSERT INTO deals (name, contact_id, owner_user_id, stage_id, next_step, next_step_date, expected_close_date)
    SELECT ${dealName}, ${c.id}, ${repId}, id, 'Kirim penawaran', jakarta_today() + 3, jakarta_today() + 20
      FROM pipeline_stages WHERE key = 'chat' RETURNING id`;
  await sql`INSERT INTO deal_line_items (deal_id, product_id, qty, unit_price) VALUES (${dealId}, ${p.id}, 1, ${PRICE})`;
  // Quotation needs the products, so the deal moves there last
  await sql`UPDATE deals SET stage_id = (SELECT id FROM pipeline_stages WHERE key = 'quotation') WHERE id = ${dealId}`;
});

const OVER_NOTE = /Di atas batas 15%, perlu persetujuan/;

test("a sales rep sees the over-limit note but has no approve button", async ({ page }) => {
  await page.goto(`/deal/${dealId}`);
  await expect(page.getByText(OVER_NOTE)).toBeVisible();
  await expect(page.getByRole("button", { name: "Setujui diskon" })).toHaveCount(0);
});

test.describe("the CEO", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  async function signIn(page: Page) {
    await page.goto("/masuk?next=/laporan");
    await page.getByLabel("Email").fill(CEO.email);
    await page.getByLabel("Password").fill(CEO.password);
    await page.getByRole("button", { name: "Masuk", exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/laporan");
  }

  test("approves from Perlu perhatian, and the note and the card tag go away", async ({ page }) => {
    await signIn(page);

    await page.goto("/pipeline");
    const card = page.locator("[data-deal-id]").filter({ hasText: dealName });
    await expect(card.getByText("Diskon di atas batas")).toBeVisible();

    await page.goto(`/deal/${dealId}`);
    await expect(page.getByText(OVER_NOTE)).toBeVisible();

    // Laporan · Perlu perhatian
    await page.goto("/laporan");
    const attention = page.getByRole("region", { name: "Perlu perhatian" });
    await expect(attention.getByText(dealName)).toBeVisible();
    await attention.getByRole("button", { name: `Setujui diskon ${dealName}` }).click();
    await expect(attention.getByText(dealName)).toHaveCount(0);

    await page.goto("/pipeline");
    await expect(page.locator("[data-deal-id]").filter({ hasText: dealName })).toBeVisible();
    await expect(page.locator("[data-deal-id]").filter({ hasText: dealName }).getByText("Diskon di atas batas")).toHaveCount(0);

    await page.goto(`/deal/${dealId}`);
    await expect(page.getByText(OVER_NOTE)).toHaveCount(0);
    await expect(page.getByText(`Diskon disetujui ${CEO.name}`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Setujui diskon" })).toHaveCount(0);
  });
});
