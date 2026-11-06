import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getCompany, listCompanies } from "@/lib/companies";
import { INDUSTRIES } from "@/lib/contactTypes";
import { sql } from "@/lib/db";
import { industryFormValue, industryKey, industryLabel } from "@/lib/industry";
import { createUser } from "./fixtures";

describe("industry labels for free-text values", () => {
  it("every key the form offers has copy", () => {
    for (const k of INDUSTRIES) expect(industryLabel(k)).not.toMatch(/^industry\./);
  });

  it("maps the words 001 listed to today's keys", () => {
    expect(industryKey("retail")).toBe("retail_fnb");
    expect(industryKey("F&B")).toBe("retail_fnb");
    expect(industryKey("healthcare")).toBe("hospital");
    expect(industryKey("hospitality")).toBe("hotel");
    expect(industryLabel("retail")).toBe("Retail & F&B");
    expect(industryLabel(" Education ")).toBe("Pendidikan");
  });

  it("shows an unknown word as typed instead of throwing, and a dash when empty", () => {
    expect(() => industryLabel("pertambangan")).not.toThrow();
    expect(industryLabel("pertambangan")).toBe("Pertambangan");
    expect(industryLabel(null)).toBe("—");
    expect(industryLabel("")).toBe("—");
  });

  it("the form starts on a key it can show", () => {
    expect(industryFormValue("f&b")).toBe("retail_fnb");
    expect(industryFormValue("pertambangan")).toBe("other");
    expect(industryFormValue(null)).toBe("");
  });

  it("a legacy company opens and is found by the label people see", async () => {
    const rep = await createUser();
    const name = `PT Warung ${randomUUID().slice(0, 6)}`;
    const [c] = await sql<{ id: string }[]>`
      INSERT INTO companies (name, industry, owner_user_id) VALUES (${name}, 'f&b', ${rep.id}) RETURNING id`;
    expect((await getCompany(c.id, rep.id))?.industry).toBe("retail_fnb");
    const { rows } = await listCompanies({ ownerId: null, q: "retail", sort: "name", limit: 500 });
    expect(rows.map((r) => r.name)).toContain(name);
  });
});
