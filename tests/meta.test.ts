import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { backoffMs, fetchInsights, MetaApiError, parseInsightRow } from "@/lib/meta/insights";
import { defaultWindow, saveInsights, syncInsights, windows } from "@/lib/meta/syncInsights";
import { createUser } from "./fixtures";

// A recorded shape of Meta's answer (tests/fixtures/meta-insights-*.json), with fresh ids per test.
const ids = () => ({ C1: `c1-${randomUUID()}`, S1: `s1-${randomUUID()}`, A1: `a1-${randomUUID()}`, C2: `c2-${randomUUID()}`, S2: `s2-${randomUUID()}`, A2: `a2-${randomUUID()}` });
function fixture(name: string, i: ReturnType<typeof ids>) {
  let s = readFileSync(`tests/fixtures/${name}.json`, "utf8");
  for (const [k, v] of Object.entries(i)) s = s.replaceAll(`{{${k}}}`, v);
  return JSON.parse(s);
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const noSleep = async () => {};

describe("reading Meta rows", () => {
  it("takes spend, reach, link clicks and only the messaging conversation action", () => {
    const i = ids();
    const row = parseInsightRow(fixture("meta-insights-page1", i).data[0]);
    expect(row).toEqual({
      metaCampaignId: i.C1, campaignName: "No_Frisca", metaAdsetId: i.S1, adsetName: "Frisca - IFP", metaAdId: i.A1,
      adName: "Vid Interactive Smartboard - Frisca", date: "2026-10-24", spend: 52340, impressions: 10450, reach: 8120, linkClicks: 212, conversations: 31,
    });
  });
  it("a row without actions or clicks counts zero, and a row without ids is refused", () => {
    const i = ids();
    expect(parseInsightRow(fixture("meta-insights-page2", i).data[0])).toMatchObject({ conversations: 0, linkClicks: 0, spend: 120500 });
    expect(() => parseInsightRow({ ad_id: "1", date_start: "2026-10-24" })).toThrow();
    expect(() => parseInsightRow({ campaign_id: "1", adset_id: "2", ad_id: "3", date_start: "24-10-2026" })).toThrow();
  });
});

describe("fetching", () => {
  it("asks for ad level, daily, the date range and the fields, and follows paging.next", async () => {
    const i = ids();
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      return json(urls.length === 1 ? fixture("meta-insights-page1", i) : fixture("meta-insights-page2", i));
    }) as unknown as typeof fetch;
    const rows = await fetchInsights({ token: "TOKEN-1", accountId: "act_1000000000000001", since: "2026-10-24", until: "2026-10-30", fetchImpl, sleep: noSleep });
    expect(rows).toHaveLength(3);
    const first = new URL(urls[0]);
    expect(first.pathname).toBe("/v24.0/act_1000000000000001/insights");
    expect(first.searchParams.get("level")).toBe("ad");
    expect(first.searchParams.get("time_increment")).toBe("1");
    expect(JSON.parse(first.searchParams.get("time_range") as string)).toEqual({ since: "2026-10-24", until: "2026-10-30" });
    expect(first.searchParams.get("fields")).toContain("inline_link_clicks");
    expect(first.searchParams.get("fields")).toContain("actions");
    expect(urls[1]).toContain("after=y"); // the next page is the URL Meta gave
  });

  it("retries a rate limit and a server error, then succeeds", async () => {
    const i = ids();
    const answers = [
      () => json({ error: { code: 17, message: "User request limit reached" } }, 400),
      () => json({}, 503),
      () => json({ data: fixture("meta-insights-page2", i).data }),
    ];
    const waits: number[] = [];
    const fetchImpl = (async () => answers.shift()!()) as unknown as typeof fetch;
    const rows = await fetchInsights({ token: "T", accountId: "1", since: "2026-10-24", until: "2026-10-24", fetchImpl, sleep: async (ms) => void waits.push(ms) });
    expect(rows).toHaveLength(1);
    expect(waits).toEqual([30_000, 2000]); // a rate limit waits half a minute, a plain server error one second then two
  });

  it("waits longer for a rate limit, grows each time, honours Retry-After and is capped", () => {
    expect([1, 2, 3, 4].map((n) => backoffMs(n, true))).toEqual([30_000, 60_000, 120_000, 240_000]);
    expect([1, 2, 3, 4].map((n) => backoffMs(n, false))).toEqual([1000, 2000, 4000, 8000]);
    expect(backoffMs(1, true, 90)).toBe(90_000);
    expect(backoffMs(9, true)).toBe(300_000);
    expect(backoffMs(1, true, 100_000)).toBe(300_000);
  });

  it("a 200 that is not Meta's list (HTML, or an empty object) is an error, not zero rows", async () => {
    for (const make of [() => new Response("<html>maintenance</html>", { status: 200 }), () => json({})]) {
      let n = 0;
      const fetchImpl = (async () => (n++, make())) as unknown as typeof fetch;
      const err = await fetchInsights({ token: "T", accountId: "1", since: "2026-10-24", until: "2026-10-24", fetchImpl, sleep: noSleep }).catch((e) => e);
      expect(err).toBeInstanceOf(MetaApiError);
      expect(n).toBe(5); // retried, then gave up
    }
    // an honest empty list is fine
    const empty = (async () => json({ data: [] })) as unknown as typeof fetch;
    expect(await fetchInsights({ token: "T", accountId: "1", since: "2026-10-24", until: "2026-10-24", fetchImpl: empty, sleep: noSleep })).toEqual([]);
  });

  it("waits as long as Meta says in Retry-After", async () => {
    const waits: number[] = [];
    const answers = [() => new Response("{}", { status: 429, headers: { "retry-after": "45" } }), () => json({ data: [] })];
    const fetchImpl = (async () => answers.shift()!()) as unknown as typeof fetch;
    await fetchInsights({ token: "T", accountId: "1", since: "2026-10-24", until: "2026-10-24", fetchImpl, sleep: async (ms) => void waits.push(ms) });
    expect(waits).toEqual([45_000]);
  });

  it("never follows a paging link to another host or over http", async () => {
    for (const next of ["https://evil.example.com/steal?access_token=T", "http://graph.facebook.com/v24.0/x", "https://graph.facebook.com.evil.com/x"]) {
      const urls: string[] = [];
      const fetchImpl = (async (u: string) => (urls.push(u), json({ data: [], paging: { next } }))) as unknown as typeof fetch;
      await expect(fetchInsights({ token: "T", accountId: "1", since: "2026-10-24", until: "2026-10-24", fetchImpl, sleep: noSleep })).rejects.toThrow(/another host/);
      expect(urls).toHaveLength(1);
    }
  });

  it("refuses an ad account that is not in Rupiah", () => {
    const i = ids();
    const raw = { ...fixture("meta-insights-page1", i).data[0], account_currency: "USD" };
    expect(() => parseInsightRow(raw)).toThrow(/IDR/);
    expect(parseInsightRow({ ...raw, account_currency: "IDR" }).spend).toBe(52340);
  });

  it("does not retry a bad token, and the error never shows the token", async () => {
    let calls = 0;
    const fetchImpl = (async () => (calls++, json({ error: { code: 190, message: "Invalid OAuth access token." } }, 400))) as unknown as typeof fetch;
    const err = await fetchInsights({ token: "SECRET-TOKEN-XYZ", accountId: "1", since: "2026-10-24", until: "2026-10-24", fetchImpl, sleep: noSleep }).catch((e) => e);
    expect(err).toBeInstanceOf(MetaApiError);
    expect(calls).toBe(1);
    expect(String(err.message)).not.toContain("SECRET-TOKEN-XYZ");
    expect(err.message).toContain("190");
  });

  it("gives up after five tries and refuses an account id that isn't a number", async () => {
    let calls = 0;
    const fetchImpl = (async () => (calls++, json({}, 500))) as unknown as typeof fetch;
    await expect(fetchInsights({ token: "T", accountId: "1", since: "2026-10-24", until: "2026-10-24", fetchImpl, sleep: noSleep })).rejects.toBeInstanceOf(MetaApiError);
    expect(calls).toBe(5);
    await expect(fetchInsights({ token: "T", accountId: "act_abc", since: "2026-10-24", until: "2026-10-24" })).rejects.toThrow(/account number/);
  });

  it("a network error is retried too", async () => {
    const i = ids();
    let n = 0;
    const fetchImpl = (async () => {
      if (n++ === 0) throw new TypeError("fetch failed");
      return json({ data: fixture("meta-insights-page2", i).data });
    }) as unknown as typeof fetch;
    expect(await fetchInsights({ token: "T", accountId: "1", since: "2026-10-24", until: "2026-10-24", fetchImpl, sleep: noSleep })).toHaveLength(1);
  });
});

describe("saving", () => {
  const rowsFor = (i: ReturnType<typeof ids>) => [...fixture("meta-insights-page1", i).data, ...fixture("meta-insights-page2", i).data].map(parseInsightRow);
  const snapshot = async (i: ReturnType<typeof ids>) => ({
    insights: await sql`SELECT a.meta_ad_id, d.date::text AS date, d.spend::int AS spend, d.impressions, d.reach, d.link_clicks, d.meta_conversations
                          FROM ad_insights_daily d JOIN ads a ON a.id = d.ad_id WHERE a.meta_ad_id IN ${sql([i.A1, i.A2])} ORDER BY 1, 2`,
    counts: (await sql`SELECT (SELECT count(*) FROM ad_campaigns WHERE meta_campaign_id IN ${sql([i.C1, i.C2])})::int AS campaigns,
                              (SELECT count(*) FROM ad_sets WHERE meta_adset_id IN ${sql([i.S1, i.S2])})::int AS adsets,
                              (SELECT count(*) FROM ads WHERE meta_ad_id IN ${sql([i.A1, i.A2])})::int AS ads`)[0],
  });

  it("makes the campaign, ad set, ad and one row per ad and day; a second run changes nothing", async () => {
    const i = ids();
    await saveInsights(rowsFor(i));
    const first = await snapshot(i);
    expect(first.counts).toEqual({ campaigns: 2, adsets: 2, ads: 2 });
    expect(first.insights).toHaveLength(3);
    expect(first.insights[0]).toMatchObject({ date: "2026-10-24", spend: 52340, meta_conversations: 31, link_clicks: 212 });
    await saveInsights(rowsFor(i));
    expect(await snapshot(i)).toEqual(first);
  });

  it("Meta restating a day updates that day, and the owner, product line and ad code stay as people set them", async () => {
    const i = ids();
    const rep = await createUser();
    await saveInsights(rowsFor(i));
    await sql`UPDATE ad_campaigns SET owner_user_id = ${rep.id} WHERE meta_campaign_id = ${i.C1}`;
    await sql`UPDATE ad_sets SET product_line = 'IFP' WHERE meta_adset_id = ${i.S1}`;
    const code = `F-IFP-${String(Math.floor(Math.random() * 90) + 10)}`;
    await sql`UPDATE ads SET prefill_code = ${code} WHERE meta_ad_id = ${i.A1}`;

    const again = rowsFor(i);
    again[0] = { ...again[0], spend: 55000, conversations: 35, adName: "Nama baru" };
    await saveInsights(again);

    const [d] = await sql`SELECT d.spend::int AS spend, d.meta_conversations FROM ad_insights_daily d JOIN ads a ON a.id = d.ad_id WHERE a.meta_ad_id = ${i.A1} AND d.date = '2026-10-24'`;
    expect(d).toEqual({ spend: 55000, meta_conversations: 35 });
    const [ad] = await sql`SELECT name, prefill_code FROM ads WHERE meta_ad_id = ${i.A1}`;
    expect(ad).toEqual({ name: "Nama baru", prefill_code: code });
    expect((await sql`SELECT owner_user_id FROM ad_campaigns WHERE meta_campaign_id = ${i.C1}`)[0].owner_user_id).toBe(rep.id);
    expect((await sql`SELECT product_line FROM ad_sets WHERE meta_adset_id = ${i.S1}`)[0].product_line).toBe("IFP");
  });

  it("feeds the leakage view (clicks → Meta chats → CRM leads)", async () => {
    const i = ids();
    await saveInsights(rowsFor(i));
    const [v] = await sql`SELECT link_clicks, meta_conversations, meta_click_to_chat::float AS ratio FROM v_ad_leakage_daily v JOIN ads a ON a.id = v.ad_id WHERE a.meta_ad_id = ${i.A1} AND v.date = '2026-10-24'`;
    expect(v).toMatchObject({ link_clicks: 212, meta_conversations: 31 });
    expect(v.ratio).toBeCloseTo(31 / 212, 3);
  });
});

describe("windows and the whole sync", () => {
  it("the nightly window is three days back to yesterday in Jakarta dates", () => {
    // 2026-11-05 01:00 Jakarta is still 4 Nov in UTC: Jakarta's day counts
    expect(defaultWindow(Date.parse("2026-11-04T18:00:00Z"))).toEqual({ from: "2026-11-02", to: "2026-11-04" });
    expect(defaultWindow(Date.parse("2026-11-05T10:00:00Z"))).toEqual({ from: "2026-11-02", to: "2026-11-04" });
  });
  it("a long backfill is cut into windows without gaps or overlaps", () => {
    expect(windows("2026-10-24", "2026-10-30")).toEqual([{ from: "2026-10-24", to: "2026-10-30" }]);
    const w = windows("2026-09-01", "2026-10-05", 14);
    expect(w[0]).toEqual({ from: "2026-09-01", to: "2026-09-14" });
    expect(w.at(-1)).toEqual({ from: "2026-09-29", to: "2026-10-05" });
    expect(w).toHaveLength(3);
  });
  it("a sync saves, notes the time, and a failure is noted without the token", async () => {
    const i = ids();
    const ok = (async () => json({ data: fixture("meta-insights-page2", i).data })) as unknown as typeof fetch;
    const s = await syncInsights({ token: "T", accountId: "1", from: "2026-10-24", to: "2026-10-24", fetchImpl: ok, sleep: noSleep });
    expect(s).toMatchObject({ rows: 1, ads: 1, spend: 120500, conversations: 0 });
    expect((await sql`SELECT value FROM app_settings WHERE key = 'insights_last_sync'`)[0].value).toMatchObject({ rows: 1, from: "2026-10-24" });

    const bad = (async () => json({ error: { code: 190, message: "Invalid OAuth access token." } }, 400)) as unknown as typeof fetch;
    await expect(syncInsights({ token: "SECRET-ZZ", accountId: "1", from: "2026-10-24", to: "2026-10-24", fetchImpl: bad, sleep: noSleep })).rejects.toBeInstanceOf(MetaApiError);
    const [f] = await sql`SELECT value FROM app_settings WHERE key = 'insights_last_failure'`;
    expect(JSON.stringify(f.value)).not.toContain("SECRET-ZZ");
    await expect(syncInsights({ token: "T", accountId: "1", from: "2026-10-30", to: "2026-10-24" })).rejects.toThrow(/after/);
  });
});

describe("the job as Railway runs it", () => {
  it("compiles, and exits 1 with a clear message when the Meta variables are missing", () => {
    execFileSync(process.execPath, ["scripts/build-jobs.mjs"], { stdio: "pipe" });
    const env = { ...process.env, META_SYSTEM_USER_TOKEN: "", META_AD_ACCOUNT_ID: "" };
    const run = (args: string[], e = env) => spawnSync(process.execPath, ["jobs/insights-sync.js", ...args], { env: e, encoding: "utf8" });
    const missing = run([]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("must be set");
    const badDate = run(["--from", "kemarin"], { ...env, META_SYSTEM_USER_TOKEN: "x", META_AD_ACCOUNT_ID: "1" });
    expect(badDate.status).toBe(1);
    expect(badDate.stderr).toContain("--from needs a date");
    const badAccount = run([], { ...env, META_SYSTEM_USER_TOKEN: "x", META_AD_ACCOUNT_ID: "abc" });
    expect(badAccount.status).toBe(1);
    expect(badAccount.stderr).toContain("account number");
    expect(badAccount.stderr + badAccount.stdout).not.toContain("x&"); // no URL with a token
  });
});
