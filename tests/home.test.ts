import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { searchAll } from "@/lib/globalSearch";
import { getHome, greetingKey } from "@/lib/home";
import { getAttention } from "@/lib/reports";
import { addLineItem, createDeal, createUser } from "./fixtures";

describe("greetingKey", () => {
  it("follows the hour in Jakarta (UTC+7)", () => {
    expect(greetingKey(new Date("2026-11-05T01:00:00Z"))).toBe("morning"); // 08:00
    expect(greetingKey(new Date("2026-11-05T05:00:00Z"))).toBe("noon"); // 12:00
    expect(greetingKey(new Date("2026-11-05T09:30:00Z"))).toBe("afternoon"); // 16:30
    expect(greetingKey(new Date("2026-11-05T12:00:00Z"))).toBe("evening"); // 19:00
    expect(greetingKey(new Date("2026-11-04T22:00:00Z"))).toBe("morning"); // 05:00 next day
  });
});

describe("Beranda figures", () => {
  it("match the pipeline summary and Perlu perhatian of one sales", async () => {
    const rep = await createUser();
    await sql`INSERT INTO sales_targets (user_id, period_month, target_amount)
              VALUES (${rep.id}, date_trunc('month', jakarta_today()::timestamp)::date, 100000000)`;
    const done = await createDeal(rep.id);
    await addLineItem(done.id, { qty: 1, unitPrice: 25_000_000 });
    await sql`UPDATE deals SET stage_id = (SELECT id FROM pipeline_stages WHERE key = 'done'), expected_close_date = current_date,
                     closed_on = jakarta_today() WHERE id = ${done.id}`;
    const late = await createDeal(rep.id);
    await sql`UPDATE deals SET next_step_date = current_date - 2 WHERE id = ${late.id}`;

    const home = await getHome(rep.id);
    const [s] = await sql<{ won: string; weighted: string; open: number; overdue: number }[]>`
      SELECT won_this_month::text AS won, weighted_open_amount::text AS weighted, open_deals AS open, next_step_overdue AS overdue
        FROM v_pipeline_summary_by_owner WHERE owner_user_id = ${rep.id} AND NOT is_total`;
    expect(home).toMatchObject({ wonThisMonth: s.won, weightedOpen: s.weighted, openDeals: s.open, overdue: s.overdue });
    expect(home.wonThisMonth).toBe("25000000");
    expect(home.target).toBe("100000000");
    expect(home.attainmentPct).toBe(25);
    expect(home.overdue).toBe(1);
    expect(home.attention).toEqual(await getAttention(rep.id, 6));
    expect(home.attention.rows.map((r) => r.dealId)).toEqual([late.id]);
  });

  it("is all zero for a sales without deals", async () => {
    const rep = await createUser();
    expect(await getHome(rep.id)).toMatchObject({ wonThisMonth: "0", target: null, attainmentPct: null, weightedOpen: "0", openDeals: 0, overdue: 0, attention: { rows: [], total: 0 } });
  });
});

describe("one search for everything", () => {
  it("finds deals, contacts and companies by name, and contacts by a local phone number", async () => {
    const tag = `Zq${randomUUID().slice(0, 6)}`;
    const rep = await createUser();
    const [co] = await sql<{ id: string }[]>`INSERT INTO companies (name, city) VALUES (${`PT ${tag}`}, 'Bandung') RETURNING id`;
    const phone = `+62857${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
    const [ct] = await sql<{ id: string }[]>`
      INSERT INTO contacts (phone_e164, full_name, company_id) VALUES (${phone}, ${`Bu ${tag}`}, ${co.id}) RETURNING id`;
    const d = await createDeal(rep.id);
    await sql`UPDATE deals SET name = ${`Deal ${tag}`}, company_id = ${co.id} WHERE id = ${d.id}`;

    const r = await searchAll(tag.toLowerCase());
    expect(r.deals.map((x) => x.id)).toContain(d.id);
    expect(r.contacts.map((x) => x.id)).toContain(ct.id);
    expect(r.companies).toEqual([{ id: co.id, title: `PT ${tag}`, detail: "Bandung" }]);

    const byPhone = await searchAll(`0${phone.slice(3)}`);
    expect(byPhone.contacts.map((x) => x.id)).toContain(ct.id);
  });

  it("treats what was typed as plain text and needs at least 2 letters", async () => {
    expect(await searchAll("a")).toEqual({ deals: [], contacts: [], companies: [] });
    const r = await searchAll("%_%");
    expect(r.companies.every((c) => c.title.includes("%_%"))).toBe(true);
  });
});
