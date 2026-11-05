import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/authz";
import { DuplicateCompanyError, listCompanies, saveCompany } from "@/lib/companies";
import { ContactInputError, DuplicatePhoneError, getContact, listContacts, logActivity, saveContact } from "@/lib/contacts";
import { sql } from "@/lib/db";
import { createDealFor, createProduct, createUser, randomPhone } from "./fixtures";

const daysAgo = (n: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(Date.now() - n * 86_400_000));
const contactInput = (o: Partial<Parameters<typeof saveContact>[1]> = {}) => ({
  id: null, name: `Kontak ${randomUUID().slice(0, 6)}`, jobTitle: "", email: "", phone: randomPhone(), companyName: "", ...o,
});
const row = async (id: string) => (await sql`SELECT * FROM v_contacts_enriched WHERE id = ${id}`)[0];

async function contactWithOpenDeal(ownerId: string, createdDaysAgo: number) {
  const id = await saveContact({ id: ownerId, role: "sales_rep" }, contactInput());
  await sql`UPDATE contacts SET created_at = now() - make_interval(days => ${createdDaysAgo}) WHERE id = ${id}`;
  await createDealFor(id, ownerId);
  return id;
}

describe("follow-up flag and Chat terakhir", () => {
  it("an open deal with no chat for 15 days needs follow-up; no open deal, or a recent chat, doesn't", async () => {
    const rep = await createUser();
    const old = await contactWithOpenDeal(rep.id, 15);
    const fresh = await contactWithOpenDeal(rep.id, 3);
    const noDeal = await saveContact(rep, contactInput());
    await sql`UPDATE contacts SET created_at = now() - interval '40 days' WHERE id = ${noDeal}`;
    expect((await row(old)).needs_followup).toBe(true);
    expect((await row(fresh)).needs_followup).toBe(false);
    expect((await row(noDeal)).needs_followup).toBe(false);
    expect((await row(old)).followup_days).toBe(14);
  });

  it("the filter and its count match the view", async () => {
    const rep = await createUser();
    const old = await contactWithOpenDeal(rep.id, 20);
    await contactWithOpenDeal(rep.id, 1);
    const mine = { ownerId: rep.id, q: "", sort: "last_new" as const, limit: 100 };
    const all = await listContacts({ ...mine, followupOnly: false });
    const due = await listContacts({ ...mine, followupOnly: true });
    expect(due.rows.map((r) => r.id)).toEqual([old]);
    expect(all.followup).toBe(1);
    expect(all.total).toBe(2);
    expect(all.rows.every((r) => r.needs_followup === (r.id === old))).toBe(true);
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM v_contacts_followup WHERE needs_followup AND owner_user_id = ${rep.id}`;
    expect(n).toBe(1);
  });

  it("logging an activity moves Chat terakhir and clears the mark; a past date keeps its day", async () => {
    const rep = await createUser();
    const id = await contactWithOpenDeal(rep.id, 30);
    const before = (await row(id)).last_chat_at as Date;
    expect((await row(id)).needs_followup).toBe(true);

    await logActivity(rep, id, "call", daysAgo(20), "Telepon bahas penawaran");
    const mid = await row(id);
    expect(mid.last_chat_at.getTime()).toBeGreaterThan(before.getTime());
    expect(mid.needs_followup).toBe(true); // 20 days ago is still past the 14-day mark
    await logActivity(rep, id, "whatsapp", daysAgo(0), "");
    const after = await row(id);
    expect(after.needs_followup).toBe(false);
    expect(Date.now() - after.last_chat_at.getTime()).toBeLessThan(60_000);

    const detail = await getContact(id, rep.id);
    expect(detail?.timeline.map((t) => t.type)).toEqual(["whatsapp", "call"]);
    expect(detail?.timeline[1]).toMatchObject({ text: "Telepon bahas penawaran", by: expect.any(String) });
  });

  it("refuses the future, a bad date and an unknown type, and writes nothing", async () => {
    const rep = await createUser();
    const id = await saveContact(rep, contactInput());
    const count = async () => (await sql`SELECT 1 FROM activities WHERE contact_id = ${id}`).length;
    const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(Date.now() + 86_400_000 * 2));
    for (const [type, date] of [["call", tomorrow], ["call", "2026-02-31"], ["call", "kemarin"], ["bogus", daysAgo(1)]]) {
      await expect(logActivity(rep, id, type, date, "x")).rejects.toBeInstanceOf(ContactInputError);
    }
    expect(await count()).toBe(0);
  });
});

describe("one phone number = one contact", () => {
  it("creating or changing a contact to a number that is taken is refused, saying whose it is", async () => {
    const siska = await createUser({ fullName: "Siska" });
    const rep = await createUser();
    const phone = randomPhone();
    const taken = await saveContact(siska, contactInput({ phone, name: "Pak Hendra" }));
    await createDealFor(taken, siska.id);

    const err = await saveContact(rep, contactInput({ phone: phone.replace(/^0/, "+62 ") })).catch((e) => e);
    expect(err).toBeInstanceOf(DuplicatePhoneError);
    expect(err).toMatchObject({ contactName: "Pak Hendra", repName: "Siska" });

    const mine = await saveContact(rep, contactInput());
    await expect(saveContact(rep, contactInput({ id: mine, phone }))).rejects.toBeInstanceOf(DuplicatePhoneError);
    expect((await sql`SELECT phone_e164 FROM contacts WHERE id = ${mine}`)[0].phone_e164).not.toBe(err.phone);
    // saving a contact with its own number is fine
    await expect(saveContact(rep, contactInput({ id: mine, name: "Nama Baru", phone: (await row(mine)).phone_e164 }))).resolves.toBe(mine);
  });

  it("refuses an unreadable number", async () => {
    const rep = await createUser();
    await expect(saveContact(rep, contactInput({ phone: "12345" }))).rejects.toMatchObject({ field: "phone" });
  });
});

describe("who may change a contact or company", () => {
  it("owner, sales lead, CEO and admin edit; another rep and marketing don't (they can read)", async () => {
    const owner = await createUser();
    const other = await createUser();
    const lead = await createUser({ role: "sales_lead" });
    const marketing = await createUser({ role: "marketing" });
    const id = await saveContact(owner, contactInput({ name: "Milik Owner" }));
    const input = (name: string) => contactInput({ id, name, phone: "" });
    const phone = (await row(id)).phone_e164;

    await expect(saveContact(other, { ...input("Dibajak"), phone })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(logActivity(other, id, "note", daysAgo(0), "x")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(logActivity(marketing, id, "note", daysAgo(0), "x")).rejects.toBeInstanceOf(ForbiddenError);
    await saveContact(lead, { ...input("Diubah lead"), phone });
    expect((await row(id)).full_name).toBe("Diubah lead");

    const asOther = await getContact(id, other.id);
    expect(asOther).toMatchObject({ canEdit: false, name: "Diubah lead" });
    expect((await getContact(id, owner.id))?.canEdit).toBe(true);
    expect(await getContact(randomUUID(), owner.id)).toBeNull();
  });

  it("marketing and inactive users can't create contacts or companies", async () => {
    const marketing = await createUser({ role: "marketing" });
    const inactive = await createUser({ isActive: false });
    for (const who of [marketing, inactive]) {
      await expect(saveContact(who, contactInput())).rejects.toBeInstanceOf(ForbiddenError);
      await expect(saveCompany(who, { id: null, name: "PT Gagal", industry: "", city: "", website: "" })).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});

describe("companies", () => {
  it("names are unique ignoring letter case; an edit by another rep is refused", async () => {
    const owner = await createUser();
    const other = await createUser();
    const name = `PT Unik ${randomUUID().slice(0, 6)}`;
    const id = await saveCompany(owner, { id: null, name, industry: "hotel", city: "Jakarta", website: "" });
    await expect(saveCompany(owner, { id: null, name: name.toUpperCase(), industry: "", city: "", website: "" })).rejects.toBeInstanceOf(DuplicateCompanyError);
    await expect(saveCompany(other, { id, name: "Dibajak", industry: "", city: "", website: "" })).rejects.toBeInstanceOf(ForbiddenError);
    await saveCompany(owner, { id, name, industry: "hospital", city: "Bandung", website: "https://contoh.id" });
    const [c] = await sql`SELECT industry, city FROM companies WHERE id = ${id}`;
    expect(c).toEqual({ industry: "hospital", city: "Bandung" });
  });

  it("the list shows contacts, open deals, pipeline and total done from the view", async () => {
    const rep = await createUser();
    const name = `PT Angka ${randomUUID().slice(0, 6)}`;
    const companyId = await saveCompany(rep, { id: null, name, industry: "corporate", city: "", website: "" });
    const c = await saveContact(rep, contactInput({ companyName: name }));
    const open = await createDealFor(c, rep.id);
    const won = await createDealFor(c, rep.id);
    const p = await createProduct();
    await sql`UPDATE deals SET company_id = ${companyId}, est_amount = 40000000 WHERE id = ${open.id}`;
    await sql`SELECT set_config('app.user_id', ${rep.id}, false)`;
    await sql`INSERT INTO deal_line_items (deal_id, product_id, qty, unit_price) VALUES (${won.id}, ${p.id}, 2, 30000000)`;
    await sql`UPDATE deals SET company_id = ${companyId}, expected_close_date = current_date,
              stage_id = (SELECT id FROM pipeline_stages WHERE key = 'done') WHERE id = ${won.id}`;

    const { rows } = await listCompanies({ ownerId: null, q: name, sort: "name", limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name, industry: "corporate", contact_count: 1, open_deals: 1, pipeline: "40000000", total_done: "60000000" });
    const sorted = await listCompanies({ ownerId: null, q: "", sort: "pipeline", limit: 500 });
    const idx = sorted.rows.findIndex((r) => r.name === name);
    expect(idx).toBeGreaterThanOrEqual(0);
    for (const r of sorted.rows.slice(0, idx)) expect(Number(r.pipeline)).toBeGreaterThanOrEqual(40_000_000);
  });
});

describe("contact list search and sort", () => {
  it("finds by name, company and phone written any way, and sorts by name or chat", async () => {
    const rep = await createUser();
    const phone = randomPhone();
    const company = `PT Cari ${randomUUID().slice(0, 6)}`;
    const a = await saveContact(rep, contactInput({ name: "Zainal", phone, companyName: company }));
    const b = await saveContact(rep, contactInput({ name: "Andi", companyName: company }));
    await sql`UPDATE contacts SET created_at = now() - interval '5 days' WHERE id = ${a}`;
    const base = { ownerId: rep.id, followupOnly: false, limit: 50 };
    for (const q of ["zainal", company.toLowerCase(), phone, phone.replace(/^0/, "+62 ")]) {
      expect((await listContacts({ ...base, q, sort: "last_new" })).rows.map((r) => r.id), q).toContain(a);
    }
    expect((await listContacts({ ...base, q: company, sort: "name" })).rows.map((r) => r.id)).toEqual([b, a]);
    expect((await listContacts({ ...base, q: company, sort: "last_new" })).rows.map((r) => r.id)).toEqual([b, a]);
    expect((await listContacts({ ...base, q: company, sort: "last_old" })).rows.map((r) => r.id)).toEqual([a, b]);
    expect((await listContacts({ ...base, q: "50%", sort: "name" })).rows).toHaveLength(0);
  });
});

describe("data checks", () => {
  it("refuses an email or website that isn't one, and accepts ordinary ones", async () => {
    const { parseContactInput } = await import("@/lib/contacts");
    const { parseCompanyInput, CompanyInputError } = await import("@/lib/companies");
    expect(() => parseContactInput({ email: "bukan email", phone: "0812" })).toThrow(ContactInputError);
    expect(parseContactInput({ email: "rina@arunika.co.id", phone: "0812" }).email).toBe("rina@arunika.co.id");
    expect(() => parseCompanyInput({ name: "PT A", website: "javascript:alert(1)" })).toThrow(CompanyInputError);
    expect(parseCompanyInput({ name: "PT A", website: "https://fortu.co.id/produk" }).website).toBe("https://fortu.co.id/produk");
    expect(parseCompanyInput({ name: "PT A", website: "fortu.co.id" }).website).toBe("fortu.co.id");
  });

  it("two saves at once with the same number or name leave one row and a clear refusal", async () => {
    const a = await createUser();
    const b = await createUser();
    const phone = randomPhone();
    const results = await Promise.allSettled([saveContact(a, contactInput({ phone })), saveContact(b, contactInput({ phone }))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(DuplicatePhoneError);

    const name = `PT Serentak ${randomUUID().slice(0, 6)}`;
    const co = (u: typeof a) => saveCompany(u, { id: null, name, industry: "", city: "", website: "" });
    const both = await Promise.allSettled([co(a), co(b)]);
    expect(both.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((both.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(DuplicateCompanyError);
    expect((await sql`SELECT 1 FROM companies WHERE lower(name) = lower(${name})`).length).toBe(1);
  });

  it("a company made from a contact belongs to the person who made it, and stays theirs when another touches a deal", async () => {
    const a = await createUser();
    const b = await createUser();
    const name = `PT Pemilik ${randomUUID().slice(0, 6)}`;
    const c = await saveContact(a, contactInput({ companyName: name }));
    const [co] = await sql<{ id: string; owner_user_id: string }[]>`SELECT co.id, co.owner_user_id FROM companies co JOIN contacts c ON c.company_id = co.id WHERE c.id = ${c}`;
    expect(co.owner_user_id).toBe(a.id);
    const d = await createDealFor(c, b.id);
    await sql`UPDATE deals SET company_id = ${co.id}, updated_at = now() WHERE id = ${d.id}`;
    expect((await sql`SELECT can_edit_company(${b.id}, ${co.id}) AS ok`)[0].ok).toBe(false);
    expect((await sql`SELECT can_edit_company(${a.id}, ${co.id}) AS ok`)[0].ok).toBe(true);
  });

  it("company search finds the industry by the name people see", async () => {
    const rep = await createUser();
    const name = `PT Sekolah ${randomUUID().slice(0, 6)}`;
    await saveCompany(rep, { id: null, name, industry: "education", city: "", website: "" });
    const { rows } = await listCompanies({ ownerId: null, q: "pendidikan", sort: "name", limit: 500 });
    expect(rows.map((r) => r.name)).toContain(name);
  });
});
