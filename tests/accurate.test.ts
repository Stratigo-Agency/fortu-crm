import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AccurateApiError, apiTimestamp, configFromEnv, createAccurateClient, sign } from "@/lib/accurate/client";
import { isoDate, mapSales } from "@/lib/accurate/map";
import { applyPlan, buildPlan, fetchAccurate } from "@/lib/accurate/sync";
import { sql } from "@/lib/db";

// Synthetic answers written from the documented shapes (tests/fixtures/accurate-*.json), not recorded from a live database.
const sk = () => `ZT${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
type Skus = { A: string; B: string; NEW: string; SVC: string; GRP: string; IDA: string; IDB: string; IDN: string; IDS: string; IDG: string };
const skus = (): Skus => {
  const u = () => randomUUID();
  return { A: sk(), B: sk(), NEW: sk(), SVC: sk(), GRP: sk(), IDA: u(), IDB: u(), IDN: u(), IDS: u(), IDG: u() };
};
function fixture(name: string, s: Skus) {
  let t = readFileSync(`tests/fixtures/${name}.json`, "utf8");
  for (const [k, v] of Object.entries(s)) t = t.replaceAll(`{{${k}}}`, v);
  return JSON.parse(t);
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const noSleep = async () => {};
const HOST = "https://zeus.accurate.id";

/** Routes the fake Accurate by path; records every call. */
function fakeAccurate(s: Skus) {
  const calls: { url: string; method: string; headers: Record<string, string> }[] = [];
  const routes: Record<string, () => unknown> = {
    "/accurate/api/item/list.do": () => fixture("accurate-item-list", s),
    "/accurate/api/warehouse/list.do": () => fixture("accurate-warehouse-list", s),
    "/accurate/api/purchase-order/list.do": () => fixture("accurate-po-list", s),
    "/accurate/api/purchase-order/detail.do?501": () => fixture("accurate-po-detail-501", s),
    "/accurate/api/purchase-order/detail.do?502": () => fixture("accurate-po-detail-502", s),
    "/accurate/api/sales-invoice/list.do": () => fixture("accurate-invoice-list", s),
    "/accurate/api/sales-invoice/detail.do?701": () => fixture("accurate-invoice-detail-701", s),
    "/accurate/api/sales-invoice/detail.do?702": () => fixture("accurate-invoice-detail-702", s),
    "/accurate/api/sales-invoice/detail.do?703": () => fixture("accurate-invoice-detail-703", s),
  };
  const f = (async (url: string, init: RequestInit) => {
    const u = new URL(url);
    calls.push({ url, method: init.method ?? "GET", headers: init.headers as Record<string, string> });
    if (u.pathname === "/accurate/api/item/list-stock.do")
      return json(fixture(u.searchParams.get("warehouseName") === "Gudang Demo" ? "accurate-list-stock-demo" : "accurate-list-stock-utama", s));
    const id = u.searchParams.get("id");
    const r = routes[u.pathname + (id ? `?${id}` : "")];
    if (!r) return json({ s: false, d: ["not found"] }, 404);
    return json(r());
  }) as unknown as typeof fetch;
  return { f, calls };
}
const client = (f: typeof fetch) => createAccurateClient({ token: "tok", signatureSecret: "sec", host: HOST, databaseId: "77", fetch: f, sleep: noSleep });

describe("client", () => {
  it("signs with the timestamp, sends the token and session, and only ever uses GET", async () => {
    const { f, calls } = fakeAccurate(skus());
    await client(f).get("/api/item/list.do");
    const h = calls[0].headers;
    expect(calls[0].method).toBe("GET");
    expect(h.Authorization).toBe("Bearer tok");
    expect(h["X-Session-ID"]).toBe("77");
    expect(h["X-Api-Signature"]).toBe(sign(h["X-Api-Timestamp"], "sec"));
    expect(h["X-Api-Timestamp"]).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/);
  });
  it("formats the timestamp in Jakarta time", () => {
    expect(apiTimestamp(new Date("2026-11-05T18:00:00Z"))).toBe("06/11/2026 01:00:00");
  });
  it("refuses anything that is not a read endpoint", async () => {
    const { f, calls } = fakeAccurate(skus());
    for (const p of ["/api/item/save.do", "/api/item/delete.do", "/api/sales-invoice/bulk-save.do", "/api/item/list.do/../save.do"])
      await expect(client(f).get(p)).rejects.toThrow(AccurateApiError);
    expect(calls).toHaveLength(0);
  });
  it("follows paging until pageCount", async () => {
    let n = 0;
    const f = (async () => json({ s: true, d: [{ n: ++n }], sp: { pageCount: 3 } })) as unknown as typeof fetch;
    expect(await client(f).listAll("/api/item/list.do")).toHaveLength(3);
  });
  it("waits and retries on 429, then gives up with a clear error", async () => {
    let n = 0;
    const waits: number[] = [];
    const f = (async () => (++n < 3 ? json({}, 429, { "retry-after": "2" }) : json({ s: true, d: [] }))) as unknown as typeof fetch;
    const c = createAccurateClient({ token: "t", signatureSecret: "s", host: HOST, databaseId: "1", fetch: f, sleep: async (ms) => void waits.push(ms) });
    await c.get("/api/item/list.do");
    expect(waits).toEqual([2000, 2000]);
    const always = (async () => json({}, 429)) as unknown as typeof fetch;
    await expect(createAccurateClient({ token: "t", signatureSecret: "s", host: HOST, databaseId: "1", fetch: always, sleep: noSleep, maxRetries: 1 }).get("/api/item/list.do")).rejects.toThrow(/429/);
  });
  it("turns s:false into an error with Accurate's message", async () => {
    const f = (async () => json({ s: false, d: ["Token tidak valid"] }, 200)) as unknown as typeof fetch;
    await expect(client(f).get("/api/item/list.do")).rejects.toThrow("Token tidak valid");
  });
  it("looks up host and database from api-token.do when they are not set", async () => {
    const urls: string[] = [];
    const f = (async (url: string) => {
      urls.push(url);
      return url.includes("api-token.do") ? json({ s: true, d: { database: { host: "https://h9f3n.pvt1.accurate.id", id: 55 } } }) : json({ s: true, d: [] });
    }) as unknown as typeof fetch;
    await createAccurateClient({ token: "t", signatureSecret: "s", fetch: f, sleep: noSleep }).get("/api/item/list.do");
    expect(urls[0]).toBe("https://account.accurate.id/api/api-token.do");
    expect(urls[1]).toBe("https://h9f3n.pvt1.accurate.id/accurate/api/item/list.do");
  });
  it("reads credentials from env only and says which are missing", () => {
    expect(() => configFromEnv({})).toThrow(/ACCURATE_API_TOKEN/);
    expect(configFromEnv({ ACCURATE_API_TOKEN: "a", ACCURATE_SIGNATURE_SECRET: "b" })).toMatchObject({ token: "a", signatureSecret: "b" });
  });
});

describe("mapping", () => {
  it("reads Accurate dates", () => {
    expect(isoDate("05/10/2026")).toBe("2026-10-05");
    expect(isoDate("")).toBeNull();
  });
  it("sums invoice lines per SKU and month", () => {
    const s = skus();
    const rows = mapSales([fixture("accurate-invoice-detail-701", s).d, fixture("accurate-invoice-detail-702", s).d, fixture("accurate-invoice-detail-703", s).d]);
    const a = (m: string) => rows.find((r) => r.sku === s.A && r.month === m);
    expect(a("2026-10-01")).toEqual({ sku: s.A, month: "2026-10-01", qty: 3, revenue: 150_000_000 });
    expect(a("2026-11-01")).toMatchObject({ qty: 3, revenue: 150_000_000 });
    expect(rows.find((r) => r.sku === s.B)).toMatchObject({ qty: 1, revenue: 45_000_000 }); // from unitPrice when totalPrice is missing
  });
});

describe("sync", () => {
  async function seedCrm(s: Skus, over: { aName?: string; aPrice?: number | null; bPrice?: number | null } = {}) {
    const [a] = await sql<{ id: string }[]>`INSERT INTO products (sku, name, product_line, list_price) VALUES (${s.A}, ${over.aName ?? "Nama dari CRM"}, 'IFP', ${over.aPrice === undefined ? 31_000_000 : over.aPrice}) RETURNING id`;
    const [b] = await sql<{ id: string }[]>`INSERT INTO products (sku, name, product_line, list_price) VALUES (${s.B}, 'Produk B', 'IFP', ${over.bPrice === undefined ? null : over.bPrice}) RETURNING id`;
    const [c] = await sql<{ id: string }[]>`INSERT INTO products (sku, name, product_line) VALUES (${sk()}, 'Hanya di CRM', 'IFP') RETURNING id`;
    return { a: a.id, b: b.id, crmOnly: c.id };
  }

  it("builds a plan: keeps CRM names and prices, fills empty prices only when Accurate has one, reports both unmatched lists", async () => {
    const s = skus();
    const ids = await seedCrm(s);
    const { f, calls } = fakeAccurate(s);
    const data = await fetchAccurate(client(f), { today: "2026-11-05" });
    const plan = await buildPlan(data);

    const a = plan.products.find((p) => p.sku === s.A)!;
    expect(a.set).toMatchObject({ barcode: "BC-A", accurate_category: "IFP", accurate_item_id: s.IDA });
    expect(a.set).not.toHaveProperty("name"); // edited in the CRM
    expect(a.set).not.toHaveProperty("list_price"); // CRM has 31 jt and Accurate has Rp0
    expect(plan.products.find((p) => p.sku === s.B)!.set).toMatchObject({ list_price: 45_000_000 }); // empty in CRM, > 0 in Accurate

    expect(plan.onlyInAccurate.map((x) => x.sku).sort()).toEqual([s.NEW, s.SVC].sort()); // GROUP items are skipped
    expect(plan.onlyInCrm.map((x) => x.sku)).toContain((await sql`SELECT sku FROM products WHERE id = ${ids.crmOnly}`)[0].sku);

    expect(plan.stock.filter((x) => x.sku === s.A).map((x) => [x.warehouse, x.qty]).sort()).toEqual([["Gudang Demo", 2], ["Gudang Utama", 12]]);
    expect(plan.stock.some((x) => x.sku === s.NEW)).toBe(false);
    expect(plan.po.insert.map((l) => [l.sku, l.qty, l.eta]).sort()).toEqual([[s.A, 10, "2026-11-25"], [s.B, 5, "2026-11-30"]].sort());
    expect(plan.sales.find((x) => x.sku === s.A && x.month === "2026-10-01")).toMatchObject({ qty: 3 });

    expect(calls.every((c) => c.method === "GET")).toBe(true);
    // a dry run only plans: nothing was written
    const [row] = await sql`SELECT accurate_item_id FROM products WHERE sku = ${s.A}`;
    expect(row.accurate_item_id).toBeNull();
  });

  it("applies the plan, and a second run changes nothing", async () => {
    const s = skus();
    const ids = await seedCrm(s);
    const { f } = fakeAccurate(s);
    const data = await fetchAccurate(client(f), { today: "2026-11-05" });
    const plan = await buildPlan(data);
    await applyPlan(plan, "2026-11-05");

    const [pa] = await sql`SELECT name, list_price::text, accurate_item_id, barcode FROM products WHERE id = ${ids.a}`;
    expect(pa).toMatchObject({ name: "Nama dari CRM", list_price: "31000000", accurate_item_id: s.IDA, barcode: "BC-A" });
    const [pb] = await sql`SELECT list_price::text FROM products WHERE id = ${ids.b}`;
    expect(pb.list_price).toBe("45000000");
    const stock = await sql`SELECT warehouse, qty_on_hand FROM inventory_snapshots WHERE product_id = ${ids.a} AND snapshot_date = '2026-11-05' ORDER BY warehouse`;
    expect(stock.map((r) => [r.warehouse, r.qty_on_hand])).toEqual([["Gudang Demo", 2], ["Gudang Utama", 12]]);
    const [m] = await sql`SELECT qty_sold, revenue::text FROM sales_monthly WHERE product_id = ${ids.a} AND period_month = '2026-10-01'`;
    expect(m).toMatchObject({ qty_sold: 3, revenue: "150000000" });
    expect((await sql`SELECT 1 FROM purchase_orders WHERE product_id = ${ids.a} AND status = 'open' AND qty = 10`)).toHaveLength(1);

    const again = await buildPlan(await fetchAccurate(client(f), { today: "2026-11-05" }));
    expect(again.products.filter((p) => [s.A, s.B].includes(p.sku))).toHaveLength(0);
    expect(again.po.insert.filter((l) => [s.A, s.B].includes(l.sku))).toHaveLength(0);
    expect(again.po.update.filter((l) => [s.A, s.B].includes(l.sku))).toHaveLength(0);
  });

  it("closes an Accurate PO line that is no longer open, and leaves hand-made POs alone", async () => {
    const s = skus();
    const ids = await seedCrm(s);
    const [gone] = await sql<{ id: string }[]>`INSERT INTO purchase_orders (product_id, qty, status, accurate_po_id) VALUES (${ids.a}, 3, 'open', '999:1') RETURNING id`;
    const [mine] = await sql<{ id: string }[]>`INSERT INTO purchase_orders (product_id, qty, status) VALUES (${ids.a}, 4, 'open') RETURNING id`;
    const { f } = fakeAccurate(s);
    const plan = await buildPlan(await fetchAccurate(client(f), { today: "2026-11-05" }));
    await applyPlan(plan, "2026-11-05");
    expect((await sql`SELECT status FROM purchase_orders WHERE id = ${gone.id}`)[0].status).toBe("received");
    expect((await sql`SELECT status FROM purchase_orders WHERE id = ${mine.id}`)[0].status).toBe("open");
  });

  it("fills an empty CRM price only when Accurate's is above 0, and never sets Rp0", async () => {
    const s = skus();
    const ids = await seedCrm(s, { aPrice: null, bPrice: 0 });
    const { f } = fakeAccurate(s);
    const plan = await buildPlan(await fetchAccurate(client(f), { today: "2026-11-05" }));
    await applyPlan(plan, "2026-11-05");
    expect((await sql`SELECT list_price FROM products WHERE id = ${ids.a}`)[0].list_price).toBeNull(); // Accurate price is 0
    expect((await sql`SELECT list_price::text FROM products WHERE id = ${ids.b}`)[0].list_price).toBe("45000000"); // 0 counts as empty
  });

  it("reports an Accurate id that already belongs to another CRM product instead of failing", async () => {
    const s = skus();
    await seedCrm(s);
    const owner = sk();
    await sql`INSERT INTO products (sku, name, product_line, accurate_item_id) VALUES (${owner}, 'Pemilik id', 'IFP', ${s.IDA})`;
    const { f } = fakeAccurate(s);
    const plan = await buildPlan(await fetchAccurate(client(f), { today: "2026-11-05" }));
    expect(plan.conflicts.some((c) => c.startsWith(s.A) && c.includes(owner))).toBe(true);
    expect(plan.products.find((p) => p.sku === s.A)!.set).not.toHaveProperty("accurate_item_id");
    await expect(applyPlan(plan, "2026-11-05")).resolves.toBeUndefined();
  });
});
