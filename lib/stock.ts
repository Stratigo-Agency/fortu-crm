import type { Role } from "@/lib/auth";
import { sql } from "@/lib/db";
import { canOpenStock } from "@/lib/shell";
import type { StockFilter, StockLine } from "@/lib/stockFilter";

export { parseStockFilter, STOCK_LINES, stockHref } from "@/lib/stockFilter";
export type { StockFilter, StockLine } from "@/lib/stockFilter";

// Numbers for /stok. Every figure comes from the SQL view v_stock_cover (CLAUDE.md rule 5);
// this file only picks and filters rows.

export type StockRow = {
  productId: string;
  sku: string;
  name: string;
  productLine: StockLine | null;
  soldPerMonth: string | null; // average of the last 3 full months
  unitsInPipeline: number;
  weightedUnits: string;
  forecastPerMonth: string;
  unitsAtPo: number;
  stock: number | null; // null = no stock snapshot for this SKU
  stockDate: string | null; // newest snapshot of this SKU (Jakarta date)
  stockStale: boolean; // that snapshot is more than 3 days old
  openPo: number;
  coverMonths: string | null;
  coverShort: boolean;
  poExceedsStock: boolean;
  atRisk: boolean;
  poWithoutStock: boolean; // units at PO but no stock figure: unknown, not "late"
};

export type StockSummary = { skus: number; atRisk: number; unitsAtPo: number; lastSnapshot: string | null };

/** At risk first, then the shortest cover, then by name. */
export async function stockRows(f: StockFilter): Promise<StockRow[]> {
  return sql<StockRow[]>`
    SELECT product_id AS "productId", sku, name, product_line::text AS "productLine",
           avg_monthly_sold_3m::text AS "soldPerMonth", units_in_pipeline::int AS "unitsInPipeline",
           weighted_pipeline_units::text AS "weightedUnits", forecast_per_month::text AS "forecastPerMonth",
           units_at_po::int AS "unitsAtPo", qty_on_hand::int AS stock, open_po_units::int AS "openPo",
           stock_date::text AS "stockDate", stock_stale AS "stockStale",
           cover_months::text AS "coverMonths", cover_short AS "coverShort", po_exceeds_stock AS "poExceedsStock",
           po_without_stock AS "poWithoutStock", at_risk AS "atRisk"
      FROM v_stock_cover
     WHERE (${f.line}::text IS NULL OR product_line::text = ${f.line})
       AND (NOT ${f.risk} OR at_risk)
     ORDER BY at_risk DESC, cover_months ASC NULLS LAST, name, sku`;
}

/** Figures for the strip, always over all SKUs (the filters only narrow the table). */
export async function stockSummary(): Promise<StockSummary> {
  const [row] = await sql<{ skus: number; atRisk: number; unitsAtPo: number; lastSnapshot: string | null }[]>`
    SELECT count(*)::int AS skus,
           count(*) FILTER (WHERE at_risk)::int AS "atRisk",
           COALESCE(sum(units_at_po), 0)::int AS "unitsAtPo",
           (SELECT max(snapshot_date)::text FROM inventory_snapshots) AS "lastSnapshot"
      FROM v_stock_cover`;
  return row;
}

/** May this user open Stok? The role is read from the database, not taken from the session cookie. */
export async function mayOpenStock(userId: string): Promise<boolean> {
  const [u] = await sql<{ role: Role }[]>`SELECT role FROM users WHERE id = ${userId} AND is_active`;
  return !!u && canOpenStock(u);
}
