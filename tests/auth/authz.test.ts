import { describe, expect, it } from "vitest";
import {
  assertCanEditDeal,
  assertCanEditLead,
  assertRole,
  canEditDealSql,
  canEditLeadSql,
  ForbiddenError,
} from "@/lib/authz";
import { sql } from "@/lib/db";
import { createDeal, createLead, createUser } from "../fixtures";

const forbidden = { name: "ForbiddenError", code: "forbidden", message: "Kamu hanya bisa mengubah data milikmu sendiri." };

describe("assertCanEditDeal", async () => {
  const owner = await createUser({ role: "sales_rep" });
  const deal = await createDeal(owner.id);

  it("lets the owner edit", async () => {
    await expect(assertCanEditDeal(owner, deal.id)).resolves.toBeUndefined();
  });

  it("refuses another sales_rep", async () => {
    const other = await createUser({ role: "sales_rep" });
    await expect(assertCanEditDeal(other, deal.id)).rejects.toThrow(ForbiddenError);
    await expect(assertCanEditDeal(other, deal.id)).rejects.toMatchObject(forbidden);
  });

  it.each(["sales_lead", "ceo", "admin"] as const)("lets %s edit someone else's deal", async (role) => {
    const user = await createUser({ role });
    await expect(assertCanEditDeal(user, deal.id)).resolves.toBeUndefined();
  });

  it("refuses marketing", async () => {
    const user = await createUser({ role: "marketing" });
    await expect(assertCanEditDeal(user, deal.id)).rejects.toThrow(ForbiddenError);
  });

  it("refuses an inactive user, even the owner or a ceo", async () => {
    const inactiveOwner = await createUser({ isActive: false });
    const ownDeal = await createDeal(inactiveOwner.id);
    await expect(assertCanEditDeal(inactiveOwner, ownDeal.id)).rejects.toThrow(ForbiddenError);
    const inactiveCeo = await createUser({ role: "ceo", isActive: false });
    await expect(assertCanEditDeal(inactiveCeo, deal.id)).rejects.toThrow(ForbiddenError);
  });

  it("refuses a deal that doesn't exist or a malformed id", async () => {
    await expect(assertCanEditDeal(owner, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(ForbiddenError);
    await expect(assertCanEditDeal(owner, "not-a-uuid")).rejects.toThrow(ForbiddenError);
  });
});

describe("assertCanEditLead", async () => {
  const owner = await createUser({ role: "sales_rep" });
  const lead = await createLead(owner.id);

  it("lets the owner edit", async () => {
    await expect(assertCanEditLead(owner, lead.id)).resolves.toBeUndefined();
  });

  it("refuses another sales_rep", async () => {
    const other = await createUser({ role: "sales_rep" });
    await expect(assertCanEditLead(other, lead.id)).rejects.toMatchObject(forbidden);
  });

  it.each(["sales_lead", "ceo", "admin"] as const)("lets %s edit someone else's lead", async (role) => {
    const user = await createUser({ role });
    await expect(assertCanEditLead(user, lead.id)).resolves.toBeUndefined();
  });

  it("lets any active user pick up an unowned lead", async () => {
    const unowned = await createLead(null);
    const rep = await createUser({ role: "sales_rep" });
    await expect(assertCanEditLead(rep, unowned.id)).resolves.toBeUndefined();
  });

  it("refuses marketing on an unowned lead (view only)", async () => {
    const unowned = await createLead(null);
    const marketing = await createUser({ role: "marketing" });
    await expect(assertCanEditLead(marketing, unowned.id)).rejects.toThrow(ForbiddenError);
  });

  it("refuses an inactive user, even on an unowned lead", async () => {
    const unowned = await createLead(null);
    const inactive = await createUser({ isActive: false });
    await expect(assertCanEditLead(inactive, unowned.id)).rejects.toThrow(ForbiddenError);
    await expect(assertCanEditLead(inactive, lead.id)).rejects.toThrow(ForbiddenError);
  });

  it("refuses a malformed id", async () => {
    await expect(assertCanEditLead(owner, "not-a-uuid")).rejects.toThrow(ForbiddenError);
  });
});

describe("canEdit*Sql in an UPDATE", () => {
  it("updates only rows the user may edit", async () => {
    const owner = await createUser();
    const other = await createUser();
    const deal = await createDeal(owner.id);
    const lead = await createLead(owner.id);

    const byOther = await sql`
      UPDATE deals SET next_step = 'Kirim penawaran'
       WHERE id = ${deal.id} AND ${canEditDealSql(other.id)}`;
    expect(byOther.count).toBe(0);
    const byOwner = await sql`
      UPDATE deals SET next_step = 'Kirim penawaran'
       WHERE id = ${deal.id} AND ${canEditDealSql(owner.id)}`;
    expect(byOwner.count).toBe(1);

    const leadByOther = await sql`
      UPDATE leads SET status = 'contacted' WHERE id = ${lead.id} AND ${canEditLeadSql(other.id)}`;
    expect(leadByOther.count).toBe(0);
    const leadByOwner = await sql`
      UPDATE leads SET status = 'contacted' WHERE id = ${lead.id} AND ${canEditLeadSql(owner.id)}`;
    expect(leadByOwner.count).toBe(1);
  });
});

describe("assertRole", () => {
  it("passes a listed role and refuses others", () => {
    expect(() => assertRole({ role: "ceo" }, "ceo", "admin")).not.toThrow();
    expect(() => assertRole({ role: "sales_lead" }, "ceo", "admin")).toThrow(ForbiddenError);
  });
});
