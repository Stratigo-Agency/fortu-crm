import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GET, HEAD } from "@/app/go/wa/route";
import { sql } from "@/lib/db";
import { ingestLead } from "@/lib/ingest/ingestLead";
import { parseCodes } from "@/lib/ingest/codes";
import { isPublicPath } from "@/lib/publicPaths";
import { createRateLimiter } from "@/lib/webform/rateLimit";
import { DEFAULT_TEXT, isBot, lineLabels, neutralizeCodes, newRefCode } from "@/lib/webform/waLink";
import { createUser, createWaLine } from "./fixtures";

const BROWSER = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1";
const randomIp = () => `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const get = (qs: string, headers: Record<string, string> = {}) =>
  GET(new Request(`http://localhost/go/wa?${qs}`, { headers: { "x-forwarded-for": randomIp(), "user-agent": BROWSER, ...headers } }));
const clicks = async () => (await sql`SELECT count(*)::int AS n FROM wa_click_events`)[0].n as number;

async function lineFor(label = `No_${randomUUID().slice(0, 6)}`) {
  const rep = await createUser();
  const line = await createWaLine(rep.id, true, label);
  return { rep, line, label };
}

describe("GET /go/wa", () => {
  it("redirects to wa.me with the prefilled text and a click code, and records one click", async () => {
    const { rep, line, label } = await lineFor();
    const res = await get(`line=${label}&text=${encodeURIComponent("Halo, tanya IFP")}&utm_source=google&utm_medium=cpc&utm_campaign=ifp-sekolah&utm_content=banner`,
      { referer: "https://fortu.co.id/produk/ifp" });
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get("location") as string);
    expect(to.origin + to.pathname).toBe(`https://wa.me/${line.phone.replace("+", "")}`);
    const text = to.searchParams.get("text") as string;
    const code = /#([A-Z2-9]{4})$/.exec(text)?.[1] as string;
    expect(code).toBeTruthy();
    expect(text).toBe(`Halo, tanya IFP #${code}`);
    expect(parseCodes(text).clickCode).toBe(code);

    const rows = await sql`SELECT * FROM wa_click_events WHERE ref_code = ${code}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source_channel: "website_wa_link", utm_source: "google", utm_medium: "cpc", utm_campaign: "ifp-sekolah",
      utm_content: "banner", landing_url: "https://fortu.co.id/produk/ifp", target_user_id: rep.id, matched_lead_id: null,
    });
  });

  it("uses a default text when none is given, and finds the line whatever the letter case", async () => {
    const { label } = await lineFor();
    const res = await get(`line=${label.toLowerCase()}`);
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get("location") as string).searchParams.get("text")).toMatch(new RegExp(`^${DEFAULT_TEXT} #[A-Z2-9]{4}$`));
  });

  it("an unknown, inactive or missing line is 404 and records nothing", async () => {
    const rep = await createUser();
    const off = await createWaLine(rep.id, false, `Mati_${randomUUID().slice(0, 6)}`);
    const before = (await sql`SELECT count(*)::int AS n FROM wa_click_events`)[0].n;
    expect((await get("line=tidak-ada")).status).toBe(404);
    expect((await get("")).status).toBe(404);
    const [{ label }] = await sql<{ label: string }[]>`SELECT label FROM wa_lines WHERE id = ${off.id}`;
    expect((await get(`line=${label}`)).status).toBe(404);
    expect((await sql`SELECT count(*)::int AS n FROM wa_click_events`)[0].n).toBe(before);
  });

  it("a group of lines sends each click to one of its active numbers", async () => {
    const tag = randomUUID().slice(0, 6);
    const a = await lineFor(`Tim_${tag}_a`);
    const b = await lineFor(`Tim_${tag}_b`);
    const off = await createWaLine((await createUser()).id, false, `Tim_${tag}_off`);
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const res = await get(`line=${encodeURIComponent(`${a.label}, ${b.label},Tim_${tag}_off,tidak-ada`)}`);
      expect(res.status).toBe(302);
      seen.add(new URL(res.headers.get("location") as string).pathname.slice(1));
    }
    expect([...seen].sort()).toEqual([a.line.phone, b.line.phone].map((p) => p.replace("+", "")).sort());
    expect(seen.has(off.phone.replace("+", ""))).toBe(false);
  });

  it("in a group, a line whose rep takes leads wins over one whose rep is away", async () => {
    const tag = randomUUID().slice(0, 6);
    const away = await createUser({ acceptingLeads: false });
    await createWaLine(away.id, true, `Grp_${tag}_away`);
    const here = await lineFor(`Grp_${tag}_here`);
    for (let i = 0; i < 8; i++) {
      const res = await get(`line=Grp_${tag}_away,Grp_${tag}_here`);
      expect(new URL(res.headers.get("location") as string).pathname).toBe(`/${here.line.phone.replace("+", "")}`);
    }
  });

  it("reads a group of labels: trimmed, lower case, no repeats, at most 10", () => {
    expect(lineLabels(null)).toEqual([]);
    expect(lineLabels(" Jakarta-1 , jakarta-1,,Medan ")).toEqual(["jakarta-1", "medan"]);
    expect(lineLabels(Array.from({ length: 15 }, (_, i) => `L${i}`).join(","))).toHaveLength(10);
  });

  it("each click gets its own code", async () => {
    const { label } = await lineFor();
    const codes = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const text = new URL((await get(`line=${label}`)).headers.get("location") as string).searchParams.get("text") as string;
      codes.add(/#(\w{4})$/.exec(text)?.[1] as string);
    }
    expect(codes.size).toBe(12);
  });

  it("caps long input and keeps a text with symbols safe in the address", async () => {
    const { label } = await lineFor();
    const res = await get(`line=${label}&text=${encodeURIComponent("Halo & selamat #1 ?x=y")}&utm_source=${"a".repeat(500)}`);
    const to = new URL(res.headers.get("location") as string);
    expect(to.searchParams.get("text")).toMatch(/^Halo & selamat #1 \?x=y #[A-Z2-9]{4}$/);
    const code = /#([A-Z2-9]{4})$/.exec(to.searchParams.get("text") as string)?.[1];
    expect((await sql`SELECT utm_source FROM wa_click_events WHERE ref_code = ${code as string}`)[0].utm_source).toHaveLength(100);
  });

  it("answers 429 after 20 clicks in a minute from one IP, and not for another IP", async () => {
    const { label } = await lineFor();
    const ip = `172.16.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    const results: number[] = [];
    for (let i = 0; i < 22; i++) results.push((await get(`line=${label}`, { "x-forwarded-for": ip })).status);
    expect(results.slice(0, 20).every((s) => s === 302)).toBe(true);
    expect(results.slice(20)).toEqual([429, 429]);
    expect((await get(`line=${label}`)).status).toBe(302);
  });

  it("a lead whose first message carries the code is matched to that click, once", async () => {
    const { label } = await lineFor();
    const res = await get(`line=${label}&utm_source=google&utm_campaign=ifp-sekolah`);
    const text = new URL(res.headers.get("location") as string).searchParams.get("text") as string;
    const code = /#(\w{4})$/.exec(text)?.[1] as string;

    const lead = await ingestLead({ phone: `0813${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, sourceChannel: "other", captureMethod: "wa_link_ref", firstMessage: text });
    const [click] = await sql`SELECT matched_lead_id FROM wa_click_events WHERE ref_code = ${code}`;
    expect(click.matched_lead_id).toBe(lead.leadId);
    const [row] = await sql`SELECT utm_source, utm_campaign FROM leads WHERE id = ${lead.leadId}`;
    expect(row).toMatchObject({ utm_source: "google", utm_campaign: "ifp-sekolah" });

    // a forwarded copy of the same message from someone else does not take the click over
    const other = await ingestLead({ phone: `0813${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, sourceChannel: "other", captureMethod: "wa_link_ref", firstMessage: text });
    expect(other.leadId).not.toBe(lead.leadId);
    expect((await sql`SELECT matched_lead_id FROM wa_click_events WHERE ref_code = ${code}`)[0].matched_lead_id).toBe(lead.leadId);
  });
});

describe("click codes and the limiter", () => {
  it("codes are 4 characters without 0, O, 1 or I", () => {
    for (let i = 0; i < 500; i++) expect(newRefCode()).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
  });
  it("the limiter forgets old hits and drops the oldest keys when full", () => {
    const l = createRateLimiter(2, 1000, 3);
    expect([l.hit("a", 0), l.hit("a", 10), l.hit("a", 20)]).toEqual([true, true, false]);
    expect(l.hit("a", 1100)).toBe(true);
    for (const k of ["b", "c", "d", "e"]) l.hit(k, 1200);
    expect([l.hit("a", 1210), l.hit("a", 1220), l.hit("a", 1230)]).toEqual([true, true, false]); // "a" was dropped, so it counts afresh
  });
});

describe("bots, spoofing and what a visitor can type", () => {
  it("a HEAD request and a link-preview crawler reach the chat but record no click and get no code", async () => {
    const { label } = await lineFor();
    const before = await clicks();
    const head = await HEAD(new Request(`http://localhost/go/wa?line=${label}`, { method: "HEAD" }));
    expect(head.status).toBe(302);
    expect(new URL(head.headers.get("location") as string).searchParams.get("text")).toBe(DEFAULT_TEXT);
    for (const ua of ["WhatsApp/2.23.20 A", "facebookexternalhit/1.1", "Slackbot-LinkExpanding 1.0", "Googlebot/2.1", ""]) {
      const res = await get(`line=${label}`, { "user-agent": ua });
      expect(res.status, ua).toBe(302);
      expect(new URL(res.headers.get("location") as string).searchParams.get("text")).toBe(DEFAULT_TEXT);
    }
    expect(await clicks()).toBe(before);
    expect((await HEAD(new Request("http://localhost/go/wa?line=tidak-ada", { method: "HEAD" }))).status).toBe(404);
    expect(isBot(BROWSER)).toBe(false);
  });

  it("a made-up first x-forwarded-for entry does not get around the limit", async () => {
    const { label } = await lineFor();
    const real = `192.168.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) statuses.push((await get(`line=${label}`, { "x-forwarded-for": `${randomIp()}, ${real}` })).status);
    expect(statuses.slice(20)).toEqual([429, 429]);
  });

  it("a text can't carry a click code or an ad code of its own", async () => {
    expect(neutralizeCodes("Halo #AB12 ya")).toBe("Halo AB12 ya");
    expect(neutralizeCodes("[F-IFP-01] halo")).toBe("(F-IFP-01) halo");
    expect(neutralizeCodes("Nomor #1 dan #12345")).toBe("Nomor #1 dan #12345");
    const { label } = await lineFor();
    const res = await get(`line=${label}&text=${encodeURIComponent("#ABCD [F-IFP-01]")}`);
    const text = new URL(res.headers.get("location") as string).searchParams.get("text") as string;
    expect(parseCodes(text).adCode).toBeUndefined();
    expect(parseCodes(text).clickCode).toBe(/#(\w{4})$/.exec(text)?.[1]);
  });
});

describe("public paths", () => {
  it("only the ingest endpoints, /go/wa, sign-in and auth are open", () => {
    for (const p of ["/api/v1/ingest/web-form", "/go/wa", "/masuk", "/api/auth/signin"]) expect(isPublicPath(p), p).toBe(true);
    for (const p of ["/api/v1/other", "/api/v1", "/go/other", "/go", "/pipeline", "/kontak", "/api/v1/ingest"]) expect(isPublicPath(p), p).toBe(false);
  });
});
