import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { REP } from "./global-setup";

const sql = postgres(process.env.DATABASE_URL_E2E as string, { max: 1 });
test.afterAll(() => sql.end());

const tag = randomUUID().slice(0, 6);
let repId: string;
let otherId: string;
const deals: Record<string, string> = {};

async function deal(name: string, ownerId: string, { products = true } = {}) {
  const [c] = await sql<{ id: string }[]>`
    INSERT INTO contacts (phone_e164, full_name)
    VALUES (${`+62813${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`}, ${`Kontak ${name}`}) RETURNING id`;
  const [d] = await sql<{ id: string }[]>`
    INSERT INTO deals (name, contact_id, owner_user_id, stage_id, next_step, next_step_date, est_amount)
    SELECT ${`${name} ${tag}`}, ${c.id}, ${ownerId}, id, 'Telepon', current_date + 1, 50000000
      FROM pipeline_stages WHERE key = 'chat' RETURNING id`;
  if (products) {
    const [p] = await sql<{ id: string }[]>`
      INSERT INTO products (sku, name, product_line, list_price)
      VALUES (${`E2E${randomUUID().slice(0, 6)}`}, 'IFP uji', 'IFP', 30000000) RETURNING id`;
    await sql`INSERT INTO deal_line_items (deal_id, product_id, qty, unit_price) VALUES (${d.id}, ${p.id}, 2, 25000000)`;
    await sql`UPDATE deals SET expected_close_date = current_date + 30 WHERE id = ${d.id}`;
  }
  return d.id;
}

const stage = async (id: string) =>
  (await sql`SELECT s.key FROM deals d JOIN pipeline_stages s ON s.id = d.stage_id WHERE d.id = ${id}`)[0].key;

test.beforeAll(async () => {
  [{ id: repId }] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${REP.email}`;
  [{ id: otherId }] = await sql<{ id: string }[]>`
    INSERT INTO users (full_name, email) VALUES (${`Rep Pipeline ${tag}`}, ${`lain-${tag}@e2e.example.com`}) RETURNING id`;
  deals.ready = await deal("Siap Quotation", repId);
  deals.bare = await deal("Tanpa Produk", repId, { products: false });
  deals.locked = await deal("Milik Lain", otherId);
});

const card = (page: Page, id: string) => page.locator(`[data-deal-id="${id}"]`);
const column = (page: Page, name: string) => page.locator(`section[aria-label="${name}"]`);

/** A real mouse drag, in small steps, so dnd-kit's mouse sensor picks it up. */
async function drag(page: Page, id: string, to: string) {
  const from = await card(page, id).locator("[data-drag-handle]").boundingBox();
  const target = await column(page, to).boundingBox();
  if (!from || !target) throw new Error("card or column not on screen");
  await page.mouse.move(from.x + from.width / 2, from.y + 20);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 10, from.y + 30, { steps: 3 });
  await page.mouse.move(target.x + target.width / 2, target.y + 120, { steps: 12 });
  await page.mouse.up();
}

// the board's live region (always mounted; its text is the toast)
const toast = (page: Page) => page.locator("div[role=status].fixed");

test.beforeEach(async ({ page }) => {
  await page.goto("/pipeline");
  await expect(card(page, deals.ready)).toBeVisible();
  // wait until the board is interactive (dnd-kit sets this after hydration)
  await expect(card(page, deals.ready).locator("[data-drag-handle]")).toHaveAttribute(
    "aria-roledescription",
    "kartu deal yang bisa dipindah",
  );
});

test("dragging a card with products and a close date to Quotation moves it, records who, and can be undone", async ({ page }) => {
  await drag(page, deals.ready, "Quotation");
  await expect(toast(page)).toContainText("Dipindah ke Quotation");
  await expect(column(page, "Quotation").locator(`[data-deal-id="${deals.ready}"]`)).toBeVisible();
  await expect.poll(() => stage(deals.ready)).toBe("quotation");
  const history = await sql`
    SELECT changed_by FROM deal_stage_history WHERE deal_id = ${deals.ready} AND from_stage_id IS NOT NULL`;
  expect(history).toEqual([{ changed_by: repId }]);

  await toast(page).getByRole("button", { name: "Batalkan" }).click();
  await expect(toast(page)).toContainText("Dipindah ke Chat masuk");
  await expect.poll(() => stage(deals.ready)).toBe("chat");
});

test("a card without products goes back, says what to add, and opens the panel URL", async ({ page }) => {
  await drag(page, deals.bare, "Quotation");
  await expect(toast(page)).toContainText("Tambahkan minimal 1 produk dengan unit dan harga.");
  await expect(page).toHaveURL(new RegExp(`deal=${deals.bare}.*stage=quotation.*missing=products`));
  await expect(column(page, "Chat masuk").locator(`[data-deal-id="${deals.bare}"]`)).toBeVisible();
  expect(await stage(deals.bare)).toBe("chat");
});

test("another rep's card shows the lock and can't be dragged", async ({ page }) => {
  const locked = card(page, deals.locked);
  await expect(locked.locator("[data-drag-handle]")).toHaveAttribute("aria-disabled", "true");
  await expect(locked).toHaveAttribute("data-locked", "true");
  await drag(page, deals.locked, "Quotation");
  await expect(column(page, "Chat masuk").locator(`[data-deal-id="${deals.locked}"]`)).toBeVisible();
  await expect(toast(page)).toHaveText(""); // the live region stays mounted; nothing was said
  expect(await stage(deals.locked)).toBe("chat");
});

test("on a phone a stage select moves the card instead of dragging", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const select = card(page, deals.ready).getByLabel("Pindah ke tahap");
  await expect(select).toBeVisible();
  await expect(card(page, deals.locked).getByLabel("Pindah ke tahap")).toHaveCount(0);
  await select.selectOption("quotation");
  await expect(toast(page)).toContainText("Dipindah ke Quotation");
  await expect.poll(() => stage(deals.ready)).toBe("quotation");
});
