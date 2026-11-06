import { ForbiddenError } from "@/lib/authz";
import type { Role } from "@/lib/auth";
import { pgError, sql } from "@/lib/db";

// Pengaturan › Iklan: who owns a campaign, which product line an ad set sells, and the code of each ad.
// Meta's numbers arrive by the nightly sync (lib/meta); people only set these three things.

const ALLOWED: Role[] = ["admin", "ceo", "marketing"];
export function canManageAds(user: { role: Role }): boolean {
  return ALLOWED.includes(user.role);
}

export class AdsError extends Error {
  constructor(readonly key: "code" | "codeTaken" | "form" | "stale", readonly code?: string) {
    super(`Invalid ads input: ${key}`);
    this.name = "AdsError";
  }
}

const AD_CODE = /^[A-Z]-(IFP|DSS|LED)-\d{2}$/;
const LINES = ["IFP", "DSS", "LED"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CampaignRow = { id: string; metaId: string; name: string; ownerId: string | null; spend30: string };
export type AdSetRow = { id: string; name: string; campaignName: string; productLine: string | null; spend30: string };
export type AdRow = { id: string; name: string; adSetName: string; code: string; spend30: string; leads7: number };
export type AdsConfig = {
  campaigns: CampaignRow[]; adSets: AdSetRow[]; ads: AdRow[];
  lastSync: { at: string; from: string; to: string; rows: number } | null;
  lastFailure: { at: string; message: string } | null;
};

export async function getAdsConfig(): Promise<AdsConfig> {
  const spend = (col: string) => sql`COALESCE((SELECT sum(i.spend) FROM ad_insights_daily i JOIN ads a ON a.id = i.ad_id JOIN ad_sets s ON s.id = a.ad_set_id
                                              WHERE ${sql.unsafe(col)} AND i.date >= jakarta_today() - 30), 0)`;
  const [campaigns, adSets, ads, sync] = await Promise.all([
    sql<CampaignRow[]>`
      SELECT c.id, c.meta_campaign_id AS "metaId", c.name, c.owner_user_id AS "ownerId", ${spend("s.campaign_id = c.id")} AS spend30
        FROM ad_campaigns c ORDER BY 5 DESC, c.name`,
    sql<AdSetRow[]>`
      SELECT s.id, s.name, c.name AS "campaignName", s.product_line::text AS "productLine",
             COALESCE((SELECT sum(i.spend) FROM ad_insights_daily i JOIN ads a ON a.id = i.ad_id WHERE a.ad_set_id = s.id AND i.date >= jakarta_today() - 30), 0) AS spend30
        FROM ad_sets s JOIN ad_campaigns c ON c.id = s.campaign_id ORDER BY 5 DESC, s.name`,
    sql<AdRow[]>`
      SELECT a.id, a.name, s.name AS "adSetName", COALESCE(a.prefill_code, '') AS code,
             COALESCE((SELECT sum(i.spend) FROM ad_insights_daily i WHERE i.ad_id = a.id AND i.date >= jakarta_today() - 30), 0) AS spend30,
             (SELECT count(*) FROM leads l WHERE l.ad_id = a.id AND l.received_at >= now() - interval '7 days' AND (NOT l.is_sample OR show_sample_data()))::int AS leads7
        FROM ads a JOIN ad_sets s ON s.id = a.ad_set_id ORDER BY 5 DESC, a.name LIMIT 300`,
    sql<{ key: string; value: Record<string, unknown> }[]>`SELECT key, value FROM app_settings WHERE key IN ('insights_last_sync', 'insights_last_failure')`,
  ]);
  const get = (k: string) => sync.find((r) => r.key === k)?.value;
  const ok = get("insights_last_sync") as AdsConfig["lastSync"] | undefined;
  const bad = get("insights_last_failure") as AdsConfig["lastFailure"] | undefined;
  // a failure older than the last good sync is history, not news
  const failure = bad && (!ok || bad.at > ok.at) ? bad : null;
  return { campaigns, adSets, ads, lastSync: ok ?? null, lastFailure: failure };
}

function assertAdsRole(user: { role: Role }) {
  if (!canManageAds(user)) throw new ForbiddenError();
}

/** Rows of a form: every `<prefix><id>` field with the value it showed when the page opened (`orig:<prefix><id>`). */
function rows(form: FormData, prefix: string): { id: string; value: string; orig: string }[] {
  const out: { id: string; value: string; orig: string }[] = [];
  for (const [k, v] of form.entries()) {
    if (!k.startsWith(prefix)) continue;
    const id = k.slice(prefix.length);
    const orig = form.get(`orig:${k}`);
    if (!UUID.test(id) || orig === null) throw new AdsError("form");
    out.push({ id, value: String(v).trim(), orig: String(orig).trim() });
  }
  return out;
}

/**
 * Campaign → owner. Fields owner:<campaignId> (a sales user id, or empty) and orig:owner:<campaignId>.
 * Only rows that were changed on the page are written, and only if nobody else changed them meanwhile.
 */
export async function saveCampaignOwners(actor: { role: Role }, form: FormData): Promise<void> {
  assertAdsRole(actor);
  const changed = rows(form, "owner:").filter((r) => r.value !== r.orig);
  for (const r of changed) if ((r.value !== "" && !UUID.test(r.value)) || (r.orig !== "" && !UUID.test(r.orig))) throw new AdsError("form");
  await sql.begin(async (tx) => {
    for (const r of changed) {
      if (r.value) {
        // only an active sales person can own a campaign
        const [ok] = await tx`SELECT 1 FROM users WHERE id = ${r.value} AND is_active AND role IN ('sales_rep', 'sales_lead')`;
        if (!ok) throw new AdsError("form");
      }
      const done = await tx`UPDATE ad_campaigns SET owner_user_id = ${r.value || null}::uuid
                             WHERE id = ${r.id} AND owner_user_id IS NOT DISTINCT FROM ${r.orig || null}::uuid RETURNING id`;
      if (done.length === 0) throw new AdsError("stale");
    }
  });
}

/** Ad set → product line. Fields line:<adSetId> (IFP, DSS, LED or empty) and orig:line:<adSetId>. */
export async function saveAdSetLines(actor: { role: Role }, form: FormData): Promise<void> {
  assertAdsRole(actor);
  const changed = rows(form, "line:").filter((r) => r.value !== r.orig);
  for (const r of changed) if ((r.value !== "" && !LINES.includes(r.value)) || (r.orig !== "" && !LINES.includes(r.orig))) throw new AdsError("form");
  await sql.begin(async (tx) => {
    for (const r of changed) {
      const done = await tx`UPDATE ad_sets SET product_line = ${r.value || null}::product_line
                             WHERE id = ${r.id} AND product_line::text IS NOT DISTINCT FROM ${r.orig || null} RETURNING id`;
      if (done.length === 0) throw new AdsError("stale");
    }
  });
}

/** Ad → code (X-PPP-NN, unique). Fields code:<adId> and orig:code:<adId>. A blank clears the code. */
export async function saveAdCodes(actor: { role: Role }, form: FormData): Promise<void> {
  assertAdsRole(actor);
  const changed = rows(form, "code:")
    .map((r) => ({ ...r, value: r.value.toUpperCase(), orig: r.orig.toUpperCase() }))
    .filter((r) => r.value !== r.orig);
  const seen = new Set<string>();
  for (const r of changed) {
    if (r.value !== "" && !AD_CODE.test(r.value)) throw new AdsError("code", r.value);
    if (r.value !== "") {
      if (seen.has(r.value)) throw new AdsError("codeTaken", r.value);
      seen.add(r.value);
    }
  }
  const ids = changed.map((r) => r.id);
  try {
    await sql.begin(async (tx) => {
      // check nobody changed these ads meanwhile, then clear first so two ads can swap codes in one save
      for (const r of changed) {
        const [now] = await tx<{ code: string | null }[]>`SELECT prefill_code AS code FROM ads WHERE id = ${r.id} FOR UPDATE`;
        if (!now || (now.code ?? "") !== r.orig) throw new AdsError("stale");
      }
      for (const r of changed) await tx`UPDATE ads SET prefill_code = NULL WHERE id = ${r.id}`;
      for (const r of changed) if (r.value) await tx`UPDATE ads SET prefill_code = ${r.value} WHERE id = ${r.id}`;
    });
  } catch (err) {
    if (pgError(err)?.code === "23505") {
      // the code that is held by an ad outside this save
      const [taken] = await sql<{ code: string }[]>`
        SELECT prefill_code AS code FROM ads WHERE prefill_code = ANY(${changed.flatMap((r) => (r.value ? [r.value] : []))}) AND id <> ALL(${ids}) LIMIT 1`;
      throw new AdsError("codeTaken", taken?.code ?? "");
    }
    throw err;
  }
}
