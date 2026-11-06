import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { AD, REP } from "./global-setup";
import { pick } from "./select";

// The pilot flow, start to finish, as a rep does it: a chat comes in, becomes a deal with a product,
// moves on the board, runs late, is lost. Then what a rep may not do, and the report.
// Phone-sized for the quick-add, desktop-sized for the board; always with a mouse.
test.use({ isMobile: false, hasTouch: false });

const sql = postgres(process.env.DATABASE_URL_E2E as string, { max: 1 });
test.afterAll(() => sql.end());

const tag = randomUUID().slice(0, 6);
const PHONE = `+62812${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
const CUSTOMER = `Smoke ${tag}`;
const SKU = `SMK${tag}`;
const DESKTOP = { width: 1440, height: 1135 };
const LATE_ORANGE = "rgb(194, 65, 12)"; // --color-late, #C2410C

let dealId = "";
let otherDealId = "";

// Dates are Jakarta dates (CLAUDE.md rule 8); en-CA formats as YYYY-MM-DD.
const isoDay = (offset: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(Date.now() + offset * 86_400_000));
const card = (page: Page, id: string) => page.locator(`[data-deal-id="${id}"]`);
const column = (page: Page, name: string) => page.locator(`section[aria-label="${name}"]`);
const toast = (page: Page) => page.locator("div[role=status].fixed");
const stageOf = async (id: string) =>
  (await sql`SELECT s.key FROM deals d JOIN pipeline_stages s ON s.id = d.stage_id WHERE d.id = ${id}`)[0].key;
const pathname = (page: Page) => new URL(page.url()).pathname;

/** A real mouse drag in small steps, so dnd-kit's mouse sensor picks it up. */
async function drag(page: Page, id: string, to: string) {
  const handle = card(page, id).locator("[data-drag-handle]");
  await expect(handle).toBeVisible(); // streamed content stays hidden until React places it
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

test.beforeAll(async () => {
  await sql`
    INSERT INTO products (sku, name, product_line, list_price) VALUES (${SKU}, 'IFP smoke 65"', 'IFP', 30000000)`;
  // a deal of another rep, for the permission checks
  const [other] = await sql<{ id: string }[]>`
    INSERT INTO users (full_name, email) VALUES (${`Rep Smoke ${tag}`}, ${`smoke-${tag}@e2e.example.com`}) RETURNING id`;
  const [oc] = await sql<{ id: string }[]>`
    INSERT INTO contacts (phone_e164, full_name) VALUES (${`+62815${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`}, 'Kontak Smoke') RETURNING id`;
  [{ id: otherDealId }] = await sql<{ id: string }[]>`
    INSERT INTO deals (name, contact_id, owner_user_id, stage_id, next_step, next_step_date, est_amount)
    SELECT ${`Deal Rep Lain ${tag}`}, ${oc.id}, ${other.id}, id, 'Telepon', jakarta_today() + 3, 20000000
      FROM pipeline_stages WHERE key = 'chat' RETURNING id`;
});

test.describe.serial("Pilot flow", () => {
  test("quick-add on a phone with an ad code links the ad and the owner", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/tambah");
    await page.getByLabel("Nomor WhatsApp").fill(PHONE);
    await page.getByLabel("Nama (boleh dikosongkan)").fill(CUSTOMER);
    await page.getByLabel("Pesan pertama").fill(`Halo kak, tanya IFP untuk kantor [${AD.code}]`);
    await expect(page.getByText(`Dari iklan: ${AD.name}`)).toBeVisible();
    await page.getByRole("button", { name: "Simpan prospek" }).click();
    await expect(page.getByRole("status")).toHaveText("Prospek tersimpan.");
    const [lead] = await sql`
      SELECT l.ad_id, l.owner_user_id, u.email FROM leads l
        JOIN contacts c ON c.id = l.contact_id JOIN users u ON u.id = l.owner_user_id
       WHERE c.phone_e164 = ${PHONE}`;
    expect(lead.email).toBe(REP.email);
    expect(lead.ad_id).not.toBeNull();
  });

  test("Jadikan deal, add a product, and the deal lands in Chat masuk with the product's value", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/prospek");
    const row = page.locator("li").filter({ hasText: CUSTOMER });
    await expect(row).toBeVisible();
    await row.getByRole("link", { name: "Jadikan deal" }).click();
    await expect(page.getByLabel("Nama deal")).toHaveValue(/Smoke/);

    await page.getByRole("button", { name: "Produk", exact: true }).click();
    await pick(page.getByRole("combobox", { name: "Produk" }), new RegExp(SKU));
    await page.getByLabel("Unit", { exact: true }).fill("3");
    await expect(page.getByLabel("Harga/unit")).toHaveValue("30.000.000");
    await page.getByLabel("Perkiraan close").fill(isoDay(14));
    await page.getByRole("button", { name: "Simpan" }).click();
    await expect(page.getByText("Deal dibuat")).toBeVisible();
    await expect.poll(() => pathname(page)).toMatch(/^\/deal\/[0-9a-f-]{36}$/);
    dealId = pathname(page).split("/").pop() as string;

    // the deal header figure; line totals elsewhere on the page show money too
    await expect(page.locator("span.tabular.font-semibold", { hasText: /^Rp90 jt$/ })).toHaveCount(1);
    const [d] = await sql`SELECT amount, stage_id FROM deals WHERE id = ${dealId}`;
    expect(Number(d.amount)).toBe(90_000_000);
    expect(await stageOf(dealId)).toBe("chat");
    const [l] = await sql`SELECT status FROM leads l JOIN contacts c ON c.id = l.contact_id WHERE c.phone_e164 = ${PHONE}`;
    expect(l.status).toBe("converted");
  });

  test("dragging the card to Negotiation moves it and records the rep", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/pipeline");
    await expect(card(page, dealId)).toBeVisible();
    await expect(card(page, dealId).locator("[data-drag-handle]")).toHaveAttribute(
      "aria-roledescription",
      "kartu deal yang bisa dipindah", // the board is interactive once dnd-kit sets this
    );
    await drag(page, dealId, "Negotiation");
    await expect(toast(page)).toContainText("Dipindah ke Negotiation");
    await expect(column(page, "Negotiation").locator(`[data-deal-id="${dealId}"]`)).toBeVisible();
    await expect.poll(() => stageOf(dealId)).toBe("negotiation");
    const [h] = await sql`
      SELECT u.email FROM deal_stage_history h JOIN users u ON u.id = h.changed_by
       WHERE h.deal_id = ${dealId} AND h.from_stage_id IS NOT NULL`;
    expect(h.email).toBe(REP.email);
  });

  test("a next step in the past shows orange on the card", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(`/deal/${dealId}`);
    await page.getByLabel("Yang harus dilakukan").fill("Telepon lagi");
    await page.getByLabel("Tanggal", { exact: true }).fill(isoDay(-2));
    await page.getByRole("button", { name: "Simpan" }).click();
    await expect(page.getByText("Deal disimpan")).toBeVisible();

    await page.goto("/pipeline");
    await expect(card(page, dealId)).toBeVisible();
    const late = card(page, dealId).getByText(/^Terlambat \d+ hari · Telepon lagi$/);
    await expect(late).toBeVisible();
    await expect(late).toHaveCSS("color", LATE_ORANGE);
    await expect(page.getByText("Next step terlambat").first()).toBeVisible(); // the figure strip counts it
  });

  test("Lost needs a reason, then the deal leaves the open board", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(`/deal/${dealId}`);
    await page.getByRole("button", { name: "Lost", exact: true }).click();
    await page.getByRole("button", { name: "Simpan" }).click();
    await expect(page.getByText("Pilih alasan lost.").first()).toBeVisible();
    expect(await stageOf(dealId)).toBe("negotiation");

    await pick(page.getByRole("combobox", { name: "Kenapa deal ini lost?" }), "Harga terlalu tinggi");
    await page.getByRole("button", { name: "Simpan" }).click();
    await expect(page.getByText("Deal disimpan")).toBeVisible();
    const [d] = await sql`SELECT lost_reason, closed_on, next_step FROM deals WHERE id = ${dealId}`;
    expect(await stageOf(dealId)).toBe("lost");
    expect(d.lost_reason).toBe("harga");
    expect(d.closed_on).not.toBeNull();
    expect(d.next_step).toBeNull();

    await page.goto("/pipeline");
    await expect(page.getByRole("heading", { name: "Pipeline" })).toBeVisible();
    await expect(card(page, dealId)).toHaveCount(0); // Lost is hidden until "Tampilkan Lost"
  });

  test("a rep cannot move, edit or open the settings for what is not theirs", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/pipeline");
    const locked = card(page, otherDealId);
    await expect(locked).toHaveAttribute("data-locked", "true");
    await expect(locked.locator("[data-drag-handle]")).toHaveAttribute("aria-disabled", "true");
    await drag(page, otherDealId, "Quotation");
    await expect(column(page, "Chat masuk").locator(`[data-deal-id="${otherDealId}"]`)).toBeVisible();
    expect(await stageOf(otherDealId)).toBe("chat");

    await page.goto(`/deal/${otherDealId}`);
    await expect(page.getByText(/^Hanya lihat/)).toBeVisible();
    await expect(page.getByLabel("Nama deal")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Simpan" })).toHaveCount(0);

    await page.goto("/pengaturan");
    await expect(page.getByRole("alert").filter({ hasText: "Pengaturan hanya" })).toBeVisible();
    expect((await page.request.get("/pengaturan/ekspor/deals")).status()).toBe(403);
  });

  test("Laporan renders for the rep with the deal that was just lost", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/laporan");
    await expect(page.getByRole("heading", { name: "Laporan" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Kinerja sales" }).locator("tbody tr")).toHaveCount(1);
    for (const name of ["Done deal per bulan", "Pipeline per tahap", "Demo dan alasan lost", "Sumber prospek"]) {
      await expect(page.getByRole("region", { name })).toBeVisible();
    }
    await expect(page.locator("p", { hasText: /^Done deal bulan ini$/ })).toBeVisible();
  });
});

test.describe("Signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the health check answers without a login, and pages send you to Masuk", async ({ page }) => {
    const health = await page.request.get("/api/health");
    expect(health.status()).toBe(200);
    expect(await health.json()).toMatchObject({ status: "ok", db: "ok" });

    await page.goto("/pipeline");
    await expect.poll(() => pathname(page)).toBe("/masuk");
    expect(new URL(page.url()).searchParams.get("next")).toBe("/pipeline");
  });
});
