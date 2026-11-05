import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/authz";
import { sql } from "@/lib/db";
import { contactsCsv, csvField, dealsCsv, toCsv } from "@/lib/exportCsv";
import {
  addMember, getRules, getStages, getTargets, getTeam, percentNumber, saveCatalog, saveDefinitions, saveProbabilities,
  saveRules, saveTargets, saveTeam, SettingsError, wholeNumber,
} from "@/lib/settings";
import { createDeal, createProduct, createUser } from "./fixtures";

const form = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};
const fails = async (p: Promise<unknown>, key: string) => {
  const err = await p.then(() => null, (e) => e);
  expect(err).toBeInstanceOf(SettingsError);
  expect(err.key).toBe(key);
};

// Settings are global, and other test files read them: put back what a test changed.
let saved: { rules: Awaited<ReturnType<typeof getRules>>; stages: Awaited<ReturnType<typeof getStages>> };
beforeEach(async () => {
  saved = { rules: await getRules(), stages: await getStages() };
});
afterEach(async () => {
  const r = saved.rules;
  for (const [k, v] of Object.entries({ max_discount_pct: r.maxDiscountPct, followup_days: r.followupDays, project_min_units: r.projectMinUnits, project_min_amount: r.projectMinAmount, high_value_amount: r.highValueAmount })) {
    await sql`UPDATE app_settings SET value = ${String(v)}::jsonb WHERE key = ${k}`;
  }
  for (const s of saved.stages) {
    await sql`UPDATE pipeline_stages SET probability = ${s.probabilityPct / 100}, stale_after_days = ${s.staleDays}, definition = ${s.definition || null} WHERE id = ${s.id}`;
  }
});

describe("reading numbers", () => {
  it("whole numbers ignore dots and Rp, blank is null, junk and out of range are refused", () => {
    expect(wholeNumber("1.500.000.000")).toBe(1_500_000_000);
    expect(wholeNumber("Rp 40")).toBe(40);
    expect(wholeNumber("  ")).toBeNull();
    expect(() => wholeNumber("101", { max: 100 })).toThrow(SettingsError);
    expect(() => wholeNumber("0", { min: 1 })).toThrow(SettingsError);
    expect(() => wholeNumber("9".repeat(20))).toThrow(SettingsError);
  });
  it("percentages take a comma, stay within 0–100", () => {
    expect(percentNumber("12,5")).toBe(12.5);
    expect(percentNumber("")).toBeNull();
    for (const bad of ["-1", "100,1", "abc"]) expect(() => percentNumber(bad)).toThrow(SettingsError);
  });
});

describe("Target", () => {
  it("saves company and per-sales targets for a month, blank removes, and a sales lead may do it", async () => {
    const rep = await createUser({ fullName: "Target Rep" });
    const lead = await createUser({ role: "sales_lead" });
    const month = "2031-03";
    await saveTargets(lead, month, form({ "amount:company": "1.500.000.000", "units:company": "167", [`amount:${rep.id}`]: "400.000.000", [`units:${rep.id}`]: "40" }));
    const rows = await getTargets(`${month}-01`);
    expect(rows.find((r) => r.userId === null)).toMatchObject({ amount: "1500000000", units: 167 });
    expect(rows.find((r) => r.userId === rep.id)).toMatchObject({ name: "Target Rep", amount: "400000000", units: 40 });

    await saveTargets(lead, month, form({ "amount:company": "1.600.000.000", [`amount:${rep.id}`]: "", [`units:${rep.id}`]: "" }));
    const after = await getTargets(`${month}-01`);
    expect(after.find((r) => r.userId === null)).toMatchObject({ amount: "1600000000", units: null });
    expect(after.find((r) => r.userId === rep.id)).toMatchObject({ amount: null, units: null });
    expect((await sql`SELECT 1 FROM sales_targets WHERE user_id = ${rep.id} AND period_month = ${month + "-01"}`).length).toBe(0);
    await sql`DELETE FROM sales_targets WHERE period_month = ${month + "-01"}`;
  });

  it("a sales rep or marketing can't, a bad month or number is refused and nothing is written", async () => {
    const rep = await createUser();
    await expect(saveTargets(rep, "2031-04", form({ "amount:company": "1" }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveTargets(await createUser({ role: "marketing" }), "2031-04", form({}))).rejects.toBeInstanceOf(ForbiddenError);
    const lead = await createUser({ role: "sales_lead" });
    await fails(saveTargets(lead, "bulan-ini", form({})), "month");
    await fails(saveTargets(lead, "2031-04", form({ "amount:company": "100", [`units:${lead.id}`]: "0" })), "number");
    expect((await sql`SELECT 1 FROM sales_targets WHERE period_month = '2031-04-01'`).length).toBe(0);
  });
});

describe("Aturan, Peluang, Definisi", () => {
  it("rules and stale days are saved, and the views follow", async () => {
    const owner = await createUser({ role: "ceo" });
    const stages = await getStages();
    const open = stages.filter((s) => !s.isWon && !s.isLost);
    await saveRules(owner, form({
      maxDiscountPct: "12,5", followupDays: "10", projectMinUnits: "8", projectMinAmount: "250.000.000", highValueAmount: "90.000.000",
      ...Object.fromEntries(open.map((s) => [`stale:${s.id}`, "9"])),
    }));
    expect(await getRules()).toEqual({ maxDiscountPct: 12.5, followupDays: 10, projectMinUnits: 8, projectMinAmount: 250_000_000, highValueAmount: 90_000_000 });
    expect((await getStages()).filter((s) => !s.isWon && !s.isLost).every((s) => s.staleDays === 9)).toBe(true);
    expect((await sql`SELECT setting_num('followup_days')::int AS n`)[0].n).toBe(10);
  });

  it("a bad value refuses the whole save", async () => {
    const owner = await createUser({ role: "admin" });
    const before = await getRules();
    await fails(saveRules(owner, form({ maxDiscountPct: "150", followupDays: "10", projectMinUnits: "8", projectMinAmount: "1", highValueAmount: "1" })), "percent");
    await fails(saveRules(owner, form({ maxDiscountPct: "10", followupDays: "0", projectMinUnits: "8", projectMinAmount: "1", highValueAmount: "1" })), "number");
    expect(await getRules()).toEqual(before);
    await expect(saveRules(await createUser({ role: "sales_lead" }), form({}))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("probabilities are 0–100 for open stages; Done deal and Lost stay 100 and 0; weighted values follow", async () => {
    const owner = await createUser({ role: "ceo" });
    const stages = await getStages();
    const open = stages.filter((s) => !s.isWon && !s.isLost);
    const fields = Object.fromEntries(open.map((s, i) => [`prob:${s.id}`, String(5 + i * 10)]));
    await saveProbabilities(owner, form(fields));
    const now = await getStages();
    expect(now.filter((s) => !s.isWon && !s.isLost).map((s) => s.probabilityPct)).toEqual(open.map((_, i) => 5 + i * 10));
    expect(now.find((s) => s.isWon)?.probabilityPct).toBe(100);
    expect(now.find((s) => s.isLost)?.probabilityPct).toBe(0);

    const deal = await createDeal(owner.id);
    await sql`UPDATE deals SET est_amount = 100000000 WHERE id = ${deal.id}`;
    const [row] = await sql`SELECT weighted_amount::int AS w FROM v_deals_enriched WHERE id = ${deal.id}`;
    expect(row.w).toBe(Math.round(100_000_000 * (5 / 100)));

    await fails(saveProbabilities(owner, form({ ...fields, [`prob:${open[0].id}`]: "101" })), "percent");
    await fails(saveProbabilities(owner, form({ ...fields, [`prob:${open[0].id}`]: "" })), "percent");
    expect((await getStages())[0].probabilityPct).toBe(5);
  });

  it("definitions are saved and a blank one clears it", async () => {
    const owner = await createUser({ role: "ceo" });
    const [first, second] = await getStages();
    await saveDefinitions(owner, form({ [`def:${first.id}`]: "  Chat pertama dari calon pelanggan  ", [`def:${second.id}`]: "" }));
    const now = await getStages();
    expect(now[0].definition).toBe("Chat pertama dari calon pelanggan");
    expect(now[1].definition).toBe("");
    const [col] = await sql`SELECT definition FROM pipeline_stages WHERE id = ${first.id}`;
    expect(col.definition).toBe("Chat pertama dari calon pelanggan");
  });
});

describe("Tim sales", () => {
  it("adds a person by email, once, and only the owner roles may", async () => {
    const admin = await createUser({ role: "admin" });
    const email = `baru-${randomUUID().slice(0, 6)}@fortu.co.id`;
    const id = await addMember(admin, form({ name: "Orang Baru", email: email.toUpperCase(), role: "sales_rep" }));
    expect((await sql`SELECT email, role, is_active FROM users WHERE id = ${id}`)[0]).toEqual({ email, role: "sales_rep", is_active: true });
    await fails(addMember(admin, form({ name: "Dobel", email, role: "sales_rep" })), "emailTaken");
    await fails(addMember(admin, form({ name: "X", email: "bukan-email", role: "sales_rep" })), "email");
    await fails(addMember(admin, form({ name: "", email: "a@b.co", role: "sales_rep" })), "name");
    await expect(addMember(admin, form({ name: "X", email: "x@y.co", role: "superuser" }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(addMember(await createUser({ role: "sales_lead" }), form({ name: "X", email: "x@y.co", role: "sales_rep" }))).rejects.toBeInstanceOf(ForbiddenError);
  });

  async function allFields(extra: Record<string, string | string[]> = {}) {
    const people = await getTeam();
    return form({
      ...Object.fromEntries(people.flatMap((p) => [
        [`role:${p.id}`, p.role], ...(p.isActive ? [[`active:${p.id}`, "on"]] : []), ...(p.acceptingLeads ? [[`accepting:${p.id}`, "on"]] : []),
        [`lines:${p.id}`, p.productLines], [`wa:${p.id}`, p.waPhone], [`walabel:${p.id}`, p.waLabel],
      ])),
      ...extra,
    });
  }

  it("changes role, active, accepting leads, product lines and the WhatsApp line", async () => {
    const admin = await createUser({ role: "admin" });
    const rep = await createUser({ fullName: "Rep Tim" });
    const f = await allFields({
      [`role:${rep.id}`]: "sales_lead", [`lines:${rep.id}`]: ["IFP", "LED"], [`wa:${rep.id}`]: "0812 5555 0101", [`walabel:${rep.id}`]: "No_RepTim",
    });
    f.delete(`accepting:${rep.id}`);
    await saveTeam(admin, f);
    const m = (await getTeam()).find((p) => p.id === rep.id)!;
    expect(m).toMatchObject({ role: "sales_lead", isActive: true, acceptingLeads: false, waPhone: "+6281255550101", waLabel: "No_RepTim" });
    expect([...m.productLines].sort()).toEqual(["IFP", "LED"]);

    // deactivate; the WhatsApp number is updated, not duplicated
    const g = await allFields({ [`wa:${rep.id}`]: "0812 5555 0202" });
    g.delete(`active:${rep.id}`);
    await saveTeam(admin, g);
    expect((await getTeam()).find((p) => p.id === rep.id)).toMatchObject({ isActive: false, waPhone: "+6281255550202" });
    expect((await sql`SELECT 1 FROM wa_lines WHERE user_id = ${rep.id}`).length).toBe(1);
  });

  it("nobody can change their own role or switch themselves off, and a number used by another line is refused", async () => {
    const admin = await createUser({ role: "admin" });
    const a = await allFields({ [`role:${admin.id}`]: "sales_rep" });
    await fails(saveTeam(admin, a), "self");
    const b = await allFields();
    b.delete(`active:${admin.id}`);
    await fails(saveTeam(admin, b), "self");

    const other = await createUser();
    await saveTeam(admin, await allFields({ [`wa:${other.id}`]: "0813 7777 0001" }));
    const third = await createUser();
    await fails(saveTeam(admin, await allFields({ [`wa:${third.id}`]: "0813 7777 0001" })), "phoneTaken");
    await fails(saveTeam(admin, await allFields({ [`wa:${third.id}`]: "123" })), "phone");
    await expect(saveTeam(await createUser({ role: "sales_lead" }), await allFields())).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("Katalog produk", () => {
  it("saves MSRP and the discount limit; blank limit means the company limit; the discount check follows", async () => {
    const owner = await createUser({ role: "ceo" });
    const p = await createProduct({ listPrice: 30_000_000 });
    const all = await sql<{ id: string; list_price: string | null; max_discount_pct: string | null }[]>`SELECT id, list_price, max_discount_pct FROM products WHERE is_active`;
    const keep = Object.fromEntries(all.flatMap((r) => [[`price:${r.id}`, r.list_price ?? ""], [`disc:${r.id}`, r.max_discount_pct ?? ""]]));
    await saveCatalog(owner, form({ ...keep, [`price:${p.id}`]: "42.000.000", [`disc:${p.id}`]: "7,5" }));
    expect((await sql`SELECT list_price::int AS price, max_discount_pct::float AS disc FROM products WHERE id = ${p.id}`)[0]).toEqual({ price: 42_000_000, disc: 7.5 });
    await saveCatalog(owner, form({ ...keep, [`price:${p.id}`]: "42.000.000", [`disc:${p.id}`]: "" }));
    expect((await sql`SELECT max_discount_pct FROM products WHERE id = ${p.id}`)[0].max_discount_pct).toBeNull();
    await fails(saveCatalog(owner, form({ ...keep, [`disc:${p.id}`]: "120" })), "percent");
    await expect(saveCatalog(await createUser({ role: "sales_rep" }), form(keep))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("CSV export", () => {
  it("fields are quoted when needed and a formula can't run in Excel", () => {
    expect(csvField("a;b")).toBe('"a;b"');
    expect(csvField('dia "bilang" ok')).toBe('"dia ""bilang"" ok"');
    expect(csvField("baris\nbaru")).toBe('"baris\nbaru"');
    expect(csvField("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvField("+62812")).toBe("'+62812");
    expect(csvField("-5")).toBe("-5");
    expect(csvField(540000000)).toBe("540000000");
    expect(csvField(null)).toBe("");
  });

  it("starts with a BOM, uses ; and CRLF", () => {
    const out = toCsv(["a", "b"], [[1, "x"]]);
    expect(out.startsWith("﻿")).toBe(true);
    expect(out).toBe("﻿a;b\r\n1;x\r\n");
  });

  it("deals and contacts: Rupiah is a plain integer, dates are YYYY-MM-DD, every deal has a row", async () => {
    const rep = await createUser({ fullName: "Rep CSV" });
    const deal = await createDeal(rep.id);
    await sql`UPDATE deals SET est_amount = 540000000, name = ${"Deal; \"khusus\" =1+1"} WHERE id = ${deal.id}`;
    const csv = await dealsCsv();
    const [header, ...lines] = csv.replace("﻿", "").trim().split("\r\n");
    expect(header.split(";")).toContain("nilai_rp");
    const line = lines.find((l) => l.startsWith(deal.id))!;
    expect(line).toContain(";540000000;");
    expect(line).toContain('"\'Deal; ""khusus"" =1+1"'.replace("'Deal", "Deal")); // quoted, not a formula (starts with D)
    expect(line).not.toMatch(/Rp|\d\.\d{3}\.\d{3}/);
    expect(line).toMatch(/;\d{4}-\d{2}-\d{2}(;|$)/);
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM deals`;
    expect(lines).toHaveLength(n);

    const contacts = await contactsCsv();
    expect(contacts.startsWith("﻿")).toBe(true);
    const [{ c }] = await sql<{ c: number }[]>`SELECT count(*)::int AS c FROM v_contacts_enriched`;
    expect(contacts.replace("﻿", "").trim().split("\r\n")).toHaveLength(c + 1);
  });
});
