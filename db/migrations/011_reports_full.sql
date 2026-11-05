-- 011 · Laporan lengkap (5 Nov 2026)
-- Views for the rest of /laporan. Like 010, one row per owner plus one total row (is_total), so a sales rep
-- sees only their own numbers and the page never adds numbers up itself.

-- Run rate: what this month would end at if the pace so far continued, and the last three full months.
CREATE VIEW v_run_rate_by_owner AS
WITH m AS (
  SELECT date_trunc('month', jakarta_today()::timestamp)::date AS start,
         EXTRACT(day FROM jakarta_today())::int AS day_of_month,
         EXTRACT(day FROM (date_trunc('month', jakarta_today()::timestamp) + interval '1 month - 1 day'))::int AS days_in_month)
SELECT d.owner_user_id, d.is_total,
       m.day_of_month, m.days_in_month,
       COALESCE(sum(d.amount) FILTER (WHERE d.period_month = m.start), 0) AS done_month,
       ROUND(COALESCE(sum(d.amount) FILTER (WHERE d.period_month = m.start), 0) * m.days_in_month / m.day_of_month) AS run_rate_month,
       COALESCE(sum(d.amount) FILTER (WHERE d.period_month >= (m.start - interval '3 months')::date AND d.period_month < m.start), 0) AS last3_amount,
       -- the last three full months, averaged and times 12
       COALESCE(sum(d.amount) FILTER (WHERE d.period_month >= (m.start - interval '3 months')::date AND d.period_month < m.start), 0) * 4 AS run_rate_year
  FROM v_done_monthly d, m
 GROUP BY d.owner_user_id, d.is_total, m.day_of_month, m.days_in_month;

-- Done deal and unit target for the current month, quarter and year (period = 'month' | 'quarter' | 'year').
CREATE VIEW v_done_period_by_owner AS
SELECT p.period, d.owner_user_id, d.is_total,
       COALESCE(sum(d.amount), 0) AS done_amount,
       COALESCE(sum(d.units), 0)::int AS units,
       COALESCE(sum(d.deals), 0)::int AS deals
  FROM (VALUES ('month'), ('quarter'), ('year')) p(period)
  JOIN v_done_monthly d ON date_trunc(p.period, d.period_month::timestamp) = date_trunc(p.period, jakarta_today()::timestamp)
 GROUP BY p.period, d.owner_user_id, d.is_total;

-- Targets summed over the months that have one inside the period. user_id NULL is the company target.
CREATE VIEW v_target_period AS
SELECT p.period, t.user_id,
       sum(t.target_amount) AS target_amount,
       sum(t.target_units)::int AS target_units
  FROM (VALUES ('month'), ('quarter'), ('year')) p(period)
  JOIN sales_targets t ON date_trunc(p.period, t.period_month::timestamp) = date_trunc(p.period, jakarta_today()::timestamp)
 GROUP BY p.period, t.user_id;

-- Weighted value of open deals expected to close inside the period.
CREATE VIEW v_forecast_period_by_owner AS
SELECT p.period, d.owner_user_id,
       (GROUPING(d.owner_user_id) = 1) AS is_total,
       COALESCE(sum(d.weighted_amount), 0) AS weighted_amount
  FROM (VALUES ('month'), ('quarter'), ('year')) p(period)
  JOIN v_deals_enriched d ON NOT d.is_won AND NOT d.is_lost
   AND date_trunc(p.period, d.expected_close_date::timestamp) = date_trunc(p.period, jakarta_today()::timestamp)
 GROUP BY GROUPING SETS ((p.period, d.owner_user_id), (p.period));

-- Open deals by expected close month: past (before today), this month, +1, +2, later, none.
CREATE VIEW v_close_forecast_by_owner AS
WITH b AS (
  SELECT d.owner_user_id, d.weighted_amount, d.amount,
         CASE WHEN d.expected_close_date IS NULL THEN 'none'
              WHEN d.expected_close_date < jakarta_today() THEN 'past'
              WHEN date_trunc('month', d.expected_close_date::timestamp) = date_trunc('month', jakarta_today()::timestamp) THEN 'm0'
              WHEN date_trunc('month', d.expected_close_date::timestamp) = date_trunc('month', jakarta_today()::timestamp) + interval '1 month' THEN 'm1'
              WHEN date_trunc('month', d.expected_close_date::timestamp) = date_trunc('month', jakarta_today()::timestamp) + interval '2 months' THEN 'm2'
              ELSE 'later' END AS bucket
    FROM v_deals_enriched d
   WHERE NOT d.is_won AND NOT d.is_lost)
SELECT owner_user_id, (GROUPING(owner_user_id) = 1) AS is_total, bucket,
       count(*)::int AS deals,
       COALESCE(sum(amount), 0) AS amount,
       COALESCE(sum(weighted_amount), 0) AS weighted_amount
  FROM b
 GROUP BY GROUPING SETS ((owner_user_id, bucket), (bucket));

-- Demand per SKU for stock planning: units in open deals, weighted by stage, at PO, and done this month.
CREATE VIEW v_sku_demand_by_owner AS
SELECT d.owner_user_id, (GROUPING(d.owner_user_id) = 1) AS is_total,
       p.id AS product_id, p.sku, p.name,
       COALESCE(sum(li.qty) FILTER (WHERE NOT d.is_won AND NOT d.is_lost), 0)::int AS units_in_pipeline,
       COALESCE(ROUND(sum(li.qty * d.probability) FILTER (WHERE NOT d.is_won AND NOT d.is_lost), 1), 0) AS weighted_units,
       COALESCE(sum(li.qty) FILTER (WHERE d.stage_key = 'po'), 0)::int AS units_at_po,
       COALESCE(sum(li.qty) FILTER (WHERE d.is_won AND d.closed_on >= date_trunc('month', jakarta_today()::timestamp)::date), 0)::int AS done_units_month
  FROM deal_line_items li
  JOIN v_deals_enriched d ON d.id = li.deal_id
  JOIN products p ON p.id = li.product_id AND p.item_type = 'inventory'
 GROUP BY GROUPING SETS ((d.owner_user_id, p.id, p.sku, p.name), (p.id, p.sku, p.name))
HAVING sum(li.qty) FILTER (WHERE NOT d.is_won AND NOT d.is_lost) > 0
    OR sum(li.qty) FILTER (WHERE d.is_won AND d.closed_on >= date_trunc('month', jakarta_today()::timestamp)::date) > 0;

-- Deals created in the last 90 days, by lead source.
CREATE VIEW v_sources_by_owner AS
SELECT d.owner_user_id, (GROUPING(d.owner_user_id) = 1) AS is_total,
       COALESCE(l.source_channel::text, 'other') AS source,
       count(*)::int AS new_deals,
       count(*) FILTER (WHERE d.is_won)::int AS won,
       COALESCE(sum(d.amount) FILTER (WHERE d.is_won), 0) AS won_amount,
       ROUND(count(*) FILTER (WHERE d.is_won)::numeric / NULLIF(count(*) FILTER (WHERE d.is_won OR d.is_lost), 0), 3) AS win_rate
  FROM v_deals_enriched d
  LEFT JOIN leads l ON l.id = d.lead_id
 WHERE d.created_at >= now() - interval '90 days'
 GROUP BY GROUPING SETS ((d.owner_user_id, COALESCE(l.source_channel::text, 'other')), (COALESCE(l.source_channel::text, 'other')));

-- Win rate with and without a demo, deals closed in the last 90 days.
CREATE VIEW v_demo_effect_by_owner AS
SELECT d.owner_user_id, (GROUPING(d.owner_user_id) = 1) AS is_total,
       (d.demo_date IS NOT NULL) AS had_demo,
       count(*) FILTER (WHERE d.is_won)::int AS won,
       count(*)::int AS closed
  FROM v_deals_enriched d
 WHERE (d.is_won OR d.is_lost) AND d.closed_on >= jakarta_today() - 90
 GROUP BY GROUPING SETS ((d.owner_user_id, (d.demo_date IS NOT NULL)), ((d.demo_date IS NOT NULL)));

-- Why deals were lost in the last 90 days.
CREATE VIEW v_lost_reasons_by_owner AS
SELECT d.owner_user_id, (GROUPING(d.owner_user_id) = 1) AS is_total,
       d.lost_reason::text AS lost_reason,
       count(*)::int AS deals,
       COALESCE(sum(d.amount), 0) AS amount
  FROM v_deals_enriched d
 WHERE d.is_lost AND d.closed_on >= jakarta_today() - 90
 GROUP BY GROUPING SETS ((d.owner_user_id, d.lost_reason), (d.lost_reason));

-- Ads to CRM, last 7 full days: clicks, chats Meta counted, leads the CRM logged. One row per ad.
CREATE VIEW v_ads_to_crm_7d AS
SELECT ad_id, ad_name, owner_user_id,
       COALESCE(sum(link_clicks), 0)::int AS link_clicks,
       COALESCE(sum(meta_conversations), 0)::int AS chats,
       COALESCE(sum(crm_leads), 0)::int AS logged,
       GREATEST(COALESCE(sum(meta_conversations), 0) - COALESCE(sum(crm_leads), 0), 0)::int AS missing
  FROM v_ad_leakage_daily
 WHERE date >= jakarta_today() - 7 AND date < jakarta_today()
 GROUP BY ad_id, ad_name, owner_user_id;

-- The same per campaign owner (owner_user_id) and in total. "missing" adds up each ad's own gap, so an ad with
-- more CRM leads than Meta chats does not hide another ad's gap. pct_logged is capped at 100.
CREATE VIEW v_ads_to_crm_7d_by_owner AS
SELECT owner_user_id, (GROUPING(owner_user_id) = 1) AS is_total,
       count(*)::int AS ads,
       sum(link_clicks)::int AS link_clicks,
       sum(chats)::int AS chats,
       sum(logged)::int AS logged,
       sum(missing)::int AS missing,
       CASE WHEN sum(chats) > 0 THEN ROUND(LEAST(sum(logged), sum(chats)) * 100.0 / sum(chats))::int END AS pct_logged,
       (array_agg(ad_name ORDER BY missing DESC, ad_name) FILTER (WHERE missing > 0))[1] AS top_missing_ad,
       max(missing)::int AS top_missing
  FROM v_ads_to_crm_7d
 GROUP BY GROUPING SETS ((owner_user_id), ());
