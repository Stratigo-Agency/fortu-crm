import { sql } from "@/lib/db";
import type { AccurateClient } from "./client";
import { accurateDate, mapItem, poState, mapPoLines, mapSales, mapStock, type AItem, type APoLine, type ASale, type AStock, type PoState } from "./map";

// Accurate → CRM, read-only on the Accurate side. products, inventory_snapshots, purchase_orders, sales_monthly.
// Rules: a name or list_price already in the CRM is never overwritten; a price from Accurate fills only an empty CRM
// price and only when it is above 0 (the first export had Rp0 everywhere); is_active is never touched.

export type AccurateData = {
  items: AItem[]; stock: AStock[]; poLines: APoLine[]; sales: ASale[];
  /** every PO the list call returned (inside the PO window) with its status, and the POs whose detail was read */
  pos: { id: string; state: PoState }[]; poDetailed: string[];
};
export type FetchOptions = { today: string; months?: number; poMonths?: number; maxInvoices?: number; throttleMs?: number; sleep?: (ms: number) => Promise<void> };

/** Today's date in Jakarta (yyyy-MM-dd); 17:00-24:00 UTC is already the next day there. */
export function jakartaToday(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(d);
}

/** At most this share of the open saved lines (minimum MIN_CLOSES) may be closed in one run. */
export const MAX_CLOSE_SHARE = 0.25;
export const MIN_CLOSES = 5;
const poIdOf = (lineKey: string) => lineKey.split(":")[0];
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
  const poList: AccurateData["pos"] = [];
  const poDetailed: string[] = [];
  for (const po of pos) {
    const id = String(po.id ?? "");
    if (!id) continue;
    const state = poState(po.statusName);
    poList.push({ id, state });
    if (state !== "open") continue;
    poLines.push(...mapPoLines(detailOf(await c.get("/api/purchase-order/detail.do", { id }))));
    poDetailed.push(id);
  }

  const from = addMonths(o.today, -((o.months ?? 3) - 1));
  const invoices = await c.listAll<Raw>("/api/sales-invoice/list.do", {
    fields: "id,number,transDate", "filter.transDate.op": "BETWEEN", "filter.transDate.val": [accurateDate(from), accurateDate(o.today)],
  });
  if (invoices.length > (o.maxInvoices ?? 5000)) throw new Error(`Too many invoices (${invoices.length}); narrow the window`);
  const details: Raw[] = [];
  const pause = o.throttleMs ?? 0;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (const inv of invoices) {
    if (pause > 0 && details.length > 0) await sleep(pause);
    details.push(detailOf(await c.get("/api/sales-invoice/detail.do", { id: String(inv.id) })));
  }
  return { items, stock, poLines, sales: mapSales(details), pos: poList, poDetailed };
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
  /** types Accurate sent that the CRM does not know; these items are left alone */
  unknownTypes: { sku: string; type: string }[];
  /** things that stopped a part of the sync; the job still applies the rest and then exits 1 */
  warnings: string[];
};

type Db = typeof sql;

export async function buildPlan(data: AccurateData, db: Db = sql): Promise<Plan> {
  const prods = await db<ProductRow[]>`SELECT id, sku, name, list_price::text, accurate_item_id, item_type::text, unit, barcode, accurate_category FROM products`;
  const bySku = new Map(prods.map((p) => [p.sku, p]));
  const aSkus = new Set(data.items.map((i) => i.sku));
  const idOwner = new Map(prods.filter((p) => p.accurate_item_id).map((p) => [p.accurate_item_id!, p.sku]));
  const conflicts: string[] = [];
  const warnings: string[] = [];
  const unknownTypes = data.items.filter((i) => i.itemType === "unknown").map((i) => ({ sku: i.sku, type: i.rawType || "(empty)" }));

  const products: ProductChange[] = [];
  for (const it of data.items) {
    const p = bySku.get(it.sku);
    if (!p || it.itemType === "unknown") continue;
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
  let stock = data.stock.flatMap((s) => {
    const p = bySku.get(s.sku);
    return p && inventorySkus.has(s.sku) ? [{ productId: p.id, sku: s.sku, warehouse: s.warehouse, qty: s.qty }] : [];
  });
  // Accurate answered but every quantity is 0 (or nothing came back) although it has stock items: more likely a broken
  // answer than an empty warehouse. Do not write today's snapshot, so a good one from earlier today stays.
  if (inventorySkus.size > 0 && !stock.some((s) => s.qty > 0)) {
    if (stock.length > 0 || data.stock.length === 0) warnings.push(`stock skipped: Accurate has ${inventorySkus.size} stock items but no quantity above 0 came back`);
    stock = [];
  }

  const existing = await db<{ id: string; accurate_po_id: string; product_id: string; qty: number; eta_date: string | null; status: string }[]>`
    SELECT id, accurate_po_id, product_id, qty, to_char(eta_date, 'YYYY-MM-DD') AS eta_date, status FROM purchase_orders WHERE accurate_po_id IS NOT NULL`;
  const exMap = new Map(existing.map((e) => [e.accurate_po_id, e]));
  const seen = new Set<string>();
  const po: Plan["po"] = { insert: [], update: [], close: [] };
  for (const l of data.poLines) {
    const p = bySku.get(l.sku);
    if (!p || seen.has(l.lineKey)) continue;
    seen.add(l.lineKey);
    const row = { ...l, productId: p.id };
    const e = exMap.get(l.lineKey);
    if (!e) po.insert.push(row);
    // only lines the CRM still has open are updated; received or cancelled lines are never reopened
    else if (e.status === "open" && (e.product_id !== p.id || e.qty !== l.qty || e.eta_date !== l.eta)) po.update.push(row);
  }

  // Close a saved open line only when Accurate says so about its PO: the PO was listed this run with a closed status,
  // or it was listed open, its detail was read and the line is no longer in it. A PO that was not listed at all
  // (older than the PO window, or a list that came back short) never closes anything.
  const openSaved = existing.filter((e) => e.status === "open");
  const state = new Map(data.pos.map((x) => [x.id, x.state]));
  const detailed = new Set(data.poDetailed);
  const candidates = openSaved.filter((e) => {
    const id = poIdOf(e.accurate_po_id);
    const st = state.get(id);
    if (st === "closed") return true;
    return st === "open" && detailed.has(id) && !seen.has(e.accurate_po_id);
  }).map((e) => e.accurate_po_id).sort();
  if (openSaved.length > 0) {
    const openListed = data.pos.filter((x) => x.state === "open").length;
    if (data.pos.length === 0) warnings.push(`PO closing skipped: Accurate listed no purchase orders but ${openSaved.length} saved lines are open`);
    else if (openListed === 0) warnings.push(`PO closing skipped: none of ${data.pos.length} listed purchase orders has an open status but ${openSaved.length} saved lines are open`);
    else {
      const cap = Math.max(MIN_CLOSES, Math.ceil(openSaved.length * MAX_CLOSE_SHARE));
      if (candidates.length > cap) warnings.push(`PO closing capped: ${candidates.length} lines should close, only ${cap} (${MAX_CLOSE_SHARE * 100}% of ${openSaved.length} open, minimum ${MIN_CLOSES}) were closed this run`);
      po.close = candidates.slice(0, cap);
    }
  }

  const sales = data.sales.flatMap((s) => {
    const p = bySku.get(s.sku);
    return p ? [{ ...s, productId: p.id }] : [];
  });
  return { products, stock, po, sales, onlyInAccurate, onlyInCrm, conflicts, unknownTypes, warnings };
}

export async function applyPlan(plan: Plan, today: string, db: Db = sql): Promise<void> {
  await db.begin(async (t) => {
    // one run at a time: a second, overlapping run waits here and then re-checks every row it touches
    await t`SELECT pg_advisory_xact_lock(hashtext('accurate-sync'))`;
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
      await t`INSERT INTO purchase_orders (product_id, qty, eta_date, status, accurate_po_id)
        SELECT ${l.productId}, ${l.qty}, ${l.eta}::date, 'open', ${l.lineKey}
        WHERE NOT EXISTS (SELECT 1 FROM purchase_orders WHERE accurate_po_id = ${l.lineKey})`;
    }
    for (const l of plan.po.update) {
      await t`UPDATE purchase_orders SET product_id = ${l.productId}, qty = ${l.qty}, eta_date = ${l.eta}::date WHERE accurate_po_id = ${l.lineKey} AND status = 'open'`;
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
    poNew: plan.po.insert.length, poUpdated: plan.po.update.length, poClosed: plan.po.close.length, unknownTypes: plan.unknownTypes.length, warnings: plan.warnings.length,
    salesRows: plan.sales.length, onlyInAccurate: plan.onlyInAccurate.length, onlyInCrm: plan.onlyInCrm.length, conflicts: plan.conflicts.length,
  };
}
