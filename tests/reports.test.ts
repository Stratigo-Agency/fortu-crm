import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { getReport } from "@/lib/reports";
import { addLineItem, createDeal, createUser } from "./fixtures";

// Each test makes its own sales rep, so every figure is checked for one person (and then for the total,
// as a sum of what is in the database).

type Mk = { stage: "chat" | "quotation" | "negotiation" | "po" | "done" | "lost"; qty?: number; unitPrice?: number; closeIn?: "month" | "later" | "past" };

async function mk(ownerId: string, o: Mk) {
  const deal = await createDeal(ownerId);
  const close = { month: "jakarta_today() + 3", later: "jakarta_today() + 40", past: "jakarta_today() - 10" }[o.closeIn ?? "month"];
  if (o.stage !== "chat" && o.stage !== "lost") await addLineItem(deal.id, { qty: o.qty ?? 2, unitPrice: o.unitPrice ?? 25_000_000 });
  if (o.stage === "lost") await addLineItem(deal.id, { qty: 1, unitPrice: 10_000_000 });
  await sql.unsafe(`
    UPDATE deals SET stage_id = (SELECT id FROM pipeline_stages WHERE key = '${o.stage}'),
           expected_close_date = ${close},
           lost_reason = ${o.stage === "lost" ? "'harga'" : "NULL"},
           next_step_date = jakarta_today() + 5
     WHERE id = '${deal.id}'`);
  return deal.id;
}

const num = (v: string | number | null | undefined) => Number(v ?? 0);

describe("Laporan numbers match the database", () => {
  it("KPIs for one sales equal a direct calculation on the deals", async () => {
    const rep = await createUser();
    await sql`INSERT INTO sales_targets (user_id, period_month, target_amount)
              VALUES (${rep.id}, date_trunc('month', jakarta_today()::timestamp)::date, 200000000)`;
    await mk(rep.id, { stage: "done", qty: 2, unitPrice: 30_000_000 }); // 60 jt, 2 units
    await mk(rep.id, { stage: "done", qty: 1, unitPrice: 20_000_000 }); // 20 jt, 1 unit
    await mk(rep.id, { stage: "quotation", qty: 2, unitPrice: 25_000_000, closeIn: "month" }); // 50 jt, closes this month
    await mk(rep.id, { stage: "negotiation", qty: 1, unitPrice: 40_000_000, closeIn: "later" }); // 40 jt, later
    await mk(rep.id, { stage: "chat" });
    await mk(rep.id, { stage: "lost" });

    const [probs] = await sql<{ quotation: string; negotiation: string }[]>`
      SELECT (SELECT probability FROM pipeline_stages WHERE key = 'quotation')::text AS quotation,
             (SELECT probability FROM pipeline_stages WHERE key = 'negotiation')::text AS negotiation`;
    const weightedQuotation = Math.round(50_000_000 * Number(probs.quotation));
    const weightedNegotiation = Math.round(40_000_000 * Number(probs.negotiation));

    const { kpis } = await getReport(rep.id);
    expect(num(kpis.wonInPeriod)).toBe(80_000_000);
    expect(kpis.unitsWon).toBe(3);
    expect(num(kpis.targetAmount)).toBe(200_000_000);
    expect(kpis.attainmentPct).toBe(40);
    expect(kpis.openDeals).toBe(3); // chat + quotation + negotiation
    expect(num(kpis.openAmount)).toBe(50_000_000 + 40_000_000 + 0);
    expect(num(kpis.weightedOpen)).toBe(weightedQuotation + weightedNegotiation);
    expect(num(kpis.forecastEndOfPeriod)).toBe(80_000_000 + weightedQuotation); // the later deal is not this month's
    expect(kpis.won90).toBe(2);
    expect(kpis.lost90).toBe(1);
    expect(kpis.winRatePct).toBe(67);
  });

  it("the six months end with this month, and the stage bars list every open stage", async () => {
    const rep = await createUser();
    await mk(rep.id, { stage: "done", qty: 1, unitPrice: 15_000_000 });
    await mk(rep.id, { stage: "po", qty: 1, unitPrice: 12_000_000 });
    const r = await getReport(rep.id);
    expect(r.months).toHaveLength(6);
    expect(num(r.months[5].amount)).toBe(15_000_000);
    expect(r.months.slice(0, 5).every((m) => num(m.amount) === 0)).toBe(true);
    const [thisMonth] = await sql<{ m: string }[]>`SELECT date_trunc('month', jakarta_today()::timestamp)::date::text AS m`;
    expect(r.months[5].month).toBe(thisMonth.m);
    const openStages = await sql<{ key: string }[]>`SELECT key FROM pipeline_stages WHERE NOT is_won AND NOT is_lost ORDER BY position`;
    expect(r.stages.map((s) => s.key)).toEqual(openStages.map((s) => s.key));
    expect(r.stages.find((s) => s.key === "po")).toMatchObject({ deals: 1, amount: "12000000" });
    expect(r.stages.find((s) => s.key === "chat")).toMatchObject({ deals: 0, amount: "0" });
  });

  it("Perlu perhatian lists only this sales' deals, most urgent first, at most 10", async () => {
    const rep = await createUser();
    const other = await createUser();
    const late = await mk(rep.id, { stage: "quotation" });
    await sql`UPDATE deals SET next_step_date = jakarta_today() - 3 WHERE id = ${late}`;
    const pastClose = await mk(rep.id, { stage: "negotiation", closeIn: "past" });
    const theirs = await mk(other.id, { stage: "quotation" });
    await sql`UPDATE deals SET next_step_date = jakarta_today() - 9 WHERE id = ${theirs}`;

    const mine = (await getReport(rep.id)).attention;
    expect(mine.rows.map((a) => a.dealId)).toEqual([late, pastClose]);
    expect(mine.rows[0]).toMatchObject({ reason: "next_step_overdue", daysOverdue: 3, severity: 0 });
    expect(mine.rows[1].reason).toBe("close_date_passed");
    expect(mine.total).toBe(2);

    for (let i = 0; i < 11; i++) {
      const id = await mk(rep.id, { stage: "quotation" });
      await sql`UPDATE deals SET next_step_date = jakarta_today() - 1 WHERE id = ${id}`;
    }
    const many = (await getReport(rep.id)).attention;
    expect(many.rows).toHaveLength(10);
    expect(many.total).toBe(13);
  });

  it("Kinerja sales: one row for one sales, with the numbers from the scorecard", async () => {
    const rep = await createUser({ fullName: "Rep Satu" });
    await createUser({ fullName: "Rep Dua" });
    await sql`INSERT INTO sales_targets (user_id, period_month, target_amount)
              VALUES (${rep.id}, date_trunc('month', jakarta_today()::timestamp)::date, 100000000)`;
    await mk(rep.id, { stage: "done", qty: 1, unitPrice: 25_000_000 });
    await mk(rep.id, { stage: "quotation" });

    const mine = (await getReport(rep.id)).reps;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ userId: rep.id, name: "Rep Satu", openDeals: 1, won: "25000000", target: "100000000", attainmentPct: 25, units: 1 });

    const all = (await getReport(null)).reps;
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(all.some((r) => r.userId === rep.id)).toBe(true);
  });

  it("Kinerja sales follows the period: Done and target over the quarter and the year", async () => {
    const rep = await createUser();
    // this month and two months ago (same year; same quarter only when this month is the quarter's last)
    await sql`INSERT INTO sales_targets (user_id, period_month, target_amount) VALUES
              (${rep.id}, date_trunc('month', jakarta_today()::timestamp)::date, 100000000),
              (${rep.id}, (date_trunc('month', jakarta_today()::timestamp) - interval '2 months')::date, 50000000)`;
    await mk(rep.id, { stage: "done", qty: 1, unitPrice: 25_000_000 });
    const earlier = await mk(rep.id, { stage: "done", qty: 2, unitPrice: 10_000_000 });
    await sql`UPDATE deals SET closed_on = (date_trunc('month', jakarta_today()::timestamp) - interval '2 months')::date + 3 WHERE id = ${earlier}`;

    const [{ same_q, same_y }] = await sql<{ same_q: boolean; same_y: boolean }[]>`
      SELECT date_trunc('quarter', jakarta_today()::timestamp) = date_trunc('quarter', jakarta_today()::timestamp - interval '2 months') AS same_q,
             date_trunc('year', jakarta_today()::timestamp) = date_trunc('year', jakarta_today()::timestamp - interval '2 months') AS same_y`;
    const row = async (p: "month" | "quarter" | "year") => (await getReport(rep.id, p)).reps[0];

    expect(await row("month")).toMatchObject({ won: "25000000", target: "100000000", attainmentPct: 25, units: 1 });
    expect(await row("quarter")).toMatchObject(
      same_q ? { won: "45000000", target: "150000000", attainmentPct: 30, units: 3 } : { won: "25000000", target: "100000000", units: 1 },
    );
    expect(await row("year")).toMatchObject(
      same_y ? { won: "45000000", target: "150000000", attainmentPct: 30, units: 3 } : { won: "25000000", target: "100000000", units: 1 },
    );
  });

  it("the total is the sum over everyone", async () => {
    const a = await createUser();
    const b = await createUser();
    await mk(a.id, { stage: "done", qty: 1, unitPrice: 11_000_000 });
    await mk(b.id, { stage: "done", qty: 1, unitPrice: 13_000_000 });
    const total = (await getReport(null)).kpis;
    const [{ s }] = await sql<{ s: string }[]>`
      SELECT COALESCE(sum(d.amount), 0)::text AS s FROM deals d JOIN pipeline_stages st ON st.id = d.stage_id
       WHERE st.is_won AND d.closed_on >= date_trunc('month', jakarta_today()::timestamp)::date`;
    expect(total.wonInPeriod).toBe(s);
  });

  it("with no deals everything is zero, nothing is invented", async () => {
    const rep = await createUser();
    const r = await getReport(rep.id);
    expect(r.kpis).toMatchObject({ wonInPeriod: "0", unitsWon: 0, openDeals: 0, winRatePct: null, attainmentPct: null, targetAmount: null });
    expect(r.attention).toEqual({ rows: [], total: 0 });
    expect(r.months.every((m) => num(m.amount) === 0)).toBe(true);
  });
});

describe("unowned leads and marketing", () => {
  it("marketing can't edit an unowned lead, a sales rep still can", async () => {
    const { createLead } = await import("./fixtures");
    const lead = await createLead(null);
    const marketing = await createUser({ role: "marketing" });
    const rep = await createUser();
    const ok = async (u: string) => (await sql`SELECT can_edit_lead(${u}, ${lead.id}) AS ok`)[0].ok;
    expect(await ok(marketing.id)).toBe(false);
    expect(await ok(rep.id)).toBe(true);
  });
});
