import { sql } from "@/lib/db";
import type { ReportPeriod } from "@/lib/reportPeriod";

// Lead dan funnel: how many leads came in, from which source group, and where they stop.
// Every number comes from the SQL functions lead_funnel() and lead_funnel_steps() (migration 016, rule 5);
// this file only picks rows and renames columns.

export const SOURCE_GROUPS = ["meta", "website", "offline", "wa_direct", "other"] as const;
export type SourceGroup = (typeof SOURCE_GROUPS)[number];

export const FUNNEL_STEPS = ["handled", "deal", "quotation", "negotiation", "po", "done"] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];

/** Reads ?sumber= safely: a known source group, or null for all sources. */
export function parseSourceGroup(value: string | string[] | undefined): SourceGroup | null {
  const v = Array.isArray(value) ? value[0] : value;
  return SOURCE_GROUPS.find((g) => g === v) ?? null;
}

export type FunnelRow = {
  group: SourceGroup | "total";
  isTotal: boolean;
  leads: number;
  handled: number;
  deals: number;
  quotation: number;
  negotiation: number;
  po: number;
  done: number;
  lost: number;
  unhandled: number;
  /** conversion into each step from the step before, whole percent; null when nobody entered */
  pct: Record<FunnelStep, number | null>;
  pctLeadToDone: number | null;
  bottleneck: { step: FunnelStep; pct: number } | null;
  /** found = a real bottleneck, insufficient = too few leads per step, none = nobody stopped */
  status: "found" | "insufficient" | "none";
};

export type FunnelStepRow = {
  step: FunnelStep;
  entered: number;
  passed: number;
  pct: number | null;
  /** median days spent before this step (lead → first deal, or days in the stage before) */
  medianDays: number | null;
  enoughData: boolean;
  isBottleneck: boolean;
};

export type LeadFunnel = {
  from: string; // Jakarta date, YYYY-MM-DD
  to: string;
  total: FunnelRow;
  groups: FunnelRow[];
  /** the steps of the total row, for the bars and the median days */
  steps: FunnelStepRow[];
  minEntering: number;
};

type Wide = {
  group_key: SourceGroup | "total"; is_total: boolean; leads: number; handled: number; deals: number; quotation: number;
  negotiation: number; po: number; done: number; lost: number; unhandled: number; pct_handled: number | null;
  pct_deal: number | null; pct_quotation: number | null; pct_negotiation: number | null; pct_po: number | null;
  pct_done: number | null; pct_lead_to_done: number | null; bottleneck_step: FunnelStep | null; bottleneck_pct: number | null;
  bottleneck_status: FunnelRow["status"];
};

function toRow(r: Wide): FunnelRow {
  return {
    group: r.group_key,
    isTotal: r.is_total,
    leads: r.leads,
    handled: r.handled,
    deals: r.deals,
    quotation: r.quotation,
    negotiation: r.negotiation,
    po: r.po,
    done: r.done,
    lost: r.lost,
    unhandled: r.unhandled,
    pct: {
      handled: r.pct_handled,
      deal: r.pct_deal,
      quotation: r.pct_quotation,
      negotiation: r.pct_negotiation,
      po: r.pct_po,
      done: r.pct_done,
    },
    pctLeadToDone: r.pct_lead_to_done,
    bottleneck: r.bottleneck_step && r.bottleneck_pct !== null ? { step: r.bottleneck_step, pct: r.bottleneck_pct } : null,
    status: r.bottleneck_status,
  };
}

/** The funnel of the leads received between two Jakarta dates (inclusive), for one owner or all (null). */
export async function leadFunnelRange(ownerId: string | null, from: string, to: string): Promise<LeadFunnel> {
  const [wide, steps, [setting]] = await Promise.all([
    sql<Wide[]>`
      SELECT group_key, is_total, leads, handled, deals, quotation, negotiation, po, done, lost, unhandled,
             pct_handled, pct_deal, pct_quotation, pct_negotiation, pct_po, pct_done, pct_lead_to_done,
             bottleneck_step, bottleneck_pct, bottleneck_status
        FROM lead_funnel(${from}::date, ${to}::date, ${ownerId}::uuid)`,
    sql<{ step_key: FunnelStep; entered: number; passed: number; conversion_pct: number | null; median_days: string | null; enough_data: boolean; is_bottleneck: boolean }[]>`
      SELECT step_key, entered, passed, conversion_pct, median_days::text AS median_days, enough_data, is_bottleneck
        FROM lead_funnel_steps(${from}::date, ${to}::date, ${ownerId}::uuid)
       WHERE is_total ORDER BY step_position`,
    sql<{ n: number }[]>`SELECT COALESCE(setting_num('funnel_min_entering'), 5)::int AS n`,
  ]);
  const rows = wide.map(toRow);
  return {
    from,
    to,
    total: rows.find((r) => r.isTotal) as FunnelRow,
    groups: rows.filter((r) => !r.isTotal),
    steps: steps.map((s) => ({
      step: s.step_key,
      entered: s.entered,
      passed: s.passed,
      pct: s.conversion_pct,
      medianDays: s.median_days === null ? null : Number(s.median_days),
      enoughData: s.enough_data,
      isBottleneck: s.is_bottleneck,
    })),
    minEntering: setting.n,
  };
}

/** The funnel for the report period: from the first day of this month / quarter / year to today (Jakarta). */
export async function getLeadFunnel(ownerId: string | null, period: ReportPeriod = "month"): Promise<LeadFunnel> {
  const [range] = await sql<{ from: string; to: string }[]>`
    SELECT date_trunc(${period}, jakarta_today()::timestamp)::date::text AS from, jakarta_today()::text AS to`;
  return leadFunnelRange(ownerId, range.from, range.to);
}
