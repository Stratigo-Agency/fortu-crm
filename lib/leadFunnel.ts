import { sql } from "@/lib/db";
import type { ReportPeriod } from "@/lib/reportPeriod";

// Lead dan funnel: how many leads came in, from which source group, and where they stop.
// Every number comes from the SQL function lead_funnel() (migration 016, rule 5);
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

export type FunnelStepRow = {
  step: FunnelStep;
  /** leads that reached the step before */
  entered: number;
  /** leads that reached this step */
  passed: number;
  /** did not pass and stopped: Lost, disqualified, or no change for longer than the stage allows */
  stopped: number;
  /** did not pass yet but still moving ('masih berjalan') */
  running: number;
  /** passed / (passed + stopped), whole percent; null when nobody passed or stopped */
  pct: number | null;
  /** median days a deal stayed in the stage of this step (completed stays only); null for handled and done */
  medianDays: number | null;
  /** enough leads stopped here to judge the step (app_settings.funnel_min_entering) */
  enoughData: boolean;
  isBottleneck: boolean;
};

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
  /** disqualified as 'bukan calon pembeli': counted as leads, left out of Ditangani → Jadi deal */
  notBuyer: number;
  /** chats from a contact that already had an open deal: not in the funnel, only counted */
  reentry: number;
  /** conversion into each step (passed / (passed + stopped)), whole percent */
  pct: Record<FunnelStep, number | null>;
  pctLeadToDone: number | null;
  /** the weakest steps (ties name all of them) and their conversion */
  bottleneck: { steps: FunnelStep[]; pct: number } | null;
  /** found = a real bottleneck, insufficient = too few leads stopped per step, none = nobody stopped */
  status: "found" | "insufficient" | "none";
  steps: FunnelStepRow[];
};

export type LeadFunnel = {
  from: string; // Jakarta date, YYYY-MM-DD
  to: string;
  total: FunnelRow;
  groups: FunnelRow[];
  /** the steps of the total row, for the bars and the usual days */
  steps: FunnelStepRow[];
  /** deals created or Done this period without a lead in this funnel (repeat orders, older leads) */
  outside: { deals: number; done: number };
  minStopped: number;
};

type StepJson = {
  step: FunnelStep; entered: number; passed: number; stopped: number; running: number; pct: number | null;
  median_days: number | string | null; enough: boolean; is_bottleneck: boolean;
};

type Wide = {
  group_key: SourceGroup | "total"; is_total: boolean; leads: number; handled: number; deals: number; quotation: number;
  negotiation: number; po: number; done: number; lost: number; unhandled: number; not_buyer: number; reentry: number;
  pct_lead_to_done: number | null; bottleneck_steps: FunnelStep[] | null; bottleneck_pct: number | null;
  bottleneck_status: FunnelRow["status"]; outside_deals: number | null; outside_done: number | null; steps: StepJson[];
};

function toStep(s: StepJson): FunnelStepRow {
  return {
    step: s.step,
    entered: s.entered,
    passed: s.passed,
    stopped: s.stopped,
    running: s.running,
    pct: s.pct,
    medianDays: s.median_days === null ? null : Number(s.median_days),
    enoughData: s.enough,
    isBottleneck: s.is_bottleneck,
  };
}

function toRow(r: Wide): FunnelRow {
  const steps = r.steps.map(toStep);
  const pctOf = (k: FunnelStep) => steps.find((s) => s.step === k)?.pct ?? null;
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
    notBuyer: r.not_buyer,
    reentry: r.reentry,
    pct: Object.fromEntries(FUNNEL_STEPS.map((k) => [k, pctOf(k)])) as Record<FunnelStep, number | null>,
    pctLeadToDone: r.pct_lead_to_done,
    bottleneck: r.bottleneck_steps?.length && r.bottleneck_pct !== null ? { steps: r.bottleneck_steps, pct: r.bottleneck_pct } : null,
    status: r.bottleneck_status,
    steps,
  };
}

/** The funnel of the leads received between two Jakarta dates (inclusive), for one owner or all (null). One query. */
export async function leadFunnelRange(ownerId: string | null, from: string, to: string): Promise<LeadFunnel> {
  const [wide, [setting]] = await Promise.all([
    sql<Wide[]>`
      SELECT group_key, is_total, leads, handled, deals, quotation, negotiation, po, done, lost, unhandled, not_buyer, reentry,
             pct_lead_to_done, bottleneck_steps, bottleneck_pct, bottleneck_status, outside_deals, outside_done, steps
        FROM lead_funnel(${from}::date, ${to}::date, ${ownerId}::uuid)`,
    sql<{ n: number }[]>`SELECT COALESCE(setting_num('funnel_min_entering'), 5)::int AS n`,
  ]);
  const rows = wide.map(toRow);
  const total = rows.find((r) => r.isTotal) as FunnelRow;
  const t = wide.find((r) => r.is_total) as Wide;
  return {
    from,
    to,
    total,
    groups: rows.filter((r) => !r.isTotal),
    steps: total.steps,
    outside: { deals: t.outside_deals ?? 0, done: t.outside_done ?? 0 },
    minStopped: setting.n,
  };
}

/** The funnel for the report period: from the first day of this month / quarter / year to today (Jakarta). */
export async function getLeadFunnel(ownerId: string | null, period: ReportPeriod = "month"): Promise<LeadFunnel> {
  const [range] = await sql<{ from: string; to: string }[]>`
    SELECT date_trunc(${period}, jakarta_today()::timestamp)::date::text AS from, jakarta_today()::text AS to`;
  return leadFunnelRange(ownerId, range.from, range.to);
}
