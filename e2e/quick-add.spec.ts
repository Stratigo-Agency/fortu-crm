import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { AD, REP } from "./global-setup";

const PHONE = "0813 2210 4471";
const E164 = "+6281322104471";
const MESSAGE = `Halo kak, mau tanya harga IFP 75 inch buat 4 kelas [${AD.code}]`;

const sql = postgres(process.env.DATABASE_URL_E2E as string, { max: 1 });
test.afterAll(() => sql.end());

async function leadsOf(e164: string) {
  return sql`
    SELECT l.id, l.ad_id, l.owner_user_id, l.source_channel, l.product_interest, u.email AS owner_email
      FROM leads l JOIN contacts c ON c.id = l.contact_id LEFT JOIN users u ON u.id = l.owner_user_id
     WHERE c.phone_e164 = ${e164}`;
}

async function fillAndSave(page: Page, phone: string, message: string) {
  await page.getByLabel("Nomor WhatsApp").fill(phone);
  await page.getByLabel("Pesan pertama").fill(message);
  await page.getByRole("button", { name: "Simpan prospek" }).click();
}

test.describe.serial("Tambah cepat on a phone", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/tambah");
    await expect(page.getByRole("heading", { name: "Prospek baru" })).toBeVisible();
  });

  test("a lead with an ad code saves with the ad linked, in under 15 seconds of typing", async ({ page }) => {
    const started = Date.now();
    await page.getByLabel("Nomor WhatsApp").fill(PHONE);
    await expect(page.getByText("Nomor baru. Kontak akan dibuat.")).toBeVisible();
    await page.getByLabel("Nama (boleh dikosongkan)").fill("Andi Wijaya");
    await page.getByLabel("Pesan pertama").fill(MESSAGE);

    // the code is read while typing: the ad card shows and the product chip is set
    await expect(page.getByText(`Dari iklan: ${AD.name}`)).toBeVisible();
    await expect(page.getByText("Sumber dan produk sudah terisi.")).toBeVisible();
    await expect(page.getByRole("radio", { name: "IFP" })).toBeChecked();
    await expect(page.getByLabel("Sumber chat")).toHaveCount(0);

    await page.getByRole("button", { name: "Simpan prospek" }).click();
    await expect(page.getByRole("status")).toHaveText("Prospek tersimpan.");
    const seconds = (Date.now() - started) / 1000;
    expect(seconds).toBeLessThan(15);

    // the form starts over and the phone field is ready for the next number
    await expect(page.getByLabel("Nomor WhatsApp")).toHaveValue("");
    await expect(page.getByLabel("Nomor WhatsApp")).toBeFocused();
    await expect(page.getByLabel("Pesan pertama")).toHaveValue("");

    const leads = await leadsOf(E164);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({
      source_channel: "meta_ctwa",
      product_interest: "IFP",
      owner_email: REP.email,
    });
    expect(leads[0].ad_id).not.toBeNull();
  });

  test("the same number again says it was merged, and stays one lead", async ({ page }) => {
    await page.getByLabel("Nomor WhatsApp").fill(PHONE);
    await expect(page.getByText("Kontak lama:")).toBeVisible();
    await fillAndSave(page, PHONE, "Halo lagi");
    await expect(page.getByRole("status")).toHaveText(
      "Customer ini sudah chat hari ini. Digabung ke prospek yang sama.",
    );
    expect(await leadsOf(E164)).toHaveLength(1);
  });

  test("an unreadable number shows the Bahasa error under the field and keeps what was typed", async ({ page }) => {
    await fillAndSave(page, "12345", "Halo");
    const error = page.locator("#phone-error");
    await expect(error).toHaveText("Nomor belum benar. Contoh: 0812 3456 7890.");
    await expect(page.getByLabel("Nomor WhatsApp")).toHaveValue("12345");
    await expect(page.getByLabel("Pesan pertama")).toHaveValue("Halo");
    expect(await leadsOf("+6212345")).toHaveLength(0);
  });

  test("without a code a source can be picked, and a time today can be chosen", async ({ page }) => {
    await page.getByLabel("Nomor WhatsApp").fill("0812 5550 0001");
    await page.getByLabel("Pesan pertama").fill("Tanya harga LED");
    await page.getByLabel("Sumber chat").selectOption("referral");
    await page.getByRole("radio", { name: "LED" }).check({ force: true });
    await page.getByRole("radio", { name: "Pilih jam" }).check({ force: true });
    await page.getByLabel("Pilih jam", { exact: true }).last().fill("00:00");
    await page.getByRole("button", { name: "Simpan prospek" }).click();
    await expect(page.getByRole("status")).toHaveText("Prospek tersimpan.");
    const [lead] = await leadsOf("+6281255500001");
    expect(lead).toMatchObject({ source_channel: "referral", product_interest: "LED", ad_id: null });
  });
});
