import { sql } from "@/lib/db";
import { type AttentionRow, getAttention } from "@/lib/reports";

// Beranda: a few figures and the deals that need action today, for one sales (null = everyone).

export type Home = {
  wonThisMonth: string;
  target: string | null;
  attainmentPct: number | null;
  weightedOpen: string;
  openDeals: number;
  overdue: number;
  attention: { rows: AttentionRow[]; total: number };
};

export async function getHome(ownerId: string | null): Promise<Home> {
  const isTotal = ownerId === null;
  const [[k], attention] = await Promise.all([
    sql<{ won: string; target: string | null; pct: number | null; weighted: string; open: number; overdue: number }[]>`
      WITH s AS (SELECT * FROM v_pipeline_summary_by_owner x
                  WHERE x.is_total = ${isTotal} AND (${ownerId}::uuid IS NULL OR x.owner_user_id = ${ownerId})),
           t AS (SELECT target_amount FROM v_target_attainment
                  WHERE user_id IS NOT DISTINCT FROM ${ownerId}::uuid AND period_month = date_trunc('month', jakarta_today()::timestamp)::date)
      SELECT COALESCE((SELECT won_this_month FROM s), 0)::text AS won,
             (SELECT target_amount FROM t)::text AS target,
             (SELECT CASE WHEN target_amount > 0 THEN ROUND(COALESCE((SELECT won_this_month FROM s), 0) * 100 / target_amount) END FROM t)::int AS pct,
             COALESCE((SELECT weighted_open_amount FROM s), 0)::text AS weighted,
             COALESCE((SELECT open_deals FROM s), 0)::int AS open,
             COALESCE((SELECT next_step_overdue FROM s), 0)::int AS overdue`,
    getAttention(ownerId, 6),
  ]);
  return {
    wonThisMonth: k.won,
    target: k.target,
    attainmentPct: k.pct,
    weightedOpen: k.weighted,
    openDeals: k.open,
    overdue: k.overdue,
    attention,
  };
}

/** Selamat pagi / siang / sore / malam by the hour in Jakarta. */
export function greetingKey(now: Date = new Date()): "morning" | "noon" | "afternoon" | "evening" {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Jakarta" }).format(now));
  if (h < 11) return "morning";
  if (h < 15) return "noon";
  if (h < 18) return "afternoon";
  return "evening";
}
