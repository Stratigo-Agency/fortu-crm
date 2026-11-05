import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/authz";
import { sql } from "@/lib/db";
import { getDeal } from "@/lib/deal";
import { leadPrefill } from "@/lib/dealLead";
import { DealInputError, parseDealInput, saveDeal } from "@/lib/dealSave";
import type { DealInput } from "@/lib/dealTypes";
import { LeadClosedError } from "@/lib/leads";
import { createLead, createProduct, createUser, randomPhone } from "./fixtures";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
const inDays = (n: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(Date.now() + n * 86_400_000));

/** A valid form submission; tests change what they need. */
function input(o: Partial<DealInput> = {}): DealInput {
  return {
    id: null,
    name: `Deal uji ${randomUUID().slice(0, 6)}`,
    kind: "new",
    parentDealId: null,
    stageKey: "chat",
    ownerId: "",
    companyName: "",
    contactName: "Kontak Uji",
    phone: randomPhone(),
    expectedCloseDate: "",
    nextStep: "Follow up WA",
    nextStepDate: inDays(2),
    demoDate: "",
    paidDate: "",
    lostReason: "",
    competitor: "",
    lostNote: "",
    estAmount: 0,
    lines: [],
    note: "",
    fromLeadId: null,
    ...o,
  };
}

const deal = async (id: string) => {
  const [d] = await sql`
    SELECT d.amount::text AS amount, d.est_amount::text AS est, s.key AS stage, d.closed_on, d.lead_id, d.owner_user_id,
           d.company_id, d.contact_id, d.lost_reason::text AS lost_reason, d.competitor
      FROM deals d JOIN pipeline_stages s ON s.id = d.stage_id WHERE d.id = ${id}`;
  return d;
};
const ok = (r: Awaited<ReturnType<typeof saveDeal>>) => {
  if (!r.ok) throw new Error(`stage rule ${r.rule}`);
  return r.id;
};

describe("saveDeal · amount follows the products", () => {
  it("saving lines makes deals.amount = the sum of line_total; removing them falls back to est_amount", async () => {
    const rep = await createUser();
    const a = await createProduct();
    const b = await createProduct({ line: "DSS" });
    const id = ok(
      await saveDeal(rep, input({
        estAmount: 5_000_000,
        lines: [
          { productId: a.id, qty: 4, unitPrice: 34_440_000 },
          { productId: b.id, qty: 1, unitPrice: 168_000_000 },
        ],
      })),
    );
    expect((await deal(id)).amount).toBe(String(4 * 34_440_000 + 168_000_000));

    const [existing] = await sql`SELECT name FROM deals WHERE id = ${id}`;
    ok(await saveDeal(rep, input({ id, name: existing.name, phone: "0812 5550 7777", estAmount: 7_000_000, lines: [] })));
    const d = await deal(id);
    expect(d.amount).toBe("7000000");
    const lines = await sql`SELECT 1 FROM deal_line_items WHERE deal_id = ${id}`;
    expect(lines).toHaveLength(0);
  });

  it("never takes the amount from the client", async () => {
    const parsed = parseDealInput({ ...input(), amount: 999, est_amount: 1 });
    expect("amount" in parsed).toBe(false);
    const rep = await createUser();
    const p = await createProduct();
    const id = ok(await saveDeal(rep, { ...input({ lines: [{ productId: p.id, qty: 2, unitPrice: 10_000_000 }] }), amount: 1 } as DealInput));
    expect((await deal(id)).amount).toBe("20000000");
  });

  it("returns the numbers from the database view in getDeal", async () => {
    const rep = await createUser();
    const p = await createProduct();
    const id = ok(await saveDeal(rep, input({ lines: [{ productId: p.id, qty: 3, unitPrice: 25_000_000 }] })));
    const d = await getDeal(id, rep.id);
    expect(d).toMatchObject({ amount: 75_000_000, canEdit: true, kind: "new", stageKey: "chat" });
    expect(d?.lines).toHaveLength(1);
    expect(d?.history.map((h) => h.kind)).toEqual(["system"]);
  });
});

describe("saveDeal · who may save", () => {
  it("a rep saving another rep's deal gets ForbiddenError and nothing changes", async () => {
    const owner = await createUser();
    const other = await createUser();
    const id = ok(await saveDeal(owner, input({ name: "Milik Owner" })));
    await expect(saveDeal(other, input({ id, name: "Dibajak" }))).rejects.toBeInstanceOf(ForbiddenError);
    const [d] = await sql`SELECT name FROM deals WHERE id = ${id}`;
    expect(d.name).toBe("Milik Owner");
  });

  it("a sales lead may edit anyone's deal and hand it over; a rep can't change the owner", async () => {
    const rep = await createUser();
    const lead = await createUser({ role: "sales_lead" });
    const target = await createUser();
    const id = ok(await saveDeal(rep, input()));
    ok(await saveDeal(rep, input({ id, ownerId: target.id }))); // ignored: reps don't reassign
    expect((await deal(id)).owner_user_id).toBe(rep.id);
    ok(await saveDeal(lead, input({ id, ownerId: target.id })));
    expect((await deal(id)).owner_user_id).toBe(target.id);
  });

  it("marketing and inactive users can't create a deal", async () => {
    const marketing = await createUser({ role: "marketing" });
    const inactive = await createUser({ isActive: false });
    for (const who of [marketing, inactive]) await expect(saveDeal(who, input())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a new deal is owned by the creator, and a rep can't pick another owner", async () => {
    const rep = await createUser();
    const other = await createUser();
    const id = ok(await saveDeal(rep, input({ ownerId: other.id })));
    expect((await deal(id)).owner_user_id).toBe(rep.id);
  });
});

describe("saveDeal · owners and managers", () => {
  it("a CEO or admin can create a deal for themselves, and a sales lead can save a deal a CEO owns", async () => {
    const ceo = await createUser({ role: "ceo" });
    const admin = await createUser({ role: "admin" });
    const lead = await createUser({ role: "sales_lead" });
    const id = ok(await saveDeal(ceo, input({ ownerId: ceo.id })));
    expect((await deal(id)).owner_user_id).toBe(ceo.id);
    ok(await saveDeal(admin, input({ ownerId: admin.id })));
    // the form sends the unchanged owner (a CEO): that must not need to be a rep or sales lead
    ok(await saveDeal(lead, input({ id, ownerId: ceo.id, name: "Disimpan sales lead" })));
    expect((await deal(id)).owner_user_id).toBe(ceo.id);
  });

  it("a manager still can't hand a deal to a CEO, marketing or an inactive user", async () => {
    const lead = await createUser({ role: "sales_lead" });
    const id = ok(await saveDeal(lead, input()));
    for (const bad of [await createUser({ role: "ceo" }), await createUser({ role: "marketing" }), await createUser({ isActive: false })]) {
      await expect(saveDeal(lead, input({ id, ownerId: bad.id }))).rejects.toMatchObject({ field: "owner" });
    }
  });
});

describe("saveDeal · closing dates", () => {
  it("Done deal → Lost keeps no payment date; Lost → Done starts at today", async () => {
    const rep = await createUser();
    const p = await createProduct();
    const base = { lines: [{ productId: p.id, qty: 1, unitPrice: 1_000_000 }], expectedCloseDate: inDays(10) };
    const id = ok(await saveDeal(rep, input({ ...base, stageKey: "quotation" })));
    ok(await saveDeal(rep, input({ ...base, id, stageKey: "done", paidDate: inDays(-5) })));
    expect(new Date((await deal(id)).closed_on).toISOString().slice(0, 10)).toBe(inDays(-5));
    // the form no longer sends the old payment date to Lost, and the server ignores it anyway
    ok(await saveDeal(rep, input({ ...base, id, stageKey: "lost", lostReason: "harga", paidDate: inDays(-5) })));
    expect(new Date((await deal(id)).closed_on).toISOString().slice(0, 10)).toBe(today());
    ok(await saveDeal(rep, input({ ...base, id, stageKey: "done", paidDate: "" })));
    expect(new Date((await deal(id)).closed_on).toISOString().slice(0, 10)).toBe(today());
  });
});

describe("saveDeal · contact of a prospect and input limits", () => {
  it("a deal made from a prospect keeps the prospect's contact, whatever number the form has", async () => {
    const rep = await createUser();
    const lead = await createLead(rep.id, { name: "Pak Asli" });
    const id = ok(await saveDeal(rep, input({ fromLeadId: lead.id, phone: randomPhone(), contactName: "Nama Lain" })));
    const [d] = await sql`SELECT d.contact_id AS deal_contact, l.contact_id AS lead_contact FROM deals d JOIN leads l ON l.id = d.lead_id WHERE d.id = ${id}`;
    expect(d.deal_contact).toBe(d.lead_contact);
  });

  it("totals that don't fit the database and dates that don't exist are refused with the field", () => {
    const base = { ...input() };
    const p = randomUUID();
    expect(() => parseDealInput({ ...base, lines: [{ productId: p, qty: 100_000, unitPrice: 9_999_999_999_999 }] })).toThrow(DealInputError);
    expect(() =>
      parseDealInput({ ...base, lines: Array.from({ length: 11 }, () => ({ productId: p, qty: 100_000, unitPrice: 9_999_999_999_999 })) }),
    ).toThrow(DealInputError);
    expect(() => parseDealInput({ ...base, expectedCloseDate: "2026-02-31" })).toThrow(DealInputError);
    expect(() => parseDealInput({ ...base, expectedCloseDate: "2026-02-28" })).not.toThrow();
  });
});

describe("saveDeal · company, contact and input checks", () => {
  it("finds the company by name in any letter case instead of making a second one", async () => {
    const rep = await createUser();
    const name = `PT Uji ${randomUUID().slice(0, 6)}`;
    const a = ok(await saveDeal(rep, input({ companyName: name })));
    const b = ok(await saveDeal(rep, input({ companyName: name.toUpperCase() })));
    expect((await deal(a)).company_id).toBe((await deal(b)).company_id);
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM companies WHERE lower(name) = lower(${name})`;
    expect(n).toBe(1);
  });

  it("uses the contact that already has the number and keeps its name", async () => {
    const rep = await createUser();
    const phone = randomPhone();
    const a = ok(await saveDeal(rep, input({ phone, contactName: "Bu Rina" })));
    const b = ok(await saveDeal(rep, input({ phone: phone.replace(/^0/, "+62 "), contactName: "Nama Lain" })));
    expect((await deal(a)).contact_id).toBe((await deal(b)).contact_id);
    const [c] = await sql`SELECT full_name FROM contacts WHERE id = ${(await deal(a)).contact_id}`;
    expect(c.full_name).toBe("Bu Rina");
  });

  it("refuses a missing name, a bad number, and a repeat order without a parent", async () => {
    const rep = await createUser();
    await expect(saveDeal(rep, input({ name: "" }))).rejects.toMatchObject({ field: "name" });
    await expect(saveDeal(rep, input({ phone: "12345" }))).rejects.toMatchObject({ field: "phone" });
    await expect(saveDeal(rep, input({ kind: "repeat" }))).rejects.toMatchObject({ field: "parent" });
    const parent = ok(await saveDeal(rep, input()));
    const id = ok(await saveDeal(rep, input({ kind: "repeat", parentDealId: parent })));
    expect((await getDeal(id, rep.id))?.parentDealId).toBe(parent);
  });

  it("parseDealInput refuses lines with no quantity or an unknown shape", () => {
    const base = { ...input() };
    for (const lines of [[{ productId: randomUUID(), qty: 0, unitPrice: 1 }], [{ productId: "x", qty: 1, unitPrice: 1 }], [{ productId: randomUUID(), qty: 1, unitPrice: -5 }]]) {
      expect(() => parseDealInput({ ...base, lines })).toThrow(DealInputError);
    }
    expect(() => parseDealInput({ ...base, stageKey: "bogus" })).toThrow(DealInputError);
    expect(() => parseDealInput({ ...base, id: "not-a-uuid" })).toThrow(DealInputError);
    expect(() => parseDealInput({ ...base, expectedCloseDate: "kemarin" })).toThrow(DealInputError);
  });
});

describe("saveDeal · stage rules", () => {
  it("Quotation needs products and a close date: the rule comes back and nothing is saved", async () => {
    const rep = await createUser();
    const p = await createProduct();
    const phone = randomPhone();
    const name = `Tanpa Produk ${randomUUID().slice(0, 6)}`;
    expect(await saveDeal(rep, input({ name, phone, stageKey: "quotation" }))).toEqual({ ok: false, rule: "products" });
    expect(await sql`SELECT 1 FROM deals WHERE name = ${name}`).toHaveLength(0);
    const withLines = { name, phone, stageKey: "quotation" as const, lines: [{ productId: p.id, qty: 1, unitPrice: 1_000_000 }] };
    expect(await saveDeal(rep, input(withLines))).toEqual({ ok: false, rule: "close_date" });
    const id = ok(await saveDeal(rep, input({ ...withLines, expectedCloseDate: inDays(20) })));
    expect((await deal(id)).stage).toBe("quotation");
    const hist = await sql`SELECT changed_by FROM deal_stage_history WHERE deal_id = ${id} AND from_stage_id IS NOT NULL`;
    expect(hist).toEqual([{ changed_by: rep.id }]);
  });

  it("an open deal needs a next step and its date", async () => {
    const rep = await createUser();
    expect(await saveDeal(rep, input({ nextStep: "" }))).toEqual({ ok: false, rule: "next_step" });
    expect(await saveDeal(rep, input({ nextStepDate: "" }))).toEqual({ ok: false, rule: "next_step" });
  });

  it("Lost needs a reason and keeps the competitor; Done deal takes the payment date, or today", async () => {
    const rep = await createUser();
    const p = await createProduct();
    const base = { lines: [{ productId: p.id, qty: 1, unitPrice: 1_000_000 }], expectedCloseDate: inDays(10) };
    const id = ok(await saveDeal(rep, input(base)));
    expect(await saveDeal(rep, input({ ...base, id, stageKey: "lost" }))).toEqual({ ok: false, rule: "lost_reason" });
    ok(await saveDeal(rep, input({ ...base, id, stageKey: "lost", lostReason: "kompetitor", competitor: "Vannoe", lostNote: "Lebih murah" })));
    expect(await deal(id)).toMatchObject({ stage: "lost", lost_reason: "kompetitor", competitor: "Vannoe" });

    // Lost → Done deal: the old lost date must not become the payment date
    await sql`UPDATE deals SET closed_on = jakarta_today() - 10 WHERE id = ${id}`;
    ok(await saveDeal(rep, input({ ...base, id, stageKey: "done" })));
    const d = await deal(id);
    expect(d.stage).toBe("done");
    expect(d.lost_reason).toBeNull();
    expect(String(new Date(d.closed_on).toISOString().slice(0, 10))).toBe(today());

    ok(await saveDeal(rep, input({ ...base, id, stageKey: "done", paidDate: inDays(-3) })));
    expect(new Date((await deal(id)).closed_on).toISOString().slice(0, 10)).toBe(inDays(-3));
  });
});

describe("saveDeal · notes and history", () => {
  it("a note goes to the history with who wrote it, newest first", async () => {
    const rep = await createUser({ fullName: "Siska" });
    const id = ok(await saveDeal(rep, input()));
    ok(await saveDeal(rep, input({ id, note: "Sudah telepon, minta revisi harga" })));
    const d = await getDeal(id, rep.id);
    expect(d?.history[0]).toMatchObject({ kind: "note", text: "Sudah telepon, minta revisi harga", by: "Siska" });
    expect(d?.history.at(-1)?.kind).toBe("system");
  });
});

describe("Jadikan deal (lead → deal)", () => {
  it("fills the form from the prospect: named after company or contact and product, owned by the prospect's owner", async () => {
    const owner = await createUser({ fullName: "Dimas" });
    const viewer = await createUser({ role: "sales_lead", fullName: "Verry" });
    const lead = await createLead(owner.id, { name: "Pak Hendra", product: "IFP", source: "meta_ctwa" });
    const pre = await leadPrefill(viewer, lead.id, { nextStep: "Follow up WA", productLabel: (l) => l });
    expect(pre).toMatchObject({
      id: null,
      name: "Pak Hendra · IFP",
      contactName: "Pak Hendra",
      ownerId: owner.id,
      ownerName: "Dimas",
      stageKey: "chat",
      nextStep: "Follow up WA",
      sourceChannel: "meta_ctwa",
      leadId: lead.id,
    });
    expect(pre.nextStepDate).toBe(inDays(2));
  });

  it("saving converts the prospect, links the deal and writes a system activity", async () => {
    const rep = await createUser();
    const lead = await createLead(rep.id, { name: "Bu Ratna" });
    const [{ phone_e164: phone }] = await sql<{ phone_e164: string }[]>`
      SELECT c.phone_e164 FROM contacts c JOIN leads l ON l.contact_id = c.id WHERE l.id = ${lead.id}`;
    const id = ok(await saveDeal(rep, input({ phone, contactName: "Bu Ratna", fromLeadId: lead.id, estAmount: 50_000_000 })));
    const [l] = await sql`SELECT status, deal_id FROM leads WHERE id = ${lead.id}`;
    expect(l).toEqual({ status: "converted", deal_id: id });
    expect((await deal(id)).lead_id).toBe(lead.id);
    expect((await deal(id)).amount).toBe("50000000");
    const acts = await sql`SELECT metadata FROM activities WHERE lead_id = ${lead.id} AND type = 'system'`;
    expect(acts).toEqual([{ metadata: { action: "converted" } }]);
  });

  it("refuses a prospect that is another rep's, or already a deal, and then saves no deal at all", async () => {
    const rep = await createUser();
    const other = await createUser();
    const theirs = await createLead(other.id);
    const name = `Tidak Jadi ${randomUUID().slice(0, 6)}`;
    await expect(saveDeal(rep, input({ name, fromLeadId: theirs.id }))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await sql`SELECT 1 FROM deals WHERE name = ${name}`).toHaveLength(0);
    expect((await sql`SELECT status FROM leads WHERE id = ${theirs.id}`)[0].status).toBe("new");

    const done = await createLead(rep.id, { status: "converted" });
    await expect(saveDeal(rep, input({ name, fromLeadId: done.id }))).rejects.toBeInstanceOf(LeadClosedError);
    expect(await sql`SELECT 1 FROM deals WHERE name = ${name}`).toHaveLength(0);
    await expect(leadPrefill(rep, theirs.id, { nextStep: "x", productLabel: (l) => l })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(leadPrefill(rep, done.id, { nextStep: "x", productLabel: (l) => l })).rejects.toBeInstanceOf(LeadClosedError);
  });
});

describe("read-only access", () => {
  it("another rep's deal comes back as read-only data, with the same fields", async () => {
    const owner = await createUser();
    const viewer = await createUser();
    const p = await createProduct();
    const id = ok(await saveDeal(owner, input({ lines: [{ productId: p.id, qty: 1, unitPrice: 2_000_000 }] })));
    const asOwner = await getDeal(id, owner.id);
    const asViewer = await getDeal(id, viewer.id);
    expect(asOwner?.canEdit).toBe(true);
    expect(asViewer?.canEdit).toBe(false);
    expect({ ...asViewer, canEdit: true }).toEqual(asOwner);
  });

  it("an unknown id is not found", async () => {
    const rep = await createUser();
    expect(await getDeal(randomUUID(), rep.id)).toBeNull();
    expect(await getDeal("nope", rep.id)).toBeNull();
  });
});
