// The Stok filter as it lives in the URL (?lini=IFP&berisiko=1). No database here, so client components can import it.

export const STOCK_LINES = ["IFP", "DSS", "LED", "accessory", "service"] as const;
export type StockLine = (typeof STOCK_LINES)[number];

export type StockFilter = { line: StockLine | null; risk: boolean };

/** ?lini=IFP&berisiko=1 → a filter; anything unknown is ignored. */
export function parseStockFilter(p: { lini?: string | string[]; berisiko?: string | string[] }): StockFilter {
  const line = Array.isArray(p.lini) ? p.lini[0] : p.lini;
  const risk = Array.isArray(p.berisiko) ? p.berisiko[0] : p.berisiko;
  return { line: (STOCK_LINES as readonly string[]).includes(line ?? "") ? (line as StockLine) : null, risk: risk === "1" };
}

export function stockHref(base: string, f: StockFilter): string {
  const q = new URLSearchParams();
  if (f.line) q.set("lini", f.line);
  if (f.risk) q.set("berisiko", "1");
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}
