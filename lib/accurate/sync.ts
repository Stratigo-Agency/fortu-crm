import { sql } from "@/lib/db";
import type { AccurateClient } from "./client";
import { accurateDate, isOpenPo, mapItem, mapPoLines, mapSales, mapStock, type AItem, type APoLine, type ASale, type AStock } from "./map";

// Accurate → CRM, read-only on the Accurate side. products, inventory_snapshots, purchase_orders, sales_monthly.
// Rules: a name or list_price already in the CRM is never overwritten; a price from Accurate fills only an empty CRM
// price and only when it is above 0 (the first export had Rp0 everywhere); is_active is never touched.

export type AccurateData = { items: AItem[]; stock: AStock[]; poLines: APoLine[]; sales: ASale[] };
export type FetchOptions = { today: string; months?: number; poMonths?: number; maxInvoices?: number };
type Raw = Record<string, unknown>;

const detailOf = (r: unknown): Raw => ((r as { d?: Raw }).d ?? {}) as Raw;
const addMonths = (iso: string, n: number) => {
  const d = new Date(`${iso.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};

/** Only GET calls through the client. */
export async function fetchAccurate(c: AccurateClient, o: FetchOptions): Promise<AccurateData> {
  const items = (await c.listAll<Raw>("/api/item/list.do", { fields: "id,no,name,itemType,unit1Name,barcode,unitPrice,suspended,itemCategory" }))
    .map(mapItem).filter((x): x is AItem => !!x);

  const warehouses = (await c.listAll<Raw>("/api/warehouse/list.do", { fields: "id,name" })).map((w) => String(w.name ?? "")).filter(Boolean);
  const stock: AStock[] = [];
  if (warehouses.length === 0) {
    for (const r of await c.listAll<Raw>("/api/item/list-stock.do")) { const s = mapStock(r, "main"); if (s) stock.push(s); }
  }
  for (const w of warehouses) {
    for (const r of await c.listAll<Raw>("/api/item/list-stock.do", { warehouseName: w })) { const s = mapStock(r, w); if (s) stock.push(s); }
  }

  const poFrom = addMonths(o.today, -(o.poMonths ?? 12));
  const pos = await c.listAll<Raw>("/api/purchase-order/list.do", {
    fields: "id,number,transDate,statusName", "filter.transDate.op": "GREATER_EQUAL_THAN", "filter.transDate.val": accurateDate(poFrom),
  });
  const poLines: APoLine[] = [];
  for (const po of pos.filter((p) => isOpenPo(p.statusName))) {
    poLines.push(...mapPoLines(detailOf(await c.get("/api/purchase-order/detail.do", { id: String(po.id) }))));
  }

  const from = addMonths(o.today, -((o.months ?? 3) - 1));
  const invoices = await c.listAll<Raw>("/api/sales-invoice/list.do", {
    fields: "id,number,transDate", "filter.transDate.op": "BETWEEN", "filter.transDate.val": [accurateDate(from), accurateDate(o.today)],
  });
  if (invoices.length > (o.maxInvoices ?? 5000)) throw new Error(`Too many invoices (${invoices.length}); narrow the window`);
  const details: Raw[] = [];
  for (const inv of invoices) details.push(detailOf(await c.get("/api/sales-invoice/detail.do", { id: String(inv.id) })));
  return { items, stock, poLines, sales: mapSales(details) };
}

type ProductRow = { id: string; sku: string; name: string; list_price: string | null; accurate_item_id: string | null; item_type: string; unit: string; barcode: string | null; accurate_category: string | null };
export type ProductChange = { sku: string; id: string; set: Partial<Record<"accurate_item_id" | "item_type" | "unit" | "barcode" | "accurate_category" | "name" | "list_price", string | number>> };
export type Plan = {
  products: ProductChange[];
  stock: { productId: string; sku: string; warehouse: string; qty: number }[];
  po: { insert: (APoLine & { productId: string })[]; update: (APoLine & { productId: string })[]; close: string[] };
  sales: (ASale & { productId: string })[];
  onlyInAccurate: { sku: string; name: string }[];
  onlyInCrm: { sku: string; name: string }[];
  conflicts: string[];
};

type Db = typeof sql;

export async function buildPlan(data: AccurateData, db: Db = sql): Promise<Plan> {
  const prods = await db<ProductRow[]>`SELECT id, sku, name, list_price::text, accurate_item_id, item_type::text, unit, barcode, accurate_category FROM products`;
  const bySku = new Map(prods.map((p) => [p.sku, p]));
  const aSkus = new Set(data.items.map((i) => i.sku));
  const idOwner = new Map(prods.filter((p) => p.accurate_item_id).map((p) => [p.accurate_item_id!, p.sku]));
  const conflicts: string[] = [];

  const products: ProductChange[] = [];
  for (const it of data.items) {
    const p = bySku.get(it.sku);
    if (!p) continue;
    const set: ProductChange["set"] = {};
    if (it.accurateId && p.accurate_item_id !== it.accurateId) {
      const owner = idOwner.get(it.accurateId);
      if (owner && owner !== p.sku) conflicts.push(`${it.sku}: Accurate id ${it.accurateId} already belongs to ${owner} in the CRM`);
      else set.accurate_item_id = it.accurateId;
    }
    if (p.item_type !== it.itemType) set.item_type = it.itemType;
    if (it.unit && p.unit !== it.unit) set.unit = it.unit;
    if (it.barcode && p.barcode !== it.barcode) set.barcode = it.barcode;
    if (it.category && p.accurate_category !== it.category) set.accurate_category = it.category;
    if (!p.name.trim() && it.name) set.name = it.name;
    if ((p.list_price === null || Number(p.list_price) === 0) && it.price > 0) set.list_price = it.price;
    if (Object.keys(set).length) products.push({ sku: it.sku, id: p.id, set });
  }

  const onlyInAccurate = data.items.filter((i) => !bySku.has(i.sku)).map((i) => ({ sku: i.sku, name: i.name }));
  const onlyInCrm = prods.filter((p) => !aSkus.has(p.sku)).map((p) => ({ sku: p.sku, name: p.name }));

  const inventorySkus = new Set(data.items.filter((i) => i.itemType === "inventory").map((i) => i.sku));
  const stock = data.stock.flatMap((s) => {
    const p = bySku.get(s.sku);
    return p && inventorySkus.has(s.sku) ? [{ productId: p.id, sku: s.sku, warehouse: s.warehouse, qty: s.qty }] : [];
  });

  const existing = await db<{ id: string; accurate_po_id: string; product_id: string; qty: number; eta_date: string | null; status: string }[]>`
    SELECT id, accurate_po_id, product_id, qty, to_char(eta_date, 'YYYY-MM-DD') AS eta_date, status FROM purchase_orders WHERE accurate_po_id IS NOT NULL`;
  const exMap = new Map(existing.map((e) => [e.accurate_po_id, e]));
  const seen = new Set<string>();
  const po: Plan["po"] = { insert: [], update: [], close: [] };
  for (const l of data.poLines) {
    const p = bySku.get(l.sku);
    if (!p) continue;
    seen.add(l.lineKey);
    const row = { ...l, productId: p.id };
    const e = exMap.get(l.lineKey);
    if (!e) po.insert.push(row);
    else if (e.product_id !== p.id || e.qty !== l.qty || e.eta_date !== l.eta || e.status !== "open") po.update.push(row);
  }
  // Lines we saved earlier that Accurate no longer lists as open: received or closed there. Hand-made POs (no accurate_po_id) stay.
  for (const e of existing) if (e.status === "open" && !seen.has(e.accurate_po_id)) po.close.push(e.accurate_po_id);

  const sales = data.sales.flatMap((s) => {
    const p = bySku.get(s.sku);
    return p ? [{ ...s, productId: p.id }] : [];
  });
  return { products, stock, po, sales, onlyInAccurate, onlyInCrm, conflicts };
}

export async function applyPlan(plan: Plan, today: string, db: Db = sql): Promise<void> {
  await db.begin(async (t) => {
    for (const c of plan.products) {
      const s = c.set;
      await t`UPDATE products SET
          accurate_item_id = COALESCE(${(s.accurate_item_id as string) ?? null}, accurate_item_id),
          item_type = COALESCE(${(s.item_type as string) ?? null}::item_type, item_type),
          unit = COALESCE(${(s.unit as string) ?? null}, unit),
          barcode = COALESCE(${(s.barcode as string) ?? null}, barcode),
          accurate_category = COALESCE(${(s.accurate_category as string) ?? null}, accurate_category),
          name = CASE WHEN btrim(name) = '' THEN COALESCE(${(s.name as string) ?? null}, name) ELSE name END,
          list_price = CASE WHEN (list_price IS NULL OR list_price = 0) THEN COALESCE(${(s.list_price as number) ?? null}::numeric, list_price) ELSE list_price END
        WHERE id = ${c.id}`;
    }
    for (const s of plan.stock) {
      await t`INSERT INTO inventory_snapshots (product_id, snapshot_date, warehouse, qty_on_hand) VALUES (${s.productId}, ${today}::date, ${s.warehouse}, ${s.qty})
        ON CONFLICT (product_id, snapshot_date, warehouse) DO UPDATE SET qty_on_hand = EXCLUDED.qty_on_hand`;
    }
    for (const l of plan.po.insert) {
      await t`INSERT INTO purchase_orders (product_id, qty, eta_date, status, accurate_po_id) VALUES (${l.productId}, ${l.qty}, ${l.eta}::date, 'open', ${l.lineKey})`;
    }
    for (const l of plan.po.update) {
      await t`UPDATE purchase_orders SET product_id = ${l.productId}, qty = ${l.qty}, eta_date = ${l.eta}::date, status = 'open' WHERE accurate_po_id = ${l.lineKey}`;
    }
    if (plan.po.close.length) await t`UPDATE purchase_orders SET status = 'received' WHERE accurate_po_id IN ${t(plan.po.close)} AND status = 'open'`;
    for (const s of plan.sales) {
      await t`INSERT INTO sales_monthly (product_id, period_month, qty_sold, revenue) VALUES (${s.productId}, ${s.month}::date, ${s.qty}, ${s.revenue})
        ON CONFLICT (product_id, period_month) DO UPDATE SET qty_sold = EXCLUDED.qty_sold, revenue = EXCLUDED.revenue`;
    }
  });
}

export function summarize(plan: Plan) {
  return {
    productsChanged: plan.products.length, stockRows: plan.stock.length,
    poNew: plan.po.insert.length, poUpdated: plan.po.update.length, poClosed: plan.po.close.length,
    salesRows: plan.sales.length, onlyInAccurate: plan.onlyInAccurate.length, onlyInCrm: plan.onlyInCrm.length, conflicts: plan.conflicts.length,
  };
}
