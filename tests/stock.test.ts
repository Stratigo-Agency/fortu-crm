import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { csvField, stockCsv } from "@/lib/exportCsv";
import { canOpenStock } from "@/lib/shell";
import { mayOpenStock, parseStockFilter, stockHref, stockRows, stockSummary } from "@/lib/stock";
import { createDeal, createProduct, createUser } from "./fixtures";

// Stok & Permintaan (T21). The screen reads v_stock_cover; every value must equal v_sku_demand
// (which Laporan and the SQL formulas already trust) for the same product.

async function line(ownerId: string, productId: string, stage: "negotiation" | "po", qty: number) {
  const d = await createDeal(ownerId);
  await sql`INSERT INTO deal_line_items (deal_id, product_id, qty, unit_price) VALUES (${d.id}, ${productId}, ${qty}, 10000000)`;
  await sql`UPDATE deals SET stage_id = (SELECT id FROM pipeline_stages WHERE key = ${stage}),
                   expected_close_date = jakarta_today() + 10, next_step_date = jakarta_today() + 3 WHERE id = ${d.id}`;
}

const snapshot = (productId: string, daysAgo: number, qty: number, warehouse = "main") =>
  sql`INSERT INTO inventory_snapshots (product_id, snapshot_date, warehouse, qty_on_hand) VALUES (${productId}, jakarta_today() - ${daysAgo}::int, ${warehouse}, ${qty})`;
const sold = (productId: string, monthsAgo: number, qty: number) =>
  sql`INSERT INTO sales_monthly (product_id, period_month, qty_sold) VALUES (${productId}, (date_trunc('month', jakarta_today()) - make_interval(months => ${monthsAgo}))::date, ${qty})`;
const po = (productId: string, qty: number, status = "open") =>
  sql`INSERT INTO purchase_orders (product_id, qty, status) VALUES (${productId}, ${qty}, ${status})`;

async function seed() {
  const rep = await createUser();
  // thin: sold 6/month, stock 2 + 1 open PO unit = 3 units -> 0,5 month of cover; 5 units sit at PO stage (more than stock)
  const thin = await createProduct({ line: "LED" });
  await snapshot(thin.id, 5, 99); // older snapshot must be ignored
  await snapshot(thin.id, 0, 1, "main");
  await snapshot(thin.id, 0, 1, "demo"); // warehouses add up
  await po(thin.id, 1);
  await po(thin.id, 50, "received"); // closed PO must be ignored
  for (const m of [1, 2, 3]) await sold(thin.id, m, 6);
  await line(rep.id, thin.id, "po", 5);
  // safe: stock 100, little demand
  const safe = await createProduct({ line: "IFP" });
  await snapshot(safe.id, 0, 100);
  for (const m of [1, 2, 3]) await sold(safe.id, m, 2); // all 3 months have a row, so v_sku_demand agrees
  // pipeline-driven: no sales history, 30 weighted-ish units in negotiation
  const pipe = await createProduct({ line: "IFP" });
  await snapshot(pipe.id, 0, 20);
  await line(rep.id, pipe.id, "negotiation", 30);
  // unknown stock: no snapshot at all
  const unknown = await createProduct({ line: "DSS" });
  for (const m of [1, 2, 3]) await sold(unknown.id, m, 4);
  // no demand at all
  const idle = await createProduct({ line: "IFP" });
  await snapshot(idle.id, 0, 7);
  return { thin, safe, pipe, unknown, idle };
}

const only = async (ids: string[], f = { line: null, risk: false } as Parameters<typeof stockRows>[0]) =>
  (await stockRows(f)).filter((r) => ids.includes(r.productId));

describe("Stok & Permintaan", () => {
  it("shows the same numbers as v_sku_demand and computes cover in SQL", async () => {
    const s = await seed();
    const ids = Object.values(s).map((p) => p.id);
    const rows = await only(ids);
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      const [d] = await sql<Record<string, string | number | null>[]>`
        SELECT avg_monthly_sold_3m::text AS sold, units_in_pipeline AS pipeline, weighted_pipeline_units::text AS weighted,
               units_at_po AS at_po, qty_on_hand AS stock, open_po_units AS open_po
          FROM v_sku_demand WHERE product_id = ${r.productId}`;
      expect(r.soldPerMonth).toBe(d.sold);
      expect(r.unitsInPipeline).toBe(Number(d.pipeline));
      expect(r.weightedUnits).toBe(d.weighted);
      expect(r.unitsAtPo).toBe(Number(d.at_po));
      expect(r.stock).toBe(d.stock === null ? null : Number(d.stock));
      expect(r.openPo).toBe(Number(d.open_po));
    }
    const byId = Object.fromEntries(rows.map((r) => [r.productId, r]));

    // thin: latest snapshot only, both warehouses, open PO only
    const thin = byId[s.thin.id];
    expect([thin.stock, thin.openPo, thin.soldPerMonth, thin.unitsAtPo]).toEqual([2, 1, "6.0", 5]);
    expect(thin.coverMonths).toBe("0.5"); // (2 + 1) / max(6, weighted/3)
    expect(thin.coverShort).toBe(true);
    expect(thin.poExceedsStock).toBe(true);

    // safe: (100 + 0) / 2 = 50 months
    expect(byId[s.safe.id]).toMatchObject({ coverMonths: "50.0", coverShort: false, poExceedsStock: false });

    // pipeline-driven: need = weighted/3, from the stage probability in the database
    const pipe = byId[s.pipe.id];
    const [{ p }] = await sql<{ p: string }[]>`SELECT probability::text AS p FROM pipeline_stages WHERE key = 'negotiation'`;
    const need = (30 * Number(p)) / 3;
    expect(Number(pipe.weightedUnits)).toBeCloseTo(30 * Number(p), 1);
    expect(Number(pipe.coverMonths)).toBeCloseTo(20 / Number(pipe.weightedUnits) * 3, 0);
    expect(need).toBeGreaterThan(0);

    // no snapshot: cover unknown and never flagged
    expect(byId[s.unknown.id]).toMatchObject({ stock: null, coverMonths: null, coverShort: false, poExceedsStock: false });
    // no demand: no cover figure, not flagged
    expect(byId[s.idle.id]).toMatchObject({ stock: 7, coverMonths: null, coverShort: false });
  });

  it("filters by product line and by risk, and lists risky SKUs first", async () => {
    const s = await seed();
    const ids = Object.values(s).map((p) => p.id);
    expect((await only(ids, { line: "LED", risk: false })).map((r) => r.productId)).toEqual([s.thin.id]);
    expect((await only(ids, { line: "DSS", risk: false })).map((r) => r.productId)).toEqual([s.unknown.id]);
    expect((await only(ids, { line: null, risk: true })).map((r) => r.productId)).toEqual([s.thin.id]);
    expect((await only(ids, { line: "IFP", risk: true }))).toEqual([]);
    expect((await only(ids))[0].productId).toBe(s.thin.id);
  });

  it("flags a PO stage above stock even when cover is long", async () => {
    const rep = await createUser();
    const p = await createProduct();
    await snapshot(p.id, 0, 3);
    await po(p.id, 500);
    await line(rep.id, p.id, "po", 4);
    const [r] = await only([p.id]);
    expect(r.coverShort).toBe(false);
    expect(r.poExceedsStock).toBe(true);
  });

  it("summary counts the at-risk rows of the view, and the subtitle date is the latest snapshot", async () => {
    const seeded = await seed();
    const mine = Object.values(seeded).map((p) => p.id);
    const sum = await stockSummary();
    // other test files write to the same database at the same time, so only the rows made here are compared exactly
    expect((await only(mine, { line: null, risk: true })).map((r) => r.productId)).toEqual([seeded.thin.id]);
    expect(sum.atRisk).toBeGreaterThanOrEqual(1);
    expect(sum.skus).toBeGreaterThanOrEqual(5);
    const [today] = await sql<{ d: string }[]>`SELECT jakarta_today()::text AS d`;
    expect(sum.lastSnapshot! >= today.d).toBe(true);
  });

  it("exports the same rows as the table, with the filter, safe for spreadsheets", async () => {
    const s = await seed();
    const csv = await stockCsv({ line: "LED", risk: true });
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe("sku;nama;lini;terjual_per_bulan;unit_di_pipeline;perkiraan_unit;di_tahap_po;stok;stok_per;po_terbuka;bulan_cakupan;berisiko");
    const mine = lines.filter((l) => l.startsWith(`${s.thin.sku};`));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toContain(";LED;6;");
    expect(mine[0]).toMatch(/;2;\d{4}-\d{2}-\d{2};1;0\.5;ya$/);
    expect(lines.some((l) => l.startsWith(`${s.safe.sku};`))).toBe(false);
    expect(csvField("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
  });

  it("adds up the latest snapshot of each warehouse, even when they were counted on different days", async () => {
    const p = await createProduct();
    await snapshot(p.id, 9, 50, "A"); // older A snapshot: ignored
    await snapshot(p.id, 6, 10, "A");
    await snapshot(p.id, 3, 4, "B");
    const [r] = await only([p.id]);
    expect(r.stock).toBe(14);
    expect(r.stockDate).toBe((await sql<{ d: string }[]>`SELECT (jakarta_today() - 3)::text AS d`)[0].d); // the SKU's newest snapshot
    expect(r.stockStale).toBe(false);
  });

  it("marks stock as old when the SKU's newest snapshot is more than 3 days old", async () => {
    const old = await createProduct();
    const edge = await createProduct();
    await snapshot(old.id, 4, 5);
    await snapshot(edge.id, 3, 5);
    const rows = await only([old.id, edge.id]);
    expect(Object.fromEntries(rows.map((r) => [r.productId, r.stockStale]))).toEqual({ [old.id]: true, [edge.id]: false });
  });

  it("keeps a SKU with PO units but no stock figure in the risk list, without the late flags", async () => {
    const rep = await createUser();
    const p = await createProduct();
    await line(rep.id, p.id, "po", 3);
    const [r] = await only([p.id], { line: null, risk: true });
    expect(r).toMatchObject({ stock: null, stockDate: null, coverMonths: null, coverShort: false, poExceedsStock: false, poWithoutStock: true, atRisk: true });
    const quiet = await createProduct();
    await sold(quiet.id, 1, 3);
    expect(await only([quiet.id], { line: null, risk: true })).toEqual([]);
    expect((await stockSummary()).atRisk).toBeGreaterThan(0);
  });

  it("flags short cover from the rounded number the screen shows", async () => {
    const a = await createProduct();
    const b = await createProduct();
    for (const p of [a, b]) for (const m of [1, 2, 3]) await sold(p.id, m, 25);
    await snapshot(a.id, 0, 24); // 24 / 25 = 0,96 -> shown as 1,0 -> not short
    await snapshot(b.id, 0, 23); // 0,92 -> shown as 0,9 -> short
    const rows = Object.fromEntries((await only([a.id, b.id])).map((r) => [r.productId, r]));
    expect(rows[a.id]).toMatchObject({ coverMonths: "1.0", coverShort: false });
    expect(rows[b.id]).toMatchObject({ coverMonths: "0.9", coverShort: true });
  });

  it("averages the last 3 full Jakarta months and counts a month without a row as 0", async () => {
    const p = await createProduct();
    await sold(p.id, 1, 6); // months 2 and 3 have no row
    await sold(p.id, 4, 100); // outside the window
    const [r] = await only([p.id]);
    expect(r.soldPerMonth).toBe("2.0");
    const [{ m }] = await sql<{ m: string }[]>`SELECT date_trunc('month', jakarta_today())::date::text AS m`;
    await sql`INSERT INTO sales_monthly (product_id, period_month, qty_sold) VALUES (${p.id}, ${m}, 900)`; // this month is not a full month
    expect((await only([p.id]))[0].soldPerMonth).toBe("2.0");
    const none = await createProduct();
    expect((await only([none.id]))[0].soldPerMonth).toBeNull();
  });

  it("checks the role in the database, not the session", async () => {
    const lead = await createUser({ role: "sales_lead" });
    const rep = await createUser();
    expect(await mayOpenStock(lead.id)).toBe(true);
    expect(await mayOpenStock(rep.id)).toBe(false);
    await sql`UPDATE users SET is_active = false WHERE id = ${lead.id}`;
    expect(await mayOpenStock(lead.id)).toBe(false);
  });

  it("only admin, ceo and sales_lead may open it; the filter in the URL ignores junk", () => {
    expect(["admin", "ceo", "sales_lead"].every((role) => canOpenStock({ role: role as "admin" }))).toBe(true);
    expect(["sales_rep", "marketing"].some((role) => canOpenStock({ role: role as "admin" }))).toBe(false);
    expect(parseStockFilter({ lini: "LED", berisiko: "1" })).toEqual({ line: "LED", risk: true });
    expect(parseStockFilter({ lini: "x'; DROP", berisiko: "yes" })).toEqual({ line: null, risk: false });
    expect(stockHref("/stok", { line: "IFP", risk: true })).toBe("/stok?lini=IFP&berisiko=1");
    expect(stockHref("/stok", { line: null, risk: false })).toBe("/stok");
  });
});
