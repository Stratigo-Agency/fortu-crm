// Pure mapping from Accurate answers to CRM rows. No network, no database.

export type ItemType = "inventory" | "non_inventory" | "service";
export type AItem = { accurateId: string; sku: string; name: string; itemType: ItemType; unit: string | null; barcode: string | null; category: string | null; price: number; suspended: boolean };
export type AStock = { sku: string; warehouse: string; qty: number };
export type APoLine = { poId: string; lineKey: string; sku: string; qty: number; eta: string | null };
export type ASale = { sku: string; month: string; qty: number; revenue: number };

type Raw = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

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
  const itemType: ItemType = t === "SERVICE" ? "service" : t.startsWith("NON") ? "non_inventory" : "inventory";
  const cat = r.itemCategory as Raw | undefined;
  return {
    accurateId: str(r.id), sku, name: str(r.name), itemType,
    unit: str(r.unit1Name) || null, barcode: str(r.barcode) || null,
    category: str(cat?.name) || null, price: Math.round(num(r.unitPrice)), suspended: r.suspended === true,
  };
}

export function mapStock(r: Raw, warehouse: string): AStock | null {
  const sku = str(r.no ?? r.itemNo);
  if (!sku) return null;
  return { sku, warehouse, qty: Math.round(num(r.quantity ?? r.availableQuantity)) };
}

/** Purchase order statuses that are still waiting for goods (Accurate: Menunggu diproses / Sebagian diproses). */
export const isOpenPo = (statusName: unknown) => /menunggu|sebagian|queue|partial/i.test(str(statusName));

export function mapPoLines(po: Raw): APoLine[] {
  const poId = str(po.id);
  const lines = Array.isArray(po.detailItem) ? (po.detailItem as Raw[]) : [];
  const out: APoLine[] = [];
  lines.forEach((l, i) => {
    const sku = str((l.item as Raw | undefined)?.no);
    const qty = Math.round(num(l.quantity));
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
      const qty = Math.round(num(l.quantity));
      const revenue = l.totalPrice !== undefined ? num(l.totalPrice) : num(l.unitPrice) * num(l.quantity);
      const k = `${sku}|${month}`;
      const cur = acc.get(k) ?? { sku, month, qty: 0, revenue: 0 };
      cur.qty += qty;
      cur.revenue += Math.round(revenue);
      acc.set(k, cur);
    }
  }
  return [...acc.values()];
}
