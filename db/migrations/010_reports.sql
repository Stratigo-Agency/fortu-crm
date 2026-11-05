-- 010 · Laporan (5 Nov 2026)
-- Report views, one row per owner (and one total row, owner_user_id NULL) so the page never adds numbers up itself.

-- Done deal per month (payment date = closed_on, a Jakarta date).
CREATE VIEW v_done_monthly AS
SELECT owner_user_id,
       (GROUPING(owner_user_id) = 1) AS is_total,
       date_trunc('month', closed_on)::date AS period_month,
       count(*)::int AS deals,
       COALESCE(sum(amount), 0) AS amount,
       COALESCE(sum(screen_units), 0)::int AS units
  FROM v_deals_enriched
 WHERE is_won AND closed_on IS NOT NULL
 GROUP BY GROUPING SETS ((owner_user_id, date_trunc('month', closed_on)), (date_trunc('month', closed_on)));

-- Open deals per stage: value and probability-weighted value.
CREATE VIEW v_stage_summary_by_owner AS
SELECT owner_user_id,
       (GROUPING(owner_user_id) = 1) AS is_total,
       stage_key,
       count(*)::int AS deals,
       COALESCE(sum(amount), 0) AS amount,
       COALESCE(sum(weighted_amount), 0) AS weighted_amount
  FROM v_deals_enriched
 WHERE NOT is_won AND NOT is_lost
 GROUP BY GROUPING SETS ((owner_user_id, stage_key), (stage_key));

-- Win rate over the last 90 days of closed deals, and how long a won deal took.
CREATE VIEW v_win_rate_90d_by_owner AS
SELECT owner_user_id,
       (GROUPING(owner_user_id) = 1) AS is_total,
       count(*) FILTER (WHERE is_won)::int AS won,
       count(*) FILTER (WHERE is_lost)::int AS lost,
       ROUND(avg(closed_on - (created_at AT TIME ZONE 'Asia/Jakarta')::date) FILTER (WHERE is_won))::int AS avg_days_to_win
  FROM v_deals_enriched
 WHERE (is_won OR is_lost) AND closed_on >= jakarta_today() - 90
 GROUP BY GROUPING SETS ((owner_user_id), ());

-- Weighted value of open deals expected to close this month.
CREATE VIEW v_forecast_month_by_owner AS
SELECT owner_user_id,
       (GROUPING(owner_user_id) = 1) AS is_total,
       COALESCE(sum(weighted_amount), 0) AS weighted_amount
  FROM v_deals_enriched
 WHERE NOT is_won AND NOT is_lost
   AND date_trunc('month', expected_close_date) = date_trunc('month', jakarta_today()::timestamp)
 GROUP BY GROUPING SETS ((owner_user_id), ());
