import { sql } from "@/lib/db";
import { linesFingerprint } from "@/lib/linesFingerprint";
import type { ReportPeriod } from "@/lib/reportPeriod";

// Numbers for /laporan. Every figure comes from a SQL view (CLAUDE.md rule 5); this file only picks rows.
// `ownerId` null = all sales (the total row of each view), otherwise one person's row.

export type ReportKpis = {
  asOf: string; // Jakarta date, YYYY-MM-DD
  period: ReportPeriod;
  wonInPeriod: string; // done deals in the selected period
  targetAmount: string | null;
  attainmentPct: number | null; // won / target, whole percent
  unitsWon: number;
  targetUnits: number | null;
  targetUnitsFrom: string | null; // first month with a unit target, when this month has none (YYYY-MM-01)
  targetUnitsNext: number | null; // that month's unit target
  forecastEndOfPeriod: string; // done + weighted open deals expected to close in the selected period
  weightedOpen: string;
  openAmount: string;
  openDeals: number;
  won90: number;
  lost90: number;
  winRatePct: number | null;
  avgDaysToWin: number | null;
  runRate: { month: string; yearly: string | null; early: boolean }; // monthly pace; yearly = last three full months x 12
};

export type MonthBar = { month: string; amount: string; units: number };
export type StageBar = { key: string; name: string; probability: string; deals: number; amount: string; weighted: string };
export type AttentionRow = {
  dealId: string; name: string; ownerName: string | null; amount: string; reason: "next_step_overdue" | "close_date_passed" | "stale" | "discount";
  severity: number; nextStep: string | null; linesFingerprint: string | null; daysOverdue: number | null; daysStale: number | null;
};
export type RepRow = {
  userId: string; name: string; openDeals: number; openAmount: string; weighted: string; won: string;
  target: string | null; attainmentPct: number | null; units: number; winRatePct: number | null; overdue: number; stale: number;
};

export type CloseBucketKey = "past" | "m0" | "m1" | "m2" | "later" | "none";
export type CloseBucket = { key: CloseBucketKey; month: string | null; deals: number; weighted: string };
export type AdsToCrm = {
  hasData: boolean; // any ad has insights in the last 7 days
  clicks: number; chats: number; logged: number; loggedPct: number | null; missing: number;
  topMissingAd: { name: string; missing: number } | null;
};
export type SkuRow = { productId: string; sku: string; name: string; unitsInPipeline: number; weightedUnits: string; unitsAtPo: number; doneUnitsMonth: number };
export type SourceRow = { source: string; newDeals: number; won: number; wonAmount: string; winRatePct: number | null };
export type DemoEffect = { won: number; closed: number; ratePct: number | null };
export type LostReasonRow = { reason: string; deals: number };

export type Report = {
  kpis: ReportKpis;
  months: MonthBar[];
  monthTarget: string | null;
  stages: StageBar[];
  attention: { rows: AttentionRow[]; total: number };
  reps: RepRow[];
  closeForecast: CloseBucket[];
  adsToCrm: AdsToCrm;
  skus: SkuRow[];
  sources: SourceRow[];
  demo: { with: DemoEffect; without: DemoEffect };
  lostReasons: LostReasonRow[];
};

const total = (ownerId: string | null) => ownerId === null;

export async function getReport(ownerId: string | null, period: ReportPeriod = "month"): Promise<Report> {
  const isTotal = total(ownerId);
  const [kpiRow] = await sql<Record<string, string | number | null>[]>`
    WITH month AS (SELECT date_trunc('month', jakarta_today()::timestamp)::date AS m),
    summary AS (
      SELECT * FROM v_pipeline_summary_by_owner s
       WHERE s.is_total = ${isTotal} AND (${ownerId}::uuid IS NULL OR s.owner_user_id = ${ownerId})),
    done AS (
      SELECT done_amount, units FROM v_done_period_by_owner x
       WHERE x.period = ${period} AND x.is_total = ${isTotal} AND (${ownerId}::uuid IS NULL OR x.owner_user_id = ${ownerId})),
    target AS (
      SELECT t.target_amount, t.target_units FROM v_target_period t
       WHERE t.period = ${period} AND t.user_id IS NOT DISTINCT FROM ${ownerId}::uuid),
    unit_from AS (
      SELECT a.period_month AS m, a.target_units AS u FROM v_target_attainment a, month
       WHERE ${period}::text = 'month' AND a.user_id IS NOT DISTINCT FROM ${ownerId}::uuid AND a.target_units IS NOT NULL AND a.period_month > month.m
       ORDER BY a.period_month LIMIT 1),
    forecast AS (
      SELECT weighted_amount FROM v_forecast_period_by_owner f
       WHERE f.period = ${period} AND f.is_total = ${isTotal} AND (${ownerId}::uuid IS NULL OR f.owner_user_id = ${ownerId})),
    pace AS (
      SELECT * FROM v_run_rate_by_owner r
       WHERE r.is_total = ${isTotal} AND (${ownerId}::uuid IS NULL OR r.owner_user_id = ${ownerId})),
    win AS (
      SELECT * FROM v_win_rate_90d_by_owner w
       WHERE w.is_total = ${isTotal} AND (${ownerId}::uuid IS NULL OR w.owner_user_id = ${ownerId}))
    SELECT jakarta_today()::text AS as_of,
           COALESCE((SELECT done_amount FROM done), 0)::text AS won_in_period,
           (SELECT target_amount FROM target)::text AS target_amount,
           (SELECT CASE WHEN target_amount > 0 THEN ROUND(COALESCE((SELECT done_amount FROM done), 0) * 100 / target_amount) END FROM target)::int AS attainment_pct,
           COALESCE((SELECT units FROM done), 0)::int AS units_won,
           (SELECT target_units FROM target)::int AS target_units,
           (SELECT m FROM unit_from)::text AS target_units_from,
           (SELECT u FROM unit_from)::int AS target_units_next,
           (COALESCE((SELECT done_amount FROM done), 0) + COALESCE((SELECT weighted_amount FROM forecast), 0))::text AS forecast_end,
           COALESCE((SELECT weighted_open_amount FROM summary), 0)::text AS weighted_open,
           COALESCE((SELECT open_amount FROM summary), 0)::text AS open_amount,
           COALESCE((SELECT open_deals FROM summary), 0)::int AS open_deals,
           COALESCE((SELECT won FROM win), 0)::int AS won90,
           COALESCE((SELECT lost FROM win), 0)::int AS lost90,
           (SELECT CASE WHEN won + lost > 0 THEN ROUND(won * 100.0 / (won + lost)) END FROM win)::int AS win_rate_pct,
           (SELECT avg_days_to_win FROM win)::int AS avg_days_to_win,
           COALESCE((SELECT run_rate_month FROM pace), 0)::text AS run_rate_month,
           (SELECT run_rate_year FROM pace)::text AS run_rate_year,
           (SELECT EXTRACT(day FROM jakarta_today()) < 7)::boolean AS run_rate_early`;

  const months = await sql<{ month: string; amount: string; units: number }[]>`
    SELECT m::date::text AS month, COALESCE(d.amount, 0)::text AS amount, COALESCE(d.units, 0)::int AS units
      FROM generate_series(date_trunc('month', jakarta_today()::timestamp) - interval '5 months',
                           date_trunc('month', jakarta_today()::timestamp), interval '1 month') m
      LEFT JOIN v_done_monthly d ON d.period_month = m::date AND d.is_total = ${isTotal}
                                AND (${ownerId}::uuid IS NULL OR d.owner_user_id = ${ownerId})
     ORDER BY m`;

  const stages = await sql<StageBar[]>`
    SELECT s.key, s.name, s.probability::text AS probability,
           COALESCE(v.deals, 0)::int AS deals, COALESCE(v.amount, 0)::text AS amount, COALESCE(v.weighted_amount, 0)::text AS weighted
      FROM pipeline_stages s
      LEFT JOIN v_stage_summary_by_owner v ON v.stage_key = s.key AND v.is_total = ${isTotal}
                                          AND (${ownerId}::uuid IS NULL OR v.owner_user_id = ${ownerId})
     WHERE NOT s.is_won AND NOT s.is_lost
     ORDER BY s.position`;

  const attention = await getAttention(ownerId, 10);

  // Kinerja sales follows the period select: Done, units and target over this month / quarter / year.
  const reps = await sql<RepRow[]>`
    SELECT c.user_id AS "userId", c.full_name AS name, c.open_deals::int AS "openDeals", c.open_amount::text AS "openAmount",
           c.weighted_pipeline::text AS weighted, COALESCE(dp.done_amount, 0)::text AS won, tp.target_amount::text AS target,
           CASE WHEN tp.target_amount > 0 THEN ROUND(COALESCE(dp.done_amount, 0) * 100 / tp.target_amount) END::int AS "attainmentPct",
           COALESCE(dp.units, 0)::int AS units, ROUND(c.win_rate_90d * 100)::int AS "winRatePct",
           c.next_step_overdue::int AS overdue, c.stale_deals::int AS stale
      FROM v_rep_scorecard c
      LEFT JOIN v_done_period_by_owner dp ON dp.period = ${period} AND NOT dp.is_total AND dp.owner_user_id = c.user_id
      LEFT JOIN v_target_period tp ON tp.period = ${period} AND tp.user_id = c.user_id
     WHERE ${ownerId}::uuid IS NULL OR c.user_id = ${ownerId}
     ORDER BY COALESCE(dp.done_amount, 0) DESC, c.full_name`;

  const [monthTarget] = await sql<{ t: string | null }[]>`
    SELECT target_amount::text AS t FROM v_target_attainment
     WHERE user_id IS NOT DISTINCT FROM ${ownerId}::uuid AND period_month = date_trunc('month', jakarta_today()::timestamp)::date`;

  const closeForecast = await sql<{ key: CloseBucketKey; month: string | null; deals: number; weighted: string }[]>`
    SELECT b.key, b.month::text AS month, COALESCE(v.deals, 0)::int AS deals, COALESCE(v.weighted_amount, 0)::text AS weighted
      FROM (SELECT * FROM (VALUES
              ('past', 0, NULL::date),
              ('m0', 1, date_trunc('month', jakarta_today()::timestamp)::date),
              ('m1', 2, (date_trunc('month', jakarta_today()::timestamp) + interval '1 month')::date),
              ('m2', 3, (date_trunc('month', jakarta_today()::timestamp) + interval '2 months')::date),
              ('later', 4, NULL::date),
              ('none', 5, NULL::date)) x(key, ord, month)) b
      LEFT JOIN v_close_forecast_by_owner v ON v.bucket = b.key AND v.is_total = ${isTotal}
                                           AND (${ownerId}::uuid IS NULL OR v.owner_user_id = ${ownerId})
     ORDER BY b.ord`;

  // Ads → CRM, last 7 full days, for the ads of this sales' campaigns (all ads for the total).
  const [ads] = await sql<{ ads: number; clicks: number; chats: number; logged: number; missing: number; pct: number | null; top_ad: string | null; top_missing: number }[]>`
    SELECT ads, link_clicks AS clicks, chats, logged, missing, pct_logged AS pct, top_missing_ad AS top_ad, top_missing
      FROM v_ads_to_crm_7d_by_owner
     WHERE is_total = ${isTotal} AND (${ownerId}::uuid IS NULL OR owner_user_id = ${ownerId})`;
  const adsToCrm: AdsToCrm = {
    hasData: (ads?.ads ?? 0) > 0,
    clicks: ads?.clicks ?? 0,
    chats: ads?.chats ?? 0,
    logged: ads?.logged ?? 0,
    loggedPct: ads?.pct ?? null,
    missing: ads?.missing ?? 0,
    topMissingAd: ads?.top_ad ? { name: ads.top_ad, missing: ads.top_missing } : null,
  };

  const skus = await sql<SkuRow[]>`
    SELECT product_id AS "productId", sku, name, units_in_pipeline AS "unitsInPipeline", weighted_units::text AS "weightedUnits",
           units_at_po AS "unitsAtPo", done_units_month AS "doneUnitsMonth"
      FROM v_sku_demand_by_owner
     WHERE is_total = ${isTotal} AND (${ownerId}::uuid IS NULL OR owner_user_id = ${ownerId})
     ORDER BY weighted_units DESC, units_in_pipeline DESC, name
     LIMIT 14`;

  const sources = await sql<SourceRow[]>`
    SELECT source, new_deals AS "newDeals", won, won_amount::text AS "wonAmount", ROUND(win_rate * 100)::int AS "winRatePct"
      FROM v_sources_by_owner
     WHERE is_total = ${isTotal} AND (${ownerId}::uuid IS NULL OR owner_user_id = ${ownerId})
     ORDER BY new_deals DESC, source`;

  const demoRows = await sql<{ had_demo: boolean; won: number; closed: number }[]>`
    SELECT had_demo, won, closed FROM v_demo_effect_by_owner
     WHERE is_total = ${isTotal} AND (${ownerId}::uuid IS NULL OR owner_user_id = ${ownerId})`;
  const demoOf = (had: boolean): DemoEffect => {
    const r = demoRows.find((x) => x.had_demo === had);
    return { won: r?.won ?? 0, closed: r?.closed ?? 0, ratePct: r && r.closed > 0 ? Math.round((r.won * 100) / r.closed) : null };
  };

  const lostReasons = await sql<LostReasonRow[]>`
    SELECT lost_reason AS reason, deals FROM v_lost_reasons_by_owner
     WHERE is_total = ${isTotal} AND (${ownerId}::uuid IS NULL OR owner_user_id = ${ownerId})
     ORDER BY deals DESC, lost_reason
     LIMIT 6`;

  const k = kpiRow;
  return {
    kpis: {
      asOf: String(k.as_of),
      period,
      wonInPeriod: String(k.won_in_period),
      targetAmount: (k.target_amount as string | null) ?? null,
      attainmentPct: (k.attainment_pct as number | null) ?? null,
      unitsWon: Number(k.units_won),
      targetUnits: (k.target_units as number | null) ?? null,
      targetUnitsFrom: (k.target_units_from as string | null) ?? null,
      targetUnitsNext: (k.target_units_next as number | null) ?? null,
      forecastEndOfPeriod: String(k.forecast_end),
      weightedOpen: String(k.weighted_open),
      openAmount: String(k.open_amount),
      openDeals: Number(k.open_deals),
      won90: Number(k.won90),
      lost90: Number(k.lost90),
      winRatePct: (k.win_rate_pct as number | null) ?? null,
      avgDaysToWin: (k.avg_days_to_win as number | null) ?? null,
      runRate: {
        month: String(k.run_rate_month),
        // the last three full months, averaged and times 12; nothing to say before there is a month of history
        yearly: k.run_rate_year && Number(k.run_rate_year) > 0 ? String(k.run_rate_year) : null,
        early: Boolean(k.run_rate_early),
      },
    },
    months,
    monthTarget: monthTarget?.t ?? null,
    stages,
    attention,
    reps,
    closeForecast,
    adsToCrm,
    skus,
    sources,
    demo: { with: demoOf(true), without: demoOf(false) },
    lostReasons,
  };
}

/** "Perlu perhatian": the most urgent open deals of one sales (null = everyone), and how many there are. */
export async function getAttention(ownerId: string | null, limit: number): Promise<{ rows: AttentionRow[]; total: number }> {
  const rows = await sql<AttentionRow[]>`
    SELECT a.deal_id AS "dealId", a.name, u.full_name AS "ownerName", a.amount::text AS amount, a.reason, a.severity,
           a.next_step AS "nextStep",
           CASE WHEN a.reason = 'discount' THEN ${linesFingerprint("a.deal_id")} END AS "linesFingerprint",
           CASE WHEN a.reason = 'next_step_overdue' THEN (jakarta_today() - a.next_step_date)::int END AS "daysOverdue",
           CASE WHEN a.reason = 'stale' THEN (jakarta_today() - (a.updated_at AT TIME ZONE 'Asia/Jakarta')::date)::int END AS "daysStale"
      FROM v_attention a LEFT JOIN users u ON u.id = a.owner_user_id
     WHERE ${ownerId}::uuid IS NULL OR a.owner_user_id = ${ownerId}
     ORDER BY a.severity, a.amount DESC, a.name
     LIMIT ${limit}`;
  const [{ n }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM v_attention a WHERE ${ownerId}::uuid IS NULL OR a.owner_user_id = ${ownerId}`;
  return { rows, total: n };
}
