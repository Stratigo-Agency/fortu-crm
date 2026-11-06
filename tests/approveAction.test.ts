import { describe, expect, it, vi } from "vitest";
import { t } from "@/lib/copy";
import { sql } from "@/lib/db";
import { createProduct, createUser, randomPhone } from "./fixtures";
import { saveDeal } from "@/lib/dealSave";

let current: { id: string; email: string; role: string; full_name: string };
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/authz", async (orig) => ({ ...(await orig<typeof import("@/lib/authz")>()), requireUser: async () => current }));

describe("approveDiscountAction", () => {
  it("tells a rep that only Pak Jovian can approve, not the generic edit message", async () => {
    const { approveDiscountAction } = await import("@/app/(app)/deal/actions");
    const rep = await createUser();
    const p = await createProduct({ listPrice: 30_000_000 });
    await sql`UPDATE products SET max_discount_pct = 15 WHERE id = ${p.id}`;
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(Date.now() + 5 * 86_400_000));
    const r = await saveDeal({ id: rep.id, role: "sales_rep" }, {
      id: null, name: "Deal uji approve", kind: "new", parentDealId: null, stageKey: "quotation", ownerId: "", companyName: "",
      contactName: "Kontak", phone: randomPhone(), expectedCloseDate: day, nextStep: "Telepon", nextStepDate: day, demoDate: "",
      paidDate: "", lostReason: "", competitor: "", lostNote: "", estAmount: 0, note: "", fromLeadId: null,
      lines: [{ productId: p.id, qty: 1, unitPrice: 24_000_000 }],
    });
    if (!r.ok) throw new Error("save failed");

    current = { id: rep.id, email: rep.email ?? "x@x", role: "sales_rep", full_name: "Rep" };
    const res = await approveDiscountAction(r.id, "anything");
    expect(res).toEqual({ ok: false, message: t("deal.approveForbidden") });
    expect(t("deal.approveForbidden")).toBe("Hanya Pak Jovian yang bisa menyetujui diskon.");
  });
});
