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
    ["sales_lead", false],
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
