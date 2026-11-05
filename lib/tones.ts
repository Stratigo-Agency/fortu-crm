import type { StageKey } from "@/lib/pipelineTypes";

// Color classes, written out in full so Tailwind finds them. One soft color per stage, product line and person.

export const STAGE_DOT: Record<StageKey, string> = {
  chat: "bg-st-chat",
  quotation: "bg-st-quotation",
  negotiation: "bg-st-negotiation",
  po: "bg-st-po",
  done: "bg-st-done",
  lost: "bg-st-lost",
};

/** A soft chip: background and readable text. */
export const STAGE_CHIP: Record<StageKey, string> = {
  chat: "bg-st-chat-bg text-st-chat-ink",
  quotation: "bg-st-quotation-bg text-st-quotation-ink",
  negotiation: "bg-st-negotiation-bg text-st-negotiation-ink",
  po: "bg-st-po-bg text-st-po-ink",
  done: "bg-st-done-bg text-st-done-ink",
  lost: "bg-st-lost-bg text-st-lost-ink",
};

/** Active stage button / node: solid color with white text, or a dark text where white would be too faint. */
export const STAGE_SOLID: Record<StageKey, string> = {
  chat: "bg-st-chat-ink text-white border-st-chat-ink",
  quotation: "bg-st-quotation-ink text-white border-st-quotation-ink",
  negotiation: "bg-st-negotiation-ink text-white border-st-negotiation-ink",
  po: "bg-st-po-ink text-white border-st-po-ink",
  done: "bg-st-done-ink text-white border-st-done-ink",
  lost: "bg-st-lost-ink text-white border-st-lost-ink",
};

const LINE: Record<string, string> = {
  IFP: "bg-blue-bg text-blue-ink",
  DSS: "bg-violet-bg text-violet-ink",
  LED: "bg-amber-bg text-amber-ink",
};

/** Product line chip (IFP, DSS, LED); anything else is grey. */
export function lineChip(line: string | null | undefined): string {
  return (line && LINE[line]) || "bg-paper text-slate";
}

const PEOPLE = [
  "bg-blue-bg text-blue-ink",
  "bg-violet-bg text-violet-ink",
  "bg-pink-bg text-pink-ink",
  "bg-teal-bg text-teal-ink",
  "bg-amber-bg text-amber-ink",
  "bg-orange-bg text-orange-ink",
];

/** The same person always gets the same avatar color (Attio). */
export function personTone(name: string | null | undefined): string {
  const s = name ?? "";
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PEOPLE[h % PEOPLE.length];
}
