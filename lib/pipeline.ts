import { sql } from "@/lib/db";
import type { Column, DealCard } from "@/lib/pipelineTypes";

// Reads for /pipeline. Numbers come from SQL (v_pipeline_summary_by_owner and
// aggregates over v_pipeline_board), never from sums in components (CLAUDE.md rule 5).

export type PipelineStats = {
  open_deals: number;
  open_amount: string;
  weighted_open_amount: string;
  won_this_month: string;
  units_won_this_month: number;
  next_step_overdue: number;
};

const NO_STATS: PipelineStats = {
  open_deals: 0,
  open_amount: "0",
  weighted_open_amount: "0",
  won_this_month: "0",
  units_won_this_month: 0,
  next_step_overdue: 0,
};

/** The stat strip, for one owner or everyone (ownerId null). */
export async function pipelineStats(ownerId: string | null): Promise<PipelineStats> {
  const [row] = await sql<PipelineStats[]>`
    SELECT open_deals, open_amount, weighted_open_amount, won_this_month, units_won_this_month, next_step_overdue
      FROM v_pipeline_summary_by_owner
     WHERE ${ownerId ? sql`NOT is_total AND owner_user_id = ${ownerId}` : sql`is_total`}`;
  return row ?? NO_STATS;
}

export type BoardFilter = {
  viewerId: string;
  ownerId: string | null;
  q: string;
  showLost: boolean;
};

function likePattern(q: string) {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function phonePatterns(q: string): string[] {
  const raw = q.replace(/\D/g, "");
  if (raw.length < 3) return [];
  const set = new Set([raw]);
  if (raw.startsWith("0")) set.add(`62${raw.slice(1)}`);
  else if (raw.startsWith("8")) set.add(`62${raw}`);
  return [...set].map((d) => `%${d}%`);
}

/** WHERE for the board: on board, sales filter, Lost toggle, search (deal, company, contact, phone, SKU). */
function boardWhere(f: BoardFilter) {
  const q = f.q.trim().slice(0, 100);
  const phones = phonePatterns(q);
  return sql`
    on_board
    ${f.ownerId ? sql`AND owner_user_id = ${f.ownerId}` : sql``}
    ${f.showLost ? sql`` : sql`AND NOT is_lost`}
    ${
      q
        ? sql`AND (name ILIKE ${likePattern(q)} OR company_name ILIKE ${likePattern(q)}
                   OR contact_name ILIKE ${likePattern(q)}
                   ${phones.length ? sql`OR phone_e164 LIKE ANY(${phones})` : sql``}
                   OR EXISTS (SELECT 1 FROM deal_line_items li JOIN products p ON p.id = li.product_id
                               WHERE li.deal_id = b.id AND p.sku ILIKE ${likePattern(q)}))`
        : sql``
    }`;
}

/** The columns in pipeline_stages order (Lost only when shown), with count and amount from SQL. */
export async function boardColumns(f: BoardFilter): Promise<Column[]> {
  return sql<Column[]>`
    SELECT s.key, s.name, s.probability::text AS probability, s.is_won, s.is_lost,
           COALESCE(t.deal_count, 0)::int AS deal_count,
           COALESCE(t.amount, 0)::text AS amount,
           COALESCE(o.older_count, 0)::int AS older_count
      FROM pipeline_stages s
      LEFT JOIN (SELECT stage_id, count(*) AS deal_count, sum(amount) AS amount
                   FROM v_pipeline_board b WHERE ${boardWhere(f)} GROUP BY stage_id) t ON t.stage_id = s.id
      LEFT JOIN (SELECT stage_id, count(*) AS older_count FROM v_pipeline_board
                  WHERE NOT on_board ${f.ownerId ? sql`AND owner_user_id = ${f.ownerId}` : sql``}
                  GROUP BY stage_id) o ON o.stage_id = s.id
     WHERE ${f.showLost ? sql`true` : sql`NOT s.is_lost`}
     ORDER BY s.position`;
}

/** Cards: open stages by next step date (soonest first), Done deal / Lost by close date (newest first). */
export async function boardCards(f: BoardFilter, limit = 500): Promise<DealCard[]> {
  return sql<DealCard[]>`
    SELECT b.id, b.name, b.stage_key, b.owner_user_id, b.owner_name, b.company_name, b.contact_name,
           b.amount::text AS amount, b.has_products, b.screen_units::int AS screen_units,
           to_char(b.expected_close_date, 'YYYY-MM-DD') AS expected_close_date,
           b.next_step, to_char(b.next_step_date, 'YYYY-MM-DD') AS next_step_date,
           b.next_step_overdue, b.days_overdue, b.days_in_stage, b.is_stale, b.days_since_update,
           b.is_project, b.needs_discount_approval, b.has_demo,
           to_char(b.closed_on, 'YYYY-MM-DD') AS closed_on,
           can_edit_deal(${f.viewerId}, b.id) AS can_edit
      FROM v_pipeline_board b
     WHERE ${boardWhere(f)}
     ORDER BY b.stage_position,
              CASE WHEN b.is_won OR b.is_lost THEN NULL ELSE b.next_step_date END ASC NULLS LAST,
              b.closed_on DESC NULLS LAST, b.updated_at DESC, b.id
     LIMIT ${limit}`;
}
