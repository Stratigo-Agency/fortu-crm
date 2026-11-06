import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { describeCodes, lookupPhoneStatus, submitQuickAdd } from "@/lib/quickAdd";
import { createAd, createClick, createUser, freeAdCode, randomPhone } from "./fixtures";

const leadRow = async (id: string) => {
  const [row] = await sql`
    SELECT owner_user_id, ad_id, source_channel, capture_method, product_interest, received_at, first_message
      FROM leads WHERE id = ${id}`;
  return row;
};
const leadCount = async (phone: string) => {
  const [{ n }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM leads l JOIN contacts c ON c.id = l.contact_id
     WHERE c.phone_e164 = ${"+62" + phone.replace(/^0/, "")}`;
  return n;
};
const clickRef = () => randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase();

describe("submitQuickAdd", () => {
  it("saves a lead with an ad code: ad linked, source and product from the ad, owned by the rep", async () => {
    const rep = await createUser();
    const code = await freeAdCode("F-IFP");
    const ad = await createAd(code, "IFP Sekolah");
    const r = await submitQuickAdd(rep.id, {
      phone: "0813 2210 4471",
      name: " Andi Wijaya ",
      message: `Halo kak, mau tanya harga IFP 75 inch buat 4 kelas [${code}]`,
      when: "now",
      source: "other", // the client's source is ignored when a code names the ad
    });
    expect(r.status).toBe("saved");
    if (r.status === "error") return;
    expect(await leadRow(r.leadId)).toMatchObject({
      owner_user_id: rep.id,
      ad_id: ad.id,
      source_channel: "meta_ctwa",
      capture_method: "manual_quick_add",
      product_interest: "IFP",
    });
    const [c] = await sql`
      SELECT c.full_name FROM contacts c JOIN leads l ON l.contact_id = c.id WHERE l.id = ${r.leadId}`;
    expect(c.full_name).toBe("Andi Wijaya");
  });

  it("keeps the rep's own answer when they chose Belum tahu or another product", async () => {
    const rep = await createUser();
    const code = await freeAdCode("F-IFP");
    await createAd(code);
    const a = await submitQuickAdd(rep.id, { phone: randomPhone(), message: `[${code}]`, interest: "unknown" });
    const b = await submitQuickAdd(rep.id, { phone: randomPhone(), message: `[${code}]`, interest: "LED" });
    if (a.status === "error" || b.status === "error") throw new Error("unexpected error");
    expect((await leadRow(a.leadId)).product_interest).toBeNull();
    expect((await leadRow(b.leadId)).product_interest).toBe("LED");
  });

  it("takes the source from a click code's link, and from the select when there is no code", async () => {
    const rep = await createUser();
    const ref = clickRef();
    await createClick(ref);
    const viaLink = await submitQuickAdd(rep.id, { phone: randomPhone(), message: `info #${ref}`, source: "referral" });
    const manual = await submitQuickAdd(rep.id, { phone: randomPhone(), message: "halo", source: "referral" });
    const bogus = await submitQuickAdd(rep.id, { phone: randomPhone(), source: "'; drop table leads; --" });
    if (viaLink.status === "error" || manual.status === "error" || bogus.status === "error") throw new Error("error");
    expect((await leadRow(viaLink.leadId)).source_channel).toBe("website_wa_link");
    expect((await leadRow(manual.leadId)).source_channel).toBe("referral");
    expect((await leadRow(bogus.leadId)).source_channel).toBe("meta_ctwa");
  });

  it("merges the same number within 24 h into one lead and says so", async () => {
    const rep = await createUser();
    const phone = randomPhone();
    const first = await submitQuickAdd(rep.id, { phone });
    const again = await submitQuickAdd(rep.id, { phone: phone.replace(/^0(\d{3})(\d+)/, "0$1-$2") });
    expect(first.status).toBe("saved");
    expect(again.status).toBe("duplicate");
    if (first.status === "error" || again.status === "error") return;
    expect(again.leadId).toBe(first.leadId);
    expect(await leadCount(phone)).toBe(1);
  });

  it("refuses an unreadable number on the phone field, writing nothing", async () => {
    const rep = await createUser();
    for (const phone of ["12345", "", undefined]) {
      expect(await submitQuickAdd(rep.id, { phone })).toEqual({
        status: "error",
        field: "phone",
        messageKey: "quickAdd.invalidPhone",
      });
    }
  });

  it("reads Pilih jam as today in Jakarta, and refuses a missing or future time", async () => {
    const rep = await createUser();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
    const early = await submitQuickAdd(rep.id, { phone: randomPhone(), when: "time", time: "00:00" });
    if (early.status === "error") throw new Error("00:00 today is never in the future");
    expect(((await leadRow(early.leadId)).received_at as Date).toISOString()).toBe(
      new Date(`${today}T00:00:00+07:00`).toISOString(),
    );

    expect(await submitQuickAdd(rep.id, { phone: randomPhone(), when: "time", time: "" })).toMatchObject({
      field: "receivedAt",
      messageKey: "quickAdd.timeMissing",
    });
    expect(await submitQuickAdd(rep.id, { phone: randomPhone(), when: "time", time: "9:5" })).toMatchObject({
      messageKey: "quickAdd.timeMissing",
    });

    const inThirty = new Date(Date.now() + 30 * 60_000);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(inThirty);
    const sameDay =
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(inThirty) === today;
    if (sameDay) {
      expect(await submitQuickAdd(rep.id, { phone: randomPhone(), when: "time", time: parts })).toMatchObject({
        status: "error",
        field: "receivedAt",
        messageKey: "quickAdd.futureTime",
      });
    }
  });

  it("refuses a user who may not log leads (marketing), writing nothing", async () => {
    const marketing = await createUser({ role: "marketing" });
    const phone = randomPhone();
    expect(await submitQuickAdd(marketing.id, { phone })).toEqual({
      status: "error",
      field: "form",
      messageKey: "authz.forbidden",
    });
    expect(await leadCount(phone)).toBe(0);
  });
});

describe("describeCodes", () => {
  it("names the ad and its product from an ad code, in any letter case", async () => {
    const code = await freeAdCode("R-DSS");
    await createAd(code, "Signage Restoran");
    expect(await describeCodes({ adCode: code })).toEqual({
      kind: "ad",
      adName: "Signage Restoran",
      code,
      productLine: "DSS",
      sourceChannel: "meta_ctwa",
    });
    expect(await describeCodes({ adCode: code.toLowerCase() })).toMatchObject({ kind: "ad", code });
  });

  it("finds a click's link, but not one that already belongs to a lead", async () => {
    const free = clickRef();
    const used = clickRef();
    await createClick(free);
    const click = await createClick(used);
    const rep = await createUser();
    const lead = await submitQuickAdd(rep.id, { phone: randomPhone() });
    if (lead.status === "error") throw new Error("error");
    await sql`UPDATE wa_click_events SET matched_lead_id = ${lead.leadId} WHERE id = ${click.id}`;
    expect(await describeCodes({ clickCode: free })).toEqual({ kind: "link", sourceChannel: "website_wa_link" });
    expect(await describeCodes({ clickCode: used })).toBeNull();
  });

  it("returns null for codes nobody owns and for no code", async () => {
    expect(await describeCodes({ adCode: "Q-LED-99", clickCode: "ZZZZ" })).toBeNull();
    expect(await describeCodes({})).toBeNull();
  });
});

describe("lookupPhoneStatus", () => {
  it("says new, known (with the name) or nothing yet", async () => {
    const rep = await createUser();
    const phone = randomPhone();
    expect(await lookupPhoneStatus("0812")).toBeNull();
    expect(await lookupPhoneStatus(phone)).toEqual({ state: "new" });
    await submitQuickAdd(rep.id, { phone, name: "Bu Rina" });
    expect(await lookupPhoneStatus(phone)).toMatchObject({ state: "known", name: "Bu Rina" });
  });
});
