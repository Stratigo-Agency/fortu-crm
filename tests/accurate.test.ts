import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { AccurateApiError, apiTimestamp, assertAccurateHost, configFromEnv, createAccurateClient, sign } from "@/lib/accurate/client";
import { isoDate, mapItem, mapPoLines, mapSales, mapStock, poState } from "@/lib/accurate/map";
import { applyPlan, buildPlan, fetchAccurate, jakartaToday, MIN_CLOSES, summarize } from "@/lib/accurate/sync";
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
  beforeEach(async () => {
    await sql`DELETE FROM purchase_orders WHERE accurate_po_id IS NOT NULL`;
  });

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

  it("closes a saved line whose PO is listed as closed, and leaves hand-made POs and unlisted POs alone", async () => {
    const s = skus();
    const ids = await seedCrm(s);
    const [gone] = await sql<{ id: string }[]>`INSERT INTO purchase_orders (product_id, qty, status, accurate_po_id) VALUES (${ids.a}, 3, 'open', '503:1') RETURNING id`;
    const [old] = await sql<{ id: string }[]>`INSERT INTO purchase_orders (product_id, qty, status, accurate_po_id) VALUES (${ids.a}, 3, 'open', '999:1') RETURNING id`;
    const [mine] = await sql<{ id: string }[]>`INSERT INTO purchase_orders (product_id, qty, status) VALUES (${ids.a}, 4, 'open') RETURNING id`;
    const { f } = fakeAccurate(s);
    const plan = await buildPlan(await fetchAccurate(client(f), { today: "2026-11-05" }));
    await applyPlan(plan, "2026-11-05");
    const st = async (id: string) => (await sql`SELECT status FROM purchase_orders WHERE id = ${id}`)[0].status;
    expect(await st(gone.id)).toBe("received");
    expect(await st(old.id)).toBe("open"); // PO 999 is outside the list (older than the PO window): not proof of anything
    expect(await st(mine.id)).toBe("open");
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

// ---- hardening ----------------------------------------------------------------------------------------------

/** Lets a test replace some answers of the fake Accurate; return undefined to fall through. */
const override = (f: typeof fetch, fn: (u: URL) => unknown | undefined) =>
  (async (url: string, init: RequestInit) => {
    const r = fn(new URL(url));
    return r !== undefined ? json(r) : (f as unknown as (u: string, i: RequestInit) => Promise<Response>)(url, init);
  }) as unknown as typeof fetch;
const okEmpty = { s: true, d: [], sp: { page: 1, pageCount: 1, rowCount: 0 } };

describe("client hardening", () => {
  it("only accepts https://<name>.accurate.id as the database host", async () => {
    for (const h of ["http://zeus.accurate.id", "https://evil.example", "https://accurate.id.evil.example", "https://zeus.accurate.id@evil.example", "https://u:p@zeus.accurate.id", "https://zeus.accurate.id:8443", "https://zeus.accurate.id/x", "https://notaccurate.id", "nonsense"])
      expect(() => assertAccurateHost(h), h).toThrow(AccurateApiError);
    expect(assertAccurateHost("https://zeus.accurate.id/")).toBe("https://zeus.accurate.id");
    expect(() => createAccurateClient({ token: "t", signatureSecret: "s", host: "https://evil.example" })).toThrow(/accurate\.id/);
  });
  it("refuses a host that api-token.do returns when it is not an accurate.id host, before sending the token there", async () => {
    const urls: string[] = [];
    const f = (async (url: string) => { urls.push(url); return json({ s: true, d: { database: { host: "https://evil.example", id: 1 } } }); }) as unknown as typeof fetch;
    await expect(createAccurateClient({ token: "t", signatureSecret: "s", fetch: f, sleep: noSleep }).get("/api/item/list.do")).rejects.toThrow(/accurate\.id/);
    expect(urls).toHaveLength(1);
  });
  it("allows exactly the endpoints the sync uses", async () => {
    const { f, calls } = fakeAccurate(skus());
    const bad = [
      "/api/item/list.do?x=1", "/api/item/list.do#a", "/api/item/LIST.DO", "/api/item/list.DO", "//host/..", "//evil.example/api/item/list.do",
      "/api/item/%2e%2e/save.do", "/api/item/../item/list.do", "/api/item/list.do/", "/accurate/api/item/list.do", "api/item/list.do",
      "/api/customer/list.do", "/api/item/detail.do", "/api/purchase-order/save.do", "https://evil.example/api/item/list.do", "",
    ];
    for (const p of bad) await expect(client(f).get(p), p).rejects.toThrow(AccurateApiError);
    expect(calls).toHaveLength(0);
    for (const p of ["/api/item/list.do", "/api/item/list-stock.do", "/api/warehouse/list.do", "/api/purchase-order/list.do", "/api/purchase-order/detail.do", "/api/sales-invoice/list.do", "/api/sales-invoice/detail.do"])
      await expect(client(override(f, () => ({ s: true, d: [] }))).get(p), p).resolves.toBeTruthy();
  });
  it("refuses parameter names it does not know", async () => {
    const { f, calls } = fakeAccurate(skus());
    for (const k of ["x", "id=1&delete", "sp.page\n", "__proto__", "filter.transDate.val&x"])
      await expect(client(f).get("/api/item/list.do", { [k]: "1" }), k).rejects.toThrow(/parameter/);
    expect(calls).toHaveLength(0);
  });
  it("never follows a redirect", async () => {
    const seen: RequestInit[] = [];
    const f = (async (_u: string, init: RequestInit) => { seen.push(init); return new Response(null, { status: 302, headers: { location: "https://evil.example/" } }); }) as unknown as typeof fetch;
    await expect(client(f).get("/api/item/list.do")).rejects.toThrow(/redirect/);
    expect(seen[0].redirect).toBe("error");
    const throws = (async () => { throw new TypeError("redirect mode is set to error"); }) as unknown as typeof fetch;
    await expect(client(throws).get("/api/item/list.do")).rejects.toThrow(AccurateApiError);
  });
  it("uses GET for every call of a full fetch", async () => {
    const { f, calls } = fakeAccurate(skus());
    await fetchAccurate(client(f), { today: "2026-11-05" });
    expect(calls.length).toBeGreaterThan(8);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });
  it("retries a 5xx with a growing wait, then reports the status", async () => {
    let n = 0;
    const waits: number[] = [];
    const f = (async () => (++n < 3 ? json({}, 503) : json({ s: true, d: [] }))) as unknown as typeof fetch;
    const c = createAccurateClient({ token: "t", signatureSecret: "s", host: HOST, databaseId: "1", fetch: f, sleep: async (ms) => void waits.push(ms) });
    await c.get("/api/item/list.do");
    expect(waits).toEqual([2000, 4000]);
    const always = (async () => json({}, 500)) as unknown as typeof fetch;
    await expect(createAccurateClient({ token: "t", signatureSecret: "s", host: HOST, databaseId: "1", fetch: always, sleep: noSleep, maxRetries: 1 }).get("/api/item/list.do")).rejects.toThrow(/500/);
  });
  it("listAll fails when a page has rows but no sp", async () => {
    const f = (async () => json({ s: true, d: [{ a: 1 }] })) as unknown as typeof fetch;
    await expect(client(f).listAll("/api/item/list.do")).rejects.toThrow(/paging info/);
  });
  it("listAll fails when the count differs from sp.rowCount or a page in the middle is empty", async () => {
    const short = (async () => json({ s: true, d: [{ a: 1 }], sp: { pageCount: 1, rowCount: 2 } })) as unknown as typeof fetch;
    await expect(client(short).listAll("/api/item/list.do")).rejects.toThrow(/Accurate says 2/);
    let n = 0;
    const hole = (async () => json({ s: true, d: ++n === 1 ? [{ a: 1 }] : [], sp: { pageCount: 3, rowCount: 1 } })) as unknown as typeof fetch;
    await expect(client(hole).listAll("/api/item/list.do")).rejects.toThrow(/empty/);
    const noList = (async () => json({ s: true, sp: { pageCount: 1 } })) as unknown as typeof fetch;
    await expect(client(noList).listAll("/api/item/list.do")).rejects.toThrow(/row list/);
    let m = 0;
    const ok = (async () => json({ s: true, d: [{ n: ++m }, { n: ++m }], sp: { pageCount: 2, rowCount: 4 } })) as unknown as typeof fetch;
    expect(await client(ok).listAll("/api/item/list.do")).toHaveLength(4);
  });
});

describe("mapping hardening", () => {
  it("throws when a quantity is missing instead of reading it as 0", () => {
    expect(() => mapStock({ no: "X" }, "W")).toThrow(/quantity/);
    expect(() => mapStock({ no: "X", quantity: "abc" }, "W")).toThrow(/non-numeric/);
    expect(mapStock({ no: "X", quantity: 0 }, "W")).toMatchObject({ qty: 0 });
    expect(mapStock({ no: "X", availableQuantity: "4" }, "W")).toMatchObject({ qty: 4 });
    expect(() => mapSales([{ transDate: "01/10/2026", detailItem: [{ item: { no: "X" }, totalPrice: 5 }] }])).toThrow(/quantity/);
    expect(() => mapSales([{ transDate: "01/10/2026", detailItem: [{ item: { no: "X" }, quantity: 1 }] }])).toThrow(/price/);
  });
  it("reads the open quantity of a PO line when Accurate shows one, else the ordered quantity", () => {
    const po = { id: 1, detailItem: [
      { id: 1, item: { no: "A" }, quantity: 10, remainingQuantity: 4 },
      { id: 2, item: { no: "B" }, quantity: 10 },
      { id: 3, item: { no: "C" }, quantity: 10, remainingQuantity: 0 },
    ] };
    expect(mapPoLines(po).map((l) => [l.sku, l.qty])).toEqual([["A", 4], ["B", 10]]);
  });
  it("sorts PO statuses into open, closed and unknown", () => {
    expect(poState("Menunggu diproses")).toBe("open");
    expect(poState("Sebagian diproses")).toBe("open");
    expect(poState("Diproses")).toBe("closed");
    expect(poState("Ditutup")).toBe("closed");
    expect(poState("")).toBe("unknown");
    expect(poState("Aneh")).toBe("unknown");
  });
  it("does not treat an unknown item type as stock", () => {
    expect(mapItem({ no: "X", itemType: "MYSTERY" })).toMatchObject({ itemType: "unknown", rawType: "MYSTERY" });
    expect(mapItem({ no: "X" })).toMatchObject({ itemType: "unknown" });
    expect(mapItem({ no: "X", itemType: "NON_INVENTORY" })).toMatchObject({ itemType: "non_inventory" });
    expect(mapItem({ no: "X", itemType: "INVENTORY" })).toMatchObject({ itemType: "inventory" });
  });
  it("dates the snapshot in Jakarta time", () => {
    expect(jakartaToday(new Date("2026-11-05T16:59:59Z"))).toBe("2026-11-05");
    expect(jakartaToday(new Date("2026-11-05T17:00:00Z"))).toBe("2026-11-06");
    expect(jakartaToday(new Date("2026-11-05T23:59:59Z"))).toBe("2026-11-06");
    expect(jakartaToday(new Date("2026-11-06T00:00:00Z"))).toBe("2026-11-06");
  });
});

describe("sync hardening", () => {
  beforeEach(async () => {
    await sql`DELETE FROM purchase_orders WHERE accurate_po_id IS NOT NULL`;
  });
  async function seed(s: Skus) {
    const [a] = await sql<{ id: string }[]>`INSERT INTO products (sku, name, product_line, list_price) VALUES (${s.A}, 'A', 'IFP', 31000000) RETURNING id`;
    const [b] = await sql<{ id: string }[]>`INSERT INTO products (sku, name, product_line) VALUES (${s.B}, 'B', 'IFP') RETURNING id`;
    return { a: a.id, b: b.id };
  }
  const plan = async (f: typeof fetch, opts: Partial<Parameters<typeof fetchAccurate>[1]> = {}) => buildPlan(await fetchAccurate(client(f), { today: "2026-11-05", ...opts }));
  const poStatus = async (key: string) => (await sql`SELECT status FROM purchase_orders WHERE accurate_po_id = ${key}`)[0]?.status;
  const savePo = (productId: string, key: string, status = "open") => sql`INSERT INTO purchase_orders (product_id, qty, status, accurate_po_id) VALUES (${productId}, 3, ${status}, ${key})`;

  it("an empty PO list closes nothing and says so", async () => {
    const s = skus(); const ids = await seed(s);
    await savePo(ids.a, "503:1");
    const { f } = fakeAccurate(s);
    const p = await plan(override(f, (u) => (u.pathname.endsWith("/purchase-order/list.do") ? okEmpty : undefined)));
    expect(p.po.close).toEqual([]);
    expect(p.warnings.join(" ")).toMatch(/listed no purchase orders/);
    await applyPlan(p, "2026-11-05");
    expect(await poStatus("503:1")).toBe("open");
  });
  it("a PO list without any open PO closes nothing and says so", async () => {
    const s = skus(); const ids = await seed(s);
    await savePo(ids.a, "503:1");
    const { f } = fakeAccurate(s);
    const onlyClosed = { s: true, d: [{ id: 503, statusName: "Ditutup" }], sp: { page: 1, pageCount: 1, rowCount: 1 } };
    const p = await plan(override(f, (u) => (u.pathname.endsWith("/purchase-order/list.do") ? onlyClosed : undefined)));
    expect(p.po.close).toEqual([]);
    expect(p.warnings.join(" ")).toMatch(/none of 1 listed/);
  });
  it("a truncated PO list (rowCount says more) fails the fetch instead of closing lines", async () => {
    const s = skus();
    const { f } = fakeAccurate(s);
    const cut = { s: true, d: [{ id: 501, statusName: "Menunggu diproses" }], sp: { page: 1, pageCount: 1, rowCount: 3 } };
    await expect(fetchAccurate(client(override(f, (u) => (u.pathname.endsWith("/purchase-order/list.do") ? cut : undefined))), { today: "2026-11-05" })).rejects.toThrow(/Accurate says 3/);
  });
  it("a status Accurate does not name never closes a line", async () => {
    const s = skus(); const ids = await seed(s);
    await savePo(ids.a, "503:1");
    const { f } = fakeAccurate(s);
    const odd = { s: true, d: [{ id: 501, statusName: "Menunggu diproses" }, { id: 503 }], sp: { page: 1, pageCount: 1, rowCount: 2 } };
    const p = await plan(override(f, (u) => (u.pathname.endsWith("/purchase-order/list.do") ? odd : undefined)));
    expect(p.po.close).toEqual([]);
  });
  it("closes a line that is gone from a PO whose detail was read, and keeps lines that are still there", async () => {
    const s = skus(); const ids = await seed(s);
    await savePo(ids.a, "501:9999");
    await savePo(ids.a, "501:9001");
    const { f } = fakeAccurate(s);
    const p = await plan(f);
    expect(p.po.close).toEqual(["501:9999"]);
    await applyPlan(p, "2026-11-05");
    expect(await poStatus("501:9999")).toBe("received");
    expect(await poStatus("501:9001")).toBe("open");
  });
  it("caps closes per run and reports it", async () => {
    const s = skus(); const ids = await seed(s);
    for (let i = 0; i < 12; i++) await savePo(ids.a, `503:${i}`);
    const { f } = fakeAccurate(s);
    const p = await plan(f);
    expect(p.po.close).toHaveLength(MIN_CLOSES);
    expect(p.warnings.join(" ")).toMatch(/capped: 12 lines/);
    await applyPlan(p, "2026-11-05");
    expect((await sql`SELECT 1 FROM purchase_orders WHERE accurate_po_id LIKE '503:%' AND status = 'open'`)).toHaveLength(12 - MIN_CLOSES);
  });
  it("does not reopen a line the CRM marked received or cancelled, and a second run changes nothing", async () => {
    const s = skus(); const ids = await seed(s);
    await savePo(ids.a, "501:9001", "received");
    await savePo(ids.b, "502:9003", "cancelled");
    const { f } = fakeAccurate(s);
    const p = await plan(f);
    expect(p.po.insert.map((l) => l.lineKey)).not.toContain("501:9001");
    expect(p.po.update).toHaveLength(0);
    await applyPlan(p, "2026-11-05");
    expect(await poStatus("501:9001")).toBe("received");
    expect(await poStatus("502:9003")).toBe("cancelled");
    const again = await plan(f);
    expect(again.po.insert).toHaveLength(0);
    expect(again.po.update).toHaveLength(0);
    expect(again.po.close).toHaveLength(0);
  });
  it("two overlapping runs do not duplicate PO lines", async () => {
    const s = skus(); const ids = await seed(s);
    const { f } = fakeAccurate(s);
    const p1 = await plan(f);
    const p2 = await plan(f);
    await Promise.all([applyPlan(p1, "2026-11-05"), applyPlan(p2, "2026-11-05")]);
    expect((await sql`SELECT 1 FROM purchase_orders WHERE product_id = ${ids.a} AND accurate_po_id = '501:9001'`)).toHaveLength(1);
    expect((await sql`SELECT 1 FROM purchase_orders WHERE product_id = ${ids.b} AND accurate_po_id = '502:9003'`)).toHaveLength(1);
  });
  it("a dry run (plan only) writes nothing", async () => {
    const s = skus(); const ids = await seed(s);
    const count = async () => Number((await sql`SELECT (SELECT count(*) FROM purchase_orders WHERE accurate_po_id IS NOT NULL) + (SELECT count(*) FROM inventory_snapshots WHERE product_id IN (${ids.a}, ${ids.b})) + (SELECT count(*) FROM sales_monthly WHERE product_id IN (${ids.a}, ${ids.b})) AS n`)[0].n);
    const before = await count();
    const { f, calls } = fakeAccurate(s);
    const p = await plan(f);
    expect(p.stock.length + p.po.insert.length + p.sales.length).toBeGreaterThan(0);
    expect(await count()).toBe(before);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });
  it("refuses an all-zero stock answer and keeps a good snapshot from earlier today", async () => {
    const s = skus(); const ids = await seed(s);
    await sql`INSERT INTO inventory_snapshots (product_id, snapshot_date, warehouse, qty_on_hand) VALUES (${ids.a}, '2026-11-05', 'Gudang Utama', 12)`;
    const { f } = fakeAccurate(s);
    const zeros = override(f, (u) => (u.pathname.endsWith("/item/list-stock.do") ? { s: true, d: [{ no: s.A, quantity: 0 }, { no: s.B, quantity: 0 }], sp: { page: 1, pageCount: 1, rowCount: 2 } } : undefined));
    const p = await plan(zeros);
    expect(p.stock).toEqual([]);
    expect(p.warnings.join(" ")).toMatch(/stock skipped/);
    await applyPlan(p, "2026-11-05");
    expect((await sql`SELECT qty_on_hand FROM inventory_snapshots WHERE product_id = ${ids.a} AND snapshot_date = '2026-11-05'`)[0].qty_on_hand).toBe(12);
    const empty = override(f, (u) => (u.pathname.endsWith("/item/list-stock.do") ? okEmpty : undefined));
    expect((await plan(empty)).warnings.join(" ")).toMatch(/stock skipped/);
  });
  it("fails the fetch when a stock row has no quantity", async () => {
    const s = skus();
    const { f } = fakeAccurate(s);
    const noQty = override(f, (u) => (u.pathname.endsWith("/item/list-stock.do") ? { s: true, d: [{ no: s.A }], sp: { page: 1, pageCount: 1, rowCount: 1 } } : undefined));
    await expect(fetchAccurate(client(noQty), { today: "2026-11-05" })).rejects.toThrow(/stock quantity/);
  });
  it("leaves items of an unknown type alone and reports them", async () => {
    const s = skus(); const ids = await seed(s);
    const { f } = fakeAccurate(s);
    const odd = override(f, (u) => (u.pathname.endsWith("/item/list.do")
      ? { s: true, d: [{ id: s.IDA, no: s.A, name: "A", itemType: "MYSTERY", unit1Name: "UNIT", unitPrice: 0 }], sp: { page: 1, pageCount: 1, rowCount: 1 } } : undefined));
    const typeBefore = (await sql`SELECT item_type::text AS t FROM products WHERE id = ${ids.a}`)[0].t;
    const p = await plan(odd);
    expect(p.unknownTypes).toEqual([{ sku: s.A, type: "MYSTERY" }]);
    expect(p.products.find((x) => x.sku === s.A)).toBeUndefined();
    expect(p.stock.some((x) => x.sku === s.A)).toBe(false);
    await applyPlan(p, "2026-11-05");
    expect((await sql`SELECT item_type::text AS t FROM products WHERE id = ${ids.a}`)[0].t).toBe(typeBefore);
    expect(summarize(p).unknownTypes).toBe(1);
  });
  it("pauses between invoice detail calls when a throttle is set", async () => {
    const s = skus();
    const { f } = fakeAccurate(s);
    const waits: number[] = [];
    await fetchAccurate(client(f), { today: "2026-11-05", throttleMs: 50, sleep: async (ms) => void waits.push(ms) });
    expect(waits).toEqual([50, 50]); // three invoices, two pauses
  });
});
