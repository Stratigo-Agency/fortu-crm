import { sql } from "@/lib/db";
import type { Tx } from "@/lib/ingest/owner";
import { fetchInsights, type InsightRow } from "./insights";

// Writes Meta insights into ad_campaigns, ad_sets, ads and ad_insights_daily.
// Owner, product line and prefill code are set by people in Pengaturan › Iklan, so a sync never touches them.

export type SyncSummary = { from: string; to: string; rows: number; ads: number; spend: number; conversations: number };

/** Upserts rows; running it twice with the same rows changes nothing but pulled_at. */
export async function saveInsights(rows: InsightRow[], tx?: Tx): Promise<void> {
  const run = async (t: Tx) => {
    const campaigns = new Map<string, string>(); // meta id → uuid
    const adsets = new Map<string, string>();
    const ads = new Map<string, string>();
    for (const r of rows) {
      if (!campaigns.has(r.metaCampaignId)) {
        const [c] = await t<{ id: string }[]>`
          INSERT INTO ad_campaigns (meta_campaign_id, name) VALUES (${r.metaCampaignId}, ${r.campaignName})
          ON CONFLICT (meta_campaign_id) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
        campaigns.set(r.metaCampaignId, c.id);
      }
      if (!adsets.has(r.metaAdsetId)) {
        const [s] = await t<{ id: string }[]>`
          INSERT INTO ad_sets (meta_adset_id, campaign_id, name) VALUES (${r.metaAdsetId}, ${campaigns.get(r.metaCampaignId)!}, ${r.adsetName})
          ON CONFLICT (meta_adset_id) DO UPDATE SET name = EXCLUDED.name, campaign_id = EXCLUDED.campaign_id RETURNING id`;
        adsets.set(r.metaAdsetId, s.id);
      }
      if (!ads.has(r.metaAdId)) {
        const [a] = await t<{ id: string }[]>`
          INSERT INTO ads (meta_ad_id, ad_set_id, name) VALUES (${r.metaAdId}, ${adsets.get(r.metaAdsetId)!}, ${r.adName})
          ON CONFLICT (meta_ad_id) DO UPDATE SET name = EXCLUDED.name, ad_set_id = EXCLUDED.ad_set_id RETURNING id`;
        ads.set(r.metaAdId, a.id);
      }
      await t`
        INSERT INTO ad_insights_daily (ad_id, date, spend, impressions, reach, link_clicks, meta_conversations, pulled_at)
        VALUES (${ads.get(r.metaAdId)!}, ${r.date}::date, ${r.spend}, ${r.impressions}, ${r.reach}, ${r.linkClicks}, ${r.conversations}, now())
        ON CONFLICT (ad_id, date) DO UPDATE
           SET spend = EXCLUDED.spend, impressions = EXCLUDED.impressions, reach = EXCLUDED.reach,
               link_clicks = EXCLUDED.link_clicks, meta_conversations = EXCLUDED.meta_conversations, pulled_at = now()`;
    }
  };
  if (tx) await run(tx);
  else await sql.begin(run);
}

const DAY = 86_400_000;
const jakartaDay = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(ms));
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** The nightly window: three days back up to yesterday, in Jakarta dates (Meta restates recent figures). */
export function defaultWindow(nowMs: number = Date.now()): { from: string; to: string } {
  return { from: jakartaDay(nowMs - 3 * DAY), to: jakartaDay(nowMs - DAY) };
}

/** Splits a long backfill into windows of at most `days` days (Meta answers shorter ranges faster and more reliably). */
export function windows(from: string, to: string, days = 14): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  for (let start = dayMs(from); start <= dayMs(to); start += days * DAY) {
    const end = Math.min(start + (days - 1) * DAY, dayMs(to));
    out.push({ from: new Date(start).toISOString().slice(0, 10), to: new Date(end).toISOString().slice(0, 10) });
  }
  return out;
}

async function remember(key: string, value: unknown) {
  await sql`INSERT INTO app_settings (key, value) VALUES (${key}, ${sql.json(value as never)})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
}

export type SyncOptions = { token: string; accountId: string; from?: string; to?: string; version?: string; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> };

/** Pulls the window, saves it, and notes the time (or the failure) for Pengaturan › Iklan. */
export async function syncInsights(o: SyncOptions): Promise<SyncSummary> {
  const win = { ...defaultWindow(), ...(o.from && { from: o.from }), ...(o.to && { to: o.to }) };
  if (win.from > win.to) throw new Error("--from is after --to");
  try {
    const all: InsightRow[] = [];
    for (const w of windows(win.from, win.to)) {
      all.push(...(await fetchInsights({ token: o.token, accountId: o.accountId, since: w.from, until: w.to, version: o.version, fetchImpl: o.fetchImpl, sleep: o.sleep })));
    }
    await saveInsights(all);
    const summary: SyncSummary = {
      from: win.from, to: win.to, rows: all.length, ads: new Set(all.map((r) => r.metaAdId)).size,
      spend: all.reduce((s, r) => s + r.spend, 0), conversations: all.reduce((s, r) => s + r.conversations, 0),
    };
    await remember("insights_last_sync", { at: new Date().toISOString(), ...summary });
    return summary;
  } catch (err) {
    await remember("insights_last_failure", { at: new Date().toISOString(), message: err instanceof Error ? err.message.slice(0, 300) : "unknown" }).catch(() => {});
    throw err;
  }
}
