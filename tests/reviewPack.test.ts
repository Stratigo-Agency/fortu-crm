import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { QUERIES, isDay, isReadOnlySql, runQueries } from "../scripts/review-pack-queries.mjs";
import { RULES, buildProposals, fmtRp, renderReport } from "../scripts/review-pack-report.mjs";
import { describeUrl, parseArgs, redact } from "../scripts/review-pack.mjs";
import { createAd, createDeal, createLead, createProduct, createQuotableDeal, createUser } from "./fixtures";

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
  // a lead the system logged by itself (web form): in the lead counts, not in "time to log"
  const web = await createLead(rina.id, { source: "website_form", receivedAt: "2019-03-14T03:00:00Z", loggedAt: "2019-03-14T03:00:02Z" });
  await sql`UPDATE leads SET capture_method = 'web_form' WHERE id = ${web.id}`;
  // an ad code on a lead that did not come from a Meta ad: not part of the Meta capture rate
  await createLead(bagas.id, { source: "whatsapp_direct", adId: ad.id, receivedAt: "2019-03-15T03:00:00Z" });
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

/** Sample (demo) rows in the same period: every query must ignore them unless asked to include them. */
async function sampleRows(ownerId: string, adId: string, approverId: string) {
  const l1 = await createLead(ownerId, { source: "meta_ctwa", adId, receivedAt: "2019-03-20T03:00:00Z", loggedAt: "2019-03-20T08:00:00Z" });
  await sql`UPDATE leads SET is_sample = true WHERE id = ${l1.id}`;
  const done = await closedDeal(ownerId, "done", "2019-03-21", { qty: 5, price: 10_000_000 });
  const lost = await closedDeal(ownerId, "lost", "2019-03-22", { reason: "timing" });
  const open = await createDeal(ownerId);
  const disc = await closedDeal(ownerId, "done", "2019-03-23");
  await sql`UPDATE deals SET discount_approved_by = ${approverId}, discount_approved_at = '2019-03-23T05:00:00Z' WHERE id = ${disc}`;
  await sql`UPDATE deals SET is_sample = true WHERE id IN (${done}, ${lost}, ${open.id}, ${disc})`;
}

describe("review pack queries", () => {
  it("are single read-only statements", () => {
    for (const q of QUERIES) expect(isReadOnlySql(q.sql), q.id).toBe(true);
    expect(isReadOnlySql("DELETE FROM leads")).toBe(false);
    expect(isReadOnlySql("SELECT 1; DELETE FROM leads")).toBe(false);
    expect(isReadOnlySql("WITH x AS (DELETE FROM leads RETURNING 1) SELECT * FROM x")).toBe(false);
    expect(isReadOnlySql("SELECT * INTO copy_of FROM leads")).toBe(false);
    expect(isReadOnlySql("select 1 as x into temp t")).toBe(false);
    expect(isReadOnlySql("SELECT 'into' AS word")).toBe(true); // inside a string it is only text
  });

  it("run in a read-only transaction, and refuse to write", async () => {
    const out = await runQueries(sql, PERIOD, [
      { id: "ro", title: "t", params: [], sql: "SELECT current_setting('transaction_read_only') AS ro" },
    ]);
    expect(out.ro[0].ro).toBe("on");
    await expect(sql.begin("read only", (tx) => tx`CREATE TEMP TABLE should_fail (x int)`)).rejects.toThrow(/read-only/);
    await expect(
      runQueries(sql, PERIOD, [{ id: "w", title: "t", params: [], sql: "SELECT nextval('deal_stage_history_id_seq')" }]),
    ).rejects.toThrow(/read-only/);
  });

  it("validate days", () => {
    expect(isDay("2026-12-01")).toBe(true);
    expect(isDay("2026-02-30")).toBe(false);
    expect(isDay("1 Des 2026")).toBe(false);
    expect(parseArgs([])).toMatchObject({ from: "2026-11-11", to: "2026-12-01", includeSample: false });
    expect(parseArgs(["--include-sample", "--from", "2026-11-12"])).toMatchObject({ from: "2026-11-12", includeSample: true });
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
    expect(leads).toBe(6);
    const src = r.leads_by_source;
    expect(src.find((x) => x.is_total)!.leads).toBe(leads);
    expect(src.filter((x) => !x.is_total).reduce((a, x) => a + x.leads, 0)).toBe(leads);
    expect(src.find((x) => x.source === "meta_ctwa")!.leads).toBe(3);
    const byRep = r.leads_by_rep;
    expect(byRep.find((x) => x.is_total)!.leads).toBe(leads);
    expect(byRep.filter((x) => !x.is_total).reduce((a, x) => a + x.leads, 0)).toBe(leads);
    expect(byRep.find((x) => x.rep === "Rina Uji")!.leads).toBe(3);

    // Time to log: only manually logged leads (the web-form lead and the imported-style ones are left out).
    // Rina 10 and 30 minutes -> median 20
    const log = r.time_to_log;
    expect(n(log.find((x) => x.rep === "Rina Uji")!.median_min)).toBe(20);
    expect(log.find((x) => x.rep === "Bagas Uji")!.over_60min).toBe(1);
    expect(log.find((x) => x.rep === "Rina Uji")!.leads).toBe(2);
    expect(log.find((x) => x.is_total)!.leads).toBe(leads - 1);

    // Stage conversion: every deal that entered a stage ends in exactly one bucket
    for (const x of r.stage_conversion) expect(x.entered).toBe(x.moved_on + x.lost_here + x.moved_back + x.still_here);
    expect(r.stage_conversion.map((x) => x.key)).toEqual((await sql<Row[]>`SELECT key FROM pipeline_stages WHERE NOT is_won AND NOT is_lost ORDER BY position`).map((x) => x.key));

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

    // Ads: Meta chats in the period (5 + 3) against Meta leads that carry the ad (2; the WhatsApp-direct lead with a code is not Meta)
    expect(r.ads_capture[0]).toMatchObject({ meta_chats: 8, leads_with_ad: 2 });
    expect(n(r.ads_capture[0].capture_pct)).toBe(25);
    expect(r.ads_capture[0].over_100).toBe(false);
    expect(r.ads_capture[0].ctwa_without_ad).toBe(1);
    const perAd = r.ads_capture_by_ad.find((x) => x.ad_code && x.meta_chats === 8)!;
    expect(perAd).toMatchObject({ meta_chats: 8, leads_with_ad: 2, missing: 6 });

    // Targets are rebuilt from deals; the company row still equals v_target_attainment and v_done_monthly
    // (the test database holds no sample rows in 2019 at this point)
    const t = r.targets.find((x) => x.is_company)!;
    const [done] = await sql<Row[]>`SELECT amount, units FROM v_done_monthly WHERE is_total AND period_month = '2019-03-01'`;
    expect(n(t.amount_won)).toBe(n(done.amount));
    expect(t.units_won).toBe(n(done.units));
    expect([t.units_won, n(t.target_units), n(t.target_amount)]).toEqual([4, 20, 500_000_000]);
    expect(n(t.units_pct)).toBe(20);
    expect(t.full_month).toBe(true);
    const [view] = await sql<Row[]>`SELECT units_won, amount_won FROM v_target_attainment WHERE user_id IS NULL AND period_month = '2019-03-01'`;
    expect([n(view.units_won), n(view.amount_won)]).toEqual([t.units_won, n(t.amount_won)]);
    expect(n(t.amount_pct)).toBe(28); // 90 jt + 50 jt = 140 jt of 500 jt
  });

  it("leave out sample rows everywhere, unless asked to include them", async () => {
    const { rina, ad } = await setup();
    const ceo = await createUser({ role: "ceo" });
    const before = (await runQueries(sql, PERIOD)) as Record<string, Row[]>;
    await sampleRows(rina.id, ad.id, ceo.id);
    const after = (await runQueries(sql, PERIOD)) as Record<string, Row[]>;
    // a sample row in the period changes nothing
    for (const q of QUERIES) expect(after[q.id], q.id).toEqual(before[q.id]);

    const withSample = (await runQueries(sql, { ...PERIOD, includeSample: true })) as Record<string, Row[]>;
    expect(withSample.leads_by_source.find((x) => x.is_total)!.leads).toBe(before.leads_by_source.find((x) => x.is_total)!.leads + 1);
    expect(withSample.win_rate.find((x) => x.is_total)!.won).toBe(before.win_rate.find((x) => x.is_total)!.won + 2);
    expect(withSample.win_rate.find((x) => x.is_total)!.lost).toBe(before.win_rate.find((x) => x.is_total)!.lost + 1);
    expect(withSample.time_to_log.find((x) => x.is_total)!.leads).toBe(before.time_to_log.find((x) => x.is_total)!.leads + 1);
    expect(withSample.discounts_approved.length).toBe(before.discounts_approved.length + 1);
    expect(withSample.ads_capture[0].leads_with_ad).toBe(before.ads_capture[0].leads_with_ad + 1);
    expect(n(withSample.targets.find((x) => x.is_company)!.amount_won)).toBeGreaterThan(n(before.targets.find((x) => x.is_company)!.amount_won));
    const open = (r: Record<string, Row[]>) => r.stale_by_stage.find((x) => x.key === "chat")!.open_deals;
    expect(open(withSample)).toBe(open(before) + 1);
    const entered = (r: Record<string, Row[]>) => r.stage_conversion.find((x) => x.key === "chat")!.entered;
    expect(entered(withSample)).toBeGreaterThan(entered(before));
    const outEntered = (r: Record<string, Row[]>) => r.stage_outcomes.find((x) => x.key === "chat")!.entered;
    expect(outEntered(withSample)).toBeGreaterThan(outEntered(before));
  });

  it("counts each deal once per stage and keeps backward moves apart", async () => {
    const rep = await createUser({ fullName: "Mundur Uji" });
    const snap = async () => {
      const r = await runQueries(sql, PERIOD, QUERIES.filter((q) => q.id === "stage_conversion"));
      return Object.fromEntries((r.stage_conversion as Row[]).map((x) => [x.key, x]));
    };
    const stageTo = (id: string, key: string) =>
      sql`UPDATE deals SET stage_id = (SELECT id FROM pipeline_stages WHERE key = ${key}) WHERE id = ${id}`;
    const before = await snap();
    // A: chat -> quotation -> chat (back) -> quotation -> negotiation: one deal, however often it came back
    const a = await createQuotableDeal(rep.id);
    await stageTo(a.id, "quotation");
    await stageTo(a.id, "chat");
    await stageTo(a.id, "quotation");
    await stageTo(a.id, "negotiation");
    // B: chat -> quotation -> chat (and stays back at chat)
    const b = await createQuotableDeal(rep.id);
    await stageTo(b.id, "quotation");
    await stageTo(b.id, "chat");
    const after = await snap();
    const d = (key: string, col: string) => n(after[key][col]) - n(before[key][col]);
    expect(d("chat", "entered")).toBe(2); // A and B, A's second visit is not a third entry
    expect(d("chat", "moved_on")).toBe(1); // A
    expect(d("chat", "still_here")).toBe(1); // B
    expect(d("quotation", "entered")).toBe(2);
    expect(d("quotation", "moved_on")).toBe(1); // A went on to Negotiation
    expect(d("quotation", "moved_back")).toBe(1); // B went back to Chat
    expect(d("negotiation", "still_here")).toBe(1); // A
    for (const x of Object.values(after) as Row[]) expect(x.entered).toBe(x.moved_on + x.lost_here + x.moved_back + x.still_here);
  });

  it("keeps a partial month apart, and does not look at today", async () => {
    await setup();
    // 10 to 31 March: March is only partly inside the period
    const part = (await runQueries(sql, { from: "2019-03-10", to: "2019-03-31" })) as Record<string, Row[]>;
    const m = part.targets.find((x) => x.is_company && x.month === "2019-03-01")!;
    expect(m.full_month).toBe(false);
    // the whole 1-31 March period is a full month
    const whole = (await runQueries(sql, PERIOD)) as Record<string, Row[]>;
    expect(whole.targets.find((x) => x.is_company && x.month === "2019-03-01")!.full_month).toBe(true);
    // a month far in the future is "full" as long as the period covers it
    await sql`INSERT INTO sales_targets (user_id, period_month, target_amount, target_units)
              VALUES (NULL, '2099-03-01', 1000000, 1) ON CONFLICT (user_id, period_month) DO NOTHING`;
    const future = (await runQueries(sql, { from: "2099-03-01", to: "2099-03-31" })) as Record<string, Row[]>;
    expect(future.targets.find((x) => x.is_company && x.month === "2099-03-01")!.full_month).toBe(true);
    // the same month with the period ending on the 30th is not
    const cut = (await runQueries(sql, { from: "2099-03-01", to: "2099-03-30" })) as Record<string, Row[]>;
    expect(cut.targets.find((x) => x.is_company && x.month === "2099-03-01")!.full_month).toBe(false);
    // the report marks it "sebagian" and makes no target proposal from it
    const text = renderReport(part, { ...{ from: "2019-03-10", to: "2019-03-31" }, generatedAt: "x" });
    expect(text).toContain("Maret 2019 (sebagian)");
    expect(buildProposals(part).some((p: Row) => p.area.startsWith("Target Rupiah") || p.area.startsWith("Target unit"))).toBe(false);
    expect(buildProposals(part).find((p: Row) => p.area === "Target bulanan")!.support).toContain("baru sebagian");
  });

  it("uses Jakarta days for closed_on, approvals and leads at the edges of the period", async () => {
    const rep = await createUser({ fullName: "Batas Uji" });
    const ceo = await createUser({ role: "ceo", fullName: "Batas CEO" });
    const edge = { from: "2019-06-01", to: "2019-06-30" };
    const inside = [await closedDeal(rep.id, "done", "2019-06-01"), await closedDeal(rep.id, "done", "2019-06-30")];
    const outside = [await closedDeal(rep.id, "done", "2019-05-31"), await closedDeal(rep.id, "done", "2019-07-01")];
    // approved 1 Jun 00:30 WIB (= 31 May 17:30 UTC): inside. Approved 1 Jul 00:30 WIB (= 30 Jun 17:30 UTC): outside.
    await sql`UPDATE deals SET discount_approved_by = ${ceo.id}, discount_approved_at = '2019-05-31T17:30:00Z' WHERE id = ${inside[0]}`;
    await sql`UPDATE deals SET discount_approved_by = ${ceo.id}, discount_approved_at = '2019-06-30T16:59:00Z' WHERE id = ${inside[1]}`;
    await sql`UPDATE deals SET discount_approved_by = ${ceo.id}, discount_approved_at = '2019-06-30T17:30:00Z' WHERE id = ${outside[1]}`;
    await sql`UPDATE deals SET discount_approved_by = ${ceo.id}, discount_approved_at = '2019-05-31T16:59:00Z' WHERE id = ${outside[0]}`;
    await createLead(rep.id, { receivedAt: "2019-05-31T17:00:00Z" }); // 1 Jun 00:00 WIB: inside
    await createLead(rep.id, { receivedAt: "2019-06-30T16:59:59Z" }); // 30 Jun 23:59:59 WIB: inside
    await createLead(rep.id, { receivedAt: "2019-06-30T17:00:00Z" }); // 1 Jul 00:00 WIB: outside
    await createLead(rep.id, { receivedAt: "2019-05-31T16:59:59Z" }); // 31 May 23:59:59 WIB: outside
    const r = (await runQueries(sql, edge)) as Record<string, Row[]>;
    const mine = (rows: Row[]) => rows.find((x) => x.rep === "Batas Uji");
    expect(mine(r.win_rate)!.won).toBe(2);
    expect(mine(r.leads_by_rep)!.leads).toBe(2);
    expect(r.discounts_approved.filter((x) => x.rep === "Batas Uji").map((x) => x.approved_on)).toEqual(["2019-06-01", "2019-06-30"]);
    expect(r.discount_summary[0].approved).toBe(2);
  });

  it("shows the ad capture ratio uncapped and warns above 100%", async () => {
    const rep = await createUser({ fullName: "Iklan Uji" });
    const ad = await createAd(`T23-${Math.random().toString(36).slice(2, 8).toUpperCase()}`);
    await sql`INSERT INTO ad_insights_daily (ad_id, date, spend, link_clicks, meta_conversations) VALUES (${ad.id}, '2019-05-10', 1000, 5, 1)`;
    await createLead(rep.id, { source: "meta_ctwa", adId: ad.id, receivedAt: "2019-05-10T03:00:00Z" });
    await createLead(rep.id, { source: "meta_ctwa", adId: ad.id, receivedAt: "2019-05-11T03:00:00Z" });
    const r = (await runQueries(sql, { from: "2019-05-01", to: "2019-05-31" })) as Record<string, Row[]>;
    expect(r.ads_capture[0]).toMatchObject({ meta_chats: 1, leads_with_ad: 2, over_100: true });
    expect(n(r.ads_capture[0].capture_pct)).toBe(200);
    const text = renderReport(r, { from: "2019-05-01", to: "2019-05-31", generatedAt: "x" });
    expect(text).toContain("lebih dari 100% (200%)");
  });

  it("renders a period without any data: no NaN, undefined or Infinity", async () => {
    const r = await runQueries(sql, { from: "2099-06-01", to: "2099-06-30" });
    const text = renderReport(r, { from: "2099-06-01", to: "2099-06-30", generatedAt: "x" });
    expect(text).not.toMatch(/NaN|undefined|Infinity|null/);
    expect(text).toContain("Data belum cukup");
    expect(text).toContain("Lead masuk: 0.");
  });

  it("renders null and zero denominators from hand-made rows", () => {
    const results = {
      leads_by_source: [{ source: null, is_total: true, leads: 0 }],
      leads_by_rep: [{ rep: null, is_total: true, leads: 0, became_deal: 0 }],
      time_to_log: [{ rep: null, is_total: true, leads: 0, median_min: null, p90_min: null, over_60min: 0 }],
      stage_conversion: [{ key: "chat", name: "Chat", entered: 0, moved_on: 0, lost_here: 0, moved_back: 0, still_here: 0, moved_on_pct: null, finished_visits: 0, median_days_in_stage: null, p75_days_in_stage: null, p90_days_in_stage: null }],
      win_rate: [{ rep: null, is_total: true, won: 0, lost: 0, closed: 0, win_rate_pct: null, won_amount: "0" }],
      lost_reasons: [],
      discount_summary: [{ approved: 0, waiting_now: 0, over_limit_deals: 0, deals_created: 0 }],
      discounts_approved: [],
      ads_capture: [{ meta_chats: 0, leads_with_ad: 0, ctwa_leads: 0, ctwa_without_ad: 0, capture_pct: null, over_100: false }],
      ads_capture_by_ad: [],
      targets: [],
      stage_outcomes: [{ key: "chat", name: "Chat", probability: "0.100", stale_after_days: 3, entered: 0, later_won: 0, later_lost: 0, closed: 0, still_open: 0, win_pct_of_closed: null }],
      stale_by_stage: [{ key: "chat", name: "Chat", stale_after_days: 3, open_deals: 0, stale_deals: 0 }],
      rule_settings: [],
    };
    const text = renderReport(results, { from: "2026-11-11", to: "2026-12-01", generatedAt: "x" });
    expect(text).not.toMatch(/NaN|undefined|Infinity|null/);
    expect(text).toContain("belum ada data iklan");
  });

  it("report text: one 'sebelum PPN', all appendix queries, no 'Anda'", async () => {
    const results = await runQueries(sql, PERIOD);
    const text = renderReport(results, { ...PERIOD, generatedAt: "1 Maret 2019", banner: "Contoh dengan data demo" });
    expect(text.match(/sebelum PPN/g)).toHaveLength(1);
    expect(text.match(/<details>/g)).toHaveLength(QUERIES.length);
    expect(text).toContain("Contoh dengan data demo");
    expect(text).toContain("Ini usulan saja. Belum ada yang diubah");
    expect(text).toContain("Data contoh (is_sample) tidak ikut dihitung.");
    expect(text).toContain("Angka dibulatkan");
    expect(renderReport(results, { ...PERIOD, generatedAt: "x", includeSample: true })).toContain("Data contoh (is_sample) ikut dihitung");
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
      stage_outcomes: [{ key: "quotation", name: "Quotation", probability: "0.300", stale_after_days: 5, entered: 4, later_won: 1, later_lost: 1, closed: 2, still_open: 2, win_pct_of_closed: "50.0" }],
      stale_by_stage: [{ key: "quotation", name: "Quotation", stale_after_days: 5, open_deals: 2, stale_deals: 2 }],
    });
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.every((x: Row) => x.proposal === "Data belum cukup" || x.proposal === "Tidak perlu diubah")).toBe(true);
    const prob = rows.find((x: Row) => x.area === "Peluang tahap Quotation")!;
    expect(prob).toMatchObject({ proposal: "Data belum cukup" });
    expect(prob.support).toContain(`minimal ${RULES.minDealsProbability}`);
    // 12 closed deals is enough for other areas, but not for a probability
    const twelve = buildProposals({
      ...base,
      stage_outcomes: [{ key: "quotation", name: "Quotation", probability: "0.300", stale_after_days: 5, entered: 14, later_won: 10, later_lost: 2, closed: 12, still_open: 2, win_pct_of_closed: "83.3" }],
    });
    expect(twelve.find((x: Row) => x.area === "Peluang tahap Quotation")!.proposal).toBe("Data belum cukup");
  });

  it("proposes a change only with enough data, and quotes the supporting number", () => {
    const rows = buildProposals({
      ...base,
      stage_outcomes: [{ key: "quotation", name: "Quotation", probability: "0.300", stale_after_days: 5, entered: 40, later_won: 18, later_lost: 12, closed: 30, still_open: 10, win_pct_of_closed: "60.0" }],
      stale_by_stage: [{ key: "quotation", name: "Quotation", stale_after_days: 5, open_deals: 8, stale_deals: 6 }],
      // the median (2 days) is under the limit; the 75th percentile (9.2) is what decides
      stage_conversion: [{ key: "quotation", entered: 30, finished_visits: 30, median_days_in_stage: "2.0", p75_days_in_stage: "9.2", p90_days_in_stage: "14.0" }],
      targets: [{ month: "2019-02-01", is_company: true, full_month: true, target_amount: "500000000", amount_won: "100000000", amount_pct: "20.0", target_units: 20, units_won: 4, units_pct: "20.0" }],
      time_to_log: [{ is_total: true, leads: 40, median_min: "95.0", over_60min: 22 }],
      ads_capture: [{ meta_chats: 100, leads_with_ad: 40, ctwa_leads: 60, ctwa_without_ad: 20, capture_pct: "40.0", over_100: false }],
      lost_reasons: [{ reason: "harga", deals: 12, share_pct: "60.0" }, { reason: "timing", deals: 8, share_pct: "40.0" }],
    });
    const find = (area: string) => rows.find((x: Row) => x.area.startsWith(area))!;
    expect(find("Peluang tahap Quotation")).toMatchObject({ current: "30%", proposal: "Pertimbangkan 60%" });
    expect(find("Peluang tahap Quotation").support).toContain("18 jadi Done deal");
    expect(find("Peluang tahap Quotation").support).toContain("10 deal terbuka belum dihitung");
    expect(find("Peluang tahap Quotation").support).toContain("condong ke deal yang cepat selesai");
    expect(find("Batas hari belum bergerak").support).toContain("3 dari 4 deal pindah dalam 9,2 hari");
    // no invented "current rule": only what the CRM really has
    expect(find("Aturan catat chat").current).toBe("-");
    expect(find("Aturan kode iklan").current).toBe("-");
    expect(find("Batas hari belum bergerak")).toMatchObject({ proposal: "Pertimbangkan 10 hari" });
    expect(find("Target Rupiah").proposal).toContain("terlalu tinggi");
    expect(find("Aturan catat chat").proposal).toContain("60 menit");
    expect(find("Aturan kode iklan").support).toContain("40 dari 100");
    expect(find("Tindak lanjut alasan lost").proposal).toContain("Harga terlalu tinggi");
  });

  it("makes no ad-code proposal when the ratio is above 100%", () => {
    const rows = buildProposals({
      ...base,
      ads_capture: [{ meta_chats: 30, leads_with_ad: 45, ctwa_leads: 45, ctwa_without_ad: 0, capture_pct: "150.0", over_100: true }],
    });
    const ads = rows.find((x: Row) => x.area === "Aturan kode iklan di chat")!;
    expect(ads.proposal).toContain("lebih dari 100%");
    expect(ads.support).toContain("150%");
  });

  it("formats money like the app", () => {
    expect(fmtRp(540_000_000)).toBe("Rp540 jt");
    expect(fmtRp(1_120_000_000)).toBe("Rp1,12 M");
    expect(fmtRp(626_600_000)).toBe("Rp626,6 jt");
    expect(fmtRp(950_000)).toBe("Rp950.000");
  });
});

describe("review pack script", () => {
  const script = path.resolve(import.meta.dirname, "../scripts/review-pack.mjs");
  const run = (url: string) =>
    spawnSync(process.execPath, [script, "--out", "/dev/null"], {
      env: { PATH: process.env.PATH ?? "", REVIEW_DATABASE_URL: url } as unknown as NodeJS.ProcessEnv,
      encoding: "utf8",
    });

  it("never prints the password, not even when the connection fails", () => {
    const secret = "Zx9SecretPw42";
    for (const url of [
      `postgresql://reader:${secret}@127.0.0.1:1/railway?sslmode=require`, // nothing listens on port 1
      `postgresql://reader:${secret}@host:notaport/railway`, // not a valid URL
    ]) {
      const out = run(url);
      expect(out.status).toBe(1);
      expect(out.stdout + out.stderr).not.toContain(secret);
      expect(out.stdout + out.stderr).toMatch(/error:/);
    }
  });

  it("describes and redacts connection URLs", () => {
    expect(describeUrl("postgresql://reader:pw1@db.example.com:5432/railway")).toBe("db.example.com:5432/railway");
    expect(() => describeUrl("postgresql://reader:pw1@h:bad/x")).toThrow(/tidak valid/);
    try {
      describeUrl("postgresql://reader:pw1@h:bad/x");
    } catch (e) {
      expect((e as Error).message).not.toContain("pw1");
    }
    expect(redact("could not connect to postgresql://reader:pw1@db.example.com:5432/x and postgres://a:b@c")).toBe(
      "could not connect to postgresql://***@db.example.com:5432/x and postgres://***@c",
    );
    expect(redact("no url here")).toBe("no url here");
  });
});
