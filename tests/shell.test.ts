import { describe, expect, it } from "vitest";
import { canOpenSettings, initials, newLeadCount } from "@/lib/shell";
import { sql } from "@/lib/db";
import { createLead, createUser } from "./fixtures";

describe("initials", () => {
  it.each([
    ["Siska", "SI"],
    ["Rudi H", "RH"],
    ["Pak Jovian", "JO"],
    ["Bu Frisca Ayu", "FA"],
    ["adib wafi", "AW"],
    ["  ", ""],
  ])("%s → %s", (name, out) => expect(initials(name)).toBe(out));
});

describe("canOpenSettings", () => {
  it.each([
    ["admin", true],
    ["ceo", true],
    ["sales_lead", true],
    ["sales_rep", false],
    ["marketing", false],
  ] as const)("%s → %s", (role, out) => expect(canOpenSettings({ role })).toBe(out));
});

describe("newLeadCount", () => {
  it("counts a rep's own new leads, and all new leads for the others", async () => {
    const rep = await createUser({ role: "sales_rep" });
    const other = await createUser({ role: "sales_rep" });
    const lead = await createUser({ role: "sales_lead" });
    const allBefore = await newLeadCount(lead);

    await createLead(rep.id);
    await createLead(rep.id);
    await createLead(other.id);
    await createLead(null);
    const contacted = await createLead(rep.id);
    await sql`UPDATE leads SET status = 'contacted' WHERE id = ${contacted.id}`;

    expect(await newLeadCount(rep)).toBe(2);
    expect(await newLeadCount(other)).toBe(1);
    expect(await newLeadCount(lead)).toBe(allBefore + 4);
    expect(await newLeadCount({ id: rep.id, role: "ceo" })).toBe(allBefore + 4);
  });
});

describe("resolveSalesFilter", () => {
  it("keeps an active user's id and falls back to all sales otherwise", async () => {
    const { resolveSalesFilter } = await import("@/lib/salesFilter");
    const rep = await createUser();
    const gone = await createUser({ isActive: false });
    expect(await resolveSalesFilter(rep.id)).toBe(rep.id);
    expect(await resolveSalesFilter(gone.id)).toBeNull();
    const ceo = await createUser({ role: "ceo" });
    expect(await resolveSalesFilter(ceo.id)).toBeNull();
    const lead = await createUser({ role: "sales_lead" });
    expect(await resolveSalesFilter(lead.id)).toBe(lead.id);
    expect(await resolveSalesFilter("00000000-0000-0000-0000-000000000000")).toBeNull();
    expect(await resolveSalesFilter("all")).toBeNull();
    expect(await resolveSalesFilter("'; drop table users; --")).toBeNull();
    expect(await resolveSalesFilter(undefined)).toBeNull();
  });

  it("lists active reps and sales leads only", async () => {
    const { salesOptions } = await import("@/lib/salesFilter");
    const rep = await createUser({ role: "sales_rep" });
    const lead = await createUser({ role: "sales_lead" });
    const ceo = await createUser({ role: "ceo" });
    const gone = await createUser({ role: "sales_rep", isActive: false });
    const ids = (await salesOptions()).map((o) => o.id);
    expect(ids).toContain(rep.id);
    expect(ids).toContain(lead.id);
    expect(ids).not.toContain(ceo.id);
    expect(ids).not.toContain(gone.id);
  });
});
