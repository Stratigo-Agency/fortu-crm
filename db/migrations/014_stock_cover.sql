-- Stok & Permintaan: pipeline demand from v_sku_demand, plus stock, sales, cover and the "at risk" flags,
-- so the screen and the CSV only pick rows (CLAUDE.md rule 5). v_sku_demand itself is left as it is
-- (other screens use it); the figures that need a stricter reading are computed here.
--
-- stock          = the latest snapshot of each warehouse, added up. A warehouse that last reported
--                  3 days ago still counts with that number. stock_date = the SKU's newest snapshot,
--                  stock_stale = that date is more than 3 days old (Jakarta).
-- sold per month = the last 3 full months in Jakarta time, divided by 3: a month without a
--                  sales_monthly row counts as 0. No row at all in those months = no figure.
-- need per month = the larger of sold per month and the weighted open pipeline units / 3.
-- cover (months) = (stock + open PO units) / need per month, shown with one decimal; cover_short
--                  compares that same rounded number, so what the screen says matches the flag.
--                  No need = no cover figure.
-- A SKU with no snapshot has unknown stock: no cover, not flagged as short. If units already sit at
-- the PO stage, po_without_stock puts it in the risk list (shown quietly, not as late).
-- At risk = cover under 1 month, PO units above the stock on hand, or PO units with unknown stock.
CREATE VIEW v_stock_cover AS
SELECT d.product_id, d.sku, d.name, d.product_line,
       sold.avg_sold                                                                   AS avg_monthly_sold_3m,
       d.units_in_pipeline, d.weighted_pipeline_units, d.units_at_po,
       st.qty_on_hand, st.stock_date, d.open_po_units,
       (st.stock_date IS NOT NULL AND st.stock_date < jakarta_today() - 3)             AS stock_stale,
       ROUND(d.weighted_pipeline_units / 3, 1)                                         AS forecast_per_month,
       n.need_per_month,
       c.cover_months,
       (c.cover_months IS NOT NULL AND c.cover_months < 1)                             AS cover_short,
       (st.qty_on_hand IS NOT NULL AND d.units_at_po > st.qty_on_hand)                 AS po_exceeds_stock,
       (st.qty_on_hand IS NULL AND d.units_at_po > 0)                                  AS po_without_stock,
       ((c.cover_months IS NOT NULL AND c.cover_months < 1)
        OR (st.qty_on_hand IS NOT NULL AND d.units_at_po > st.qty_on_hand)
        OR (st.qty_on_hand IS NULL AND d.units_at_po > 0))                             AS at_risk
  FROM v_sku_demand d
  CROSS JOIN LATERAL (
    SELECT sum(w.qty_on_hand) AS qty_on_hand, max(w.snapshot_date) AS stock_date
      FROM (SELECT DISTINCT ON (s.warehouse) s.qty_on_hand, s.snapshot_date
              FROM inventory_snapshots s
             WHERE s.product_id = d.product_id
             ORDER BY s.warehouse, s.snapshot_date DESC) w
  ) st
  CROSS JOIN LATERAL (
    SELECT CASE WHEN count(*) = 0 THEN NULL ELSE ROUND(sum(sm.qty_sold)::numeric / 3, 1) END AS avg_sold
      FROM sales_monthly sm
     WHERE sm.product_id = d.product_id
       AND sm.period_month >= (date_trunc('month', jakarta_today()) - interval '3 months')::date
       AND sm.period_month <  date_trunc('month', jakarta_today())::date
  ) sold
  CROSS JOIN LATERAL (
    SELECT GREATEST(COALESCE(sold.avg_sold, 0), d.weighted_pipeline_units / 3) AS need_per_month
  ) n
  CROSS JOIN LATERAL (
    SELECT CASE WHEN st.qty_on_hand IS NOT NULL AND n.need_per_month > 0
                THEN ROUND((st.qty_on_hand + d.open_po_units) / n.need_per_month, 1) END AS cover_months
  ) c;
