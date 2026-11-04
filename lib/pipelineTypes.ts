// Pipeline types shared by the server and the board (no database code here).

export type StageKey = "chat" | "quotation" | "negotiation" | "po" | "done" | "lost";
export const STAGE_KEYS: readonly StageKey[] = ["chat", "quotation", "negotiation", "po", "done", "lost"];
export type StageRule = "next_step" | "products" | "close_date" | "lost_reason";
export const STAGE_RULES: readonly StageRule[] = ["next_step", "products", "close_date", "lost_reason"];

export type PipelineView = "board" | "ringkas" | "list";

/** A card as the board needs it; money as strings (postgres numeric), dates as YYYY-MM-DD. */
export type DealCard = {
  id: string;
  name: string;
  stage_key: StageKey;
  owner_user_id: string;
  owner_name: string | null;
  company_name: string | null;
  contact_name: string | null;
  amount: string;
  has_products: boolean;
  screen_units: number;
  expected_close_date: string | null;
  next_step: string | null;
  next_step_date: string | null;
  next_step_overdue: boolean;
  days_overdue: number | null;
  days_in_stage: number;
  is_stale: boolean;
  days_since_update: number;
  is_project: boolean;
  needs_discount_approval: boolean;
  has_demo: boolean;
  closed_on: string | null;
  can_edit: boolean;
};

export type Column = {
  key: StageKey;
  name: string;
  probability: string;
  is_won: boolean;
  is_lost: boolean;
  deal_count: number;
  amount: string;
  /** Done deal / Lost closed before this month: they live in Laporan */
  older_count: number;
};

/** What a move returns. `previous` lets undo put back what the move cleared (Done/Lost clear the next step). */
export type MoveResult =
  | { ok: true; from: StageKey; previous: { nextStep: string | null; nextStepDate: string | null } }
  | { ok: false; rule: StageRule };
