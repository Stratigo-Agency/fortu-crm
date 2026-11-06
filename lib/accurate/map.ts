// Pure mapping from Accurate answers to CRM rows. No network, no database.

export type ItemType = "inventory" | "non_inventory" | "service" | "unknown";
export type AItem = { accurateId: string; sku: string; name: string; itemType: ItemType; rawType: string; unit: string | null; barcode: string | null; category: string | null; price: number; suspended: boolean };
export type AStock = { sku: string; warehouse: string; qty: number };
export type APoLine = { poId: string; lineKey: string; sku: string; qty: number; eta: string | null };
export type ASale = { sku: string; month: string; qty: number; revenue: number };

type Raw = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};
/** A quantity that must be there: a missing or non-numeric field is an API change, not a zero. */
function reqNum(v: unknown, what: string): number {
  if (v === undefined || v === null || v === "") throw new Error(`Accurate answer has no ${what}`);
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  if (!Number.isFinite(n)) throw new Error(`Accurate answer has a non-numeric ${what}`);
  return n;
}

/** dd/MM/yyyy (Accurate) → yyyy-MM-dd, or null. */
export function isoDate(v: unknown): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(str(v));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
/** yyyy-MM-dd → dd/MM/yyyy (for filters). */
export const accurateDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export function mapItem(r: Raw): AItem | null {
  const sku = str(r.no);
  const t = str(r.itemType).toUpperCase();
  if (!sku || t === "GROUP") return null;
  // Only the three known types map to a CRM type; anything else is "unknown" and is reported, never treated as stock.
  const itemType: ItemType = t === "INVENTORY" ? "inventory" : t === "SERVICE" ? "service" : /^NON[ _-]?INVENTORY$/.test(t) ? "non_inventory" : "unknown";
  const cat = r.itemCategory as Raw | undefined;
  return {
    accurateId: str(r.id), sku, name: str(r.name), itemType, rawType: t,
    unit: str(r.unit1Name) || null, barcode: str(r.barcode) || null,
    category: str(cat?.name) || null, price: Math.round(num(r.unitPrice)), suspended: r.suspended === true,
  };
}

export function mapStock(r: Raw, warehouse: string): AStock | null {
  const sku = str(r.no ?? r.itemNo);
  if (!sku) return null;
  return { sku, warehouse, qty: Math.round(reqNum(r.quantity ?? r.availableQuantity, `stock quantity for ${sku}`)) };
}

export type PoState = "open" | "closed" | "unknown";
/**
 * Purchase order status: open = still waiting for goods (Accurate: Menunggu diproses / Sebagian diproses),
 * closed = known finished or cancelled (Diproses, Ditutup, ...). Anything else is "unknown" and never closes a CRM line.
 */
export function poState(statusName: unknown): PoState {
  const t = str(statusName);
  if (/menunggu|sebagian|queue|partial/i.test(t)) return "open";
  if (/diproses|ditutup|tutup|selesai|batal|closed|complete|cancel|received/i.test(t)) return "closed";
  return "unknown";
}
export const isOpenPo = (statusName: unknown) => poState(statusName) === "open";

/**
 * Assumption (to check against a live database): a PO line may expose what is still open under one of these names;
 * if so the CRM counts that quantity. Otherwise the full ordered quantity is used.
 */
const REMAINING_FIELDS = ["remainingQuantity", "outstandingQuantity", "unprocessedQuantity", "quantityRemaining"];

export function mapPoLines(po: Raw): APoLine[] {
  const poId = str(po.id);
  const lines = Array.isArray(po.detailItem) ? (po.detailItem as Raw[]) : [];
  const out: APoLine[] = [];
  lines.forEach((l, i) => {
    const sku = str((l.item as Raw | undefined)?.no);
    const remainingKey = REMAINING_FIELDS.find((k) => l[k] !== undefined && l[k] !== null && l[k] !== "");
    const qty = Math.round(remainingKey ? num(l[remainingKey]) : num(l.quantity));
    if (!sku || qty <= 0) return;
    out.push({ poId, lineKey: `${poId}:${str(l.id) || i}`, sku, qty, eta: isoDate(l.shipDate) ?? isoDate(po.shipDate) });
  });
  return out;
}

/** Sums invoice lines per SKU and month (month = first day, from transDate). */
export function mapSales(invoices: Raw[]): ASale[] {
  const acc = new Map<string, ASale>();
  for (const inv of invoices) {
    const d = isoDate(inv.transDate);
    if (!d) continue;
    const month = `${d.slice(0, 7)}-01`;
    for (const l of Array.isArray(inv.detailItem) ? (inv.detailItem as Raw[]) : []) {
      const sku = str((l.item as Raw | undefined)?.no);
      if (!sku) continue;
      const q = reqNum(l.quantity, `invoice quantity for ${sku}`);
      const qty = Math.round(q);
      const revenue = l.totalPrice !== undefined && l.totalPrice !== null ? reqNum(l.totalPrice, `invoice total for ${sku}`) : reqNum(l.unitPrice, `invoice price for ${sku}`) * q;
      const k = `${sku}|${month}`;
      const cur = acc.get(k) ?? { sku, month, qty: 0, revenue: 0 };
      cur.qty += qty;
      cur.revenue += Math.round(revenue);
      acc.set(k, cur);
    }
  }
  return [...acc.values()];
}
