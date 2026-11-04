-- Fortu CRM · Phase 1 schema v1.1 · PostgreSQL 15+ (Railway Postgres)
-- v1.1 (3 Nov 2026): wa_lines seam for Cloud API, capture_method on leads, ad prefill codes, English stage names.
-- Money = whole Rupiah numeric(15,0). Phones = E.164 text. Times = timestamptz (UTC), shown in Asia/Jakarta.

-- gen_random_uuid() is built in since PostgreSQL 13; no extension needed.

-- ───────── Enums ─────────
CREATE TYPE user_role      AS ENUM ('admin','ceo','sales_lead','sales_rep','marketing');
CREATE TYPE source_channel AS ENUM ('meta_ctwa','meta_leadform','website_form','website_wa_link','google_ads','instagram_dm','whatsapp_direct','referral','event','other');
CREATE TYPE lead_status    AS ENUM ('new','contacted','qualified','disqualified','converted');
CREATE TYPE product_line   AS ENUM ('IFP','DSS','LED','accessory','service');
CREATE TYPE deal_type      AS ENUM ('new','repeat','upsell');
CREATE TYPE lost_reason    AS ENUM ('harga','kompetitor','budget','timing','no_response','spec','other');
CREATE TYPE activity_type  AS ENUM ('note','call','whatsapp','meeting','visit','email','task','stage_change','system');
CREATE TYPE notif_kind     AS ENUM ('high_value_lead','stale_deal','won','sla_breach');
CREATE TYPE wa_line_mode   AS ENUM ('business_app','coexistence','cloud_api');
CREATE TYPE capture_method AS ENUM ('manual_quick_add','web_form','wa_link_ref','cloud_api_webhook','import');

-- ───────── Sales core ─────────
CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name             text NOT NULL,
  email                 text UNIQUE NOT NULL,
  role                  user_role NOT NULL DEFAULT 'sales_rep',
  receives_round_robin  boolean NOT NULL DEFAULT false,
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- One row per WhatsApp number. MVP: mode = business_app, Meta ids null.
-- Moving a line to Coexistence / Cloud API = fill the Meta ids + flip mode. No other table changes.
CREATE TABLE wa_lines (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid REFERENCES users(id),     -- current owner; reassignable when a rep leaves
  phone_e164            text UNIQUE NOT NULL CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  label                 text NOT NULL,                 -- e.g. 'No_Frisca'
  mode                  wa_line_mode NOT NULL DEFAULT 'business_app',
  meta_waba_id          text,
  meta_phone_number_id  text UNIQUE,                   -- webhook routing key once on Cloud API
  connected_at          timestamptz,
  is_active             boolean NOT NULL DEFAULT true,
  CHECK (mode = 'business_app' OR meta_phone_number_id IS NOT NULL)
);

CREATE TABLE companies (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  industry              text,                   -- education, retail, f&b, corporate, government, healthcare, hospitality, other
  city                  text,
  website               text,
  owner_user_id         uuid REFERENCES users(id),
  accurate_customer_id  text UNIQUE,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE contacts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164            text UNIQUE NOT NULL CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  full_name             text,
  email                 text,
  job_title             text,
  company_id            uuid REFERENCES companies(id),
  owner_user_id         uuid REFERENCES users(id),
  first_lead_id         uuid,                   -- FK added after leads
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pipeline_stages (
  id                    smallserial PRIMARY KEY,
  key                   text UNIQUE NOT NULL,
  name                  text NOT NULL,
  position              smallint NOT NULL,
  probability           numeric(4,3) NOT NULL CHECK (probability BETWEEN 0 AND 1),
  is_won                boolean NOT NULL DEFAULT false,
  is_lost               boolean NOT NULL DEFAULT false,
  stale_after_days      smallint NOT NULL DEFAULT 7
);

-- ───────── Attribution (needed before leads) ─────────
CREATE TABLE ad_campaigns (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meta_campaign_id      text UNIQUE NOT NULL,
  name                  text NOT NULL,
  owner_user_id         uuid REFERENCES users(id),
  objective             text,
  status                text
);

CREATE TABLE ad_sets (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meta_adset_id         text UNIQUE NOT NULL,
  campaign_id           uuid NOT NULL REFERENCES ad_campaigns(id),
  name                  text NOT NULL,
  product_line          product_line,
  daily_budget          numeric(15,0)
);

CREATE TABLE ads (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meta_ad_id            text UNIQUE NOT NULL,
  ad_set_id             uuid NOT NULL REFERENCES ad_sets(id),
  name                  text NOT NULL,
  creative_name         text,
  prefill_code          text UNIQUE,            -- e.g. 'R-IFP-03', put in the ad's prefilled WA message
  status                text
);

CREATE TABLE ad_insights_daily (
  ad_id                 uuid NOT NULL REFERENCES ads(id),
  date                  date NOT NULL,          -- Asia/Jakarta day, as Meta reports it
  spend                 numeric(15,0) NOT NULL DEFAULT 0,
  impressions           integer NOT NULL DEFAULT 0,
  reach                 integer NOT NULL DEFAULT 0,
  link_clicks           integer NOT NULL DEFAULT 0,
  meta_conversations    integer NOT NULL DEFAULT 0,
  pulled_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ad_id, date)
);

CREATE TABLE inbound_events (
  id                    bigserial PRIMARY KEY,
  provider              text NOT NULL,          -- whatsapp | meta_leadgen | web_form
  external_id           text NOT NULL,
  payload               jsonb NOT NULL,
  received_at           timestamptz NOT NULL DEFAULT now(),
  processed_at          timestamptz,
  error                 text,
  UNIQUE (provider, external_id)                -- idempotency: Meta retries webhooks
);

CREATE TABLE leads (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id            uuid NOT NULL REFERENCES contacts(id),
  owner_user_id         uuid REFERENCES users(id),
  wa_line_id            uuid REFERENCES wa_lines(id),
  source_channel        source_channel NOT NULL,
  capture_method        capture_method NOT NULL DEFAULT 'manual_quick_add',
  product_interest      product_line,
  ad_id                 uuid REFERENCES ads(id),
  ctwa_clid             text,
  utm_source            text,
  utm_medium            text,
  utm_campaign          text,
  utm_content           text,
  first_message         text,
  inbound_event_id      bigint REFERENCES inbound_events(id),
  received_at           timestamptz NOT NULL DEFAULT now(),  -- when the chat arrived (rep-entered in MVP)
  logged_at             timestamptz NOT NULL DEFAULT now(),  -- when it reached the CRM
  first_response_at     timestamptz,                          -- reliable only on Cloud API lines
  status                lead_status NOT NULL DEFAULT 'new',
  disqualify_reason     text,
  deal_id               uuid                    -- FK added after deals
);
ALTER TABLE contacts ADD CONSTRAINT contacts_first_lead_fk FOREIGN KEY (first_lead_id) REFERENCES leads(id);

CREATE TABLE wa_click_events (
  id                    bigserial PRIMARY KEY,
  ref_code              text UNIQUE NOT NULL,   -- printed into the prefilled WA message, e.g. "#W7K2"
  source_channel        source_channel NOT NULL,
  utm_source            text,
  utm_medium            text,
  utm_campaign          text,
  utm_content           text,
  landing_url           text,
  target_user_id        uuid REFERENCES users(id),
  clicked_at            timestamptz NOT NULL DEFAULT now(),
  matched_lead_id       uuid REFERENCES leads(id)
);

-- ───────── Products (needed by line items) ─────────
CREATE TABLE products (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku                   text UNIQUE NOT NULL,
  name                  text NOT NULL,
  product_line          product_line NOT NULL,
  size_inch             smallint,
  list_price            numeric(15,0),
  accurate_item_id      text UNIQUE,
  is_active             boolean NOT NULL DEFAULT true
);

-- ───────── Deals ─────────
CREATE TABLE deals (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  contact_id            uuid NOT NULL REFERENCES contacts(id),
  company_id            uuid REFERENCES companies(id),
  owner_user_id         uuid NOT NULL REFERENCES users(id),
  lead_id               uuid REFERENCES leads(id),
  stage_id              smallint NOT NULL REFERENCES pipeline_stages(id),
  amount                numeric(15,0) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  expected_close_date   date,
  stage_entered_at      timestamptz NOT NULL DEFAULT now(),
  closed_at             timestamptz,
  lost_reason           lost_reason,
  lost_note             text,
  deal_type             deal_type NOT NULL DEFAULT 'new',
  parent_deal_id        uuid REFERENCES deals(id),
  next_followup_at      timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (deal_type = 'new' OR parent_deal_id IS NOT NULL)
);
ALTER TABLE leads ADD CONSTRAINT leads_deal_fk FOREIGN KEY (deal_id) REFERENCES deals(id);

CREATE TABLE deal_line_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id               uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  product_id            uuid NOT NULL REFERENCES products(id),
  qty                   integer NOT NULL CHECK (qty > 0),
  unit_price            numeric(15,0) NOT NULL,
  discount_pct          numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
  line_total            numeric(15,0) GENERATED ALWAYS AS (ROUND(qty * unit_price * (1 - discount_pct / 100))) STORED
);

CREATE TABLE deal_stage_history (
  id                    bigserial PRIMARY KEY,
  deal_id               uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  from_stage_id         smallint REFERENCES pipeline_stages(id),
  to_stage_id           smallint NOT NULL REFERENCES pipeline_stages(id),
  amount_at_change      numeric(15,0) NOT NULL,
  changed_by            uuid REFERENCES users(id),
  changed_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE activities (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type                  activity_type NOT NULL,
  contact_id            uuid REFERENCES contacts(id),
  deal_id               uuid REFERENCES deals(id) ON DELETE CASCADE,
  lead_id               uuid REFERENCES leads(id),
  user_id               uuid REFERENCES users(id),
  body                  text,
  due_at                timestamptz,            -- set = a task / follow-up reminder
  completed_at          timestamptz,
  metadata              jsonb NOT NULL DEFAULT '{}',
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (contact_id IS NOT NULL OR deal_id IS NOT NULL OR lead_id IS NOT NULL)
);

CREATE TABLE stage_playbook_items (
  id                    serial PRIMARY KEY,
  stage_id              smallint NOT NULL REFERENCES pipeline_stages(id),
  label                 text NOT NULL,
  position              smallint NOT NULL DEFAULT 0
);

CREATE TABLE deal_playbook_checks (
  deal_id               uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  item_id               integer NOT NULL REFERENCES stage_playbook_items(id),
  checked_by            uuid REFERENCES users(id),
  checked_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (deal_id, item_id)
);

CREATE TABLE sales_targets (
  id                    serial PRIMARY KEY,
  user_id               uuid REFERENCES users(id),   -- null = company-wide
  period_month          date NOT NULL CHECK (extract(day FROM period_month) = 1),
  target_amount         numeric(15,0) NOT NULL,
  UNIQUE NULLS NOT DISTINCT (user_id, period_month)
);

CREATE TABLE notifications (
  id                    bigserial PRIMARY KEY,
  user_id               uuid NOT NULL REFERENCES users(id),
  kind                  notif_kind NOT NULL,
  deal_id               uuid REFERENCES deals(id),
  lead_id               uuid REFERENCES leads(id),
  channel               text NOT NULL DEFAULT 'in_app',  -- in_app | whatsapp | email
  payload               jsonb NOT NULL DEFAULT '{}',
  sent_at               timestamptz NOT NULL DEFAULT now(),
  read_at               timestamptz
);

CREATE TABLE app_settings (
  key                   text PRIMARY KEY,
  value                 jsonb NOT NULL
);

-- ───────── Inventory (stub until Accurate) ─────────
CREATE TABLE inventory_snapshots (
  product_id            uuid NOT NULL REFERENCES products(id),
  snapshot_date         date NOT NULL,
  warehouse             text NOT NULL DEFAULT 'main',
  qty_on_hand           integer NOT NULL,
  PRIMARY KEY (product_id, snapshot_date, warehouse)
);

CREATE TABLE purchase_orders (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id            uuid NOT NULL REFERENCES products(id),
  qty                   integer NOT NULL,
  eta_date              date,
  status                text NOT NULL DEFAULT 'open',  -- open | received | cancelled
  accurate_po_id        text
);

CREATE TABLE sales_monthly (
  product_id            uuid NOT NULL REFERENCES products(id),
  period_month          date NOT NULL,
  qty_sold              integer NOT NULL,
  revenue               numeric(15,0),
  PRIMARY KEY (product_id, period_month)
);

-- ───────── Indexes for the dashboard queries ─────────
CREATE INDEX ON leads (owner_user_id, received_at DESC);
CREATE INDEX ON leads (ad_id, received_at);
CREATE INDEX ON leads (contact_id);
CREATE INDEX ON leads (wa_line_id, received_at DESC);
CREATE INDEX ON deals (owner_user_id, stage_id);
CREATE INDEX ON deals (stage_id, expected_close_date);
CREATE INDEX ON deal_stage_history (deal_id, changed_at);
CREATE INDEX ON activities (deal_id, created_at DESC);
CREATE INDEX ON activities (contact_id, created_at DESC);
CREATE INDEX ON activities (user_id, due_at) WHERE completed_at IS NULL AND due_at IS NOT NULL;

-- ───────── Trigger: every stage move is logged, timestamps kept ─────────
CREATE FUNCTION trg_deal_stage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    NEW.stage_entered_at := now();
    NEW.closed_at := CASE WHEN (SELECT is_won OR is_lost FROM pipeline_stages WHERE id = NEW.stage_id)
                          THEN now() ELSE NULL END;
    IF TG_OP = 'UPDATE' THEN   -- on INSERT the row does not exist yet; the AFTER trigger logs it
      INSERT INTO deal_stage_history (deal_id, from_stage_id, to_stage_id, amount_at_change, changed_by)
      VALUES (NEW.id, OLD.stage_id, NEW.stage_id, NEW.amount,
              NULLIF(current_setting('app.user_id', true), '')::uuid);
    END IF;
  END IF;
  IF (SELECT is_lost FROM pipeline_stages WHERE id = NEW.stage_id) AND NEW.lost_reason IS NULL THEN
    RAISE EXCEPTION 'lost_reason is required when a deal is marked lost';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER deal_stage_upd BEFORE INSERT OR UPDATE ON deals FOR EACH ROW EXECUTE FUNCTION trg_deal_stage();

CREATE FUNCTION trg_deal_insert_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO deal_stage_history (deal_id, from_stage_id, to_stage_id, amount_at_change, changed_by)
  VALUES (NEW.id, NULL, NEW.stage_id, NEW.amount, NULLIF(current_setting('app.user_id', true), '')::uuid);
  RETURN NULL;
END $$;
CREATE TRIGGER deal_stage_ins AFTER INSERT ON deals FOR EACH ROW EXECUTE FUNCTION trg_deal_insert_history();

-- ───────── Seed ─────────
INSERT INTO pipeline_stages (key, name, position, probability, is_won, is_lost, stale_after_days) VALUES
  ('chat_received', 'Chat Received',  1, 0.10, false, false, 2),
  ('proposal_sent', 'Proposal Sent',  2, 0.30, false, false, 5),
  ('negotiation',   'Negotiation',    3, 0.60, false, false, 7),
  ('invoice_sent',  'Invoice Sent',   4, 0.90, false, false, 14),
  ('closed_won',    'Closed-Won',     5, 1.00, true,  false, 0),
  ('closed_lost',   'Closed-Lost',    6, 0.00, false, true,  0);

INSERT INTO stage_playbook_items (stage_id, label, position)
SELECT id, l, p FROM pipeline_stages s
JOIN (VALUES ('proposal_sent','Follow up',1),('proposal_sent','Ajak ketemu',2),
             ('negotiation','Tawarkan diskon',1),('negotiation','Tawarkan extra service',2),
             ('closed_won','Kirim hampers',1),('closed_won','Tawarkan produk baru',2),('closed_won','Ajak ngopi',3)
     ) v(k,l,p) ON v.k = s.key;

INSERT INTO app_settings (key, value) VALUES
  ('high_value_amount',         '100000000'),
  ('first_response_sla_minutes','15'),
  ('timezone',                  '"Asia/Jakarta"');

-- ───────── Views ─────────
CREATE VIEW v_deals_enriched AS
SELECT d.*,
       s.name                                    AS stage_name,
       s.position                                AS stage_position,
       s.probability,
       s.is_won, s.is_lost,
       ROUND(d.amount * s.probability)           AS weighted_amount,
       (now()::date - d.created_at::date)        AS age_days,
       (now()::date - d.stage_entered_at::date)  AS days_in_stage,
       (NOT s.is_won AND NOT s.is_lost
        AND now() - d.stage_entered_at > make_interval(days => s.stale_after_days)) AS is_stale
FROM deals d
JOIN pipeline_stages s ON s.id = d.stage_id;

CREATE VIEW v_pipeline_summary AS
SELECT
  SUM(amount) FILTER (WHERE NOT is_lost)                               AS total_amount,
  SUM(weighted_amount) FILTER (WHERE NOT is_won AND NOT is_lost)       AS weighted_open_amount,
  SUM(amount) FILTER (WHERE NOT is_won AND NOT is_lost)                AS open_amount,
  SUM(amount) FILTER (WHERE is_won AND closed_at >= date_trunc('month', now())) AS won_this_month,
  SUM(amount) FILTER (WHERE created_at >= date_trunc('month', now()))  AS new_this_month,
  ROUND(AVG(age_days) FILTER (WHERE NOT is_won AND NOT is_lost), 1)    AS avg_open_age_days,
  COUNT(*) FILTER (WHERE NOT is_won AND NOT is_lost)                   AS open_deals
FROM v_deals_enriched;

CREATE VIEW v_rep_scorecard AS
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
  COUNT(d.id) FILTER (WHERE d.is_stale)                                              AS stale_deals
FROM users u
LEFT JOIN v_deals_enriched d ON d.owner_user_id = u.id
WHERE u.role IN ('sales_rep','sales_lead') AND u.is_active
GROUP BY u.id, u.full_name;

CREATE VIEW v_stage_conversion AS
WITH moves AS (
  SELECT h.*, s.position AS to_pos,
         LEAD(h.changed_at) OVER (PARTITION BY h.deal_id ORDER BY h.changed_at) AS left_at,
         LEAD(h.to_stage_id) OVER (PARTITION BY h.deal_id ORDER BY h.changed_at) AS next_stage_id
  FROM deal_stage_history h JOIN pipeline_stages s ON s.id = h.to_stage_id
)
SELECT s.key, s.name, s.position,
       COUNT(*)                                                   AS entered,
       COUNT(*) FILTER (WHERE ns.position > s.position AND NOT ns.is_lost) AS moved_on,
       COUNT(*) FILTER (WHERE ns.is_lost)                         AS lost_here,
       ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM m.left_at - m.changed_at) / 86400)::numeric, 1) AS median_days_in_stage
FROM moves m
JOIN pipeline_stages s       ON s.id = m.to_stage_id
LEFT JOIN pipeline_stages ns ON ns.id = m.next_stage_id
WHERE NOT s.is_won AND NOT s.is_lost
GROUP BY s.key, s.name, s.position
ORDER BY s.position;

CREATE VIEW v_ad_leakage_daily AS
SELECT a.id AS ad_id, a.name AS ad_name, ast.name AS ad_set_name, ast.product_line, c.owner_user_id,
       i.date, i.spend, i.link_clicks, i.meta_conversations,
       COUNT(l.id)                                              AS crm_leads,
       ROUND(i.meta_conversations::numeric / NULLIF(i.link_clicks, 0), 3) AS meta_click_to_chat,
       ROUND(COUNT(l.id)::numeric / NULLIF(i.meta_conversations, 0), 3)    AS chats_captured,
       COUNT(l.deal_id)                                         AS leads_to_deals
FROM ad_insights_daily i
JOIN ads a          ON a.id = i.ad_id
JOIN ad_sets ast    ON ast.id = a.ad_set_id
JOIN ad_campaigns c ON c.id = ast.campaign_id
LEFT JOIN leads l   ON l.ad_id = a.id
                   AND (l.received_at AT TIME ZONE 'Asia/Jakarta')::date = i.date
GROUP BY a.id, a.name, ast.name, ast.product_line, c.owner_user_id,
         i.date, i.spend, i.link_clicks, i.meta_conversations;

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
     WHERE po.product_id = p.id AND po.status = 'open')                            AS open_po_units
FROM products p
WHERE p.is_active;
