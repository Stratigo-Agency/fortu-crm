import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { REP } from "./global-setup";

// Phones (390 px): Laporan, with the funnel as a list, never scrolls sideways and no label is cut off.

const sql = postgres(process.env.DATABASE_URL_E2E as string, { max: 1 });
test.afterAll(() => sql.end());

test("Laporan fits a 390 px phone without horizontal scroll", async ({ page }) => {
  const [rep] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${REP.email}`;
  const phone = `+62812${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
  const [c] = await sql<{ id: string }[]>`INSERT INTO contacts (phone_e164, full_name) VALUES (${phone}, 'Funnel ponsel') RETURNING id`;
  await sql`
    INSERT INTO leads (contact_id, owner_user_id, source_channel, status, first_message)
    VALUES (${c.id}, ${rep.id}, 'meta_ctwa', 'contacted', 'Tanya harga')`;

  await page.goto("/laporan");
  await expect(page.getByRole("region", { name: "Lead dan funnel" })).toBeVisible();
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(client);
  const groups = page.getByRole("region", { name: "Per sumber" });
  const negotiation = groups.getByText("Negotiation", { exact: true }).filter({ visible: true }).first();
  await expect(negotiation).toBeVisible();
  expect(await negotiation.evaluate((n) => n.scrollWidth <= n.clientWidth + 1)).toBe(true);

  await page.goto("/prospek?tab=semua");
  await expect(page.getByRole("combobox", { name: "Sumber" })).toBeVisible();
  const p = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(p).toBeLessThanOrEqual(0);
});
