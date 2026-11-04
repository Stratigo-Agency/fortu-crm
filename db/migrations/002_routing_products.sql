-- Fortu CRM · migration 002 · 3 Nov 2026
-- 1) Flexible lead routing: rep specialisation + availability, ownership change log
-- 2) Accurate fields on products + seed from daftar-barang_accurate.xlsx (32 items)

-- ───────── Routing ─────────
ALTER TABLE users RENAME COLUMN receives_round_robin TO accepting_leads;   -- availability toggle for auto-assignment
ALTER TABLE users ALTER COLUMN accepting_leads SET DEFAULT true;
ALTER TABLE users ADD COLUMN product_lines product_line[] NOT NULL DEFAULT '{}';  -- specialisation; empty = takes any line
ALTER TABLE users ADD COLUMN google_sub text UNIQUE;                       -- set on first Google sign-in
ALTER TABLE users ADD COLUMN last_login_at timestamptz;

CREATE TYPE ownership_reason AS ENUM ('auto_assign','manual_reassign','rep_unavailable','specialisation','rep_offboarded');

CREATE TABLE ownership_changes (
  id                    bigserial PRIMARY KEY,
  lead_id               uuid REFERENCES leads(id) ON DELETE CASCADE,
  deal_id               uuid REFERENCES deals(id) ON DELETE CASCADE,
  from_user_id          uuid REFERENCES users(id),
  to_user_id            uuid NOT NULL REFERENCES users(id),
  reason                ownership_reason NOT NULL,
  note                  text,
  changed_by            uuid REFERENCES users(id),     -- null = system
  changed_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (lead_id IS NOT NULL OR deal_id IS NOT NULL)
);
CREATE INDEX ON ownership_changes (lead_id);
CREATE INDEX ON ownership_changes (deal_id);

-- Auto-assignment pick: available reps who cover the product line, fewest open new leads, then longest since last assignment.
CREATE FUNCTION pick_lead_owner(p_line product_line) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT u.id
  FROM users u
  WHERE u.is_active AND u.accepting_leads AND u.role IN ('sales_rep','sales_lead')
    AND (p_line IS NULL OR cardinality(u.product_lines) = 0 OR p_line = ANY (u.product_lines))
  ORDER BY (SELECT count(*) FROM leads l WHERE l.owner_user_id = u.id AND l.status = 'new'),
           (SELECT max(oc.changed_at) FROM ownership_changes oc WHERE oc.to_user_id = u.id) NULLS FIRST,
           u.full_name
  LIMIT 1
$$;

-- ───────── Products: Accurate fields ─────────
CREATE TYPE item_type AS ENUM ('inventory','non_inventory','service');   -- Accurate "Jenis Barang": INV / NON / SVC
ALTER TABLE products ADD COLUMN accurate_category text;   -- raw "Kategori Barang", e.g. 'DS WALL'
ALTER TABLE products ADD COLUMN item_type item_type NOT NULL DEFAULT 'inventory';
ALTER TABLE products ADD COLUMN unit text NOT NULL DEFAULT 'UNIT';
ALTER TABLE products ADD COLUMN barcode text;
COMMENT ON COLUMN products.sku IS 'Accurate "Kode Barang" (item no). accurate_item_id = Accurate internal id, filled by the first API sync.';

-- Only stocked items belong in the demand forecast.
CREATE OR REPLACE VIEW v_sku_demand AS
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
WHERE p.is_active AND p.item_type = 'inventory';
