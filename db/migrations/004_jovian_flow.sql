-- 004 · Pak Jovian's sales flow (decided 4 Nov 2026)
-- Stages Chat masuk → Quotation → Negotiation → PO → Done deal (+ Lost), with what each stage requires.
-- Next step on every open deal, MSRP + discount limit, project deals, demo date, competitor,
-- payment date as close date, Rupiah + unit targets side by side, contact follow-up.

-- ───────── 1. Stages: keys, names, definitions ─────────
ALTER TABLE pipeline_stages ADD COLUMN definition text;

UPDATE pipeline_stages SET
  key = CASE key
    WHEN 'chat_received' THEN 'chat'
    WHEN 'proposal_sent' THEN 'quotation'
    WHEN 'negotiation'   THEN 'negotiation'
    WHEN 'invoice_sent'  THEN 'po'
    WHEN 'closed_won'    THEN 'done'
    WHEN 'closed_lost'   THEN 'lost' END,
  name = CASE key
    WHEN 'chat_received' THEN 'Chat masuk'
    WHEN 'proposal_sent' THEN 'Quotation'
    WHEN 'negotiation'   THEN 'Negotiation'
    WHEN 'invoice_sent'  THEN 'PO'
    WHEN 'closed_won'    THEN 'Done deal'
    WHEN 'closed_lost'   THEN 'Lost' END,
  definition = CASE key
    WHEN 'chat_received' THEN 'Chat atau telepon dengan kebutuhan jelas: produk, lokasi, perkiraan jumlah.'
    WHEN 'proposal_sent' THEN 'Quotation sudah dikirim ke customer.'
    WHEN 'negotiation'   THEN 'Customer membalas quotation: nego harga, demo, revisi spek, atau menunggu persetujuan internal.'
    WHEN 'invoice_sent'  THEN 'PO/SPK diterima atau DP disepakati. Minta proforma ke Finance. Deal 10 unit ke atas: cek stok ke Operasional dulu.'
    WHEN 'closed_won'    THEN 'Pembayaran DP atau lunas sudah dikonfirmasi Finance.'
    WHEN 'closed_lost'   THEN 'Customer batal, pilih kompetitor, atau tidak membalas 30 hari.' END;

-- ───────── 2. New fields ─────────
ALTER TYPE source_channel ADD VALUE IF NOT EXISTS 'partner_si';
ALTER TYPE source_channel ADD VALUE IF NOT EXISTS 'repeat_order';
ALTER TYPE source_channel ADD VALUE IF NOT EXISTS 'tender';
ALTER TYPE source_channel ADD VALUE IF NOT EXISTS 'walk_in';
ALTER TYPE lost_reason    ADD VALUE IF NOT EXISTS 'stock_leadtime';

ALTER TABLE deals
  ADD COLUMN next_step            text,
  ADD COLUMN next_step_date       date,
  ADD COLUMN demo_date            date,
  ADD COLUMN competitor           text,
  ADD COLUMN est_amount           numeric(15,0) NOT NULL DEFAULT 0 CHECK (est_amount >= 0),  -- used while no products are listed
  ADD COLUMN closed_on            date,                 -- Done deal: payment date. Lost: date lost. Jakarta date.
  ADD COLUMN discount_approved_by uuid REFERENCES users(id),
  ADD COLUMN discount_approved_at timestamptz;

COMMENT ON COLUMN products.list_price IS 'MSRP before PPN. Fills the line price and is the base for the discount check.';
ALTER TABLE products ADD COLUMN max_discount_pct numeric(5,2) CHECK (max_discount_pct BETWEEN 0 AND 100);  -- null = app_settings.max_discount_pct

INSERT INTO app_settings (key, value) VALUES
  ('max_discount_pct',   '15'),
  ('project_min_units',  '10'),
  ('project_min_amount', '300000000'),
  ('followup_days',      '14')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

CREATE FUNCTION setting_num(p_key text) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT (value #>> '{}')::numeric FROM app_settings WHERE key = p_key
$$;

CREATE FUNCTION jakarta_today() RETURNS date LANGUAGE sql STABLE AS $$
  SELECT (now() AT TIME ZONE 'Asia/Jakarta')::date
$$;

-- ───────── 3. Deal amount follows its products ─────────
-- amount = sum of line totals; with no lines yet, amount = est_amount.
CREATE FUNCTION recalc_deal_amount(p_deal uuid) RETURNS void LANGUAGE sql AS $$
  UPDATE deals d SET amount = COALESCE(
    (SELECT SUM(li.line_total) FROM deal_line_items li WHERE li.deal_id = d.id), d.est_amount)
  WHERE d.id = p_deal
$$;

CREATE FUNCTION trg_line_items_amount() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM recalc_deal_amount(COALESCE(NEW.deal_id, OLD.deal_id));
  IF TG_OP = 'UPDATE' AND NEW.deal_id IS DISTINCT FROM OLD.deal_id THEN
    PERFORM recalc_deal_amount(OLD.deal_id);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER line_items_amount AFTER INSERT OR UPDATE OR DELETE ON deal_line_items
  FOR EACH ROW EXECUTE FUNCTION trg_line_items_amount();

-- ───────── 4. What each stage requires ─────────
-- Errors carry a short key after "stage_rule:" so the app can show the Bahasa message from messages/id.json.
CREATE OR REPLACE FUNCTION trg_deal_stage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  st pipeline_stages%ROWTYPE;
  n_lines int;
BEGIN
  SELECT * INTO st FROM pipeline_stages WHERE id = NEW.stage_id;

  IF NOT EXISTS (SELECT 1 FROM deal_line_items WHERE deal_id = NEW.id) THEN
    NEW.amount := NEW.est_amount;
  END IF;

  IF TG_OP = 'INSERT' OR NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    NEW.stage_entered_at := now();
    NEW.closed_at := CASE WHEN st.is_won OR st.is_lost THEN now() ELSE NULL END;
    NEW.closed_on := CASE WHEN st.is_won OR st.is_lost THEN COALESCE(NEW.closed_on, jakarta_today()) ELSE NULL END;

    -- From Quotation on (except Lost): at least one product with qty and price.
    IF st.position >= 2 AND NOT st.is_lost THEN
      SELECT COUNT(*) INTO n_lines FROM deal_line_items WHERE deal_id = NEW.id AND qty > 0 AND unit_price > 0;
      IF n_lines = 0 THEN RAISE EXCEPTION 'stage_rule:products' USING ERRCODE = 'check_violation'; END IF;
    END IF;
    -- Quotation, Negotiation, PO: expected close date.
    IF st.position >= 2 AND NOT st.is_won AND NOT st.is_lost AND NEW.expected_close_date IS NULL THEN
      RAISE EXCEPTION 'stage_rule:close_date' USING ERRCODE = 'check_violation';
    END IF;

    IF TG_OP = 'UPDATE' THEN   -- on INSERT the row does not exist yet; the AFTER trigger logs it
      INSERT INTO deal_stage_history (deal_id, from_stage_id, to_stage_id, amount_at_change, changed_by)
      VALUES (NEW.id, OLD.stage_id, NEW.stage_id, NEW.amount,
              NULLIF(current_setting('app.user_id', true), '')::uuid);
    END IF;
  END IF;

  -- Every open deal has a next step and a date.
  IF NOT st.is_won AND NOT st.is_lost AND (NULLIF(btrim(NEW.next_step), '') IS NULL OR NEW.next_step_date IS NULL) THEN
    RAISE EXCEPTION 'stage_rule:next_step' USING ERRCODE = 'check_violation';
  END IF;
  IF st.is_won OR st.is_lost THEN
    NEW.next_step := NULL; NEW.next_step_date := NULL;
  END IF;
  IF st.is_lost AND NEW.lost_reason IS NULL THEN
    RAISE EXCEPTION 'stage_rule:lost_reason' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT st.is_lost THEN NEW.competitor := NULL; END IF;

  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ───────── 5. Views ─────────
-- v_deals_enriched selects d.*, so it is rebuilt with the new columns; its dependents are rebuilt too.
DROP VIEW v_deals_enriched CASCADE;   -- drops v_pipeline_summary, v_rep_scorecard, v_sku_demand

-- Line discount against MSRP.
CREATE VIEW v_deal_line_discounts AS
SELECT li.id AS line_id, li.deal_id, p.sku, p.name, li.qty, li.unit_price, li.line_total, p.list_price AS msrp,
       COALESCE(p.max_discount_pct, setting_num('max_discount_pct')) AS max_discount_pct,
       CASE WHEN p.list_price > 0
            THEN ROUND((1 - li.line_total::numeric / (li.qty * p.list_price)) * 100, 1) END AS discount_pct_vs_msrp,
       (p.list_price > 0 AND (1 - li.line_total::numeric / (li.qty * p.list_price)) * 100
          > COALESCE(p.max_discount_pct, setting_num('max_discount_pct')) + 0.05) AS over_limit
FROM deal_line_items li JOIN products p ON p.id = li.product_id;

CREATE VIEW v_deals_enriched AS
SELECT d.*,
       s.key                                     AS stage_key,
       s.name                                    AS stage_name,
       s.position                                AS stage_position,
       s.probability,
       s.is_won, s.is_lost,
       ROUND(d.amount * s.probability)           AS weighted_amount,
       (now()::date - d.created_at::date)        AS age_days,
       (now()::date - d.stage_entered_at::date)  AS days_in_stage,
       (NOT s.is_won AND NOT s.is_lost
        AND now() - d.updated_at > make_interval(days => s.stale_after_days)) AS is_stale,
       COALESCE(u.units, 0)                      AS screen_units,
       (COALESCE(u.units, 0) >= setting_num('project_min_units')
        OR d.amount >= setting_num('project_min_amount'))                      AS is_project,
       (NOT s.is_won AND NOT s.is_lost AND d.next_step_date < jakarta_today()) AS next_step_overdue,
       (NOT s.is_won AND NOT s.is_lost AND d.expected_close_date < jakarta_today()) AS close_date_passed,
       (d.discount_approved_at IS NULL AND EXISTS (
          SELECT 1 FROM v_deal_line_discounts x WHERE x.deal_id = d.id AND x.over_limit)) AS needs_discount_approval
FROM deals d
JOIN pipeline_stages s ON s.id = d.stage_id
LEFT JOIN LATERAL (
  SELECT SUM(li.qty) AS units FROM deal_line_items li JOIN products p ON p.id = li.product_id
  WHERE li.deal_id = d.id AND p.counts_as_screen) u ON true;

CREATE VIEW v_pipeline_summary AS
SELECT
  SUM(amount) FILTER (WHERE NOT is_lost)                               AS total_amount,
  SUM(weighted_amount) FILTER (WHERE NOT is_won AND NOT is_lost)       AS weighted_open_amount,
  SUM(amount) FILTER (WHERE NOT is_won AND NOT is_lost)                AS open_amount,
  SUM(amount) FILTER (WHERE is_won AND closed_on >= date_trunc('month', jakarta_today())) AS won_this_month,
  SUM(amount) FILTER (WHERE created_at >= date_trunc('month', now()))  AS new_this_month,
  ROUND(AVG(age_days) FILTER (WHERE NOT is_won AND NOT is_lost), 1)    AS avg_open_age_days,
  COUNT(*) FILTER (WHERE NOT is_won AND NOT is_lost)                   AS open_deals,
  COUNT(*) FILTER (WHERE next_step_overdue)                            AS next_step_overdue,
  SUM(screen_units) FILTER (WHERE is_won AND closed_on >= date_trunc('month', jakarta_today())) AS units_won_this_month
FROM v_deals_enriched;

-- Payment date is the close date.
CREATE OR REPLACE VIEW v_units_won_monthly AS
SELECT d.owner_user_id,
       date_trunc('month', d.closed_on)::date AS period_month,
       SUM(li.qty)                            AS units_won
FROM deals d
JOIN pipeline_stages s ON s.id = d.stage_id AND s.is_won
JOIN deal_line_items li ON li.deal_id = d.id
JOIN products p ON p.id = li.product_id AND p.counts_as_screen
GROUP BY 1, 2;

-- Rupiah next to units.
CREATE OR REPLACE VIEW v_target_attainment AS
SELECT t.user_id, t.period_month, t.target_units, t.target_amount,
       COALESCE(CASE WHEN t.user_id IS NULL
                     THEN (SELECT SUM(units_won) FROM v_units_won_monthly w WHERE w.period_month = t.period_month)
                     ELSE (SELECT SUM(units_won) FROM v_units_won_monthly w WHERE w.period_month = t.period_month AND w.owner_user_id = t.user_id)
                END, 0) AS units_won,
       COALESCE((SELECT SUM(d.amount) FROM deals d JOIN pipeline_stages s ON s.id = d.stage_id AND s.is_won
                 WHERE date_trunc('month', d.closed_on)::date = t.period_month
                   AND (t.user_id IS NULL OR d.owner_user_id = t.user_id)), 0) AS amount_won
FROM sales_targets t;

CREATE VIEW v_rep_scorecard AS
SELECT u.id AS user_id, u.full_name,
  (SELECT COUNT(*) FROM leads l WHERE l.owner_user_id = u.id AND l.received_at >= now() - interval '7 days')  AS leads_7d,
  (SELECT COUNT(*) FROM leads l WHERE l.owner_user_id = u.id AND l.received_at >= now() - interval '30 days') AS leads_30d,
  (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM l.first_response_at - l.received_at) / 60)
     FROM leads l WHERE l.owner_user_id = u.id AND l.first_response_at IS NOT NULL
      AND l.received_at >= now() - interval '30 days')                                                       AS median_first_response_min,
  COUNT(d.id) FILTER (WHERE NOT d.is_won AND NOT d.is_lost)                         AS open_deals,
  COALESCE(SUM(d.amount) FILTER (WHERE NOT d.is_won AND NOT d.is_lost),0)           AS open_amount,
  COALESCE(SUM(d.weighted_amount) FILTER (WHERE NOT d.is_won AND NOT d.is_lost),0)  AS weighted_pipeline,
  COALESCE(SUM(d.amount) FILTER (WHERE d.is_won AND d.closed_on >= date_trunc('month', jakarta_today())),0) AS won_this_month,
  (SELECT t.target_amount FROM sales_targets t WHERE t.user_id = u.id
      AND t.period_month = date_trunc('month', jakarta_today())::date)              AS target_this_month,
  ROUND(COUNT(d.id) FILTER (WHERE (d.is_won OR d.is_lost) AND d.closed_on >= jakarta_today() - 90 AND d.is_won)::numeric
        / NULLIF(COUNT(d.id) FILTER (WHERE (d.is_won OR d.is_lost) AND d.closed_on >= jakarta_today() - 90), 0), 3) AS win_rate_90d,
  COUNT(d.id) FILTER (WHERE d.is_stale)                                              AS stale_deals,
  COUNT(d.id) FILTER (WHERE d.next_step_overdue)                                     AS next_step_overdue,
  COALESCE(SUM(d.screen_units) FILTER (WHERE d.is_won AND d.closed_on >= date_trunc('month', jakarta_today())),0) AS units_won_this_month,
  (SELECT t.target_units FROM sales_targets t WHERE t.user_id = u.id
      AND t.period_month = date_trunc('month', jakarta_today())::date)              AS target_units_this_month,
  (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM l.logged_at - l.received_at) / 60)
     FROM leads l WHERE l.owner_user_id = u.id AND l.received_at >= now() - interval '30 days')               AS median_log_delay_min
FROM users u
LEFT JOIN v_deals_enriched d ON d.owner_user_id = u.id
WHERE u.role IN ('sales_rep','sales_lead') AND u.is_active
GROUP BY u.id, u.full_name;

-- Demand per SKU, now also with units sitting at PO (a firm signal for stock).
CREATE VIEW v_sku_demand AS
SELECT p.id AS product_id, p.sku, p.name, p.product_line,
  (SELECT ROUND(AVG(qty_sold), 1) FROM sales_monthly sm
     WHERE sm.product_id = p.id AND sm.period_month >= date_trunc('month', now()) - interval '3 months'
       AND sm.period_month <  date_trunc('month', now()))                          AS avg_monthly_sold_3m,
  (SELECT COALESCE(ROUND(SUM(li.qty * d.probability), 1), 0)
     FROM deal_line_items li JOIN v_deals_enriched d ON d.id = li.deal_id
     WHERE li.product_id = p.id AND NOT d.is_won AND NOT d.is_lost)                AS weighted_pipeline_units,
  (SELECT SUM(qty_on_hand) FROM inventory_snapshots s
     WHERE s.product_id = p.id
       AND s.snapshot_date = (SELECT MAX(snapshot_date) FROM inventory_snapshots WHERE product_id = p.id)) AS qty_on_hand,
  (SELECT COALESCE(SUM(qty), 0) FROM purchase_orders po
     WHERE po.product_id = p.id AND po.status = 'open')                            AS open_po_units,
  (SELECT COALESCE(SUM(li.qty), 0) FROM deal_line_items li JOIN v_deals_enriched d ON d.id = li.deal_id
     WHERE li.product_id = p.id AND d.stage_key = 'po')                           AS units_at_po,
  (SELECT COALESCE(SUM(li.qty), 0) FROM deal_line_items li JOIN v_deals_enriched d ON d.id = li.deal_id
     WHERE li.product_id = p.id AND NOT d.is_won AND NOT d.is_lost)                AS units_in_pipeline
FROM products p
WHERE p.is_active AND p.item_type = 'inventory';

-- "Perlu perhatian": one row per open deal that needs action, most urgent first.
CREATE VIEW v_attention AS
SELECT d.id AS deal_id, d.name, d.owner_user_id, d.stage_key, d.amount,
       CASE WHEN d.next_step_overdue       THEN 'next_step_overdue'
            WHEN d.close_date_passed       THEN 'close_date_passed'
            WHEN d.is_stale                THEN 'stale'
            WHEN d.needs_discount_approval THEN 'discount' END AS reason,
       CASE WHEN d.next_step_overdue THEN 0 WHEN d.close_date_passed THEN 1 WHEN d.is_stale THEN 2 ELSE 3 END AS severity,
       d.next_step, d.next_step_date, d.expected_close_date, d.updated_at
FROM v_deals_enriched d
WHERE NOT d.is_won AND NOT d.is_lost
  AND (d.next_step_overdue OR d.close_date_passed OR d.is_stale OR d.needs_discount_approval);

-- Contacts: first and last chat, open deals, follow-up flag.
CREATE VIEW v_contact_activity AS
SELECT c.id AS contact_id, c.full_name, c.phone_e164, c.company_id, c.owner_user_id,
       LEAST(c.created_at, (SELECT MIN(l.received_at) FROM leads l WHERE l.contact_id = c.id)) AS first_chat_at,
       GREATEST((SELECT MAX(l.received_at) FROM leads l WHERE l.contact_id = c.id),
                (SELECT MAX(a.created_at) FROM activities a WHERE a.contact_id = c.id
                   AND a.type IN ('call','whatsapp','meeting','visit','email','note')),
                c.created_at) AS last_chat_at,
       (SELECT COUNT(*) FROM deals d JOIN pipeline_stages s ON s.id = d.stage_id
         WHERE d.contact_id = c.id AND NOT s.is_won AND NOT s.is_lost) AS open_deals
FROM contacts c;

CREATE VIEW v_contacts_followup AS
SELECT v.*, (v.open_deals > 0 AND v.last_chat_at < now() - make_interval(days => setting_num('followup_days')::int)) AS needs_followup
FROM v_contact_activity v;

-- Win rate with and without a demo, and lost reasons (90 days).
CREATE VIEW v_demo_effect_90d AS
SELECT (d.demo_date IS NOT NULL) AS had_demo,
       COUNT(*) FILTER (WHERE d.is_won) AS won, COUNT(*) AS closed,
       ROUND(COUNT(*) FILTER (WHERE d.is_won)::numeric / NULLIF(COUNT(*), 0), 3) AS win_rate
FROM v_deals_enriched d
WHERE (d.is_won OR d.is_lost) AND d.closed_on >= jakarta_today() - 90
GROUP BY 1;

CREATE VIEW v_lost_reasons_90d AS
SELECT d.lost_reason, COUNT(*) AS deals, SUM(d.amount) AS amount
FROM v_deals_enriched d
WHERE d.is_lost AND d.closed_on >= jakarta_today() - 90
GROUP BY 1 ORDER BY 2 DESC;

-- Deals created in 90 days by source.
CREATE VIEW v_sources_90d AS
SELECT COALESCE(l.source_channel::text, 'other') AS source,
       COUNT(*) AS new_deals,
       COUNT(*) FILTER (WHERE d.is_won) AS won,
       COALESCE(SUM(d.amount) FILTER (WHERE d.is_won), 0) AS won_amount,
       ROUND(COUNT(*) FILTER (WHERE d.is_won)::numeric / NULLIF(COUNT(*) FILTER (WHERE d.is_won OR d.is_lost), 0), 3) AS win_rate,
       COALESCE(SUM(d.weighted_amount) FILTER (WHERE NOT d.is_won AND NOT d.is_lost), 0) AS weighted_open
FROM v_deals_enriched d
LEFT JOIN leads l ON l.id = d.lead_id
WHERE d.created_at >= now() - interval '90 days'
GROUP BY 1;

-- Playbook checklist items were keyed on the old stage keys; they keep working through stage_id.
CREATE INDEX ON deals (owner_user_id, next_step_date) WHERE closed_at IS NULL;

-- Demo rows for staging and training can be removed in one go.
ALTER TABLE companies ADD COLUMN is_sample boolean NOT NULL DEFAULT false;
ALTER TABLE contacts  ADD COLUMN is_sample boolean NOT NULL DEFAULT false;
ALTER TABLE leads     ADD COLUMN is_sample boolean NOT NULL DEFAULT false;
ALTER TABLE deals     ADD COLUMN is_sample boolean NOT NULL DEFAULT false;
