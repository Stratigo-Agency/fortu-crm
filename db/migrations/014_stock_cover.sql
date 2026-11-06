-- Stok & Permintaan: v_sku_demand plus the monthly need, the cover in months and the "at risk" flag,
-- so the screen and the CSV only pick rows (CLAUDE.md rule 5).
--
-- need per month = the larger of what we sold per month (average of the last 3 full months)
--                  and what the open pipeline is expected to ask per month (weighted units spread over 3 months).
-- cover (months) = (stock + open PO units) / need per month. No need = no cover figure.
-- A SKU with no stock snapshot has unknown stock: no cover and never flagged (Accurate may not be connected yet).
-- At risk = cover under 1 month, or units at the PO stage above the stock on hand.
CREATE VIEW v_stock_cover AS
SELECT d.product_id, d.sku, d.name, d.product_line,
       d.avg_monthly_sold_3m, d.units_in_pipeline, d.weighted_pipeline_units, d.units_at_po,
       d.qty_on_hand, d.open_po_units,
       ROUND(d.weighted_pipeline_units / 3, 1)                                        AS forecast_per_month,
       n.need_per_month,
       CASE WHEN d.qty_on_hand IS NOT NULL AND n.need_per_month > 0
            THEN ROUND((d.qty_on_hand + d.open_po_units) / n.need_per_month, 1) END   AS cover_months,
       (d.qty_on_hand IS NOT NULL AND n.need_per_month > 0
          AND (d.qty_on_hand + d.open_po_units) / n.need_per_month < 1)               AS cover_short,
       (d.qty_on_hand IS NOT NULL AND d.units_at_po > d.qty_on_hand)                  AS po_exceeds_stock
  FROM v_sku_demand d
  CROSS JOIN LATERAL (SELECT GREATEST(COALESCE(d.avg_monthly_sold_3m, 0), d.weighted_pipeline_units / 3) AS need_per_month) n;
