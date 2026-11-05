import { STAGE_KEYS, type StageKey, type StageRule } from "@/lib/pipelineTypes";

// Mirror of the stage rules in the database (trg_deal_stage, migration 004), used only to show what
// is missing before saving. The database trigger stays the authority and always checks again.

export type StageRuleInput = {
  stageKey: StageKey;
  nextStep: string;
  nextStepDate: string;
  expectedCloseDate: string;
  lostReason: string;
  /** product lines with a quantity and a price above 0 */
  pricedLines: number;
};

/** The rules this deal would break if saved at its stage. */
export function missingRules(f: StageRuleInput): StageRule[] {
  const missing: StageRule[] = [];
  const index = STAGE_KEYS.indexOf(f.stageKey);
  const open = f.stageKey !== "done" && f.stageKey !== "lost";
  if (open && (!f.nextStep.trim() || !f.nextStepDate)) missing.push("next_step");
  if (index >= 1 && f.stageKey !== "lost" && f.pricedLines === 0) missing.push("products");
  if (index >= 1 && open && !f.expectedCloseDate) missing.push("close_date");
  if (f.stageKey === "lost" && !f.lostReason) missing.push("lost_reason");
  return missing;
}

/** Which form fields a rule is about, to mark them. */
export const RULE_FIELDS: Record<StageRule, string[]> = {
  next_step: ["nextStep", "nextStepDate"],
  products: ["lines"],
  close_date: ["expectedCloseDate"],
  lost_reason: ["lostReason"],
};
