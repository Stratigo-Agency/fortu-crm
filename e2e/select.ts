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
