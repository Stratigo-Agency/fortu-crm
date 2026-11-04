import { expect, test } from "@playwright/test";
import { REP } from "./global-setup";

test("a signed-in rep sees the app, and a wrong password is refused", async ({ page, browser }) => {
  await page.goto("/pipeline");
  await expect(page.getByRole("heading", { name: "Pipeline" })).toBeVisible();

  const anonymous = await browser.newContext({
    baseURL: "http://localhost:3100",
    storageState: { cookies: [], origins: [] }, // not signed in
  });
  const fresh = await anonymous.newPage();
  await fresh.goto("/masuk");
  await fresh.getByLabel("Email").fill(REP.email);
  await fresh.getByLabel("Password").fill("salah-sengaja");
  await fresh.getByRole("button", { name: "Masuk", exact: true }).click();
  await expect(fresh.getByText("Email atau password salah.")).toBeVisible();
  await anonymous.close();
});
