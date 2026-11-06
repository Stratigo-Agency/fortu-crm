import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/authz";
import { sql } from "@/lib/db";
import { approveDiscount } from "@/lib/discount";
import { saveDeal } from "@/lib/dealSave";
import type { DealInput } from "@/lib/dealTypes";
import { createProduct, createUser, randomPhone } from "./fixtures";

const inDays = (n: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(Date.now() + n * 86_400_000));
const MSRP = 30_000_000;

type Line = { productId: string; qty: number; unitPrice: number };
function input(lines: Line[], o: Partial<DealInput> = {}): DealInput {
  return {
    id: null, name: `Deal diskon ${randomUUID().slice(0, 6)}`, kind: "new", parentDealId: null, stageKey: "quotation",
    ownerId: "", companyName: "", contactName: "Kontak Uji", phone: randomPhone(),
    expectedCloseDate: inDays(14), nextStep: "Kirim penawaran", nextStepDate: inDays(2), demoDate: "", paidDate: "",
    lostReason: "", competitor: "", lostNote: "", estAmount: 0, lines, note: "", fromLeadId: null, ...o,
  };
}
const save = async (rep: { id: string; role: "sales_rep" | "ceo" | "admin" | "sales_lead" }, i: DealInput) => {
  const r = await saveDeal(rep, i);
  if (!r.ok) throw new Error(`stage rule ${r.rule}`);
  return r.id;
};
const state = async (id: string) => {
  const [d] = await sql<{ needs: boolean; by: string | null; at: Date | null }[]>`
    SELECT e.needs_discount_approval AS needs, d.discount_approved_by AS by, d.discount_approved_at AS at
      FROM v_deals_enriched e JOIN deals d ON d.id = e.id WHERE e.id = ${id}`;
  return d;
};
/** 18% off MSRP 30 jt */
const OVER = Math.round(MSRP * 0.82);

describe("discount limit and approval", () => {
  it("18% off with a 15% limit needs approval; the CEO approves and it clears", async () => {
    const rep = await createUser();
    const ceo = await createUser({ role: "ceo" });
    const p = await createProduct({ listPrice: MSRP });
    await sql`UPDATE products SET max_discount_pct = 15 WHERE id = ${p.id}`;
    const id = await save({ id: rep.id, role: "sales_rep" }, input([{ productId: p.id, qty: 1, unitPrice: OVER }]));
    expect((await state(id)).needs).toBe(true);

    expect(await approveDiscount({ id: ceo.id, role: "ceo" }, id)).toBe(true);
    const after = await state(id);
    expect(after).toMatchObject({ needs: false, by: ceo.id });
    expect(after.at).not.toBeNull();

    // nothing left to approve
    expect(await approveDiscount({ id: ceo.id, role: "ceo" }, id)).toBe(false);
  });

  it("a discount inside the limit never needs approval", async () => {
    const rep = await createUser();
    const p = await createProduct({ listPrice: MSRP });
    await sql`UPDATE products SET max_discount_pct = 15 WHERE id = ${p.id}`;
    const id = await save({ id: rep.id, role: "sales_rep" }, input([{ productId: p.id, qty: 1, unitPrice: Math.round(MSRP * 0.9) }]));
    expect((await state(id)).needs).toBe(false);
  });

  it("changing a price, a quantity or a product takes the approval back; saving the same lines keeps it", async () => {
    const rep = await createUser();
    const admin = await createUser({ role: "admin" });
    const p = await createProduct({ listPrice: MSRP });
    const q = await createProduct({ listPrice: MSRP });
    await sql`UPDATE products SET max_discount_pct = 15 WHERE id IN (${p.id}, ${q.id})`;
    const actor = { id: rep.id, role: "sales_rep" as const };
    const line = { productId: p.id, qty: 2, unitPrice: OVER };
    const id = await save(actor, input([line]));
    await approveDiscount({ id: admin.id, role: "admin" }, id);

    // same lines, other fields: approval stays
    await save(actor, input([line], { id, nextStep: "Telepon lagi" }));
    expect(await state(id)).toMatchObject({ needs: false, by: admin.id });

    // the rep lowers the price a little more: approval gone, needs it again
    await save(actor, input([{ ...line, unitPrice: OVER - 1_000_000 }], { id }));
    expect(await state(id)).toMatchObject({ needs: true, by: null, at: null });

    // approve again, then change the quantity
    await approveDiscount({ id: admin.id, role: "admin" }, id);
    await save(actor, input([{ productId: p.id, qty: 3, unitPrice: OVER - 1_000_000 }], { id }));
    expect(await state(id)).toMatchObject({ needs: true, by: null });

    // approve again, then swap the product
    await approveDiscount({ id: admin.id, role: "admin" }, id);
    await save(actor, input([{ productId: q.id, qty: 3, unitPrice: OVER - 1_000_000 }], { id }));
    expect(await state(id)).toMatchObject({ needs: true, by: null });
  });

  it("a rep (or a sales lead, or marketing) cannot approve", async () => {
    const rep = await createUser();
    const p = await createProduct({ listPrice: MSRP });
    await sql`UPDATE products SET max_discount_pct = 15 WHERE id = ${p.id}`;
    const id = await save({ id: rep.id, role: "sales_rep" }, input([{ productId: p.id, qty: 1, unitPrice: OVER }]));
    for (const role of ["sales_rep", "sales_lead", "marketing"] as const) {
      const u = await createUser({ role });
      await expect(approveDiscount({ id: u.id, role }, id)).rejects.toBeInstanceOf(ForbiddenError);
    }
    // the owner's own session cannot lift the role either
    await expect(approveDiscount({ id: rep.id, role: "sales_rep" }, id)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await state(id)).toMatchObject({ needs: true, by: null });
  });

  it("a session that claims to be CEO but is not in the database as one is refused", async () => {
    const rep = await createUser();
    const p = await createProduct({ listPrice: MSRP });
    await sql`UPDATE products SET max_discount_pct = 15 WHERE id = ${p.id}`;
    const id = await save({ id: rep.id, role: "sales_rep" }, input([{ productId: p.id, qty: 1, unitPrice: OVER }]));
    const gone = await createUser({ role: "ceo", isActive: false });
    await expect(approveDiscount({ id: gone.id, role: "ceo" }, id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(approveDiscount({ id: rep.id, role: "ceo" }, id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await state(id)).by).toBeNull();
  });

  it("the product's own limit overrides the global one, both ways", async () => {
    const rep = await createUser();
    const strict = await createProduct({ listPrice: MSRP });
    const loose = await createProduct({ listPrice: MSRP });
    await sql`UPDATE products SET max_discount_pct = 10 WHERE id = ${strict.id}`;
    await sql`UPDATE products SET max_discount_pct = 20 WHERE id = ${loose.id}`;
    const actor = { id: rep.id, role: "sales_rep" as const };
    const twelve = Math.round(MSRP * 0.88);
    const eighteen = Math.round(MSRP * 0.82);
    // 12% is over the strict 10% limit but under the global 15%
    expect((await state(await save(actor, input([{ productId: strict.id, qty: 1, unitPrice: twelve }])))).needs).toBe(true);
    // 18% is over the global 15% but under the loose 20%
    expect((await state(await save(actor, input([{ productId: loose.id, qty: 1, unitPrice: eighteen }])))).needs).toBe(false);
  });

  it("an unknown deal id is not an error, just nothing to approve", async () => {
    const ceo = await createUser({ role: "ceo" });
    expect(await approveDiscount({ id: ceo.id, role: "ceo" }, randomUUID())).toBe(false);
    await expect(approveDiscount({ id: ceo.id, role: "ceo" }, "not-an-id")).rejects.toBeInstanceOf(ForbiddenError);
  });
});
