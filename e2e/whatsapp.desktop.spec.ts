import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { CEO, REP } from "./global-setup";

// Pengaturan › WhatsApp (T19): admin and ceo only; Meta's SDK is allowed on that page only.

const sql = postgres(process.env.DATABASE_URL_E2E as string, { max: 1 });
test.afterAll(() => sql.end());

const PHONE = "+6281199887766";

test.beforeAll(async () => {
  const [{ id: repId }] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${REP.email}`;
  await sql`
    INSERT INTO wa_lines (user_id, phone_e164, label, mode, meta_waba_id, meta_phone_number_id, connected_at, consent_at, consent_by)
    VALUES (${repId}, ${PHONE}, 'No_Rep', 'coexistence', '100200300400500', '600700800900100', now(), now(), 'Rep E2E')
    ON CONFLICT (phone_e164) DO NOTHING`;
});

test("a sales rep is refused", async ({ page }) => {
  await page.goto("/pengaturan/whatsapp");
  await expect(page.getByRole("alert").filter({ hasText: "Pengaturan hanya untuk admin dan CEO." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sambungkan nomor" })).toHaveCount(0);
  await expect(page.getByText("+62 811-9988-7766")).toHaveCount(0);
});

test("Laporan shows the reply-speed card to a rep", async ({ page }) => {
  await page.goto("/laporan");
  await expect(page.getByRole("region", { name: "Kecepatan balas chat" })).toBeVisible();
});

test.describe("the CEO", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  async function signIn(page: Page) {
    await page.goto("/masuk?next=/pengaturan");
    await page.getByLabel("Email").fill(CEO.email);
    await page.getByLabel("Password").fill(CEO.password);
    await page.getByRole("button", { name: "Masuk", exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/pengaturan");
  }

  test("sees the lines, the consent and the setup note, with Meta allowed on this page only", async ({ page }) => {
    await signIn(page);
    const settings = await page.request.get("/pengaturan");
    expect(settings.headers()["content-security-policy"]).not.toContain("facebook");

    await page.getByRole("link", { name: "WhatsApp", exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/pengaturan/whatsapp");
    await expect(page.getByRole("heading", { name: "WhatsApp", level: 1 })).toBeVisible();
    const lines = page.getByRole("region", { name: "Nomor sales" });
    await expect(lines.getByText("+62 811-9988-7766")).toBeVisible();
    await expect(lines.getByText("Tersambung ke CRM")).toBeVisible();
    await expect(lines.getByText(/^Rep E2E, /)).toBeVisible();
    await expect(lines.getByRole("button", { name: "Cabut izin" })).toBeVisible();
    await expect(lines.getByText("Nomor dilepas dari CRM. Isi pesan yang tersimpan dihapus.")).toBeVisible();
    // the e2e server has no Meta app: a short note for the CEO instead of the button, without setting names
    await expect(page.getByRole("note")).toHaveText("Pengaturan Meta belum lengkap. Hubungi admin.");
    await expect(page.locator("main")).not.toContainText(/META_|docs\//);

    const res = await page.request.get("/pengaturan/whatsapp");
    expect(res.headers()["content-security-policy"]).toContain("https://connect.facebook.net");
    expect(res.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  });
});
