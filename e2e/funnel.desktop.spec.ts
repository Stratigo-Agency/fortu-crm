import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { REP } from "./global-setup";

// Lead dan funnel on /laporan: the section is first, and a sales rep sees only their own leads.

const sql = postgres(process.env.DATABASE_URL_E2E as string, { max: 1 });
test.afterAll(() => sql.end());

const tag = randomUUID().slice(0, 6);

async function lead(ownerId: string, source: string, status = "new") {
  const phone = `+62812${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
  const [c] = await sql<{ id: string }[]>`INSERT INTO contacts (phone_e164, full_name) VALUES (${phone}, ${`Funnel ${tag}`}) RETURNING id`;
  await sql`
    INSERT INTO leads (contact_id, owner_user_id, source_channel, status, first_message)
    VALUES (${c.id}, ${ownerId}, ${source}, ${status}, 'Tanya harga')`;
}

/** The numbers lead_funnel() gives for this month, for one owner or everyone. */
async function funnel(ownerId: string | null) {
  const [r] = await sql<{ leads: number; unhandled: number }[]>`
    SELECT leads, unhandled FROM lead_funnel(date_trunc('month', jakarta_today()::timestamp)::date, jakarta_today(), ${ownerId}::uuid)
     WHERE is_total`;
  return r;
}

test("Lead dan funnel comes first in Laporan and shows only the rep's own leads", async ({ page }) => {
  const [rep] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${REP.email}`;
  const [other] = await sql<{ id: string }[]>`
    INSERT INTO users (full_name, email, role) VALUES ('Rep Funnel Lain', ${`funnel-${tag}@e2e.example.com`}, 'sales_rep') RETURNING id`;
  await lead(rep.id, "meta_ctwa");
  await lead(rep.id, "website_form", "contacted");
  for (let i = 0; i < 3; i++) await lead(other.id, "walk_in");

  const own = await funnel(rep.id);
  const all = await funnel(null);
  expect(all.leads).toBeGreaterThan(own.leads);

  await page.goto("/laporan");
  const section = page.getByRole("region", { name: "Lead dan funnel" });
  await expect(section).toBeVisible();
  // first section under the header: above the Done deal figures
  const [funnelTop, kpiTop] = await Promise.all([
    section.boundingBox(),
    page.locator("p", { hasText: /^Done deal bulan ini$/ }).boundingBox(),
  ]);
  expect(funnelTop!.y).toBeLessThan(kpiTop!.y);

  const figure = (label: string) => section.locator("dl > div").filter({ has: page.locator("dt", { hasText: label }) }).locator("dd");
  await expect(figure("Lead masuk bulan ini")).toHaveText(String(own.leads));
  await expect(figure("Belum ditangani")).toHaveText(String(own.unhandled));
  await expect(section.getByRole("region", { name: "Per sumber" })).toBeVisible();
  const table = section.getByRole("region", { name: "Per sumber" }).locator("table");
  await expect(table.getByRole("rowheader", { name: "Semua sumber" })).toBeVisible();
  await expect(table.getByRole("rowheader", { name: "Iklan Meta" })).toBeVisible();
  // the other rep's walk-ins are not counted for this rep
  const offline = table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Offline" }) });
  const [ownOffline] = await sql<{ leads: number }[]>`
    SELECT leads FROM lead_funnel(date_trunc('month', jakarta_today()::timestamp)::date, jakarta_today(), ${rep.id}::uuid)
     WHERE group_key = 'offline'`;
  await expect(offline.locator("td").first()).toHaveText(String(ownOffline.leads));
  await expect(section.getByRole("region", { name: "Langkah funnel semua sumber" })).toBeVisible();
});

test("a rep sees their own funnel on Laporan and Beranda even when the sales filter points at another rep", async ({ page, context, baseURL }) => {
  const [rep] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${REP.email}`;
  const [other] = await sql<{ id: string }[]>`
    INSERT INTO users (full_name, email, role) VALUES ('Rep Filter Lain', ${`filter-${tag}@e2e.example.com`}, 'sales_rep') RETURNING id`;
  await lead(rep.id, "walk_in");
  const own = await funnel(rep.id);
  // the other rep always has more leads than this rep, so the two figures differ
  for (let i = 0; i <= own.leads; i++) await lead(other.id, "meta_ctwa");
  expect((await funnel(other.id)).leads).toBeGreaterThan(own.leads);
  await context.addCookies([{ name: "crm_sales", value: other.id, url: baseURL! }]);
  try {

    await page.goto("/laporan");
    const section = page.getByRole("region", { name: "Lead dan funnel" });
    const figure = section.locator("dl > div").filter({ has: page.locator("dt", { hasText: "Lead masuk bulan ini" }) }).locator("dd");
    await expect(figure).toHaveText(String(own.leads));

    await page.goto("/beranda");
    const link = page.getByRole("link", { name: /Lead bulan ini/ });
    await expect(link).toContainText(String(own.leads));
    await expect(link).toContainText("Offline");
  } finally {
    await context.clearCookies({ name: "crm_sales" });
  }
});

for (const width of [768, 1024]) {
  test(`Lead dan funnel fits ${width} px next to the sidebar, with every column label visible`, async ({ page }) => {
    const [rep] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${REP.email}`;
    await lead(rep.id, "website_form", "contacted");
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/laporan");
    const groups = page.getByRole("region", { name: "Per sumber" });
    await expect(groups).toBeVisible();
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(0);
    // a table from 1024 px (with a "Lead masuk" column), cards per source below it
    const labels = ["Ditangani", "Jadi deal", "Quotation", "Negotiation", "PO", "Done deal", "Lost"];
    for (const label of width >= 1024 ? ["Lead masuk", ...labels] : labels) {
      const el = groups.getByText(label, { exact: true }).filter({ visible: true }).first();
      await expect(el).toBeVisible();
      const box = await el.boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      // not cut off: the whole word fits its box
      expect(await el.evaluate((n) => n.scrollWidth <= n.clientWidth + 1)).toBe(true);
    }
  });
}
