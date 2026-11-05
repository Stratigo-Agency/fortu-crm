import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/v1/ingest/web-form/route";
import { sql } from "@/lib/db";
import { MAX_SKEW_SECONDS, sign, verifySignature } from "@/lib/webform/signature";
import { createUser } from "./fixtures";

const SECRET = "uji-rahasia-webform";
const URL_ = "http://localhost/api/v1/ingest/web-form";

beforeAll(() => {
  process.env.WEBFORM_HMAC_SECRET = SECRET;
});
afterEach(() => {
  process.env.WEBFORM_HMAC_SECRET = SECRET;
});

const phone = () => `0812${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
const payload = (o: Record<string, unknown> = {}) => ({
  submission_id: randomUUID(),
  submitted_at: new Date().toISOString(),
  name: "Budi Santoso",
  phone: phone(),
  email: "budi@sma1.sch.id",
  company: "SMA Negeri 1",
  product_interest: "IFP",
  message: "Butuh 12 unit untuk kelas",
  page_url: "https://fortu.co.id/produk/ifp",
  utm: { source: "google", medium: "cpc", campaign: "ifp-sekolah", content: null },
  click_ids: { gclid: "Cj0KCQ", fbclid: null },
  ...o,
});

function signed(body: string, o: { ts?: number; secret?: string; headers?: Record<string, string | null> } = {}) {
  const ts = String(o.ts ?? Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = { "content-type": "application/json" };
  const set = { "x-fortu-timestamp": ts, "x-fortu-signature": sign(o.secret ?? SECRET, ts, body), ...o.headers };
  for (const [k, v] of Object.entries(set)) if (v !== null) headers[k] = v;
  return new Request(URL_, { method: "POST", body, headers });
}
const send = (p: object, o?: Parameters<typeof signed>[1]) => POST(signed(JSON.stringify(p), o));

describe("signature check", () => {
  const body = '{"a":1}';
  const now = 1_800_000_000_000;
  const ts = String(now / 1000);

  it("accepts the right signature", () => {
    expect(verifySignature(SECRET, { timestamp: ts, signature: sign(SECRET, ts, body) }, body, now)).toEqual({ ok: true });
  });
  it("refuses a wrong secret, a changed body, a missing or malformed header", () => {
    const good = sign(SECRET, ts, body);
    expect(verifySignature(SECRET, { timestamp: ts, signature: sign("lain", ts, body) }, body, now)).toMatchObject({ ok: false, reason: "mismatch" });
    expect(verifySignature(SECRET, { timestamp: ts, signature: good }, body + " ", now)).toMatchObject({ ok: false, reason: "mismatch" });
    expect(verifySignature(SECRET, { timestamp: null, signature: good }, body, now)).toMatchObject({ reason: "missing" });
    expect(verifySignature(SECRET, { timestamp: ts, signature: null }, body, now)).toMatchObject({ reason: "missing" });
    expect(verifySignature(SECRET, { timestamp: "abc", signature: good }, body, now)).toMatchObject({ reason: "format" });
    expect(verifySignature(SECRET, { timestamp: ts, signature: "sha256=zz" }, body, now)).toMatchObject({ reason: "format" });
    expect(verifySignature(SECRET, { timestamp: ts, signature: good.slice(7) }, body, now)).toMatchObject({ reason: "format" });
  });
  it(`allows ${MAX_SKEW_SECONDS} s of difference and no more`, () => {
    const at = (s: number) => String(now / 1000 - s);
    expect(verifySignature(SECRET, { timestamp: at(MAX_SKEW_SECONDS), signature: sign(SECRET, at(MAX_SKEW_SECONDS), body) }, body, now).ok).toBe(true);
    expect(verifySignature(SECRET, { timestamp: at(MAX_SKEW_SECONDS + 1), signature: sign(SECRET, at(MAX_SKEW_SECONDS + 1), body) }, body, now)).toMatchObject({ reason: "stale" });
    expect(verifySignature(SECRET, { timestamp: at(-301), signature: sign(SECRET, at(-301), body) }, body, now)).toMatchObject({ reason: "stale" });
  });
});

describe("POST /api/v1/ingest/web-form", () => {
  it("a valid signed submission makes one website lead with its owner, UTMs and message", async () => {
    await createUser({ role: "sales_rep", productLines: ["IFP"] });
    const p = payload();
    const res = await send(p);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ deduped: false, leadId: expect.any(String) });

    const [lead] = await sql`
      SELECT source_channel, capture_method, product_interest, utm_source, utm_medium, utm_campaign, first_message, owner_user_id, status
        FROM leads WHERE id = ${json.leadId}`;
    expect(lead).toMatchObject({
      source_channel: "website_form", capture_method: "web_form", product_interest: "IFP",
      utm_source: "google", utm_medium: "cpc", utm_campaign: "ifp-sekolah",
      first_message: "Butuh 12 unit untuk kelas", status: "new",
    });
    expect(lead.owner_user_id).not.toBeNull(); // picked by pick_lead_owner
    // the whole body is kept for later (email, page, click ids)
    const [ev] = await sql`SELECT payload FROM inbound_events WHERE provider = 'web_form' AND external_id = ${p.submission_id}`;
    expect(ev.payload).toMatchObject({ email: "budi@sma1.sch.id", page_url: "https://fortu.co.id/produk/ifp", click_ids: { gclid: "Cj0KCQ" } });
  });

  it("the same submission_id twice is one lead, and the second answer says deduped", async () => {
    const p = payload();
    const first = await (await send(p)).json();
    const again = await send(p, { ts: Math.floor(Date.now() / 1000) + 1 });
    expect(again.status).toBe(200);
    const second = await again.json();
    expect(second).toMatchObject({ leadId: first.leadId, deduped: true });
    expect((await sql`SELECT 1 FROM leads WHERE id = ${first.leadId}`).length).toBe(1);
    expect((await sql`SELECT 1 FROM inbound_events WHERE provider = 'web_form' AND external_id = ${p.submission_id}`).length).toBe(1);
  });

  it("a wrong signature, a wrong secret, a missing header or a changed body is 401 and writes nothing", async () => {
    const p = payload();
    const body = JSON.stringify(p);
    const attempts = [
      signed(body, { secret: "salah" }),
      signed(body, { headers: { "x-fortu-signature": null } }),
      signed(body, { headers: { "x-fortu-timestamp": null } }),
      signed(body, { headers: { "x-fortu-signature": "sha256=" + "0".repeat(64) } }),
      // signed for one body, sent with another
      new Request(URL_, { method: "POST", body: JSON.stringify({ ...p, phone: "081200000000" }), headers: signed(body).headers }),
    ];
    for (const req of attempts) expect((await POST(req)).status).toBe(401);
    expect((await sql`SELECT 1 FROM inbound_events WHERE provider = 'web_form' AND external_id = ${p.submission_id}`).length).toBe(0);
  });

  it("a timestamp 301 s old is 401, 299 s old is accepted", async () => {
    const now = Math.floor(Date.now() / 1000);
    expect((await send(payload(), { ts: now - 301 })).status).toBe(401);
    expect((await send(payload(), { ts: now - 299 })).status).toBe(200);
  });

  it("a signed but broken body is 400", async () => {
    const bad = [
      JSON.stringify({ ...payload(), submission_id: "bukan-uuid" }),
      JSON.stringify({ ...payload(), phone: undefined }),
      JSON.stringify({ ...payload(), phone: "12345" }), // not a readable number
      "{ not json",
      "[]",
    ];
    for (const body of bad) {
      const res = await POST(signed(body));
      expect(res.status, body).toBe(400);
    }
    expect((await POST(signed(JSON.stringify({ ...payload(), message: "x".repeat(40_000) })))).status).toBe(400);
  });

  it("optional fields can be missing or null; an unknown product is ignored; a future time falls back to now", async () => {
    const res = await send({ submission_id: randomUUID(), phone: phone(), product_interest: "XYZ", submitted_at: "2999-01-01T00:00:00Z", utm: null, click_ids: null });
    expect(res.status).toBe(200);
    const [lead] = await sql`SELECT product_interest, received_at FROM leads WHERE id = ${(await res.json()).leadId}`;
    expect(lead.product_interest).toBeNull();
    expect(Date.now() - lead.received_at.getTime()).toBeLessThan(60_000);
  });

  it("a later submission from the same number in a day merges into the lead instead of making another", async () => {
    const number = phone();
    const a = await (await send(payload({ phone: number }))).json();
    const b = await (await send(payload({ phone: number, message: "Tanya lagi" }))).json();
    expect(b).toMatchObject({ leadId: a.leadId, deduped: true });
  });

  it("without a configured secret it refuses everything and says nothing about why", async () => {
    delete process.env.WEBFORM_HMAC_SECRET;
    const res = await send(payload());
    expect(res.status).toBe(500);
    expect(Object.keys(await res.json()).sort()).toEqual(["error", "requestId"]);
  });

  it("never shows internals in a failure", async () => {
    const res = await send(payload({ submission_id: "x" }));
    const text = JSON.stringify(await res.json());
    expect(text).not.toMatch(/postgres|stack|select|secret/i);
  });
});
