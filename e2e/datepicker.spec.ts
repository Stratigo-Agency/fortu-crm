import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { REP } from "./global-setup";

// ui/DatePicker on a phone: our own calendar instead of the browser's, with the keyboard and 44 px days.
const sql = postgres(process.env.DATABASE_URL_E2E as string, { max: 1 });
test.afterAll(() => sql.end());

const tag = randomUUID().slice(0, 6);
const jakarta = (offset: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(Date.now() + offset * 86_400_000));
let contactId: string;

test.beforeAll(async () => {
  const [{ id: repId }] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${REP.email}`;
  const [c] = await sql<{ id: string }[]>`
    INSERT INTO contacts (phone_e164, full_name, owner_user_id)
    VALUES (${`+62817${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`}, ${`Bu Tanggal ${tag}`}, ${repId}) RETURNING id`;
  contactId = c.id;
});

test("the activity date opens our calendar: today in Jakarta, no future days, keyboard and 44 px targets", async ({ page }) => {
  await page.goto(`/kontak?contact=${contactId}`);
  const trigger = page.getByRole("combobox", { name: "Tanggal" });
  await expect(trigger).toHaveAttribute("data-value", jakarta(0));
  expect(await page.locator('input[type="date"]').count()).toBe(0);

  await trigger.click();
  const grid = page.getByRole("grid");
  await expect(grid).toBeVisible();
  await expect(grid.getByRole("columnheader")).toHaveText(["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"]);
  const today = grid.locator(`[data-day="${jakarta(0)}"]`);
  await expect(today).toHaveAttribute("aria-current", "date");
  await expect(today).toBeFocused();
  // layout size, not the box mid-way through the popup's opening animation
  const [w, h] = await today.evaluate((el) => [(el as HTMLElement).offsetWidth, (el as HTMLElement).offsetHeight]);
  expect(w).toBeGreaterThanOrEqual(44);
  expect(h).toBeGreaterThanOrEqual(44);
  // max = today: tomorrow can't be picked, and the arrow stops at today
  const tomorrow = grid.locator(`[data-day="${jakarta(1)}"]`);
  if ((await tomorrow.count()) > 0) await expect(tomorrow).toBeDisabled();
  await page.keyboard.press("ArrowRight");
  await expect(today).toBeFocused();
  // the calendar fits the phone
  const cal = await page.getByRole("dialog").filter({ has: grid }).boundingBox();
  expect((cal?.x ?? 0) + (cal?.width ?? 0)).toBeLessThanOrEqual(390);

  // a week back with the keyboard, then Enter picks it
  await page.keyboard.press("ArrowUp");
  await expect(grid.locator(`[data-day="${jakarta(-7)}"]`)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(grid).toHaveCount(0);
  await expect(trigger).toHaveAttribute("data-value", jakarta(-7));
  await expect(trigger).toBeFocused();

  // Esc closes without a change
  await page.keyboard.press("Enter");
  await expect(grid).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Escape");
  await expect(grid).toHaveCount(0);
  await expect(trigger).toHaveAttribute("data-value", jakarta(-7));
});
