-- 007 · Pipeline board (5 Nov 2026)
-- 1) v_pipeline_board: one card per deal on the board (open deals, plus Done deal / Lost closed this month),
--    with company, contact, owner and the card tags. Search and column totals run on this view.
-- 2) v_pipeline_summary_by_owner: the numbers of v_pipeline_summary per owner (is_total = everyone),
--    so the stat strip follows the sales filter.

CREATE VIEW v_pipeline_board AS
SELECT e.id,
       e.name,
       e.stage_id,
       e.stage_key,
       e.stage_position,
       e.is_won,
       e.is_lost,
       e.owner_user_id,
       u.full_name AS owner_name,
       e.company_id,
       co.name     AS company_name,
       e.contact_id,
       c.full_name AS contact_name,
       c.phone_e164,
       e.amount,
       e.est_amount,
       EXISTS (SELECT 1 FROM deal_line_items li WHERE li.deal_id = e.id) AS has_products,
       e.screen_units,
       e.weighted_amount,
       e.expected_close_date,
       e.next_step,
       e.next_step_date,
       e.next_step_overdue,
       CASE WHEN e.next_step_overdue THEN jakarta_today() - e.next_step_date END AS days_overdue,
       e.days_in_stage,
       e.is_stale,
       (jakarta_today() - (e.updated_at AT TIME ZONE 'Asia/Jakarta')::date) AS days_since_update,
       e.is_project,
       e.needs_discount_approval,
       (e.demo_date IS NOT NULL AND e.demo_date <= jakarta_today()) AS has_demo,
       e.closed_on,
       e.updated_at,
       -- open deals always; Done deal and Lost only when closed this month (Jakarta)
       (NOT e.is_won AND NOT e.is_lost)
         OR e.closed_on >= date_trunc('month', jakarta_today()::timestamp)::date AS on_board
  FROM v_deals_enriched e
  LEFT JOIN users u      ON u.id = e.owner_user_id
  LEFT JOIN companies co ON co.id = e.company_id
  LEFT JOIN contacts c   ON c.id = e.contact_id;

CREATE VIEW v_pipeline_summary_by_owner AS
SELECT owner_user_id,
       (GROUPING(owner_user_id) = 1) AS is_total,
       count(*) FILTER (WHERE NOT is_won AND NOT is_lost)::int AS open_deals,
       COALESCE(sum(amount) FILTER (WHERE NOT is_won AND NOT is_lost), 0) AS open_amount,
       COALESCE(sum(weighted_amount) FILTER (WHERE NOT is_won AND NOT is_lost), 0) AS weighted_open_amount,
       COALESCE(sum(amount) FILTER (WHERE is_won AND closed_on >= date_trunc('month', jakarta_today()::timestamp)::date), 0)
         AS won_this_month,
       COALESCE(sum(screen_units) FILTER (WHERE is_won AND closed_on >= date_trunc('month', jakarta_today()::timestamp)::date), 0)::int
         AS units_won_this_month,
       count(*) FILTER (WHERE next_step_overdue)::int AS next_step_overdue
  FROM v_deals_enriched
 GROUP BY GROUPING SETS ((owner_user_id), ());
