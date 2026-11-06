import type { StageKey } from "@/lib/pipelineTypes";

// Deal types shared by the server and the deal form (no database code here).

export type DealKind = "new" | "repeat" | "upsell" | "rental";
export const DEAL_KINDS: readonly DealKind[] = ["new", "repeat", "upsell", "rental"];

export type DealLine = {
  productId: string;
  sku: string;
  name: string;
  qty: number;
  unitPrice: number;
  /** MSRP (products.list_price), null when not set */
  msrp: number | null;
  countsAsScreen: boolean;
};

export type HistoryItem = {
  id: string;
  kind: "stage" | "note" | "system";
  at: string;
  by: string | null;
  text: string | null;
  stageKey: StageKey | null;
};

/** Where the deal's lead came from (v_leads_enriched), shown read-only on the deal. */
export type LeadTrace = {
  group: string; // source group key: meta, website, offline, wa_direct, other
  channel: string; // source_channel
  adName: string | null;
  adCode: string | null;
  clickCode: string | null;
  utmCampaign: string | null;
  landingUrl: string | null;
  receivedAt: string; // ISO timestamp
};

/** A deal as the form needs it; money as whole-Rupiah numbers, dates as YYYY-MM-DD. */
export type DealDetail = {
  id: string | null; // null = a new deal
  name: string;
  kind: DealKind;
  parentDealId: string | null;
  stageKey: StageKey;
  ownerId: string;
  ownerName: string | null;
  companyName: string;
  contactName: string;
  phone: string; // +62…, or "" for a new deal
  leadId: string | null;
  sourceChannel: string | null;
  leadTrace: LeadTrace | null;
  expectedCloseDate: string;
  nextStep: string;
  nextStepDate: string;
  demoDate: string;
  paidDate: string; // closed_on of a Done deal
  lostReason: string;
  competitor: string;
  lostNote: string;
  estAmount: number;
  lines: DealLine[];
  // from the database (v_deals_enriched); never typed by the user
  amount: number;
  weightedAmount: number;
  screenUnits: number;
  daysInStage: number;
  isProject: boolean;
  needsDiscountApproval: boolean;
  discountApprovedBy: string | null;
  /** the name shown in "Diskon disetujui …" */
  discountApprovedByName: string | null;
  canEdit: boolean;
  /** names the saved product lines; the CEO's approval is only valid for the lines it was given for */
  linesFingerprint: string;
  history: HistoryItem[];
};

export type ProductOption = {
  id: string;
  sku: string;
  name: string;
  msrp: number | null;
  countsAsScreen: boolean;
  /** the most discount from MSRP allowed without approval: the product's own limit or the app setting */
  maxDiscountPct: number;
};

/** Values from app_settings that the form needs for its live preview. */
export type DealSettings = { projectMinUnits: number; projectMinAmount: number };

export type DealInput = {
  id: string | null;
  name: string;
  kind: DealKind;
  parentDealId: string | null;
  stageKey: StageKey;
  ownerId: string;
  companyName: string;
  contactName: string;
  phone: string;
  expectedCloseDate: string;
  nextStep: string;
  nextStepDate: string;
  demoDate: string;
  paidDate: string;
  lostReason: string;
  competitor: string;
  lostNote: string;
  estAmount: number;
  lines: { productId: string; qty: number; unitPrice: number }[];
  /** a note to add to the history (not stored on the deal) */
  note: string;
  /** the prospect this deal comes from, when created with Jadikan deal */
  fromLeadId: string | null;
};
