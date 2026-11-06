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
