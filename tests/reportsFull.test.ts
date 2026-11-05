import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { getReport } from "@/lib/reports";
import { parsePeriod, periodParam } from "@/lib/reportPeriod";
import { createAd, createDeal, createLead, createProduct, createUser } from "./fixtures";

// The panels added in T14. Each test makes its own sales rep, so every figure is checked for one person.

const num = (v: string | number | null | undefined) => Number(v ?? 0);

/** A deal at `stage` with one line of `qty` x `price` for `product` (a new product when omitted). */
async function deal(ownerId: string, stage: "chat" | "quotation" | "negotiation" | "po" | "done" | "lost", o: {
  qty?: number; price?: number; product?: string; closeSql?: string; closedOn?: string; demo?: boolean; leadId?: string; reason?: string;
} = {}) {
  const d = await createDeal(ownerId);
  const productId = o.product ?? (await createProduct()).id;
  if (stage !== "chat") await sql`INSERT INTO deal_line_items (deal_id, product_id, qty, unit_price) VALUES (${d.id}, ${productId}, ${o.qty ?? 1}, ${o.price ?? 10_000_000})`;
  await sql.unsafe(`
    UPDATE deals SET stage_id = (SELECT id FROM pipeline_stages WHERE key = '${stage}'),
           expected_close_date = ${o.closeSql ?? "jakarta_today() + 3"},
           lost_reason = ${stage === "lost" ? `'${o.reason ?? "harga"}'` : "NULL"},
           demo_date = ${o.demo ? "jakarta_today() - 2" : "NULL"},
           lead_id = ${o.leadId ? `'${o.leadId}'` : "NULL"},
           closed_on = ${stage === "done" || stage === "lost" ? (o.closedOn ?? "jakarta_today()") : "NULL"},
           next_step_date = jakarta_today() + 5
     WHERE id = '${d.id}'`);
  return d.id;
}

const prob = async (key: string) => Number((await sql<{ p: string }[]>`SELECT probability::text AS p FROM pipeline_stages WHERE key = ${key}`)[0].p);

describe("period parameter", () => {
  it("maps the Bahasa query values and falls back to this month", () => {
    expect(parsePeriod("kuartal")).toBe("quarter");
    expect(parsePeriod(["tahun", "bulan"])).toBe("year");
    expect(parsePeriod("bulan")).toBe("month");
    expect(parsePeriod("bogus")).toBe("month");
    expect(parsePeriod(undefined)).toBe("month");
    expect(periodParam("quarter")).toBe("kuartal");
  });
});

describe("Run rate", () => {
  it("is the month's pace from the view, and the yearly figure comes from the last three full months", async () => {
    const rep = await createUser();
    await deal(rep.id, "done", { qty: 1, price: 60_000_000 });
    const [d] = await sql<{ day: number; dim: number }[]>`
      SELECT EXTRACT(day FROM jakarta_today())::int AS day,
             EXTRACT(day FROM (date_trunc('month', jakarta_today()::timestamp) + interval '1 month - 1 day'))::int AS dim`;
    let r = (await getReport(rep.id)).kpis.runRate;
    expect(num(r.month)).toBe(Math.round((60_000_000 * d.dim) / d.day));
    expect(r.early).toBe(d.day < 7);
    expect(r.yearly).toBeNull(); // no full month of history yet

    // 30 jt closed on the last day of last month, 90 jt two months ago, nothing three months ago
    await deal(rep.id, "done", { qty: 1, price: 30_000_000, closedOn: "(date_trunc('month', jakarta_today()::timestamp) - interval '1 day')::date" });
    await deal(rep.id, "done", { qty: 1, price: 90_000_000, closedOn: "(date_trunc('month', jakarta_today()::timestamp) - interval '55 days')::date" });
    r = (await getReport(rep.id)).kpis.runRate;
    expect(num(r.yearly)).toBe(((30_000_000 + 90_000_000) / 3) * 12);
  });

  it("is zero when nothing is done yet", async () => {
    const rep = await createUser();
    const r = (await getReport(rep.id)).kpis.runRate;
    expect(num(r.month)).toBe(0);
    expect(r.yearly).toBeNull();
  });
});

describe("Period select", () => {
  it("done, units and forecast follow the period, equal to a direct calculation", async () => {
    const rep = await createUser();
    const p = await prob("quotation");
    await deal(rep.id, "done", { qty: 2, price: 10_000_000 }); // today
    await deal(rep.id, "done", { qty: 3, price: 20_000_000, closedOn: "(date_trunc('year', jakarta_today()::timestamp))::date" }); // 1 Jan
    await deal(rep.id, "quotation", { qty: 1, price: 40_000_000, closeSql: "(date_trunc('year', jakarta_today()::timestamp) + interval '11 months 15 days')::date" }); // mid December
    await sql`INSERT INTO sales_targets (user_id, period_month, target_amount, target_units)
              SELECT ${rep.id}, (date_trunc('year', jakarta_today()::timestamp) + make_interval(months => n))::date, 100000000, 10 FROM generate_series(0, 11) n`;

    for (const period of ["month", "quarter", "year"] as const) {
      const k = (await getReport(rep.id, period)).kpis;
      const [x] = await sql<{ done: string; units: number; forecast: string; target: string; units_target: number }[]>`
        SELECT COALESCE(sum(d.amount) FILTER (WHERE s.is_won AND date_trunc(${period}, d.closed_on::timestamp) = date_trunc(${period}, jakarta_today()::timestamp)), 0)::text AS done,
               COALESCE(sum(d.screen_units) FILTER (WHERE s.is_won AND date_trunc(${period}, d.closed_on::timestamp) = date_trunc(${period}, jakarta_today()::timestamp)), 0)::int AS units,
               COALESCE(sum(ROUND(d.amount * s.probability)) FILTER (WHERE NOT s.is_won AND NOT s.is_lost AND date_trunc(${period}, d.expected_close_date::timestamp) = date_trunc(${period}, jakarta_today()::timestamp)), 0)::text AS forecast,
               (SELECT sum(target_amount) FROM sales_targets WHERE user_id = ${rep.id} AND date_trunc(${period}, period_month::timestamp) = date_trunc(${period}, jakarta_today()::timestamp))::text AS target,
               (SELECT sum(target_units) FROM sales_targets WHERE user_id = ${rep.id} AND date_trunc(${period}, period_month::timestamp) = date_trunc(${period}, jakarta_today()::timestamp))::int AS units_target
          FROM v_deals_enriched d JOIN pipeline_stages s ON s.id = d.stage_id WHERE d.owner_user_id = ${rep.id}`;
      expect(k.period).toBe(period);
      expect(k.wonInPeriod).toBe(x.done);
      expect(k.unitsWon).toBe(x.units);
      expect(num(k.forecastEndOfPeriod)).toBe(num(x.done) + num(x.forecast));
      expect(k.targetAmount).toBe(x.target);
      expect(k.targetUnits).toBe(x.units_target);
    }
    // the year always holds both done deals and the December quotation; this month always holds the first one
    const year = (await getReport(rep.id, "year")).kpis;
    expect(num(year.wonInPeriod)).toBe(20_000_000 + 60_000_000);
    expect(year.unitsWon).toBe(5); // 2 + 3 units
    expect(num(year.forecastEndOfPeriod)).toBe(80_000_000 + Math.round(40_000_000 * p));
    expect(num(year.targetAmount)).toBe(1_200_000_000);
    expect(year.targetUnits).toBe(120);
  });
});

describe("Perkiraan per bulan close", () => {
  it("puts each open deal in its bucket, weighted, and lists the six buckets in order", async () => {
    const rep = await createUser();
    const q = await prob("quotation");
    const m = (n: number) => `(date_trunc('month', jakarta_today()::timestamp) + interval '${n} months')::date`;
    await deal(rep.id, "quotation", { price: 10_000_000, closeSql: "jakarta_today() - 10" });
    await deal(rep.id, "quotation", { price: 20_000_000, closeSql: `(${m(1)} - 1)` }); // last day of this month
    await deal(rep.id, "quotation", { price: 30_000_000, closeSql: `(${m(1)} + 4)` });
    await deal(rep.id, "quotation", { price: 40_000_000, closeSql: `(${m(2)} + 9)` });
    await deal(rep.id, "quotation", { price: 50_000_000, closeSql: `(${m(5)})` });
    await deal(rep.id, "chat", { closeSql: "NULL" });
    await deal(rep.id, "done", { price: 99_000_000 }); // not open: not counted

    const b = (await getReport(rep.id)).closeForecast;
    expect(b.map((x) => x.key)).toEqual(["past", "m0", "m1", "m2", "later", "none"]);
    const [months] = await sql<{ m0: string; m1: string; m2: string }[]>`
      SELECT ${sql.unsafe(m(0))}::text AS m0, ${sql.unsafe(m(1))}::text AS m1, ${sql.unsafe(m(2))}::text AS m2`;
    expect(b.map((x) => x.month)).toEqual([null, months.m0, months.m1, months.m2, null, null]);
    expect(b.map((x) => x.deals)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(b.map((x) => num(x.weighted))).toEqual([
      Math.round(10_000_000 * q), Math.round(20_000_000 * q), Math.round(30_000_000 * q), Math.round(40_000_000 * q), Math.round(50_000_000 * q), 0,
    ]);
  });

  it("is all zero for a sales without open deals, and the total sums every sales", async () => {
    const rep = await createUser();
    expect((await getReport(rep.id)).closeForecast.every((x) => x.deals === 0 && num(x.weighted) === 0)).toBe(true);
    await deal(rep.id, "quotation", { price: 10_000_000, closeSql: "jakarta_today() - 3" });
    const total = (await getReport(null)).closeForecast.find((x) => x.key === "past")!;
    const [{ n, w }] = await sql<{ n: number; w: string }[]>`
      SELECT count(*)::int AS n, COALESCE(sum(weighted_amount), 0)::text AS w FROM v_deals_enriched
       WHERE NOT is_won AND NOT is_lost AND expected_close_date < jakarta_today()`;
    expect(total.deals).toBe(n);
    expect(total.weighted).toBe(w);
  });
});

describe("Dari iklan ke CRM", () => {
  it("counts clicks and chats Meta reports, what the CRM logged, and names the ad missing the most", async () => {
    const rep = await createUser();
    const code1 = `Q-${randomUUID().slice(0, 6)}`;
    const code2 = `Q-${randomUUID().slice(0, 6)}`;
    const a1 = await createAd(code1, "Iklan Satu");
    const a2 = await createAd(code2, "Iklan Dua");
    await sql`UPDATE ad_campaigns SET owner_user_id = ${rep.id} WHERE id IN (SELECT s.campaign_id FROM ads a JOIN ad_sets s ON s.id = a.ad_set_id WHERE a.id IN (${a1.id}, ${a2.id}))`;
    // 2 days ago: Iklan Satu 100 clicks, 10 chats, 4 logged; Iklan Dua 50 clicks, 5 chats, 5 logged. Today is not counted.
    await sql`INSERT INTO ad_insights_daily (ad_id, date, spend, link_clicks, meta_conversations)
              VALUES (${a1.id}, jakarta_today() - 2, 1000000, 100, 10), (${a2.id}, jakarta_today() - 2, 500000, 50, 5),
                     (${a1.id}, jakarta_today(), 700000, 70, 7)`;
    const [{ at }] = await sql<{ at: string }[]>`SELECT (((jakarta_today() - 2)::timestamp + interval '10 hours') AT TIME ZONE 'Asia/Jakarta')::text AS at`;
    for (let i = 0; i < 4; i++) await createLead(rep.id, { adId: a1.id, source: "meta_ctwa", receivedAt: at });
    for (let i = 0; i < 5; i++) await createLead(rep.id, { adId: a2.id, source: "meta_ctwa", receivedAt: at });
    const ads = (await getReport(rep.id)).adsToCrm;
    expect(ads).toMatchObject({ hasData: true, clicks: 150, chats: 15, logged: 9, missing: 6, loggedPct: 60 });
    expect(ads.topMissingAd).toEqual({ name: "Iklan Satu", missing: 6 });
  });

  it("an ad with more CRM leads than Meta chats does not hide another ad's gap", async () => {
    const rep = await createUser();
    const a1 = await createAd(`Q-${randomUUID().slice(0, 6)}`, "Iklan Lebih");
    const a2 = await createAd(`Q-${randomUUID().slice(0, 6)}`, "Iklan Kurang");
    await sql`UPDATE ad_campaigns SET owner_user_id = ${rep.id} WHERE id IN (SELECT s.campaign_id FROM ads a JOIN ad_sets s ON s.id = a.ad_set_id WHERE a.id IN (${a1.id}, ${a2.id}))`;
    await sql`INSERT INTO ad_insights_daily (ad_id, date, spend, link_clicks, meta_conversations)
              VALUES (${a1.id}, jakarta_today() - 3, 1, 30, 10), (${a2.id}, jakarta_today() - 3, 1, 30, 10)`;
    const [{ at }] = await sql<{ at: string }[]>`SELECT (((jakarta_today() - 3)::timestamp + interval '9 hours') AT TIME ZONE 'Asia/Jakarta')::text AS at`;
    for (let i = 0; i < 14; i++) await createLead(rep.id, { adId: a1.id, source: "meta_ctwa", receivedAt: at }); // more than Meta's 10
    for (let i = 0; i < 5; i++) await createLead(rep.id, { adId: a2.id, source: "meta_ctwa", receivedAt: at });
    const ads = (await getReport(rep.id)).adsToCrm;
    expect(ads).toMatchObject({ chats: 20, logged: 19, missing: 5, loggedPct: 95 });
    expect(ads.topMissingAd).toEqual({ name: "Iklan Kurang", missing: 5 });
  });

  it("says there is no data for a sales without insights", async () => {
    const rep = await createUser();
    expect((await getReport(rep.id)).adsToCrm).toEqual({ hasData: false, clicks: 0, chats: 0, logged: 0, loggedPct: null, missing: 0, topMissingAd: null });
  });
});

describe("Permintaan per SKU", () => {
  it("sums units in the pipeline, weighted units, units at PO and done this month for this sales only", async () => {
    const rep = await createUser();
    const other = await createUser();
    const p = await createProduct();
    const pq = await prob("quotation");
    const pp = await prob("po");
    await deal(rep.id, "quotation", { product: p.id, qty: 3 });
    await deal(rep.id, "po", { product: p.id, qty: 2 });
    await deal(rep.id, "done", { product: p.id, qty: 4 });
    await deal(other.id, "quotation", { product: p.id, qty: 9 });

    const row = (await getReport(rep.id)).skus.find((s) => s.productId === p.id)!;
    expect(row).toMatchObject({ sku: p.sku, unitsInPipeline: 5, unitsAtPo: 2, doneUnitsMonth: 4 });
    expect(num(row.weightedUnits)).toBeCloseTo(Math.round((3 * pq + 2 * pp) * 10) / 10, 5);

    const all = (await getReport(null)).skus;
    expect(all.length).toBeLessThanOrEqual(14);
  });

  it("lists the biggest weighted demand first, at most 14", async () => {
    const rep = await createUser();
    for (let i = 1; i <= 16; i++) await deal(rep.id, "po", { qty: i });
    const skus = (await getReport(rep.id)).skus;
    expect(skus).toHaveLength(14);
    expect(skus.map((s) => num(s.weightedUnits))).toEqual([...skus.map((s) => num(s.weightedUnits))].sort((a, b) => b - a));
    expect(skus[0].unitsInPipeline).toBe(16);
  });
});

describe("Sumber prospek, demo and lost reasons", () => {
  it("counts new deals and wins by source, for this sales only", async () => {
    const rep = await createUser();
    const other = await createUser();
    const l1 = await createLead(rep.id, { source: "meta_ctwa" });
    const l2 = await createLead(rep.id, { source: "meta_ctwa" });
    const l3 = await createLead(rep.id, { source: "referral" });
    await deal(rep.id, "done", { leadId: l1.id, price: 30_000_000 });
    await deal(rep.id, "lost", { leadId: l2.id });
    await deal(rep.id, "quotation", { leadId: l3.id });
    await deal(rep.id, "chat"); // no lead: counted as "other"
    await deal(other.id, "done", { leadId: (await createLead(other.id, { source: "meta_ctwa" })).id });

    const s = (await getReport(rep.id)).sources;
    expect(s.find((x) => x.source === "meta_ctwa")).toEqual({ source: "meta_ctwa", newDeals: 2, won: 1, wonAmount: "30000000", winRatePct: 50 });
    expect(s.find((x) => x.source === "referral")).toMatchObject({ newDeals: 1, won: 0, winRatePct: null });
    expect(s.find((x) => x.source === "other")).toMatchObject({ newDeals: 1 });
    expect(s[0].source).toBe("meta_ctwa"); // most new deals first
  });

  it("compares win rate with and without a demo, and ranks the lost reasons", async () => {
    const rep = await createUser();
    await deal(rep.id, "done", { demo: true });
    await deal(rep.id, "done", { demo: true });
    await deal(rep.id, "lost", { demo: true, reason: "harga" });
    await deal(rep.id, "done", { demo: false });
    await deal(rep.id, "lost", { demo: false, reason: "harga" });
    await deal(rep.id, "lost", { demo: false, reason: "kompetitor" });
    await deal(rep.id, "lost", { demo: false, reason: "harga", closedOn: "jakarta_today() - 120" }); // older than 90 days

    const r = await getReport(rep.id);
    expect(r.demo.with).toEqual({ won: 2, closed: 3, ratePct: 67 });
    expect(r.demo.without).toEqual({ won: 1, closed: 3, ratePct: 33 });
    expect(r.lostReasons).toEqual([{ reason: "harga", deals: 2 }, { reason: "kompetitor", deals: 1 }]);
  });

  it("shows empty results, not made-up ones, for a sales without deals", async () => {
    const rep = await createUser();
    const r = await getReport(rep.id);
    expect(r.demo).toEqual({ with: { won: 0, closed: 0, ratePct: null }, without: { won: 0, closed: 0, ratePct: null } });
    expect(r.sources).toEqual([]);
    expect(r.lostReasons).toEqual([]);
    expect(r.skus).toEqual([]);
  });
});
