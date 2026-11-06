// The queries behind the review pack (T23). Every number in the pack comes from one of these.
// Rules for this file: SELECT only, no imports from app code, no writes. The runner opens a
// read-only transaction, so even a mistake here cannot change data.
//
// Parameters: `$1` = first day, `$2` = last day (both inclusive, Jakarta dates, YYYY-MM-DD),
// `$3` = include sample rows (false in real use). A query lists the ones it uses in `params`, in order
// ($1, $2, ...), so a query without a period starts with the sample flag as `$1`.
// Sample rows (is_sample = true: demo and training data) are left out of EVERY number unless the flag is set.
// The views v_stage_conversion and v_target_attainment have no sample filter, so those two numbers are
// rebuilt here from deals / deal_stage_history / deal_line_items (rule 5 allows a view-equivalent query).

const IN_PERIOD = "(l.received_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $1::date AND $2::date";
const BOTH = ["from", "to", "sample"]; // $1, $2, $3
const SAMPLE_ONLY = ["sample"]; // $1

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
 WHERE ${IN_PERIOD} AND (NOT l.is_sample OR $3::boolean)
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
 WHERE ${IN_PERIOD} AND (NOT l.is_sample OR $3::boolean)
 GROUP BY GROUPING SETS ((l.owner_user_id, u.full_name), ())
 ORDER BY is_total, leads DESC, rep`,
  },
  {
    id: "time_to_log",
    title: "Waktu dari chat masuk sampai dicatat di CRM (hanya yang dicatat manual)",
    params: BOTH,
    // Only leads a rep typed in by hand (quick-add). Web form, WA link and API leads are logged by the system
    // within seconds, and imports carry old dates, so mixing them in would make the delay look better or worse than it is.
    sql: `
SELECT u.full_name AS rep,
       (GROUPING(l.owner_user_id) = 1) AS is_total,
       count(*)::int AS leads,
       ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM l.logged_at - l.received_at) / 60))::numeric, 1) AS median_min,
       ROUND((percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM l.logged_at - l.received_at) / 60))::numeric, 1) AS p90_min,
       count(*) FILTER (WHERE l.logged_at - l.received_at > interval '60 minutes')::int AS over_60min
  FROM leads l
  LEFT JOIN users u ON u.id = l.owner_user_id
 WHERE ${IN_PERIOD} AND (NOT l.is_sample OR $3::boolean)
   AND l.capture_method = 'manual_quick_add'
 GROUP BY GROUPING SETS ((l.owner_user_id, u.full_name), ())
 ORDER BY is_total, leads DESC, rep`,
  },
  {
    id: "stage_conversion",
    title: "Konversi dan lama di tiap tahap (semua deal sejak awal, tanpa data contoh)",
    params: SAMPLE_ONLY,
    // Like v_stage_conversion, but: sample deals are left out, each deal counts once per stage (a deal that
    // comes back to a stage is not counted twice) and a move backwards is its own column, not "lanjut".
    // Each deal that entered a stage ends in exactly one bucket: still_here (it is there now) > moved_on >
    // lost_here > moved_back, so entered = moved_on + lost_here + still_here + moved_back.
    sql: `
WITH moves AS (
  SELECT h.deal_id, h.to_stage_id, h.changed_at,
         LEAD(h.changed_at)   OVER w AS left_at,
         LEAD(h.to_stage_id)  OVER w AS next_stage_id
    FROM deal_stage_history h
    JOIN deals d ON d.id = h.deal_id
   WHERE (NOT d.is_sample OR $1::boolean)
  WINDOW w AS (PARTITION BY h.deal_id ORDER BY h.changed_at, h.id)
), visits AS (
  SELECT s.id AS stage_id, m.deal_id, m.changed_at, m.left_at,
         (ns.id IS NOT NULL AND NOT ns.is_lost AND ns.position > s.position) AS went_on,
         COALESCE(ns.is_lost, false) AS went_lost,
         (ns.id IS NOT NULL AND NOT ns.is_lost AND ns.position <= s.position) AS went_back,
         (ns.id IS NULL) AS is_current
    FROM moves m
    JOIN pipeline_stages s ON s.id = m.to_stage_id AND NOT s.is_won AND NOT s.is_lost
    LEFT JOIN pipeline_stages ns ON ns.id = m.next_stage_id
), per_deal AS (
  SELECT stage_id, deal_id,
         bool_or(went_on) AS went_on, bool_or(went_lost) AS went_lost,
         bool_or(is_current) AS is_current, bool_or(went_back) AS went_back
    FROM visits
   GROUP BY stage_id, deal_id
), outcome AS (
  SELECT stage_id,
         count(*)::int AS entered,
         count(*) FILTER (WHERE NOT is_current AND went_on)::int AS moved_on,
         count(*) FILTER (WHERE NOT is_current AND NOT went_on AND went_lost)::int AS lost_here,
         count(*) FILTER (WHERE is_current)::int AS still_here,
         count(*) FILTER (WHERE NOT is_current AND NOT went_on AND NOT went_lost)::int AS moved_back
    FROM per_deal
   GROUP BY stage_id
), timing AS (
  SELECT stage_id,
         count(*)::int AS finished_visits,
         ROUND((percentile_cont(0.5)  WITHIN GROUP (ORDER BY extract(epoch FROM left_at - changed_at) / 86400))::numeric, 1) AS median_days_in_stage,
         ROUND((percentile_cont(0.75) WITHIN GROUP (ORDER BY extract(epoch FROM left_at - changed_at) / 86400))::numeric, 1) AS p75_days_in_stage,
         ROUND((percentile_cont(0.9)  WITHIN GROUP (ORDER BY extract(epoch FROM left_at - changed_at) / 86400))::numeric, 1) AS p90_days_in_stage
    FROM visits
   WHERE left_at IS NOT NULL
   GROUP BY stage_id
)
SELECT s.key, s.name, s.position,
       COALESCE(o.entered, 0) AS entered,
       COALESCE(o.moved_on, 0) AS moved_on,
       COALESCE(o.lost_here, 0) AS lost_here,
       COALESCE(o.moved_back, 0) AS moved_back,
       COALESCE(o.still_here, 0) AS still_here,
       CASE WHEN COALESCE(o.moved_on, 0) + COALESCE(o.lost_here, 0) + COALESCE(o.moved_back, 0) > 0
            THEN ROUND(o.moved_on * 100.0 / (o.moved_on + o.lost_here + o.moved_back), 1) END AS moved_on_pct,
       COALESCE(t.finished_visits, 0) AS finished_visits,
       t.median_days_in_stage, t.p75_days_in_stage, t.p90_days_in_stage
  FROM pipeline_stages s
  LEFT JOIN outcome o ON o.stage_id = s.id
  LEFT JOIN timing t ON t.stage_id = s.id
 WHERE NOT s.is_won AND NOT s.is_lost
 ORDER BY s.position`,
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
       count(*)::int AS closed,
       ROUND(count(*) FILTER (WHERE d.is_won) * 100.0 / NULLIF(count(*), 0), 1) AS win_rate_pct,
       COALESCE(sum(d.amount) FILTER (WHERE d.is_won), 0) AS won_amount
  FROM v_deals_enriched d
  JOIN deals sd ON sd.id = d.id
  LEFT JOIN users u ON u.id = d.owner_user_id
 WHERE (d.is_won OR d.is_lost) AND d.closed_on BETWEEN $1::date AND $2::date
   AND (NOT sd.is_sample OR $3::boolean)
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
  JOIN deals sd ON sd.id = d.id
 WHERE d.is_lost AND d.closed_on BETWEEN $1::date AND $2::date
   AND (NOT sd.is_sample OR $3::boolean)
 GROUP BY d.lost_reason
 ORDER BY deals DESC, reason`,
  },
  {
    id: "discount_summary",
    title: "Diskon: ringkasan",
    params: BOTH,
    // Two different groups on purpose: "approved" is by the approval date, "over_limit_deals" is of the deals
    // CREATED in the period. The pack labels them separately.
    sql: `
SELECT count(*) FILTER (WHERE (d.discount_approved_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $1::date AND $2::date)::int AS approved,
       count(*) FILTER (WHERE d.needs_discount_approval AND NOT d.is_lost)::int AS waiting_now,
       count(*) FILTER (WHERE (d.created_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $1::date AND $2::date
                          AND EXISTS (SELECT 1 FROM v_deal_line_discounts x WHERE x.deal_id = d.id AND x.over_limit))::int AS over_limit_deals,
       count(*) FILTER (WHERE (d.created_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $1::date AND $2::date)::int AS deals_created
  FROM v_deals_enriched d
  JOIN deals sd ON sd.id = d.id
 WHERE (NOT sd.is_sample OR $3::boolean)`,
  },
  {
    id: "discounts_approved",
    title: "Deal dengan diskon yang disetujui (menurut tanggal persetujuan)",
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
  JOIN deals sd ON sd.id = d.id
  LEFT JOIN users u ON u.id = d.owner_user_id
  LEFT JOIN users a ON a.id = d.discount_approved_by
 WHERE (d.discount_approved_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN $1::date AND $2::date
   AND (NOT sd.is_sample OR $3::boolean)
 ORDER BY d.discount_approved_at, d.name`,
  },
  {
    id: "ads_capture",
    title: "Iklan ke CRM: berapa chat iklan yang tercatat",
    params: BOTH,
    // Both sides are Meta click-to-WhatsApp: Meta's conversations on one side, CRM leads from meta_ctwa on the other.
    // The ratio is NOT capped: above 100% means the two sides do not describe the same chats (shown as a warning).
    sql: `
WITH meta AS (
  SELECT COALESCE(sum(meta_conversations), 0)::int AS meta_chats
    FROM ad_insights_daily
   WHERE date BETWEEN $1::date AND $2::date
), crm AS (
  SELECT count(*) FILTER (WHERE l.ad_id IS NOT NULL)::int AS leads_with_ad,
         count(*)::int AS ctwa_leads,
         count(*) FILTER (WHERE l.ad_id IS NULL)::int AS ctwa_without_ad
    FROM leads l
   WHERE ${IN_PERIOD} AND (NOT l.is_sample OR $3::boolean)
     AND l.source_channel = 'meta_ctwa'
)
SELECT meta.meta_chats, crm.leads_with_ad, crm.ctwa_leads, crm.ctwa_without_ad,
       CASE WHEN meta.meta_chats > 0
            THEN ROUND(crm.leads_with_ad * 100.0 / meta.meta_chats, 1) END AS capture_pct,
       (meta.meta_chats > 0 AND crm.leads_with_ad > meta.meta_chats) AS over_100
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
              WHERE l.ad_id IS NOT NULL AND l.source_channel = 'meta_ctwa'
                AND ${IN_PERIOD} AND (NOT l.is_sample OR $3::boolean)
              GROUP BY l.ad_id) l ON l.ad_id = a.id
 WHERE i.ad_id IS NOT NULL OR l.ad_id IS NOT NULL
 ORDER BY missing DESC, ad_name
 LIMIT 10`,
  },
  {
    id: "targets",
    title: "Target unit dan Rupiah per bulan (bulan penuh di dalam periode)",
    params: BOTH,
    // Built from deals (not v_target_attainment, which has no sample filter). `full_month` = the whole calendar
    // month lies inside [from, to]; only those months feed proposals. For a month only partly inside the period
    // (the pilot starts on the 11th), results count only closed_on inside the period and the row says "sebagian".
    sql: `
SELECT t.period_month::text AS month,
       u.full_name AS rep,
       (t.user_id IS NULL) AS is_company,
       (t.period_month >= $1::date
        AND (t.period_month + interval '1 month' - interval '1 day')::date <= $2::date) AS full_month,
       t.target_units,
       won.units::int AS units_won,
       CASE WHEN t.target_units > 0 THEN ROUND(won.units * 100.0 / t.target_units, 1) END AS units_pct,
       t.target_amount,
       won.amount AS amount_won,
       CASE WHEN t.target_amount > 0 THEN ROUND(won.amount * 100.0 / t.target_amount, 1) END AS amount_pct
  FROM sales_targets t
  LEFT JOIN users u ON u.id = t.user_id
  CROSS JOIN LATERAL (
    SELECT COALESCE((SELECT sum(d.amount)
                       FROM deals d JOIN pipeline_stages s ON s.id = d.stage_id AND s.is_won
                      WHERE date_trunc('month', d.closed_on)::date = t.period_month
                        AND d.closed_on BETWEEN $1::date AND $2::date
                        AND (t.user_id IS NULL OR d.owner_user_id = t.user_id)
                        AND (NOT d.is_sample OR $3::boolean)), 0) AS amount,
           COALESCE((SELECT sum(li.qty)
                       FROM deals d
                       JOIN pipeline_stages s ON s.id = d.stage_id AND s.is_won
                       JOIN deal_line_items li ON li.deal_id = d.id
                       JOIN products p ON p.id = li.product_id AND p.counts_as_screen
                      WHERE date_trunc('month', d.closed_on)::date = t.period_month
                        AND d.closed_on BETWEEN $1::date AND $2::date
                        AND (t.user_id IS NULL OR d.owner_user_id = t.user_id)
                        AND (NOT d.is_sample OR $3::boolean)), 0) AS units
  ) won
 WHERE t.period_month BETWEEN date_trunc('month', $1::date)::date AND date_trunc('month', $2::date)::date
 ORDER BY t.period_month, (t.user_id IS NOT NULL), u.full_name`,
  },
  {
    id: "stage_outcomes",
    title: "Peluang tahap: hasil akhir deal yang pernah lewat tiap tahap",
    params: SAMPLE_ONLY,
    sql: `
SELECT s.key, s.name, s.position, s.probability, s.stale_after_days,
       count(DISTINCT d.id)::int AS entered,
       count(DISTINCT d.id) FILTER (WHERE cs.is_won)::int AS later_won,
       count(DISTINCT d.id) FILTER (WHERE cs.is_lost)::int AS later_lost,
       count(DISTINCT d.id) FILTER (WHERE cs.is_won OR cs.is_lost)::int AS closed,
       count(DISTINCT d.id) FILTER (WHERE NOT cs.is_won AND NOT cs.is_lost)::int AS still_open,
       ROUND(count(DISTINCT d.id) FILTER (WHERE cs.is_won) * 100.0
             / NULLIF(count(DISTINCT d.id) FILTER (WHERE cs.is_won OR cs.is_lost), 0), 1) AS win_pct_of_closed
  FROM pipeline_stages s
  LEFT JOIN deal_stage_history h ON h.to_stage_id = s.id
  LEFT JOIN deals d ON d.id = h.deal_id AND (NOT d.is_sample OR $1::boolean)
  LEFT JOIN pipeline_stages cs ON cs.id = d.stage_id
 WHERE NOT s.is_won AND NOT s.is_lost
 GROUP BY s.id, s.key, s.name, s.position, s.probability, s.stale_after_days
 ORDER BY s.position`,
  },
  {
    id: "stale_by_stage",
    title: "Deal terbuka dan yang sudah lewat batas hari per tahap",
    params: SAMPLE_ONLY,
    sql: `
SELECT s.key, s.name, s.stale_after_days,
       count(d.id)::int AS open_deals,
       count(d.id) FILTER (WHERE d.is_stale)::int AS stale_deals
  FROM pipeline_stages s
  LEFT JOIN (SELECT e.id, e.stage_id, e.is_stale
               FROM v_deals_enriched e JOIN deals sd ON sd.id = e.id
              WHERE (NOT sd.is_sample OR $1::boolean)) d ON d.stage_id = s.id
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
  return !/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|do|set|reset|vacuum|refresh|into)\b/i.test(
    body.replace(/'[^']*'/g, "''"),
  );
}

/** Parameter values for one query, in the order of its `params`. */
function valuesFor(query, period) {
  return query.params.map((name) => (name === "sample" ? Boolean(period.includeSample) : period[name]));
}

/**
 * Runs every query inside ONE read-only transaction, so all numbers describe the same moment.
 * `sql` is a postgres.js client. `period` = { from, to, includeSample? }. Returns { [id]: rows }.
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
