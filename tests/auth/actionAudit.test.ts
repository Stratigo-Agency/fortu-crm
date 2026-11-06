import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { saveDeal } from "@/lib/dealSave";
import type { DealInput } from "@/lib/dealTypes";
import { createLead, createUser, randomPhone } from "../fixtures";

// Gaps found in the T22 permission audit (docs/permission-audit.md). Each test failed before its fix.

const inDays = (n: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(Date.now() + n * 86_400_000));

function input(o: Partial<DealInput> = {}): DealInput {
  return {
    id: null, name: `Deal audit ${randomUUID().slice(0, 6)}`, kind: "new", parentDealId: null, stageKey: "chat", ownerId: "",
    companyName: "", contactName: "Kontak Uji", phone: randomPhone(), expectedCloseDate: "", nextStep: "Follow up WA",
    nextStepDate: inDays(2), demoDate: "", paidDate: "", lostReason: "", competitor: "", lostNote: "", estAmount: 0,
    lines: [], note: "", fromLeadId: null, ...o,
  };
}

const row = async (id: string) => {
  const [d] = await sql<{ owner_user_id: string; contact_id: string }[]>`SELECT owner_user_id, contact_id FROM deals WHERE id = ${id}`;
  return d;
};

describe("saveDeal · the role comes from the database, not the sign-in cookie", () => {
  it("a person demoted to sales_rep can't hand a deal over while their cookie still says sales_lead", async () => {
    const demoted = await createUser({ role: "sales_rep" });
    const other = await createUser({ role: "sales_rep" });
    const created = await saveDeal(demoted, input());
    if (!created.ok) throw new Error("setup");
    const staleSession = { id: demoted.id, role: "sales_lead" as const }; // what the 5-minute-old cookie says
    await saveDeal(staleSession, input({ id: created.id, ownerId: other.id }));
    expect((await row(created.id)).owner_user_id).toBe(demoted.id);
  });

  it("a real sales lead still hands a deal over", async () => {
    const lead = await createUser({ role: "sales_lead" });
    const other = await createUser({ role: "sales_rep" });
    const created = await saveDeal(lead, input());
    if (!created.ok) throw new Error("setup");
    await saveDeal(lead, input({ id: created.id, ownerId: other.id }));
    expect((await row(created.id)).owner_user_id).toBe(other.id);
  });
});

describe("saveDeal · a prospect's contact is only taken when the deal is made from that prospect", () => {
  it("editing a deal ignores fromLeadId: the contact of someone else's prospect is not attached", async () => {
    const rep = await createUser({ role: "sales_rep" });
    const other = await createUser({ role: "sales_rep" });
    const theirLead = await createLead(other.id);
    const created = await saveDeal(rep, input());
    if (!created.ok) throw new Error("setup");
    const before = await row(created.id);
    await saveDeal(rep, input({ id: created.id, phone: randomPhone(), fromLeadId: theirLead.id }));
    const [lead] = await sql<{ contact_id: string; status: string }[]>`SELECT contact_id, status FROM leads WHERE id = ${theirLead.id}`;
    expect((await row(created.id)).contact_id).not.toBe(lead.contact_id);
    expect(before.contact_id).not.toBe(lead.contact_id);
    expect(lead.status).not.toBe("converted");
  });
});
