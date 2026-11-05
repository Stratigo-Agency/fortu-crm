import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { REP } from "./global-setup";

const sql = postgres(process.env.DATABASE_URL_E2E as string, { max: 1 });
test.afterAll(() => sql.end());

const tag = `Cari${randomUUID().slice(0, 6)}`;

test.beforeAll(async () => {
  const [{ id }] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${REP.email}`;
  const [c] = await sql<{ id: string }[]>`INSERT INTO contacts (phone_e164, full_name) VALUES (${`+62858${String(Date.now()).slice(-8)}`}, ${`Pak ${tag}`}) RETURNING id`;
  await sql`
    INSERT INTO deals (name, contact_id, owner_user_id, stage_id, next_step, next_step_date)
    SELECT ${`Deal ${tag}`}, ${c.id}, ${id}, id, 'Telepon', current_date - 1 FROM pipeline_stages WHERE key = 'chat'`;
});

test("signing in lands on Beranda; its search finds deals and contacts, and opens them", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/beranda$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Selamat (pagi|siang|sore|malam), /);
  // the late deal of this rep is in Perlu perhatian
  await expect(page.getByRole("region", { name: "Perlu perhatian" }).getByText(`Deal ${tag}`)).toBeVisible();

  await page.getByRole("searchbox", { name: "Cari" }).fill(tag);
  await page.getByRole("searchbox", { name: "Cari" }).press("Enter");
  await expect(page).toHaveURL(new RegExp(`/cari\\?q=${tag}`));
  await expect(page.getByRole("region", { name: "Deal" }).getByText(`Deal ${tag}`)).toBeVisible();
  await expect(page.getByRole("region", { name: "Kontak" }).getByText(`Pak ${tag}`)).toBeVisible();

  await page.getByRole("region", { name: "Deal" }).getByRole("link", { name: new RegExp(`Deal ${tag}`) }).click();
  await expect(page).toHaveURL(/\/deal\//);
  await expect(page.getByRole("heading", { name: `Deal ${tag}` })).toBeVisible();
});

test("the sidebar shows every screen and Cmd+K opens search", async ({ page }) => {
  await page.goto("/pipeline");
  const nav = page.getByRole("navigation", { name: "Navigasi" }).first();
  for (const name of ["Beranda", "Pipeline", "Prospek", "Kontak", "Perusahaan", "Laporan"]) {
    await expect(nav.getByRole("link", { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  await expect(nav.getByRole("link", { name: /^Pipeline/ })).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page).toHaveURL(/\/cari$/);
  await expect(page.getByRole("searchbox", { name: "Cari" })).toBeFocused();
  await page.getByRole("searchbox", { name: "Cari" }).fill("x");
  await page.getByRole("searchbox", { name: "Cari" }).press("Enter");
  await expect(page.getByText("Ketik minimal 2 huruf.")).toBeVisible();
});
