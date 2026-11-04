import { describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/authz";
import { sql } from "@/lib/db";
import { InvalidInputError, LeadClosedError, markContacted, markNotFit, reassignLead } from "@/lib/leads";
import { createLead, createUser } from "./fixtures";

const lead = async (id: string) => {
  const [row] = await sql`SELECT status, owner_user_id, disqualify_reason, first_response_at FROM leads WHERE id = ${id}`;
  return row;
};
const owners = async (leadId: string) =>
  sql`SELECT from_user_id, to_user_id, reason, changed_by FROM ownership_changes WHERE lead_id = ${leadId} ORDER BY id`;

describe("a rep acting on another rep's lead (forged request)", () => {
  it("can't mark it contacted, mark it not a fit, or reassign it: ForbiddenError and nothing changes", async () => {
    const owner = await createUser();
    const intruder = await createUser({ role: "sales_rep" });
    const target = await createUser();
    const l = await createLead(owner.id);

    await expect(markContacted(intruder, l.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(markNotFit(intruder, l.id, "harga", "x")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(reassignLead(intruder, l.id, target.id)).rejects.toBeInstanceOf(ForbiddenError);

    expect(await lead(l.id)).toMatchObject({ status: "new", owner_user_id: owner.id, disqualify_reason: null });
    expect(await owners(l.id)).toHaveLength(0);
    const acts = await sql`SELECT 1 FROM activities WHERE lead_id = ${l.id}`;
    expect(acts).toHaveLength(0);
  });

  it("an owner can't reassign even their own lead (only sales_lead, ceo, admin)", async () => {
    const owner = await createUser();
    const target = await createUser();
    const l = await createLead(owner.id);
    await expect(reassignLead(owner, l.id, target.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await lead(l.id)).owner_user_id).toBe(owner.id);
  });

  it("a role changed in the database is honoured even if the session still says sales_lead", async () => {
    const stale = await createUser({ role: "sales_rep" });
    const owner = await createUser();
    const target = await createUser();
    const l = await createLead(owner.id);
    // the session thinks this user is a sales_lead; the database says sales_rep
    await expect(reassignLead({ id: stale.id, role: "sales_lead" }, l.id, target.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await lead(l.id)).owner_user_id).toBe(owner.id);
  });

  it("marketing and inactive users can't act, even on an unowned lead", async () => {
    const marketing = await createUser({ role: "marketing" });
    const inactive = await createUser({ isActive: false });
    const l = await createLead(null);
    for (const who of [marketing, inactive]) {
      await expect(markContacted(who, l.id)).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect((await lead(l.id)).status).toBe("new");
  });
});

describe("markContacted", () => {
  it("moves a new lead to contacted and keeps the first response time", async () => {
    const owner = await createUser();
    const l = await createLead(owner.id);
    await markContacted(owner, l.id);
    const first = await lead(l.id);
    expect(first.status).toBe("contacted");
    expect(first.first_response_at).not.toBeNull();
    await markContacted(owner, l.id); // again: nothing breaks
    expect((await lead(l.id)).first_response_at).toEqual(first.first_response_at);
  });

  it("lets a sales rep pick up an unowned lead, and a sales lead act on anyone's", async () => {
    const rep = await createUser();
    const lead2 = await createUser({ role: "sales_lead" });
    const unowned = await createLead(null);
    await markContacted(rep, unowned.id);
    expect((await lead(unowned.id)).status).toBe("contacted");
    const someones = await createLead((await createUser()).id);
    await markContacted(lead2, someones.id);
    expect((await lead(someones.id)).status).toBe("contacted");
  });

  it("says a qualified lead is closed for this action, not that it is forbidden", async () => {
    const owner = await createUser();
    const l = await createLead(owner.id, { status: "qualified" });
    await expect(markContacted(owner, l.id)).rejects.toBeInstanceOf(LeadClosedError);
    const other = await createUser();
    await expect(markContacted(other, l.id)).rejects.toBeInstanceOf(ForbiddenError); // still not theirs
  });

  it("says the lead is closed once it is not a fit", async () => {
    const owner = await createUser();
    const l = await createLead(owner.id, { status: "disqualified" });
    await expect(markContacted(owner, l.id)).rejects.toBeInstanceOf(LeadClosedError);
  });
});

describe("markNotFit", () => {
  it("disqualifies with the reason and writes the note to the activity", async () => {
    const owner = await createUser();
    const l = await createLead(owner.id);
    await markNotFit(owner, l.id, "budget", "  Tidak ada anggaran tahun ini ");
    expect(await lead(l.id)).toMatchObject({ status: "disqualified", disqualify_reason: "budget" });
    const [a] = await sql`SELECT type, body, user_id, metadata FROM activities WHERE lead_id = ${l.id}`;
    expect(a).toEqual({
      type: "note",
      body: "Tidak ada anggaran tahun ini",
      user_id: owner.id,
      metadata: { action: "disqualified", reason: "budget" },
    });
  });

  it("writes no activity without a note, and refuses an unknown reason", async () => {
    const owner = await createUser();
    const l = await createLead(owner.id);
    await expect(markNotFit(owner, l.id, "bogus")).rejects.toBeInstanceOf(InvalidInputError);
    expect((await lead(l.id)).status).toBe("new");
    await markNotFit(owner, l.id, "harga");
    expect(await sql`SELECT 1 FROM activities WHERE lead_id = ${l.id}`).toHaveLength(0);
  });

  it("doesn't touch a lead that already became a deal", async () => {
    const owner = await createUser();
    const l = await createLead(owner.id, { status: "converted" });
    await expect(markNotFit(owner, l.id, "harga")).rejects.toBeInstanceOf(LeadClosedError);
    expect((await lead(l.id)).status).toBe("converted");
  });
});

describe("reassignLead", () => {
  it("moves the lead and records who moved it, from whom, and why", async () => {
    const lead1 = await createUser({ role: "sales_lead" });
    const from = await createUser();
    const to = await createUser();
    const l = await createLead(from.id);
    await reassignLead(lead1, l.id, to.id);
    expect((await lead(l.id)).owner_user_id).toBe(to.id);
    expect(await owners(l.id)).toEqual([
      { from_user_id: from.id, to_user_id: to.id, reason: "manual_reassign", changed_by: lead1.id },
    ]);
  });

  it("works for ceo and admin, and for an unowned lead (from is empty)", async () => {
    const to = await createUser();
    for (const role of ["ceo", "admin"] as const) {
      const boss = await createUser({ role });
      const l = await createLead(null);
      await reassignLead(boss, l.id, to.id);
      expect((await owners(l.id))[0]).toMatchObject({ from_user_id: null, to_user_id: to.id });
    }
  });

  it("does nothing when the new owner already has it", async () => {
    const boss = await createUser({ role: "admin" });
    const owner = await createUser();
    const l = await createLead(owner.id);
    await reassignLead(boss, l.id, owner.id);
    expect(await owners(l.id)).toHaveLength(0);
  });

  it("refuses a new owner who isn't an active sales rep or sales lead", async () => {
    const boss = await createUser({ role: "admin" });
    const l = await createLead(null);
    for (const bad of [
      await createUser({ role: "marketing" }),
      await createUser({ role: "ceo" }),
      await createUser({ isActive: false }),
    ]) {
      await expect(reassignLead(boss, l.id, bad.id)).rejects.toBeInstanceOf(InvalidInputError);
    }
    await expect(reassignLead(boss, l.id, "not-a-uuid")).rejects.toBeInstanceOf(InvalidInputError);
    expect((await lead(l.id)).owner_user_id).toBeNull();
  });
});
