-- Fortu CRM · migration 003 · 3 Nov 2026
-- 1) Bahasa Indonesia stage names (keys stay English)
-- 2) Unit targets: 2.000 screens in 2027 (All Hands 31 Okt 2026) = 167 / month company-wide
-- 3) View-all / edit-own: one SQL check the app uses on every write
-- 4) Rental deals (videotron sewa, Des 2026 – Jan 2027)

-- ───────── 1. Stage names shown in the UI ─────────
UPDATE pipeline_stages SET name = CASE key
  WHEN 'chat_received' THEN 'Chat Masuk'
  WHEN 'proposal_sent' THEN 'Penawaran Terkirim'
  WHEN 'negotiation'   THEN 'Negosiasi'
  WHEN 'invoice_sent'  THEN 'PI / Invoice Terkirim'
  WHEN 'closed_won'    THEN 'Deal Berhasil'
  WHEN 'closed_lost'   THEN 'Batal'
END;

-- ───────── 2. Unit targets ─────────
-- A "unit" is a screen: IFP, DSS or LED line items. Brackets, pens and warranty do not count.
ALTER TABLE products ADD COLUMN counts_as_screen boolean
  GENERATED ALWAYS AS (product_line IN ('IFP','DSS','LED')) STORED;

ALTER TABLE sales_targets ALTER COLUMN target_amount DROP NOT NULL;
ALTER TABLE sales_targets ADD COLUMN target_units integer CHECK (target_units > 0);
ALTER TABLE sales_targets ADD CONSTRAINT sales_targets_has_target
  CHECK (target_amount IS NOT NULL OR target_units IS NOT NULL);

-- Company-wide: 167 units per month through 2027 (12 × 167 = 2.004 ≥ 2.000).
-- Per-rep targets (~42) are set in Pengaturan › Target once users exist.
INSERT INTO sales_targets (user_id, period_month, target_units)
SELECT NULL, d::date, 167
FROM generate_series('2027-01-01'::date, '2027-12-01'::date, interval '1 month') d
ON CONFLICT (user_id, period_month) DO UPDATE SET target_units = EXCLUDED.target_units;

-- Screens won per rep per month (Asia/Jakarta months).
CREATE VIEW v_units_won_monthly AS
SELECT d.owner_user_id,
       date_trunc('month', d.closed_at AT TIME ZONE 'Asia/Jakarta')::date AS period_month,
       SUM(li.qty)                                                       AS units_won
FROM deals d
JOIN pipeline_stages s ON s.id = d.stage_id AND s.is_won
JOIN deal_line_items li ON li.deal_id = d.id
JOIN products p ON p.id = li.product_id AND p.counts_as_screen
GROUP BY 1, 2;

-- Target vs actual, per rep and company-wide (user_id NULL).
CREATE VIEW v_target_attainment AS
SELECT t.user_id, t.period_month, t.target_units, t.target_amount,
       COALESCE(CASE WHEN t.user_id IS NULL
                     THEN (SELECT SUM(units_won) FROM v_units_won_monthly w WHERE w.period_month = t.period_month)
                     ELSE (SELECT SUM(units_won) FROM v_units_won_monthly w WHERE w.period_month = t.period_month AND w.owner_user_id = t.user_id)
                END, 0) AS units_won
FROM sales_targets t;

-- Scorecard gains units won and the unit target (new columns appended; existing ones unchanged).
CREATE OR REPLACE VIEW v_rep_scorecard AS
SELECT u.id AS user_id, u.full_name,
  (SELECT COUNT(*) FROM leads l WHERE l.owner_user_id = u.id AND l.received_at >= now() - interval '7 days')  AS leads_7d,
  (SELECT COUNT(*) FROM leads l WHERE l.owner_user_id = u.id AND l.received_at >= now() - interval '30 days') AS leads_30d,
  (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM l.first_response_at - l.received_at) / 60)
     FROM leads l WHERE l.owner_user_id = u.id AND l.first_response_at IS NOT NULL
      AND l.received_at >= now() - interval '30 days')                                                       AS median_first_response_min,
  COUNT(d.id) FILTER (WHERE NOT d.is_won AND NOT d.is_lost)                         AS open_deals,
  COALESCE(SUM(d.weighted_amount) FILTER (WHERE NOT d.is_won AND NOT d.is_lost),0)  AS weighted_pipeline,
  COALESCE(SUM(d.amount) FILTER (WHERE d.is_won AND d.closed_at >= date_trunc('month', now())),0) AS won_this_month,
  (SELECT t.target_amount FROM sales_targets t WHERE t.user_id = u.id
      AND t.period_month = date_trunc('month', now())::date)                         AS target_this_month,
  ROUND(COUNT(d.id) FILTER (WHERE d.is_won)::numeric
        / NULLIF(COUNT(d.id) FILTER (WHERE d.is_won OR d.is_lost), 0), 3)            AS win_rate,
  COUNT(d.id) FILTER (WHERE d.is_stale)                                              AS stale_deals,
  COALESCE((SELECT w.units_won FROM v_units_won_monthly w WHERE w.owner_user_id = u.id
      AND w.period_month = date_trunc('month', now() AT TIME ZONE 'Asia/Jakarta')::date), 0) AS units_won_this_month,
  (SELECT t.target_units FROM sales_targets t WHERE t.user_id = u.id
      AND t.period_month = date_trunc('month', now() AT TIME ZONE 'Asia/Jakarta')::date)     AS target_units_this_month,
  (SELECT median_log FROM (
     SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM l.logged_at - l.received_at) / 60) AS median_log
     FROM leads l WHERE l.owner_user_id = u.id AND l.received_at >= now() - interval '30 days') x)            AS median_log_delay_min
FROM users u
LEFT JOIN v_deals_enriched d ON d.owner_user_id = u.id
WHERE u.role IN ('sales_rep','sales_lead') AND u.is_active
GROUP BY u.id, u.full_name;

-- ───────── 3. View-all / edit-own ─────────
-- Everyone signed in may READ every lead and deal. Only the owner, a sales_lead, the ceo or an admin may WRITE.
-- The app calls these in every Server Action and also puts them in the UPDATE's WHERE, so a bypassed check still fails.
CREATE FUNCTION can_edit_deal(p_user uuid, p_deal uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM users u, deals d
    WHERE u.id = p_user AND d.id = p_deal AND u.is_active
      AND (u.role IN ('admin','ceo','sales_lead') OR d.owner_user_id = u.id))
$$;

CREATE FUNCTION can_edit_lead(p_user uuid, p_lead uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM users u, leads l
    WHERE u.id = p_user AND l.id = p_lead AND u.is_active
      AND (u.role IN ('admin','ceo','sales_lead') OR l.owner_user_id = u.id OR l.owner_user_id IS NULL))
$$;

-- ───────── 4. Rental deals ─────────
ALTER TYPE deal_type ADD VALUE IF NOT EXISTS 'rental';
ALTER TABLE deals DROP CONSTRAINT deals_check;
ALTER TABLE deals ADD CONSTRAINT deals_parent_required
  CHECK (deal_type::text NOT IN ('repeat','upsell') OR parent_deal_id IS NOT NULL);
