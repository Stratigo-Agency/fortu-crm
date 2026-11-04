import { expect, test as setup } from "@playwright/test";
import { AUTH_FILE } from "../playwright.config";
import { REP } from "./global-setup";

// Signs in through the real /masuk form and keeps the session for the other tests.
setup("sign in as a sales rep", async ({ page }) => {
  await page.goto("/masuk?next=/pipeline");
  await page.getByLabel("Email").fill(REP.email);
  await page.getByLabel("Password").fill(REP.password);
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await page.waitForURL("**/pipeline");
  await expect(page.getByRole("heading", { name: "Pipeline" })).toBeVisible();
  await page.context().storageState({ path: AUTH_FILE });
});
