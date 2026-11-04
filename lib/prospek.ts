import { sql } from "@/lib/db";

// Reads for /prospek. The numbers come from the SQL views v_leads_enriched and v_prospek_stats (rule 5).

export type ProspekTab = "baru" | "dihubungi" | "semua";
export const TABS: readonly ProspekTab[] = ["baru", "dihubungi", "semua"];
export const PAGE_SIZE = 50;
export const MAX_LIMIT = 500;

/** Reads ?tab= safely: anything unknown is the default tab. */
export function parseTab(value: string | string[] | undefined): ProspekTab {
  return TABS.find((t) => t === value) ?? "baru";
}

/** Reads ?limit=: a multiple of the page size, at most MAX_LIMIT. */
export function parseLimit(value: string | string[] | undefined): number {
  const n = Number(Array.isArray(value) ? value[0] : value);
  if (!Number.isInteger(n) || n < PAGE_SIZE) return PAGE_SIZE;
  return Math.min(Math.ceil(n / PAGE_SIZE) * PAGE_SIZE, MAX_LIMIT);
}

export type ProspekRow = {
  id: string;
  status: string;
  contact_name: string | null;
  phone_e164: string;
  first_message: string | null;
  source_channel: string;
  ad_code: string | null;
  click_code: string | null;
  product_interest: string | null;
  received_at: Date;
  is_late: boolean;
  owner_user_id: string | null;
  owner_name: string | null;
  can_edit: boolean;
};

const OPEN_STATUSES = ["new", "contacted", "qualified"];

/** Escapes % _ \ so a search for "50%" matches the text, not everything. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * What to look for in phone_e164 (stored as +62…) for a typed number. A full number written locally
 * ("0812 33…") is also tried as +62812…, and the digits as typed are always tried, so the last
 * digits of a number that happen to start with 0 or 8 are still found.
 */
function phonePatterns(q: string): string[] {
  const raw = q.replace(/\D/g, "");
  if (raw.length < 3) return [];
  const patterns = new Set([raw]);
  if (raw.startsWith("0")) patterns.add(`62${raw.slice(1)}`);
  else if (raw.startsWith("8")) patterns.add(`62${raw}`);
  return [...patterns].map((d) => `%${d}%`);
}

type ListOptions = {
  /** Who is looking, to say which rows they may act on. */
  viewerId: string;
  /** The sales filter: one owner, or null for all sales. */
  ownerId: string | null;
  tab: ProspekTab;
  q: string;
  limit: number;
};

/** Leads for one tab, newest first. hasMore tells whether "Muat lebih banyak" applies. */
export async function listProspects(o: ListOptions): Promise<{ rows: ProspekRow[]; hasMore: boolean }> {
  const q = o.q.trim().slice(0, 100);
  const statuses = o.tab === "baru" ? ["new"] : o.tab === "dihubungi" ? ["contacted"] : OPEN_STATUSES;
  const phones = phonePatterns(q);
  const search = q
    ? sql`AND (contact_name ILIKE ${likePattern(q)} OR first_message ILIKE ${likePattern(q)}
               ${phones.length ? sql`OR phone_e164 LIKE ANY(${phones})` : sql``})`
    : sql``;
  const owner = o.ownerId ? sql`AND owner_user_id = ${o.ownerId}` : sql``;

  const rows = await sql<ProspekRow[]>`
    SELECT id, status, contact_name, phone_e164, first_message, source_channel, ad_code, click_code,
           product_interest, received_at, is_late, owner_user_id, owner_name,
           can_edit_lead(${o.viewerId}, id) AS can_edit
      FROM v_leads_enriched
     WHERE status = ANY(${statuses}) ${owner} ${search}
     ORDER BY received_at DESC, id
     LIMIT ${o.limit + 1}`;
  return { rows: rows.slice(0, o.limit), hasMore: rows.length > o.limit };
}

export type ProspekStats = {
  new_count: number;
  contacted_count: number;
  open_count: number;
  received_today: number;
  /** null when no chat came in during the last 7 days */
  median_log_delay_min: number | null;
  meta_without_code: number;
};

const NO_STATS: ProspekStats = {
  new_count: 0,
  contacted_count: 0,
  open_count: 0,
  received_today: 0,
  median_log_delay_min: null,
  meta_without_code: 0,
};

/** The numbers on top of /prospek, for one owner or for all sales (ownerId null). */
export async function prospekStats(ownerId: string | null): Promise<ProspekStats> {
  const [row] = await sql<ProspekStats[]>`
    SELECT new_count, contacted_count, open_count, received_today, median_log_delay_min, meta_without_code
      FROM v_prospek_stats
     WHERE ${ownerId ? sql`NOT is_total AND owner_user_id = ${ownerId}` : sql`is_total`}`;
  return row ?? NO_STATS;
}
