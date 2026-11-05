import { sql } from "@/lib/db";

// Numbers for /laporan. Every figure comes from a SQL view (CLAUDE.md rule 5); this file only picks rows.
// `ownerId` null = all sales (the total row of each view), otherwise one person's row.

export type ReportKpis = {
  asOf: string; // Jakarta date, YYYY-MM-DD
  wonThisMonth: string;
  targetAmount: string | null;
  attainmentPct: number | null; // won / target, whole percent
  unitsWon: number;
  targetUnits: number | null;
  targetUnitsFrom: string | null; // first month with a unit target, when this month has none (YYYY-MM-01)
  targetUnitsNext: number | null; // that month's unit target
  forecastEndOfMonth: string; // done + weighted open deals closing this month
  weightedOpen: string;
  openAmount: string;
  openDeals: number;
  won90: number;
  lost90: number;
  winRatePct: number | null;
  avgDaysToWin: number | null;
};

export type MonthBar = { month: string; amount: string; units: number };
export type StageBar = { key: string; name: string; probability: string; deals: number; amount: string; weighted: string };
export type AttentionRow = {
  dealId: string; name: string; ownerName: string | null; amount: string; reason: "next_step_overdue" | "close_date_passed" | "stale" | "discount";
  severity: number; nextStep: string | null; daysOverdue: number | null; daysStale: number | null;
};
export type RepRow = {
  userId: string; name: string; openDeals: number; openAmount: string; weighted: string; won: string;
  target: string | null; attainmentPct: number | null; units: number; winRatePct: number | null; overdue: number; stale: number;
};

export type Report = {
  kpis: ReportKpis;
  months: MonthBar[];
  monthTarget: string | null;
  stages: StageBar[];
  attention: { rows: AttentionRow[]; total: number };
  reps: RepRow[];
};

const total = (ownerId: string | null) => ownerId === null;

export async function getReport(ownerId: string | null): Promise<Report> {
  const isTotal = total(ownerId);
  const [kpiRow] = await sql<Record<string, string | number | null>[]>`
    WITH month AS (SELECT date_trunc('month', jakarta_today()::timestamp)::date AS m),
    summary AS (
      SELECT * FROM v_pipeline_summary_by_owner s
       WHERE s.is_total = ${isTotal} AND (${ownerId}::uuid IS NULL OR s.owner_user_id = ${ownerId})),
    target AS (
      SELECT a.target_amount, a.target_units FROM v_target_attainment a, month
       WHERE a.user_id IS NOT DISTINCT FROM ${ownerId}::uuid AND a.period_month = month.m),
    unit_from AS (
      SELECT a.period_month AS m, a.target_units AS u FROM v_target_attainment a, month
       WHERE a.user_id IS NOT DISTINCT FROM ${ownerId}::uuid AND a.target_units IS NOT NULL AND a.period_month > month.m
       ORDER BY a.period_month LIMIT 1),
    forecast AS (
      SELECT weighted_amount FROM v_forecast_month_by_owner f
       WHERE f.is_total = ${isTotal} AND (${ownerId}::uuid IS NULL OR f.owner_user_id = ${ownerId})),
    win AS (
      SELECT * FROM v_win_rate_90d_by_owner w
       WHERE w.is_total = ${isTotal} AND (${ownerId}::uuid IS NULL OR w.owner_user_id = ${ownerId}))
    SELECT jakarta_today()::text AS as_of,
           COALESCE((SELECT won_this_month FROM summary), 0)::text AS won_this_month,
           (SELECT target_amount FROM target)::text AS target_amount,
           (SELECT CASE WHEN target_amount > 0 THEN ROUND((SELECT won_this_month FROM summary) * 100 / target_amount) END FROM target)::int AS attainment_pct,
           COALESCE((SELECT units_won_this_month FROM summary), 0)::int AS units_won,
           (SELECT target_units FROM target)::int AS target_units,
           (SELECT m FROM unit_from)::text AS target_units_from,
           (SELECT u FROM unit_from)::int AS target_units_next,
           (COALESCE((SELECT won_this_month FROM summary), 0) + COALESCE((SELECT weighted_amount FROM forecast), 0))::text AS forecast_end,
           COALESCE((SELECT weighted_open_amount FROM summary), 0)::text AS weighted_open,
           COALESCE((SELECT open_amount FROM summary), 0)::text AS open_amount,
           COALESCE((SELECT open_deals FROM summary), 0)::int AS open_deals,
           COALESCE((SELECT won FROM win), 0)::int AS won90,
           COALESCE((SELECT lost FROM win), 0)::int AS lost90,
           (SELECT CASE WHEN won + lost > 0 THEN ROUND(won * 100.0 / (won + lost)) END FROM win)::int AS win_rate_pct,
           (SELECT avg_days_to_win FROM win)::int AS avg_days_to_win`;

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

  const attentionRows = await sql<AttentionRow[]>`
    SELECT a.deal_id AS "dealId", a.name, u.full_name AS "ownerName", a.amount::text AS amount, a.reason, a.severity,
           a.next_step AS "nextStep",
           CASE WHEN a.reason = 'next_step_overdue' THEN (jakarta_today() - a.next_step_date)::int END AS "daysOverdue",
           CASE WHEN a.reason = 'stale' THEN (jakarta_today() - (a.updated_at AT TIME ZONE 'Asia/Jakarta')::date)::int END AS "daysStale"
      FROM v_attention a LEFT JOIN users u ON u.id = a.owner_user_id
     WHERE ${ownerId}::uuid IS NULL OR a.owner_user_id = ${ownerId}
     ORDER BY a.severity, a.amount DESC, a.name
     LIMIT 10`;
  const [{ n }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM v_attention a WHERE ${ownerId}::uuid IS NULL OR a.owner_user_id = ${ownerId}`;

  const reps = await sql<RepRow[]>`
    SELECT c.user_id AS "userId", c.full_name AS name, c.open_deals::int AS "openDeals", c.open_amount::text AS "openAmount",
           c.weighted_pipeline::text AS weighted, c.won_this_month::text AS won, c.target_this_month::text AS target,
           CASE WHEN c.target_this_month > 0 THEN ROUND(c.won_this_month * 100 / c.target_this_month) END::int AS "attainmentPct",
           c.units_won_this_month::int AS units, ROUND(c.win_rate_90d * 100)::int AS "winRatePct",
           c.next_step_overdue::int AS overdue, c.stale_deals::int AS stale
      FROM v_rep_scorecard c
     WHERE ${ownerId}::uuid IS NULL OR c.user_id = ${ownerId}
     ORDER BY c.won_this_month DESC, c.full_name`;

  const [monthTarget] = await sql<{ t: string | null }[]>`
    SELECT target_amount::text AS t FROM v_target_attainment
     WHERE user_id IS NOT DISTINCT FROM ${ownerId}::uuid AND period_month = date_trunc('month', jakarta_today()::timestamp)::date`;

  const k = kpiRow;
  return {
    kpis: {
      asOf: String(k.as_of),
      wonThisMonth: String(k.won_this_month),
      targetAmount: (k.target_amount as string | null) ?? null,
      attainmentPct: (k.attainment_pct as number | null) ?? null,
      unitsWon: Number(k.units_won),
      targetUnits: (k.target_units as number | null) ?? null,
      targetUnitsFrom: (k.target_units_from as string | null) ?? null,
      targetUnitsNext: (k.target_units_next as number | null) ?? null,
      forecastEndOfMonth: String(k.forecast_end),
      weightedOpen: String(k.weighted_open),
      openAmount: String(k.open_amount),
      openDeals: Number(k.open_deals),
      won90: Number(k.won90),
      lost90: Number(k.lost90),
      winRatePct: (k.win_rate_pct as number | null) ?? null,
      avgDaysToWin: (k.avg_days_to_win as number | null) ?? null,
    },
    months,
    monthTarget: monthTarget?.t ?? null,
    stages,
    attention: { rows: attentionRows, total: n },
    reps,
  };
}
