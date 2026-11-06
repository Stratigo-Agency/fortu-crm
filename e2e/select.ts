import { expect, type Locator } from "@playwright/test";

/** Picks an option in our own Select (a button that opens a list), by the option's text. */
export async function pick(trigger: Locator, option: string | RegExp) {
  await trigger.click();
  const list = trigger.page().getByRole("listbox").last();
  await expect(list).toBeVisible();
  await list.getByRole("option", { name: option }).first().click();
  await expect(list).toHaveCount(0);
}

/** What the Select shows now. */
export async function shown(trigger: Locator): Promise<string> {
  return ((await trigger.textContent()) ?? "").trim();
}

/** Picks by the option's value (an id), when names can repeat across specs. */
export async function pickValue(trigger: Locator, value: string) {
  await trigger.click();
  const list = trigger.page().getByRole("listbox").last();
  await expect(list).toBeVisible();
  await list.locator(`[role="option"][data-value="${value}"]`).click();
  await expect(list).toHaveCount(0);
}

/** Picks a day ("YYYY-MM-DD") in our own DatePicker: opens it, steps to the month, clicks the day. */
export async function pickDate(trigger: Locator, day: string) {
  const page = trigger.page();
  await trigger.click();
  const grid = page.getByRole("grid").last();
  await expect(grid).toBeVisible();
  const target = day.slice(0, 7);
  for (let i = 0; i < 240; i++) {
    const month = (await grid.getAttribute("data-month")) ?? "";
    if (month === target) break;
    await page.getByRole("button", { name: month < target ? "Bulan berikutnya" : "Bulan sebelumnya" }).last().click();
    await expect(grid).not.toHaveAttribute("data-month", month);
  }
  await grid.locator(`[data-day="${day}"]`).click();
  await expect(page.getByRole("grid")).toHaveCount(0);
  await expect(trigger).toHaveAttribute("data-value", day);
}
