import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { QUERIES, isDay, isReadOnlySql, runQueries } from "../scripts/review-pack-queries.mjs";
import { RULES, buildProposals, fmtRp, renderReport } from "../scripts/review-pack-report.mjs";
import { parseArgs } from "../scripts/review-pack.mjs";
import { createAd, createDeal, createLead, createProduct, createUser } from "./fixtures";

// The review pack (T23). The shared test database already holds rows from other tests, so every check
// uses a period in the past (March 2019, so the month counts as over) or compares a query with the view it is built on.

const PERIOD = { from: "2019-03-01", to: "2019-03-31" };
const n = (v: unknown) => Number(v ?? 0);

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function closedDeal(ownerId: string, stage: "done" | "lost", closedOn: string, o: { qty?: number; price?: number; reason?: string } = {}) {
  const d = await createDeal(ownerId);
  const p = await createProduct();
  await sql`INSERT INTO deal_line_items (deal_id, product_id, qty, unit_price) VALUES (${d.id}, ${p.id}, ${o.qty ?? 2}, ${o.price ?? 20_000_000})`;
  await sql`
    UPDATE deals SET stage_id = (SELECT id FROM pipeline_stages WHERE key = ${stage}),
           expected_close_date = ${closedOn}::date,
           lost_reason = ${stage === "lost" ? (o.reason ?? "harga") : null}::lost_reason,
           closed_on = ${closedOn}::date, next_step_date = ${closedOn}::date
     WHERE id = ${d.id}`;
  return d.id;
}

async function setup() {
  const rina = await createUser({ fullName: "Rina Uji" });
  const bagas = await createUser({ fullName: "Bagas Uji" });
  const ad = await createAd(`T23-${Math.random().toString(36).slice(2, 8).toUpperCase()}`);

  // 4 leads in March 2019 (Jakarta): logged 10, 30, 90 and 0 minutes after they arrived.
  await createLead(rina.id, { source: "meta_ctwa", adId: ad.id, receivedAt: "2019-03-10T03:00:00Z", loggedAt: "2019-03-10T03:10:00Z" });
  await createLead(rina.id, { source: "meta_ctwa", receivedAt: "2019-03-11T03:00:00Z", loggedAt: "2019-03-11T03:30:00Z" });
  await createLead(bagas.id, { source: "website_form", receivedAt: "2019-03-12T03:00:00Z", loggedAt: "2019-03-12T04:30:00Z" });
  await createLead(bagas.id, { source: "meta_ctwa", adId: ad.id, receivedAt: "2019-03-13T03:00:00Z" });
  // outside the period: must not be counted
  await createLead(rina.id, { source: "referral", receivedAt: "2019-04-02T03:00:00Z" });
  // 31 Mar 23:30 UTC is already 1 Apr in Jakarta: outside as well
  await createLead(rina.id, { source: "referral", receivedAt: "2019-03-31T23:30:00Z" });

  await sql`INSERT INTO ad_insights_daily (ad_id, date, spend, link_clicks, meta_conversations)
            VALUES (${ad.id}, '2019-03-10', 100000, 30, 5), (${ad.id}, '2019-03-11', 100000, 20, 3),
                   (${ad.id}, '2019-04-05', 100000, 20, 99)`;

  await closedDeal(rina.id, "done", "2019-03-14", { qty: 3, price: 30_000_000 });
  await closedDeal(bagas.id, "done", "2019-03-15", { qty: 1, price: 50_000_000 });
  await closedDeal(bagas.id, "lost", "2019-03-16", { reason: "kompetitor" });
  await closedDeal(rina.id, "lost", "2019-03-17", { reason: "harga" });
  await closedDeal(rina.id, "lost", "2019-03-18", { reason: "harga" });
  await closedDeal(rina.id, "done", "2019-04-03"); // April: outside

  await sql`INSERT INTO sales_targets (user_id, period_month, target_amount, target_units)
            VALUES (NULL, '2019-03-01', 500000000, 20) ON CONFLICT (user_id, period_month) DO UPDATE SET target_amount = 500000000, target_units = 20`;
  return { rina, bagas, ad };
}

describe("review pack queries", () => {
  it("are single read-only statements", () => {
    for (const q of QUERIES) expect(isReadOnlySql(q.sql), q.id).toBe(true);
    expect(isReadOnlySql("DELETE FROM leads")).toBe(false);
    expect(isReadOnlySql("SELECT 1; DELETE FROM leads")).toBe(false);
    expect(isReadOnlySql("WITH x AS (DELETE FROM leads RETURNING 1) SELECT * FROM x")).toBe(false);
    expect(isReadOnlySql("SELECT * INTO copy_of FROM leads")).toBe(true); // blocked by the read-only transaction instead
  });

  it("run in a read-only transaction, and refuse to write", async () => {
    const out = await runQueries(sql, PERIOD, [
      { id: "ro", title: "t", params: [], sql: "SELECT current_setting('transaction_read_only') AS ro" },
    ]);
    expect(out.ro[0].ro).toBe("on");
    await expect(sql.begin("read only", (tx) => tx`CREATE TEMP TABLE should_fail (x int)`)).rejects.toThrow(/read-only/);
    await expect(
      runQueries(sql, PERIOD, [{ id: "w", title: "t", params: [], sql: "SELECT * INTO review_pack_copy FROM leads" }]),
    ).rejects.toThrow(/read-only/);
  });

  it("validate days", () => {
    expect(isDay("2026-12-01")).toBe(true);
    expect(isDay("2026-02-30")).toBe(false);
    expect(isDay("1 Des 2026")).toBe(false);
    expect(parseArgs([])).toMatchObject({ from: "2026-11-11", to: "2026-12-01" });
    expect(() => parseArgs(["--from", "2026-12-02", "--to", "2026-12-01"])).toThrow();
    expect(() => parseArgs(["--bogus", "x"])).toThrow();
  });

  it("all execute and their sums match the data and the views", async () => {
    await setup();
    const r = (await runQueries(sql, PERIOD)) as Record<string, Row[]>;
    for (const q of QUERIES) expect(Array.isArray(r[q.id]), q.id).toBe(true);

    // Leads: 4 inside the period (Jakarta day), by source and by rep
    const [{ c: leads }] = await sql<{ c: number }[]>`
      SELECT count(*)::int AS c FROM leads
       WHERE (received_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN ${PERIOD.from}::date AND ${PERIOD.to}::date`;
    expect(leads).toBe(4);
    const src = r.leads_by_source;
    expect(src.find((x) => x.is_total)!.leads).toBe(leads);
    expect(src.filter((x) => !x.is_total).reduce((a, x) => a + x.leads, 0)).toBe(leads);
    expect(src.find((x) => x.source === "meta_ctwa")!.leads).toBe(3);
    const byRep = r.leads_by_rep;
    expect(byRep.find((x) => x.is_total)!.leads).toBe(leads);
    expect(byRep.filter((x) => !x.is_total).reduce((a, x) => a + x.leads, 0)).toBe(leads);
    expect(byRep.find((x) => x.rep === "Rina Uji")!.leads).toBe(2);

    // Time to log: Rina 10 and 30 minutes -> median 20
    const log = r.time_to_log;
    expect(n(log.find((x) => x.rep === "Rina Uji")!.median_min)).toBe(20);
    expect(log.find((x) => x.rep === "Bagas Uji")!.over_60min).toBe(1);
    expect(log.find((x) => x.is_total)!.leads).toBe(leads);

    // Stage conversion is v_stage_conversion, row for row
    const view = await sql<Row[]>`SELECT key, entered, moved_on, lost_here, median_days_in_stage FROM v_stage_conversion ORDER BY position`;
    expect(r.stage_conversion.map((x) => [x.key, x.entered, x.moved_on, x.lost_here, x.median_days_in_stage])).toEqual(
      view.map((x) => [x.key, x.entered, x.moved_on, x.lost_here, x.median_days_in_stage]),
    );
    for (const x of r.stage_conversion) expect(x.still_here).toBe(x.entered - x.moved_on - x.lost_here);

    // Win rate: 2 Done deal + 3 Lost in March (the April one is outside)
    const win = r.win_rate;
    const total = win.find((x) => x.is_total)!;
    expect([total.won, total.lost, n(total.win_rate_pct)]).toEqual([2, 3, 40]);
    expect(n(total.won_amount)).toBe(3 * 30_000_000 + 50_000_000);
    expect(win.filter((x) => !x.is_total).reduce((a, x) => a + x.won, 0)).toBe(total.won);
    expect(win.filter((x) => !x.is_total).reduce((a, x) => a + x.lost, 0)).toBe(total.lost);

    // Lost reasons add up to the lost deals, and the shares to 100
    expect(r.lost_reasons.reduce((a, x) => a + x.deals, 0)).toBe(total.lost);
    expect(r.lost_reasons[0]).toMatchObject({ reason: "harga", deals: 2 });
    expect(Math.round(r.lost_reasons.reduce((a, x) => a + n(x.share_pct), 0))).toBe(100);

    // Ads: Meta chats in the period (5 + 3) against leads that carry the ad (2)
    expect(r.ads_capture[0]).toMatchObject({ meta_chats: 8, leads_with_ad: 2 });
    expect(n(r.ads_capture[0].capture_pct)).toBe(25);
    expect(r.ads_capture[0].ctwa_without_ad).toBe(1);
    const perAd = r.ads_capture_by_ad.find((x) => x.ad_code && x.meta_chats === 8)!;
    expect(perAd).toMatchObject({ meta_chats: 8, leads_with_ad: 2, missing: 6 });

    // Targets: the company row is v_target_attainment, and its totals are v_done_monthly
    const t = r.targets.find((x) => x.is_company)!;
    const [done] = await sql<Row[]>`SELECT amount, units FROM v_done_monthly WHERE is_total AND period_month = '2019-03-01'`;
    expect(n(t.amount_won)).toBe(n(done.amount));
    expect(t.units_won).toBe(n(done.units));
    expect([t.units_won, n(t.target_units), n(t.target_amount)]).toEqual([4, 20, 500_000_000]);
    expect(n(t.units_pct)).toBe(20);
    expect(t.month_over).toBe(true);
    expect(n(t.amount_pct)).toBe(28); // 90 jt + 50 jt = 140 jt of 500 jt
  });

  it("report text: one 'sebelum PPN', all appendix queries, no 'Anda'", async () => {
    const results = await runQueries(sql, PERIOD);
    const text = renderReport(results, { ...PERIOD, generatedAt: "1 Maret 2019", banner: "Contoh dengan data demo" });
    expect(text.match(/sebelum PPN/g)).toHaveLength(1);
    expect(text.match(/<details>/g)).toHaveLength(QUERIES.length);
    expect(text).toContain("Contoh dengan data demo");
    expect(text).toContain("Ini usulan saja. Belum ada yang diubah");
    expect(text).not.toMatch(/\bAnda\b/);
    for (const q of QUERIES) expect(text).toContain(q.sql.trim());
  });
});

describe("review pack proposals", () => {
  const base = {
    rule_settings: [{ key: "max_discount_pct", value: "15" }],
    stage_outcomes: [],
    stale_by_stage: [],
    stage_conversion: [],
    targets: [],
    discount_summary: [{ approved: 0, waiting_now: 0, over_limit_deals: 0, deals_created: 0 }],
    time_to_log: [],
    ads_capture: [{ meta_chats: 0, leads_with_ad: 0, ctwa_leads: 0, ctwa_without_ad: 0, capture_pct: null }],
    lost_reasons: [],
  };

  it("says 'data belum cukup' instead of guessing when the data is thin", () => {
    const rows = buildProposals({
      ...base,
      stage_outcomes: [{ key: "quotation", name: "Quotation", probability: "0.300", stale_after_days: 5, entered: 4, later_won: 1, later_lost: 1, closed: 2, win_pct_of_closed: "50.0" }],
      stale_by_stage: [{ key: "quotation", name: "Quotation", stale_after_days: 5, open_deals: 2, stale_deals: 2 }],
    });
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.every((x: Row) => x.proposal === "Data belum cukup" || x.proposal === "Tidak perlu diubah")).toBe(true);
    const prob = rows.find((x: Row) => x.area === "Peluang tahap Quotation")!;
    expect(prob).toMatchObject({ proposal: "Data belum cukup" });
    expect(prob.support).toContain(`minimal ${RULES.minDeals}`);
  });

  it("proposes a change only with enough data, and quotes the supporting number", () => {
    const rows = buildProposals({
      ...base,
      stage_outcomes: [{ key: "quotation", name: "Quotation", probability: "0.300", stale_after_days: 5, entered: 30, later_won: 18, later_lost: 12, closed: 30, win_pct_of_closed: "60.0" }],
      stale_by_stage: [{ key: "quotation", name: "Quotation", stale_after_days: 5, open_deals: 8, stale_deals: 6 }],
      stage_conversion: [{ key: "quotation", entered: 30, median_days_in_stage: "9.2" }],
      targets: [{ month: "2019-02-01", is_company: true, month_over: true, target_amount: "500000000", amount_won: "100000000", amount_pct: "20.0", target_units: 20, units_won: 4, units_pct: "20.0" }],
      time_to_log: [{ is_total: true, leads: 40, median_min: "95.0", over_60min: 22 }],
      ads_capture: [{ meta_chats: 100, leads_with_ad: 40, ctwa_leads: 60, ctwa_without_ad: 20, capture_pct: "40.0" }],
      lost_reasons: [{ reason: "harga", deals: 12, share_pct: "60.0" }, { reason: "timing", deals: 8, share_pct: "40.0" }],
    });
    const find = (area: string) => rows.find((x: Row) => x.area.startsWith(area))!;
    expect(find("Peluang tahap Quotation")).toMatchObject({ current: "30%", proposal: "Pertimbangkan 60%" });
    expect(find("Peluang tahap Quotation").support).toContain("18 jadi Done deal");
    expect(find("Batas hari belum bergerak")).toMatchObject({ proposal: "Pertimbangkan 10 hari" });
    expect(find("Target Rupiah").proposal).toContain("terlalu tinggi");
    expect(find("Aturan catat chat").proposal).toContain("60 menit");
    expect(find("Aturan kode iklan").support).toContain("40 dari 100");
    expect(find("Tindak lanjut alasan lost").proposal).toContain("Harga terlalu tinggi");
  });

  it("formats money like the app", () => {
    expect(fmtRp(540_000_000)).toBe("Rp540 jt");
    expect(fmtRp(1_120_000_000)).toBe("Rp1,12 M");
    expect(fmtRp(626_600_000)).toBe("Rp626,6 jt");
    expect(fmtRp(950_000)).toBe("Rp950.000");
  });
});
