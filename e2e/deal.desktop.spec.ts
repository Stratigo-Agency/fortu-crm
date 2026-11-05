import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { REP } from "./global-setup";
import { pick } from "./select";

const sql = postgres(process.env.DATABASE_URL_E2E as string, { max: 1 });
test.afterAll(() => sql.end());

const tag = randomUUID().slice(0, 6);
let repId: string;
let leadName: string;
let otherDealId: string;

test.beforeAll(async () => {
  [{ id: repId }] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${REP.email}`;
  // DIGI08 with an MSRP, as in the design
  await sql`
    INSERT INTO products (sku, name, product_line, list_price) VALUES ('DIGI08', 'Signage Standing 55"', 'DSS', 42000000)
    ON CONFLICT (sku) DO NOTHING`;

  // a prospect of the rep
  leadName = `Hendra ${tag}`;
  const [c] = await sql<{ id: string }[]>`
    INSERT INTO contacts (phone_e164, full_name) VALUES (${`+62814${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`}, ${leadName}) RETURNING id`;
  await sql`
    INSERT INTO leads (contact_id, owner_user_id, source_channel, product_interest, first_message)
    VALUES (${c.id}, ${repId}, 'meta_ctwa', 'DSS', 'Tanya signage lobi')`;

  // a deal of another rep, to see it read-only
  const [other] = await sql<{ id: string }[]>`
    INSERT INTO users (full_name, email) VALUES (${`Rep Deal ${tag}`}, ${`deal-${tag}@e2e.example.com`}) RETURNING id`;
  const [oc] = await sql<{ id: string }[]>`
    INSERT INTO contacts (phone_e164, full_name) VALUES (${`+62815${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`}, 'Kontak Lain') RETURNING id`;
  [{ id: otherDealId }] = await sql<{ id: string }[]>`
    INSERT INTO deals (name, contact_id, owner_user_id, stage_id, next_step, next_step_date, est_amount)
    SELECT ${`Deal Milik Lain ${tag}`}, ${oc.id}, ${other.id}, id, 'Telepon', current_date + 1, 10000000 FROM pipeline_stages WHERE key = 'chat'
    RETURNING id`;
});

const card = (page: Page, name: string) => page.locator("[data-deal-id]").filter({ hasText: name });
const column = (page: Page, name: string) => page.locator(`section[aria-label="${name}"]`);

async function drag(page: Page, name: string, to: string) {
  const handle = card(page, name).locator("[data-drag-handle]");
  await expect(handle).toBeVisible(); // streamed content is hidden until React places it
  await expect(column(page, to)).toBeVisible();
  const from = await handle.boundingBox();
  const target = await column(page, to).boundingBox();
  if (!from || !target) throw new Error("card or column not on screen");
  await page.mouse.move(from.x + from.width / 2, from.y + 20);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 10, from.y + 30, { steps: 3 });
  await page.mouse.move(target.x + target.width / 2, target.y + 120, { steps: 12 });
  await page.mouse.up();
}

test.describe.serial("Deal panel", () => {
  test("Prospek → Jadikan deal → add DIGI08 ×4 → save → a card in Chat masuk with its Rupiah value", async ({ page }) => {
    await page.goto("/prospek");
    const row = page.locator("li").filter({ hasText: leadName });
    await expect(row).toBeVisible();
    await row.getByRole("link", { name: "Jadikan deal" }).click();

    // filled in from the prospect
    await expect(page).toHaveURL(/\/deal\/new\?fromLead=/);
    await expect(page.getByLabel("Nama deal")).toHaveValue(`${leadName} · Signage`);
    await expect(page.getByLabel("Nama", { exact: false }).first()).toBeVisible();
    await expect(page.getByLabel("Yang harus dilakukan")).toHaveValue("Follow up WA");
    await expect(page.getByRole("button", { name: "Chat masuk" })).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "Produk", exact: true }).click();
    await pick(page.getByRole("combobox", { name: "Produk" }), /DIGI08 · Signage Standing 55"/);
    await page.getByLabel("Unit", { exact: true }).fill("4");
    await expect(page.getByLabel("Harga/unit")).toHaveValue("42.000.000");
    await expect(page.getByText("Sesuai MSRP")).toBeVisible();
    await expect(page.getByText("Rp168.000.000").first()).toBeVisible();
    await expect(page.getByText("4 unit layar")).toBeVisible();

    await page.getByRole("button", { name: "Simpan" }).click();
    await expect(page.getByText("Deal dibuat")).toBeVisible();
    await expect(page).toHaveURL(/\/deal\/[0-9a-f-]{36}$/);

    // the amount in the header is the database's (sum of the lines)
    await expect(page.getByText("Rp168 jt")).toBeVisible();
    const [l] = await sql`SELECT status, deal_id FROM leads l JOIN contacts c ON c.id = l.contact_id WHERE c.full_name = ${leadName}`;
    expect(l.status).toBe("converted");
    expect(l.deal_id).not.toBeNull();

    await page.goto("/pipeline");
    const inChat = column(page, "Chat masuk").locator("[data-deal-id]").filter({ hasText: leadName });
    await expect(inChat).toBeVisible();
    await expect(inChat).toContainText("Rp168 jt");
  });

  test("a drag to Quotation without a close date opens the panel with that field marked", async ({ page }) => {
    await page.goto("/pipeline");
    const handle = card(page, leadName).locator("[data-drag-handle]");
    await expect(handle).toHaveAttribute("aria-roledescription", "kartu deal yang bisa dipindah");
    await drag(page, leadName, "Quotation");

    const panel = page.getByRole("dialog");
    await expect(panel).toBeVisible();
    await expect(page).toHaveURL(/\/deal\/[0-9a-f-]{36}\?stage=quotation&missing=close_date/);
    await expect(panel.getByRole("button", { name: "Quotation" })).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByLabel("Perkiraan close")).toHaveAttribute("aria-invalid", "true");
    await expect(panel.getByText("Isi perkiraan tanggal close.")).toBeVisible();
    // the board is still behind the panel
    await expect(column(page, "Chat masuk")).toBeVisible();

    // fill the date and save: the deal moves to Quotation
    await panel.getByLabel("Perkiraan close").fill(new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10));
    await panel.getByRole("button", { name: "Simpan" }).click();
    await expect(panel.getByText("Deal disimpan")).toBeVisible();
    const [d] = await sql`SELECT s.key FROM deals d JOIN pipeline_stages s ON s.id = d.stage_id WHERE d.name LIKE ${`${leadName}%`}`;
    expect(d.key).toBe("quotation");
    const hist = await sql`
      SELECT h.changed_by FROM deal_stage_history h JOIN deals d ON d.id = h.deal_id
       WHERE d.name LIKE ${`${leadName}%`} AND h.from_stage_id IS NOT NULL`;
    expect(hist).toEqual([{ changed_by: repId }]);
  });

  test("Esc closes the panel, and unsaved changes are asked about first", async ({ page }) => {
    await page.goto("/pipeline");
    await card(page, leadName).getByRole("link", { name: new RegExp(leadName) }).click();
    const panel = page.getByRole("dialog");
    await expect(panel).toBeVisible();
    await expect(panel.getByLabel("Nama deal")).toBeVisible();

    await page.keyboard.press("Escape"); // nothing changed: closes at once
    await expect(panel).toHaveCount(0);
    await expect(page).toHaveURL(/\/pipeline$/);

    await card(page, leadName).getByRole("link", { name: new RegExp(leadName) }).click();
    await expect(panel).toBeVisible();
    await panel.getByLabel("Nama deal").fill("Nama baru yang belum disimpan");
    await page.keyboard.press("Escape");
    const ask = page.getByRole("alertdialog");
    await expect(ask).toContainText("Ada perubahan yang belum disimpan.");
    await ask.getByRole("button", { name: "Lanjut ubah" }).click();
    await expect(ask).toHaveCount(0);
    await expect(panel.getByLabel("Nama deal")).toHaveValue("Nama baru yang belum disimpan");

    await page.keyboard.press("Escape");
    await page.getByRole("alertdialog").getByRole("button", { name: "Buang perubahan" }).click();
    await expect(panel).toHaveCount(0);
    const [d] = await sql`SELECT name FROM deals WHERE name LIKE ${`${leadName}%`}`;
    expect(d.name).toBe(`${leadName} · Signage`);
  });

  test("a product line can be removed on a desktop too", async ({ page }) => {
    await page.goto("/deal/new");
    await page.getByRole("button", { name: "Produk", exact: true }).click();
    await pick(page.getByRole("combobox", { name: "Produk" }), /DIGI08 · Signage Standing 55"/);
    await expect(page.getByLabel("Harga/unit")).toHaveValue("42.000.000");
    const remove = page.getByRole("button", { name: "Hapus produk" });
    await expect(remove).toBeVisible();
    expect((await remove.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await remove.click();
    await expect(page.getByRole("combobox", { name: "Produk" })).toHaveCount(0);
    await expect(page.getByLabel("Perkiraan nilai")).toBeVisible(); // back to the estimate
  });

  test("another rep's deal opens with the same panel, read-only", async ({ page }) => {
    await page.goto(`/deal/${otherDealId}`);
    await expect(page.getByRole("heading", { name: new RegExp(`Deal Milik Lain ${tag}`) })).toBeVisible();
    await expect(page.getByText(/^Hanya lihat/)).toBeVisible();
    await expect(page.getByLabel("Nama deal")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Simpan" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Quotation" })).toBeDisabled();
  });
});
