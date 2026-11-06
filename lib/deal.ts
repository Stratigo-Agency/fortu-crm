import { sql } from "@/lib/db";
import type { DealDetail, DealKind, LeadTrace, DealLine, DealSettings, HistoryItem, ProductOption } from "@/lib/dealTypes";
import { normalizePhone } from "@/lib/ingest/phone";
import type { StageKey } from "@/lib/pipelineTypes";

// Reads for the deal panel and page. Money comes out of the database views (rule 5):
// amount, estimate and units are v_deals_enriched values, never recomputed here.

export const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** One deal with everything the form shows, or null when it doesn't exist. */
export async function getDeal(id: string, viewerId: string): Promise<DealDetail | null> {
  if (!isUuid(id)) return null;
  const [d] = await sql<
    {
      id: string; name: string; deal_type: DealKind; parent_deal_id: string | null; stage_key: StageKey;
      owner_user_id: string; owner_name: string | null; company_name: string | null; contact_name: string | null;
      phone_e164: string; lead_id: string | null; source_channel: string | null;
      expected_close_date: string | null; next_step: string | null; next_step_date: string | null;
      demo_date: string | null; closed_on: string | null; lost_reason: string | null; competitor: string | null;
      lost_note: string | null; est_amount: string; amount: string; weighted_amount: string; screen_units: string;
      days_in_stage: number; is_project: boolean; needs_discount_approval: boolean;
      discount_approved_by: string | null; can_edit: boolean;
    }[]
  >`
    SELECT e.id, e.name, e.deal_type, e.parent_deal_id, e.stage_key, e.owner_user_id,
           u.full_name AS owner_name, co.name AS company_name, c.full_name AS contact_name, c.phone_e164,
           e.lead_id, l.source_channel,
           to_char(e.expected_close_date, 'YYYY-MM-DD') AS expected_close_date,
           e.next_step, to_char(e.next_step_date, 'YYYY-MM-DD') AS next_step_date,
           to_char(e.demo_date, 'YYYY-MM-DD') AS demo_date, to_char(e.closed_on, 'YYYY-MM-DD') AS closed_on,
           e.lost_reason::text AS lost_reason, e.competitor, e.lost_note, e.est_amount::text AS est_amount,
           e.amount::text AS amount, e.weighted_amount::text AS weighted_amount, e.screen_units::text AS screen_units,
           e.days_in_stage, e.is_project, e.needs_discount_approval, e.discount_approved_by,
           can_edit_deal(${viewerId}, e.id) AS can_edit
      FROM v_deals_enriched e
      JOIN contacts c ON c.id = e.contact_id
      LEFT JOIN companies co ON co.id = e.company_id
      LEFT JOIN users u ON u.id = e.owner_user_id
      LEFT JOIN leads l ON l.id = e.lead_id
     WHERE e.id = ${id}`;
  if (!d) return null;

  const lines = await sql<
    { product_id: string; sku: string; name: string; qty: number; unit_price: string; list_price: string | null; counts_as_screen: boolean }[]
  >`
    SELECT li.product_id, p.sku, p.name, li.qty, li.unit_price::text AS unit_price,
           p.list_price::text AS list_price, p.counts_as_screen
      FROM deal_line_items li JOIN products p ON p.id = li.product_id
     WHERE li.deal_id = ${id} ORDER BY li.id`;

  const history = await dealHistory(id);

  return {
    id: d.id,
    name: d.name,
    kind: d.deal_type,
    parentDealId: d.parent_deal_id,
    stageKey: d.stage_key,
    ownerId: d.owner_user_id,
    ownerName: d.owner_name,
    companyName: d.company_name ?? "",
    contactName: d.contact_name ?? "",
    phone: d.phone_e164,
    leadId: d.lead_id,
    sourceChannel: d.source_channel,
    leadTrace: d.lead_id ? await leadTrace(d.lead_id) : null,
    expectedCloseDate: d.expected_close_date ?? "",
    nextStep: d.next_step ?? "",
    nextStepDate: d.next_step_date ?? "",
    demoDate: d.demo_date ?? "",
    paidDate: d.closed_on ?? "",
    lostReason: d.lost_reason ?? "",
    competitor: d.competitor ?? "",
    lostNote: d.lost_note ?? "",
    estAmount: Number(d.est_amount),
    lines: lines.map<DealLine>((l) => ({
      productId: l.product_id,
      sku: l.sku,
      name: l.name,
      qty: l.qty,
      unitPrice: Number(l.unit_price),
      msrp: l.list_price === null ? null : Number(l.list_price),
      countsAsScreen: l.counts_as_screen,
    })),
    amount: Number(d.amount),
    weightedAmount: Number(d.weighted_amount),
    screenUnits: Number(d.screen_units),
    daysInStage: d.days_in_stage,
    isProject: d.is_project,
    needsDiscountApproval: d.needs_discount_approval,
    discountApprovedBy: d.discount_approved_by,
    canEdit: d.can_edit,
    history,
  };
}

/** Where a lead came from: source group, channel, ad or campaign, and when it came in (v_leads_enriched). */
export async function leadTrace(leadId: string): Promise<LeadTrace | null> {
  const [l] = await sql<
    { source_group: string; source_channel: string; ad_name: string | null; ad_code: string | null; click_code: string | null;
      utm_campaign: string | null; landing_url: string | null; received_at: Date }[]
  >`
    SELECT source_group, source_channel::text AS source_channel, ad_name, ad_code, click_code, utm_campaign, landing_url, received_at
      FROM v_leads_enriched WHERE id = ${leadId}`;
  if (!l) return null;
  return {
    group: l.source_group,
    channel: l.source_channel,
    adName: l.ad_name,
    adCode: l.ad_code,
    clickCode: l.click_code,
    utmCampaign: l.utm_campaign,
    landingUrl: l.landing_url,
    receivedAt: l.received_at.toISOString(),
  };
}

/** Stage moves and notes of a deal, newest first. */
export async function dealHistory(dealId: string): Promise<HistoryItem[]> {
  const stages = await sql<{ id: string; at: Date; by: string | null; key: StageKey }[]>`
    SELECT h.id::text AS id, h.changed_at AS at, u.full_name AS by, t.key
      FROM deal_stage_history h
      JOIN pipeline_stages t ON t.id = h.to_stage_id
      LEFT JOIN users u ON u.id = h.changed_by
     WHERE h.deal_id = ${dealId} AND h.from_stage_id IS NOT NULL -- the first row is the deal's creation, shown as "Deal dibuat"`;
  const acts = await sql<{ id: string; at: Date; by: string | null; type: string; body: string | null; metadata: { action?: string } }[]>`
    SELECT a.id::text AS id, a.created_at AS at, u.full_name AS by, a.type::text AS type, a.body, a.metadata
      FROM activities a LEFT JOIN users u ON u.id = a.user_id
     WHERE a.deal_id = ${dealId} AND a.type IN ('note', 'system')`;
  const items: HistoryItem[] = [
    ...stages.map((s) => ({ id: `s${s.id}`, kind: "stage" as const, at: s.at.toISOString(), by: s.by, text: null, stageKey: s.key })),
    ...acts.map((a) => ({
      id: `a${a.id}`,
      kind: (a.type === "note" ? "note" : "system") as "note" | "system",
      at: a.at.toISOString(),
      by: a.by,
      text: a.type === "note" ? a.body : (a.metadata?.action ?? null),
      stageKey: null,
    })),
  ];
  return items.sort((x, y) => y.at.localeCompare(x.at));
}

/** The product list for the line selects. */
export async function productOptions(): Promise<ProductOption[]> {
  const rows = await sql<
    { id: string; sku: string; name: string; list_price: string | null; counts_as_screen: boolean; max_discount_pct: string }[]
  >`
    SELECT id, sku, name, list_price::text AS list_price, counts_as_screen,
           COALESCE(max_discount_pct, setting_num('max_discount_pct'))::text AS max_discount_pct
      FROM products WHERE is_active ORDER BY sku`;
  return rows.map((r) => ({
    id: r.id,
    sku: r.sku,
    name: r.name,
    msrp: r.list_price === null ? null : Number(r.list_price),
    countsAsScreen: r.counts_as_screen,
    maxDiscountPct: Number(r.max_discount_pct),
  }));
}

/** Thresholds of the "Deal proyek" note, from app_settings. */
export async function dealSettings(): Promise<DealSettings> {
  const [r] = await sql<{ units: string; amount: string }[]>`
    SELECT setting_num('project_min_units')::text AS units, setting_num('project_min_amount')::text AS amount`;
  return { projectMinUnits: Number(r.units), projectMinAmount: Number(r.amount) };
}

/** Company names for the combobox. */
export async function searchCompanies(q: string): Promise<string[]> {
  const term = q.trim().slice(0, 100);
  if (!term) return [];
  const rows = await sql<{ name: string }[]>`
    SELECT name FROM companies WHERE name ILIKE ${`%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}
     ORDER BY name LIMIT 8`;
  return rows.map((r) => r.name);
}

export type ContactMatch = { name: string | null; phone: string; rep: string | null };

/** A contact that already has this number, and the rep who has an open deal or lead with them. */
export async function contactByPhone(raw: string): Promise<ContactMatch | null> {
  let phone: string;
  try {
    phone = normalizePhone(raw);
  } catch {
    return null;
  }
  const [c] = await sql<{ id: string; full_name: string | null }[]>`
    SELECT id, full_name FROM contacts WHERE phone_e164 = ${phone}`;
  if (!c) return null;
  const [rep] = await sql<{ full_name: string }[]>`
    SELECT u.full_name FROM (
      SELECT d.owner_user_id, d.updated_at FROM deals d JOIN pipeline_stages s ON s.id = d.stage_id
       WHERE d.contact_id = ${c.id} AND NOT s.is_won AND NOT s.is_lost
      UNION ALL
      SELECT l.owner_user_id, l.received_at FROM leads l
       WHERE l.contact_id = ${c.id} AND l.status IN ('new', 'contacted', 'qualified')
    ) x JOIN users u ON u.id = x.owner_user_id ORDER BY x.updated_at DESC LIMIT 1`;
  return { name: c.full_name, phone, rep: rep?.full_name ?? null };
}

/** The company's deals, for the parent of a repeat, upsell or rental deal. */
export async function parentDeals(companyName: string): Promise<{ id: string; name: string }[]> {
  const name = companyName.trim();
  if (!name) return [];
  return sql<{ id: string; name: string }[]>`
    SELECT d.id, d.name FROM deals d JOIN companies co ON co.id = d.company_id
     WHERE lower(co.name) = lower(${name}) ORDER BY d.created_at DESC LIMIT 20`;
}

/** A blank deal for "+ Deal": the signed-in rep owns it, stage Chat masuk, next step in 2 days. */
export function emptyDeal(ownerId: string, ownerName: string | null, nextStepText: string): DealDetail {
  const inTwoDays = new Date(Date.now() + 2 * 86_400_000);
  return {
    id: null,
    name: "",
    kind: "new",
    parentDealId: null,
    stageKey: "chat",
    ownerId,
    ownerName,
    companyName: "",
    contactName: "",
    phone: "",
    leadId: null,
    sourceChannel: null,
    leadTrace: null,
    expectedCloseDate: "",
    nextStep: nextStepText,
    nextStepDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(inTwoDays),
    demoDate: "",
    paidDate: "",
    lostReason: "",
    competitor: "",
    lostNote: "",
    estAmount: 0,
    lines: [],
    amount: 0,
    weightedAmount: 0,
    screenUnits: 0,
    daysInStage: 0,
    isProject: false,
    needsDiscountApproval: false,
    discountApprovedBy: null,
    canEdit: true,
    history: [],
  };
}
