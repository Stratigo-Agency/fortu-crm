// Meta Marketing API · ad insights (docs/INTEGRATIONS.md · Meta insights sync).
// Fetching with retries and reading the rows live here; writing to the database is in syncInsights.ts.

export const DEFAULT_GRAPH_VERSION = "v24.0";
export const CONVERSATION_ACTION = "onsite_conversion.messaging_conversation_started_7d";
const FIELDS = "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,reach,inline_link_clicks,actions,account_currency";

export type InsightRow = {
  metaCampaignId: string; campaignName: string;
  metaAdsetId: string; adsetName: string;
  metaAdId: string; adName: string;
  date: string; // YYYY-MM-DD, the account's day (Asia/Jakarta)
  spend: number; // whole Rupiah
  impressions: number; reach: number; linkClicks: number; conversations: number;
};

type RawAction = { action_type?: string; value?: string };
type RawRow = Record<string, unknown> & { actions?: RawAction[] };

const whole = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n) : 0;
};
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** One Meta row (level=ad, time_increment=1) as the CRM stores it. Throws on a row without ids or a date. */
export function parseInsightRow(raw: RawRow): InsightRow {
  const row = {
    metaCampaignId: str(raw.campaign_id), campaignName: str(raw.campaign_name),
    metaAdsetId: str(raw.adset_id), adsetName: str(raw.adset_name),
    metaAdId: str(raw.ad_id), adName: str(raw.ad_name),
    date: str(raw.date_start),
  };
  if (!row.metaCampaignId || !row.metaAdsetId || !row.metaAdId || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) {
    throw new Error("Meta insights row without campaign, ad set, ad or date");
  }
  // spend is read as whole Rupiah; a USD or other account would be rounded wrongly, so refuse it
  if (typeof raw.account_currency === "string" && raw.account_currency !== "IDR") {
    throw new Error(`Ad account currency is ${raw.account_currency}, the CRM reads IDR only`);
  }
  const conversations = (Array.isArray(raw.actions) ? raw.actions : [])
    .filter((a) => a.action_type === CONVERSATION_ACTION)
    .reduce((sum, a) => sum + whole(a.value), 0);
  return {
    ...row,
    spend: whole(raw.spend), // IDR has no decimals; Meta sends "52340" or "52340.00"
    impressions: whole(raw.impressions), reach: whole(raw.reach), linkClicks: whole(raw.inline_link_clicks), conversations,
  };
}

export class MetaApiError extends Error {
  constructor(readonly status: number, readonly code: number | null, message: string, readonly retryable: boolean) {
    super(message);
    this.name = "MetaApiError";
  }
}

// Meta says "too many calls" with these codes (4, 17, 32, 613) and sometimes with 200-range-looking transient errors.
const RATE_CODES = new Set([4, 17, 32, 613, 80000, 80003, 80004]);

type Deps = { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; maxAttempts?: number };

/** Waits in ms before try `attempt` (1-based). Rate limits need minutes to clear, other errors seconds. */
export function backoffMs(attempt: number, rateLimited: boolean, retryAfterSec?: number): number {
  if (retryAfterSec && retryAfterSec > 0) return Math.min(300_000, Math.round(retryAfterSec * 1000));
  const base = rateLimited ? 30_000 : 1000;
  return Math.min(300_000, base * 2 ** (attempt - 1));
}

type Page = { data?: RawRow[]; paging?: { next?: string } };

/** GET one page. Retries 429, 5xx, rate-limit codes, network errors and unreadable answers; other errors fail at once. */
async function getPage(url: string, { fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), maxAttempts = 5 }: Deps): Promise<Page> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let rateLimited = false;
    let retryAfter: number | undefined;
    try {
      const res = await fetchImpl(url, { headers: { accept: "application/json" } });
      retryAfter = Number(res.headers.get("retry-after")) || undefined;
      const body = (await res.json().catch(() => null)) as ({ error?: { code?: number; message?: string; is_transient?: boolean } } & Page) | null;
      if (res.ok && body && !body.error) {
        // a 200 that isn't Meta's list (an HTML page, an empty object) must not pass for "no rows"
        if (!Array.isArray(body.data)) throw new MetaApiError(res.status, null, "Meta API answered 200 without a data list", true);
        return body;
      }
      const code = body?.error?.code ?? null;
      rateLimited = res.status === 429 || (code !== null && RATE_CODES.has(code));
      const unreadable = res.ok && !body?.error; // a 200 that isn't JSON
      const retryable = rateLimited || unreadable || res.status >= 500 || body?.error?.is_transient === true;
      // never put the URL (it carries the token) or the response text in the message
      throw new MetaApiError(res.status, code, `Meta API ${res.status}${code !== null ? ` (code ${code})` : ""}: ${body?.error?.message ?? "no details"}`.slice(0, 300), retryable);
    } catch (err) {
      lastError = err;
      const retryable = err instanceof MetaApiError ? err.retryable : true; // a network error is worth another try
      if (!retryable || attempt === maxAttempts) break;
      await sleep(backoffMs(attempt, rateLimited, retryAfter));
    }
  }
  if (lastError instanceof MetaApiError) throw lastError;
  throw new Error("Meta API not reachable");
}

/** paging.next carries the access token, so it is only followed when it points to Meta over https. */
function trustedNext(next: string | undefined): string | undefined {
  if (!next) return undefined;
  const u = new URL(next);
  if (u.protocol !== "https:" || u.hostname !== "graph.facebook.com") throw new Error("Meta paging link points to another host");
  return next;
}

export type FetchOptions = Deps & { token: string; accountId: string; since: string; until: string; version?: string };

/** All ad-level daily rows from `since` to `until` (inclusive), following paging.next. */
export async function fetchInsights(o: FetchOptions): Promise<InsightRow[]> {
  const account = o.accountId.replace(/^act_/, "");
  if (!/^\d+$/.test(account)) throw new Error("META_AD_ACCOUNT_ID must be the account number");
  const params = new URLSearchParams({
    level: "ad", time_increment: "1", limit: "200", fields: FIELDS,
    time_range: JSON.stringify({ since: o.since, until: o.until }),
    access_token: o.token,
  });
  let url: string | undefined = `https://graph.facebook.com/${o.version ?? DEFAULT_GRAPH_VERSION}/act_${account}/insights?${params}`;
  const rows: InsightRow[] = [];
  for (let page = 0; url && page < 500; page++) {
    const body = await getPage(url, o);
    for (const raw of body.data ?? []) rows.push(parseInsightRow(raw));
    url = trustedNext(body.paging?.next);
  }
  return rows;
}
