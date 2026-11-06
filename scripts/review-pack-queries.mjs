// The queries behind the review pack (T23). Every number in the pack comes from one of these.
// Rules for this file: SELECT only, no imports from app code, no writes. The runner opens a
// read-only transaction, so even a mistake here cannot change data.
//
// Parameters: `$1` = first day, `$2` = last day (both inclusive, Jakarta dates, YYYY-MM-DD).
// A query lists which ones it uses in `params`; a query with `params: []` ignores the period.

const IN_PERIOD = "(l.received_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $1::date AND $2::date";
const BOTH = ["from", "to"];

/** @type {Array<{ id: string, title: string, params: string[], sql: string }>} */
export const QUERIES = [
  {
    id: "leads_by_source",
    title: "Lead masuk per sumber",
    params: BOTH,
    sql: `
SELECT l.source_channel::text AS source,
       (GROUPING(l.source_channel) = 1) AS is_total,
       count(*)::int AS leads
  FROM leads l
 WHERE ${IN_PERIOD}
 GROUP BY GROUPING SETS ((l.source_channel), ())
 ORDER BY is_total, leads DESC, source`,
  },
  {
    id: "leads_by_rep",
    title: "Lead masuk per sales",
    params: BOTH,
    sql: `
SELECT u.full_name AS rep,
       (GROUPING(l.owner_user_id) = 1) AS is_total,
       count(*)::int AS leads,
       count(l.deal_id)::int AS became_deal
  FROM leads l
  LEFT JOIN users u ON u.id = l.owner_user_id
 WHERE ${IN_PERIOD}
 GROUP BY GROUPING SETS ((l.owner_user_id, u.full_name), ())
 ORDER BY is_total, leads DESC, rep`,
  },
  {
    id: "time_to_log",
    title: "Waktu dari chat masuk sampai dicatat di CRM",
    params: BOTH,
    sql: `
SELECT u.full_name AS rep,
       (GROUPING(l.owner_user_id) = 1) AS is_total,
       count(*)::int AS leads,
       ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM l.logged_at - l.received_at) / 60))::numeric, 1) AS median_min,
       ROUND((percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM l.logged_at - l.received_at) / 60))::numeric, 1) AS p90_min,
       count(*) FILTER (WHERE l.logged_at - l.received_at > interval '60 minutes')::int AS over_60min
  FROM leads l
  LEFT JOIN users u ON u.id = l.owner_user_id
 WHERE ${IN_PERIOD}
 GROUP BY GROUPING SETS ((l.owner_user_id, u.full_name), ())
 ORDER BY is_total, leads DESC, rep`,
  },
  {
    id: "stage_conversion",
    title: "Konversi dan lama di tiap tahap (semua deal sejak awal)",
    params: [],
    sql: `
SELECT key, name, position, entered, moved_on, lost_here,
       (entered - moved_on - lost_here)::int AS still_here,
       CASE WHEN moved_on + lost_here > 0
            THEN ROUND(moved_on * 100.0 / (moved_on + lost_here), 1) END AS moved_on_pct,
       median_days_in_stage
  FROM v_stage_conversion
 ORDER BY position`,
  },
  {
    id: "win_rate",
    title: "Win rate (deal yang selesai di periode ini)",
    params: BOTH,
    sql: `
SELECT u.full_name AS rep,
       (GROUPING(d.owner_user_id) = 1) AS is_total,
       count(*) FILTER (WHERE d.is_won)::int AS won,
       count(*) FILTER (WHERE d.is_lost)::int AS lost,
       ROUND(count(*) FILTER (WHERE d.is_won) * 100.0 / NULLIF(count(*), 0), 1) AS win_rate_pct,
       COALESCE(sum(d.amount) FILTER (WHERE d.is_won), 0) AS won_amount
  FROM v_deals_enriched d
  JOIN users u ON u.id = d.owner_user_id
 WHERE (d.is_won OR d.is_lost) AND d.closed_on BETWEEN $1::date AND $2::date
 GROUP BY GROUPING SETS ((d.owner_user_id, u.full_name), ())
 ORDER BY is_total, won DESC, rep`,
  },
  {
    id: "lost_reasons",
    title: "Alasan lost",
    params: BOTH,
    sql: `
SELECT d.lost_reason::text AS reason,
       count(*)::int AS deals,
       COALESCE(sum(d.amount), 0) AS amount,
       ROUND(count(*) * 100.0 / sum(count(*)) OVER (), 1) AS share_pct
  FROM v_deals_enriched d
 WHERE d.is_lost AND d.closed_on BETWEEN $1::date AND $2::date
 GROUP BY d.lost_reason
 ORDER BY deals DESC, reason`,
  },
  {
    id: "discount_summary",
    title: "Diskon: ringkasan",
    params: BOTH,
    sql: `
SELECT count(*) FILTER (WHERE (d.discount_approved_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $1::date AND $2::date)::int AS approved,
       count(*) FILTER (WHERE d.needs_discount_approval AND NOT d.is_lost)::int AS waiting_now,
       count(*) FILTER (WHERE (d.created_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $1::date AND $2::date
                          AND EXISTS (SELECT 1 FROM v_deal_line_discounts x WHERE x.deal_id = d.id AND x.over_limit))::int AS over_limit_deals,
       count(*) FILTER (WHERE (d.created_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $1::date AND $2::date)::int AS deals_created
  FROM v_deals_enriched d`,
  },
  {
    id: "discounts_approved",
    title: "Deal dengan diskon yang disetujui",
    params: BOTH,
    sql: `
SELECT d.name AS deal,
       u.full_name AS rep,
       d.stage_name,
       d.amount,
       (SELECT max(x.discount_pct_vs_msrp) FROM v_deal_line_discounts x WHERE x.deal_id = d.id) AS max_discount_pct,
       (SELECT max(x.max_discount_pct) FROM v_deal_line_discounts x WHERE x.deal_id = d.id) AS limit_pct,
       a.full_name AS approved_by,
       (d.discount_approved_at AT TIME ZONE 'Asia/Jakarta')::date::text AS approved_on
  FROM v_deals_enriched d
  JOIN users u ON u.id = d.owner_user_id
  LEFT JOIN users a ON a.id = d.discount_approved_by
 WHERE (d.discount_approved_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $1::date AND $2::date
 ORDER BY d.discount_approved_at, d.name`,
  },
  {
    id: "ads_capture",
    title: "Iklan ke CRM: berapa chat iklan yang tercatat",
    params: BOTH,
    sql: `
WITH meta AS (
  SELECT COALESCE(sum(meta_conversations), 0)::int AS meta_chats
    FROM ad_insights_daily
   WHERE date BETWEEN $1::date AND $2::date
), crm AS (
  SELECT count(*) FILTER (WHERE l.ad_id IS NOT NULL)::int AS leads_with_ad,
         count(*) FILTER (WHERE l.source_channel = 'meta_ctwa')::int AS ctwa_leads,
         count(*) FILTER (WHERE l.source_channel = 'meta_ctwa' AND l.ad_id IS NULL)::int AS ctwa_without_ad
    FROM leads l
   WHERE ${IN_PERIOD}
)
SELECT meta.meta_chats, crm.leads_with_ad, crm.ctwa_leads, crm.ctwa_without_ad,
       CASE WHEN meta.meta_chats > 0
            THEN ROUND(LEAST(crm.leads_with_ad, meta.meta_chats) * 100.0 / meta.meta_chats, 1) END AS capture_pct
  FROM meta, crm`,
  },
  {
    id: "ads_capture_by_ad",
    title: "Iklan ke CRM per iklan (10 yang paling banyak belum tercatat)",
    params: BOTH,
    sql: `
SELECT a.name AS ad_name,
       a.prefill_code AS ad_code,
       COALESCE(i.chats, 0)::int AS meta_chats,
       COALESCE(l.leads, 0)::int AS leads_with_ad,
       GREATEST(COALESCE(i.chats, 0) - COALESCE(l.leads, 0), 0)::int AS missing
  FROM ads a
  LEFT JOIN (SELECT ad_id, sum(meta_conversations) AS chats
               FROM ad_insights_daily
              WHERE date BETWEEN $1::date AND $2::date
              GROUP BY ad_id) i ON i.ad_id = a.id
  LEFT JOIN (SELECT l.ad_id, count(*) AS leads
               FROM leads l
              WHERE l.ad_id IS NOT NULL AND ${IN_PERIOD}
              GROUP BY l.ad_id) l ON l.ad_id = a.id
 WHERE i.ad_id IS NOT NULL OR l.ad_id IS NOT NULL
 ORDER BY missing DESC, ad_name
 LIMIT 10`,
  },
  {
    id: "targets",
    title: "Target unit dan Rupiah per bulan (bulan penuh)",
    params: BOTH,
    sql: `
SELECT t.period_month::text AS month,
       u.full_name AS rep,
       (t.user_id IS NULL) AS is_company,
       ((t.period_month + interval '1 month')::date <= jakarta_today()) AS month_over,
       t.target_units,
       t.units_won::int AS units_won,
       CASE WHEN t.target_units > 0 THEN ROUND(t.units_won * 100.0 / t.target_units, 1) END AS units_pct,
       t.target_amount,
       t.amount_won,
       CASE WHEN t.target_amount > 0 THEN ROUND(t.amount_won * 100.0 / t.target_amount, 1) END AS amount_pct
  FROM v_target_attainment t
  LEFT JOIN users u ON u.id = t.user_id
 WHERE t.period_month BETWEEN date_trunc('month', $1::date)::date AND date_trunc('month', $2::date)::date
 ORDER BY t.period_month, (t.user_id IS NOT NULL), u.full_name`,
  },
  {
    id: "stage_outcomes",
    title: "Peluang tahap: hasil akhir deal yang pernah lewat tiap tahap",
    params: [],
    sql: `
SELECT s.key, s.name, s.position, s.probability, s.stale_after_days,
       count(DISTINCT h.deal_id)::int AS entered,
       count(DISTINCT h.deal_id) FILTER (WHERE cs.is_won)::int AS later_won,
       count(DISTINCT h.deal_id) FILTER (WHERE cs.is_lost)::int AS later_lost,
       count(DISTINCT h.deal_id) FILTER (WHERE cs.is_won OR cs.is_lost)::int AS closed,
       ROUND(count(DISTINCT h.deal_id) FILTER (WHERE cs.is_won) * 100.0
             / NULLIF(count(DISTINCT h.deal_id) FILTER (WHERE cs.is_won OR cs.is_lost), 0), 1) AS win_pct_of_closed
  FROM pipeline_stages s
  LEFT JOIN deal_stage_history h ON h.to_stage_id = s.id
  LEFT JOIN deals d ON d.id = h.deal_id
  LEFT JOIN pipeline_stages cs ON cs.id = d.stage_id
 WHERE NOT s.is_won AND NOT s.is_lost
 GROUP BY s.id, s.key, s.name, s.position, s.probability, s.stale_after_days
 ORDER BY s.position`,
  },
  {
    id: "stale_by_stage",
    title: "Deal terbuka dan yang sudah lewat batas hari per tahap",
    params: [],
    sql: `
SELECT s.key, s.name, s.stale_after_days,
       count(d.id)::int AS open_deals,
       count(d.id) FILTER (WHERE d.is_stale)::int AS stale_deals
  FROM pipeline_stages s
  LEFT JOIN v_deals_enriched d ON d.stage_id = s.id
 WHERE NOT s.is_won AND NOT s.is_lost
 GROUP BY s.id, s.key, s.name, s.stale_after_days, s.position
 ORDER BY s.position`,
  },
  {
    id: "rule_settings",
    title: "Aturan yang berlaku sekarang",
    params: [],
    sql: `
SELECT key, (value #>> '{}') AS value
  FROM app_settings
 WHERE key IN ('max_discount_pct', 'followup_days', 'project_min_units', 'project_min_amount')
 ORDER BY key`,
  },
];

/** True when the text is a single read-only statement (SELECT, or WITH ... SELECT). */
export function isReadOnlySql(text) {
  const body = text.trim().replace(/;\s*$/, "");
  if (body.includes(";")) return false;
  if (!/^(select|with)\b/i.test(body)) return false;
  return !/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|do|set|reset|vacuum|refresh)\b/i.test(
    body.replace(/'[^']*'/g, "''"),
  );
}

/** Parameter values for one query, in the order of its `params`. */
function valuesFor(query, period) {
  return query.params.map((name) => period[name]);
}

/**
 * Runs every query inside ONE read-only transaction, so all numbers describe the same moment.
 * `sql` is a postgres.js client. Returns { [id]: rows }.
 */
export async function runQueries(sql, period, queries = QUERIES) {
  for (const q of queries) {
    if (!isReadOnlySql(q.sql)) throw new Error(`query ${q.id} is not a single SELECT`);
  }
  return sql.begin("read only", async (tx) => {
    await tx`SET LOCAL statement_timeout = '60s'`;
    const out = {};
    for (const q of queries) {
      out[q.id] = await tx.unsafe(q.sql, valuesFor(q, period));
    }
    return out;
  });
}

/** YYYY-MM-DD check (a real calendar day). */
export function isDay(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
