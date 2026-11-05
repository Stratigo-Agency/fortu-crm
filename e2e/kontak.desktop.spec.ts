import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { REP } from "./global-setup";

const sql = postgres(process.env.DATABASE_URL_E2E as string, { max: 1 });
test.afterAll(() => sql.end());

const tag = randomUUID().slice(0, 6);
const phone = () => `+62816${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
const dueName = `Bu Rina ${tag}`;
const otherName = `Pak Dodi ${tag}`;
const company = `PT Kontak ${tag}`;
let otherPhoneLocal: string;

test.beforeAll(async () => {
  const [{ id: repId }] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${REP.email}`;
  const [co] = await sql<{ id: string }[]>`INSERT INTO companies (name, industry, city) VALUES (${company}, 'hotel', 'Surabaya') RETURNING id`;
  // a contact of the rep with an open deal and no chat for 20 days
  const [c] = await sql<{ id: string }[]>`
    INSERT INTO contacts (phone_e164, full_name, company_id, created_at)
    VALUES (${phone()}, ${dueName}, ${co.id}, now() - interval '20 days') RETURNING id`;
  await sql`
    INSERT INTO deals (name, contact_id, company_id, owner_user_id, stage_id, next_step, next_step_date, est_amount)
    SELECT ${`Deal ${dueName}`}, ${c.id}, ${co.id}, ${repId}, id, 'Telepon', jakarta_today() + 1, 25000000 FROM pipeline_stages WHERE key = 'chat'`;

  // a contact of another rep
  const [other] = await sql<{ id: string }[]>`INSERT INTO users (full_name, email) VALUES (${`Rep Kontak ${tag}`}, ${`kontak-${tag}@e2e.example.com`}) RETURNING id`;
  const p = phone();
  otherPhoneLocal = `0${p.slice(3)}`;
  const [oc] = await sql<{ id: string }[]>`INSERT INTO contacts (phone_e164, full_name, created_at) VALUES (${p}, ${otherName}, now() - interval '3 days') RETURNING id`;
  await sql`
    INSERT INTO deals (name, contact_id, owner_user_id, stage_id, next_step, next_step_date, est_amount)
    SELECT ${`Deal ${otherName}`}, ${oc.id}, ${other.id}, id, 'Telepon', jakarta_today() + 1, 5000000 FROM pipeline_stages WHERE key = 'chat'`;
});

test.describe.serial("Kontak", () => {
  test("the follow-up filter lists the contact; logging a call moves Chat terakhir to today", async ({ page }) => {
    await page.goto(`/kontak?q=${encodeURIComponent(tag)}`);
    const dueRow = page.locator("tr").filter({ hasText: dueName });
    await expect(dueRow).toBeVisible();
    await expect(dueRow.getByText("lebih dari 14 hari")).toBeVisible();
    await expect(page.locator("tr").filter({ hasText: otherName })).toBeVisible();

    await page.getByRole("checkbox", { name: /Perlu follow-up/ }).click();
    await expect(page).toHaveURL(/followup=1/);
    await expect(page.locator("tr").filter({ hasText: dueName })).toBeVisible();
    await expect(page.locator("tr").filter({ hasText: otherName })).toHaveCount(0);

    await page.locator("tr").filter({ hasText: dueName }).getByRole("link", { name: dueName }).click();
    const panel = page.getByRole("dialog");
    await expect(panel.getByText("20 hari lalu")).toBeVisible();
    await panel.getByText("Telepon", { exact: true }).click();
    // Enter in the note logs the activity (it must not save the contact form)
    await panel.getByRole("textbox", { name: "Catatan" }).fill("Bahas jadwal demo");
    await panel.getByRole("textbox", { name: "Catatan" }).press("Enter");
    await expect(page.getByText("Aktivitas dicatat")).toBeVisible();
    await expect(panel.getByText("Bahas jadwal demo")).toBeVisible();
    await expect(panel.getByText("20 hari lalu")).toHaveCount(0);
    await expect(panel.getByText(/menit lalu|detik lalu|baru saja/).first()).toBeVisible();

    // closing the panel: the list shows today and the mark is gone
    await panel.getByRole("button", { name: "Tutup" }).click();
    await expect(page.locator("tr").filter({ hasText: dueName })).toHaveCount(0);
    await page.goto(`/kontak?q=${encodeURIComponent(tag)}`);
    const after = page.locator("tr").filter({ hasText: dueName });
    await expect(after.getByText("Hari ini")).toBeVisible();
    await expect(after.getByText("lebih dari 14 hari")).toHaveCount(0);
  });

  test("a new contact with a taken number is refused, naming the owner; another rep's contact is read-only", async ({ page }) => {
    await page.goto("/kontak?contact=new");
    const panel = page.getByRole("dialog");
    await panel.getByLabel("Nama", { exact: true }).fill("Orang Baru");
    await panel.getByLabel("No. WhatsApp").fill(otherPhoneLocal);
    await panel.getByRole("button", { name: "Simpan" }).click();
    await expect(panel.getByRole("alert").filter({ hasText: otherName })).toBeVisible();
    await expect(panel.getByRole("alert").filter({ hasText: `Rep Kontak ${tag}` })).toBeVisible();

    await page.goto(`/kontak?q=${encodeURIComponent(otherName)}`);
    await page.getByRole("link", { name: otherName }).click();
    const ro = page.getByRole("dialog");
    await expect(ro.getByText(`Hanya lihat. Kontak ini milik Rep Kontak ${tag}.`)).toBeVisible();
    await expect(ro.getByRole("button", { name: "Simpan" })).toHaveCount(0);
    await expect(ro.getByRole("button", { name: "Catat", exact: true })).toHaveCount(0);
  });
});

test.describe.serial("Perusahaan", () => {
  test("the list shows the figures; a new company can be added and its name is unique", async ({ page }) => {
    await page.goto(`/perusahaan?q=${encodeURIComponent(company)}`);
    const row = page.locator("tr").filter({ hasText: company });
    await expect(row).toBeVisible();
    await expect(row.getByText("Hotel")).toBeVisible();
    await expect(row.getByText("Surabaya")).toBeVisible();
    await expect(row.getByText("Rp25 jt")).toBeVisible();

    const fresh = `PT Baru ${tag}`;
    await page.goto("/perusahaan?company=new");
    const panel = page.getByRole("dialog");
    await panel.getByLabel("Nama perusahaan").fill(fresh);
    await panel.getByRole("button", { name: "Simpan" }).click();
    await expect(page.getByText("Perusahaan dibuat")).toBeVisible();

    await page.goto("/perusahaan?company=new");
    await page.getByRole("dialog").getByLabel("Nama perusahaan").fill(fresh.toUpperCase());
    await page.getByRole("dialog").getByRole("button", { name: "Simpan" }).click();
    await expect(page.getByRole("dialog").getByText("Nama perusahaan ini sudah ada.")).toBeVisible();
  });
});
