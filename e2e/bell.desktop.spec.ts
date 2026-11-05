import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { REP } from "./global-setup";

const sql = postgres(process.env.DATABASE_URL_E2E as string, { max: 1 });
test.afterAll(() => sql.end());

const tag = `Bel${randomUUID().slice(0, 6)}`;
let dealId: string;
let userId: string;

test.beforeAll(async () => {
  const [{ id }] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${REP.email}`;
  userId = id;
  const [c] = await sql<{ id: string }[]>`INSERT INTO contacts (phone_e164, full_name) VALUES (${`+62857${String(Date.now()).slice(-8)}`}, ${`Pak ${tag}`}) RETURNING id`;
  const [d] = await sql<{ id: string }[]>`
    INSERT INTO deals (name, contact_id, owner_user_id, stage_id, next_step, next_step_date)
    SELECT ${`Deal ${tag}`}, ${c.id}, ${id}, id, 'Telepon', jakarta_today() + 3 FROM pipeline_stages WHERE key = 'chat' RETURNING id`;
  dealId = d.id;
  await sql`
    INSERT INTO notifications (user_id, kind, deal_id, channel, payload)
    VALUES (${id}, 'stale_deal', ${d.id}, 'in_app',
            ${sql.json({ kind: "stale_deal", deal: { id: d.id, name: `Deal ${tag}`, amount: 150000000, stage: "Negotiation" }, owner: { name: "Rep E2E" } })})`;
});

test("the bell shows the unread count, lists the reminder, opens the deal and marks it read", async ({ page }) => {
  await page.goto("/beranda");
  const bell = page.getByRole("button", { name: /^Buka pengingat/ }).first();
  await expect(bell).toContainText("1");
  await bell.click();
  const panel = page.getByRole("dialog", { name: "Pengingat" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText(`Deal ${tag} belum bergerak`)).toBeVisible();
  await expect(panel.getByText("Masih di Negotiation · Rp150 jt")).toBeVisible();
  // the panel stays inside the window
  const box = (await page.getByRole("dialog", { name: "Pengingat" }).locator("xpath=..").boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);

  await panel.getByRole("button", { name: new RegExp(`Deal ${tag}`) }).click();
  await expect(page).toHaveURL(new RegExp(`/deal/${dealId}`));
  const [row] = await sql<{ read: boolean }[]>`SELECT read_at IS NOT NULL AS read FROM notifications WHERE user_id = ${userId} AND deal_id = ${dealId}`;
  expect(row.read).toBe(true);

  await page.goto("/beranda");
  await expect(page.getByRole("button", { name: /^Buka pengingat/ }).first()).not.toContainText("1");
});

test("with nothing to say the bell says so, and Esc closes it", async ({ page }) => {
  await sql`DELETE FROM notifications WHERE user_id = ${userId}`;
  await page.goto("/beranda");
  const bell = page.getByRole("button", { name: /^Buka pengingat/ }).first();
  await bell.click();
  await expect(page.getByText("Belum ada pengingat.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Pengingat" })).toHaveCount(0);
});

test("on a phone the panel fits the window", async ({ page }) => {
  await sql`
    INSERT INTO notifications (user_id, kind, deal_id, channel, payload)
    VALUES (${userId}, 'next_step_overdue', ${dealId}, 'in_app',
            ${sql.json({ kind: "next_step_overdue", deal: { id: dealId, name: `Deal ${tag}`, amount: 150000000, stage: "Chat masuk", next_step: "Telepon" }, owner: { name: "Rep E2E" } })})`;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/beranda");
  await page.getByRole("button", { name: /^Buka pengingat/ }).first().click();
  const popup = page.getByRole("dialog", { name: "Pengingat" }).locator("xpath=..");
  await expect(popup).toBeVisible();
  const box = (await popup.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
});
