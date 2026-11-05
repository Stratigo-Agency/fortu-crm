import { sql } from "@/lib/db";
import { likePattern, phonePatterns } from "@/lib/search";

// One search box for deals, contacts and companies (Beranda and /cari). View all: everyone may find everything.

export type SearchHit = { id: string; title: string; detail: string | null };
export type SearchResults = { deals: SearchHit[]; contacts: SearchHit[]; companies: SearchHit[] };

const LIMIT = 8;

export async function searchAll(q: string): Promise<SearchResults> {
  const text = q.trim();
  if (text.length < 2) return { deals: [], contacts: [], companies: [] };
  const like = likePattern(text);
  const phones = phonePatterns(text);
  const [deals, contacts, companies] = await Promise.all([
    sql<SearchHit[]>`
      SELECT d.id, d.name AS title, concat_ws(' · ', d.stage_name, c.name) AS detail
        FROM v_deals_enriched d LEFT JOIN companies c ON c.id = d.company_id
       WHERE d.name ILIKE ${like} OR c.name ILIKE ${like}
       ORDER BY d.is_won OR d.is_lost, d.updated_at DESC
       LIMIT ${LIMIT}`,
    sql<SearchHit[]>`
      SELECT ct.id, COALESCE(ct.full_name, ct.phone_e164) AS title, concat_ws(' · ', ct.phone_e164, co.name) AS detail
        FROM contacts ct LEFT JOIN companies co ON co.id = ct.company_id
       WHERE ct.full_name ILIKE ${like} OR co.name ILIKE ${like}
          OR (${phones.length > 0} AND ct.phone_e164 LIKE ANY(${phones}::text[]))
       ORDER BY ct.created_at DESC
       LIMIT ${LIMIT}`,
    sql<SearchHit[]>`
      SELECT id, name AS title, city AS detail FROM companies
       WHERE name ILIKE ${like}
       ORDER BY name
       LIMIT ${LIMIT}`,
  ]);
  return { deals, contacts, companies };
}
