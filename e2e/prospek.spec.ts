import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { REP } from "./global-setup";
import { pick, pickValue } from "./select";

const sql = postgres(process.env.DATABASE_URL_E2E as string, { max: 1 });
test.afterAll(() => sql.end());

// One run, one set of people: the signed-in rep (from global setup), another rep and a rep with no leads.
const tag = randomUUID().slice(0, 6);
let repId: string;
let otherId: string;
let emptyId: string;

async function user(name: string, role = "sales_rep") {
  const [u] = await sql<{ id: string }[]>`
    INSERT INTO users (full_name, email, role) VALUES (${name}, ${`${name.replace(/\W/g, "").toLowerCase()}-${tag}@e2e.example.com`}, ${role})
    RETURNING id`;
  return u.id;
}

async function lead(ownerId: string, name: string, o: { hoursAgo?: number; status?: string; message?: string } = {}) {
  const phone = `+62812${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
  const [c] = await sql<{ id: string }[]>`
    INSERT INTO contacts (phone_e164, full_name) VALUES (${phone}, ${name}) RETURNING id`;
  const at = new Date(Date.now() - (o.hoursAgo ?? 0.2) * 3_600_000).toISOString();
  const [l] = await sql<{ id: string }[]>`
    INSERT INTO leads (contact_id, owner_user_id, source_channel, status, first_message, received_at, logged_at)
    VALUES (${c.id}, ${ownerId}, 'whatsapp_direct', ${o.status ?? "new"}, ${o.message ?? "Tanya harga"}, ${at}, ${at})
    RETURNING id`;
  return l.id;
}

test.beforeAll(async () => {
  [repId] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${REP.email}`.then((r) => r.map((x) => x.id));
  otherId = await user("Rep Lain");
  emptyId = await user("Rep Kosong");
  await lead(repId, `Andi ${tag}`, { hoursAgo: 0.2, message: "Pesan baru" });
  await lead(repId, `Maria ${tag}`, { hoursAgo: 3, message: "Pesan lama tiga jam" });
  await lead(repId, `Dihubungi ${tag}`, { status: "contacted", message: "Sudah ditelepon" });
  await lead(otherId, `Milik Lain ${tag}`, { message: "Punya rep lain" });
});

const row = (page: Page, name: string) => page.locator("li").filter({ hasText: `${name} ${tag}` });

test.beforeEach(async ({ page }) => {
  await page.goto("/prospek");
  await expect(page.getByRole("heading", { name: "Prospek" })).toBeVisible();
});

test("the tab, the search and the sales filter survive a reload", async ({ page }) => {
  await page.getByRole("link", { name: /^Sudah dihubungi/ }).click();
  await expect(page).toHaveURL(/tab=dihubungi/);
  await expect(row(page, "Dihubungi")).toBeVisible();

  await page.getByRole("link", { name: "Semua", exact: true }).click();
  await expect(page).toHaveURL(/tab=semua/); // let the navigation finish before typing
  await expect(page.getByRole("link", { name: "Semua", exact: true })).toHaveAttribute("aria-current", "page");
  await page.getByLabel("Cari nama, nomor atau pesan").fill(`Maria ${tag}`);
  await page.getByLabel("Cari nama, nomor atau pesan").press("Enter");
  await expect(page).toHaveURL(/tab=semua/);
  await expect(page).toHaveURL(/q=Maria/);

  await page.reload();
  await expect(page.getByRole("link", { name: "Semua", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByLabel("Cari nama, nomor atau pesan")).toHaveValue(`Maria ${tag}`);
  await expect(row(page, "Maria")).toBeVisible();
  await expect(row(page, "Andi")).toHaveCount(0);

  // the global sales filter (cookie) also stays; on a phone it sits in the menu sheet
  const cookie = async () => (await page.context().cookies()).find((c) => c.name === "crm_sales")?.value;
  const salesFilter = async () => {
    await expect(page.getByRole("heading", { name: "Prospek" })).toBeVisible(); // the page (and its bar) is there
    const filter = page.getByLabel("Lihat data").locator("visible=true"); // the desktop sidebar has one too, hidden
    if ((await filter.count()) === 0) await page.getByRole("button", { name: "Menu" }).click();
    return filter;
  };
  await pickValue(await salesFilter(), otherId); // by id: other specs add reps too
  await expect.poll(cookie).toBe(otherId); // the choice is saved before we reload
  await page.reload();
  await expect(await salesFilter()).toHaveText("Rep Lain");
  await pick(await salesFilter(), "Semua sales"); // leave it as found
  await expect.poll(cookie).toBe("all");
});

test("a new chat over 2 hours old gets the orange chip, a fresh one doesn't", async ({ page }) => {
  const late = row(page, "Maria").getByText("3 jam lalu");
  await expect(late).toBeVisible();
  await expect(late).toHaveClass(/bg-late-bg/);
  await expect(row(page, "Andi").getByText(/menit lalu/)).not.toHaveClass(/bg-late-bg/);
});

test("rows of another rep are view only", async ({ page }) => {
  const theirs = row(page, "Milik Lain");
  await expect(theirs.getByText("Hanya lihat")).toBeVisible();
  await expect(theirs.getByRole("link", { name: "Jadikan deal" })).toHaveCount(0);
  await expect(theirs.getByLabel(/^Aksi lain/)).toHaveCount(0);
  await expect(row(page, "Andi").getByRole("link", { name: "Jadikan deal" })).toBeVisible();
});

test("a filter with no chats shows the empty text", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "crm_sales", value: emptyId, url: baseURL! }]);
  await page.reload();
  await expect(page.getByText("Belum ada chat baru.")).toBeVisible();
  await context.clearCookies({ name: "crm_sales" });
});

test("marking contacted moves the lead to Sudah dihubungi; not a fit takes it off the list", async ({ page }) => {
  const andi = row(page, "Andi");
  await andi.getByLabel(/^Aksi lain untuk Andi/).click();
  await andi.getByRole("button", { name: "Tandai sudah dihubungi" }).click();
  await expect(row(page, "Andi")).toHaveCount(0);
  await page.getByRole("link", { name: /^Sudah dihubungi/ }).click();
  await expect(row(page, "Andi")).toBeVisible();
  const [{ status }] = await sql`SELECT l.status FROM leads l JOIN contacts c ON c.id = l.contact_id WHERE c.full_name = ${`Andi ${tag}`}`;
  expect(status).toBe("contacted");

  await page.getByRole("link", { name: "Baru", exact: false }).first().click();
  const maria = row(page, "Maria");
  await maria.getByLabel(/^Aksi lain untuk Maria/).click();
  // the dialog needs the page to be interactive: retry until it opens
  const dialog = maria.getByRole("dialog");
  await expect(async () => {
    await maria.getByRole("button", { name: "Tidak cocok" }).click();
    await expect(dialog).toBeVisible({ timeout: 1500 });
  }).toPass();
  await pick(dialog.getByRole("combobox", { name: "Kenapa tidak cocok?" }), "Budget ditunda");
  await dialog.getByRole("button", { name: "Simpan" }).click();
  await expect(row(page, "Maria")).toHaveCount(0);
  const [lost] = await sql`
    SELECT l.status, l.disqualify_reason FROM leads l JOIN contacts c ON c.id = l.contact_id WHERE c.full_name = ${`Maria ${tag}`}`;
  expect(lost).toEqual({ status: "disqualified", disqualify_reason: "budget" });
});
