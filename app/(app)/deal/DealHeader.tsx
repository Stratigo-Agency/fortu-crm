"use client";

import { Check, Circle, CircleCheck } from "lucide-react";
import { t } from "@/lib/copy";
import { percent, rupiahShort } from "@/lib/format";
import { STAGE_KEYS, type StageKey, type StageRule } from "@/lib/pipelineTypes";
import { missingRules, type StageRuleInput } from "@/lib/stageRules";
import { STAGE_CHIP, STAGE_DOT } from "@/lib/tones";

type Props = {
  kind: string;
  name: string;
  stageKey: StageKey;
  amount: number;
  weightedAmount: number;
  daysInStage: number;
  isNew: boolean;
  onStage?: (key: StageKey) => void;
  disabled?: boolean;
  /** what is filled in now, to show what the next stage still needs */
  rules: Omit<StageRuleInput, "stageKey">;
};

const FLOW: StageKey[] = STAGE_KEYS.filter((k) => k !== "lost");

/** The rules a stage asks for (the same rules the database checks, lib/stageRules.ts). */
function rulesFor(stage: StageKey): StageRule[] {
  const all: StageRule[] = ["next_step", "products", "close_date", "lost_reason"];
  // a rule applies to a stage when an empty deal would break it there
  const empty = missingRules({ stageKey: stage, nextStep: "", nextStepDate: "", expectedCloseDate: "", lostReason: "", pricedLines: 0 });
  return all.filter((r) => empty.includes(r));
}

/**
 * The deal's stages as a small workflow (Attio): connected steps, the ones behind ticked, the current one in
 * its color. Under it, what the next stage still needs, so a rep sees why a move would be stopped.
 */
export function DealHeader({ kind, name, stageKey, amount, weightedAmount, daysInStage, isNew, onStage, disabled, rules }: Props) {
  const current = FLOW.indexOf(stageKey);
  const lost = stageKey === "lost";
  const next = !lost && current >= 0 && current < FLOW.length - 1 ? FLOW[current + 1] : null;
  const needs = next ? rulesFor(next) : [];
  const missing = next ? missingRules({ ...rules, stageKey: next }) : [];

  return (
    <div className="px-6 pb-4 pt-5">
      <p className="text-sm text-faint">{kind}</p>
      <h1 className="mt-0.5 pr-14 text-xl font-semibold text-ink">{name || t("deal.new")}</h1>

      <div className="-mx-6 mt-4 overflow-x-auto px-6 pb-1">
        <ol className="flex min-w-max items-center" role="group" aria-label={t("pipeline.colStage")}>
          {FLOW.map((key, i) => {
            const active = key === stageKey;
            const passed = !lost && i < current;
            return (
              <li key={key} className="flex items-center">
                {i > 0 && (
                  <span
                    aria-hidden="true"
                    className={`h-0.5 w-4 rounded-full transition-colors duration-500 ${!lost && i <= current ? STAGE_DOT[FLOW[i - 1]] : "bg-line"}`}
                  />
                )}
                <button
                  type="button"
                  disabled={disabled || !onStage}
                  aria-pressed={active}
                  onClick={() => onStage?.(key)}
                  className={`flex h-11 items-center gap-1.5 rounded-sm border px-2.5 text-base transition duration-200 enabled:hover:-translate-y-0.5 desk:h-9 ${
                    active
                      ? `${STAGE_CHIP[key]} border-current font-semibold shadow-card`
                      : passed
                        ? "border-line bg-white text-ink"
                        : "border-dashed border-line bg-white text-slate"
                  }`}
                >
                  {passed ? (
                    <Check size={14} strokeWidth={2.4} aria-hidden="true" className="text-good" />
                  ) : (
                    <span className={`h-2 w-2 shrink-0 rounded-full ${STAGE_DOT[key]} ${active ? "animate-pulse-dot" : ""}`} aria-hidden="true" />
                  )}
                  {t(`stage.${key}`)}
                </button>
              </li>
            );
          })}
          <li className="ml-3 flex items-center">
            <button
              type="button"
              disabled={disabled || !onStage}
              aria-pressed={lost}
              onClick={() => onStage?.("lost")}
              className={`flex h-11 items-center gap-1.5 rounded-sm border px-2.5 text-base transition duration-200 desk:h-9 ${
                lost ? `${STAGE_CHIP.lost} border-current font-semibold` : "border-dashed border-line bg-white text-slate hover:text-ink"
              }`}
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${STAGE_DOT.lost}`} aria-hidden="true" />
              {t("stage.lost")}
            </button>
          </li>
        </ol>
      </div>

      {next && !disabled && needs.length > 0 && (
        <div className="dot-grid mt-3 rounded-md border border-line px-3.5 py-3" aria-live="polite">
          <p className="text-sm font-medium text-slate">
            {missing.length === 0 ? t("flow.ready", { stage: t(`stage.${next}`) }) : t("flow.toNext", { stage: t(`stage.${next}`) })}
          </p>
          <ul className="stagger mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
            {needs.map((r) => {
              const ok = !missing.includes(r);
              return (
                <li key={r} className={`flex items-center gap-1.5 text-sm ${ok ? "text-good" : "text-ink"}`}>
                  {ok ? (
                    <CircleCheck size={15} strokeWidth={2} aria-hidden="true" />
                  ) : (
                    <Circle size={15} strokeWidth={2} aria-hidden="true" className="text-faint" />
                  )}
                  {t(`flow.need.${r}`)}
                  <span className="sr-only">{ok ? t("flow.done") : t("flow.missing")}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {!isNew && (
        <p className="mt-4 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm text-slate">
          <span>
            <span className="tabular text-lg font-semibold text-ink">{rupiahShort(amount)}</span>{" "}
            {t("common.value").toLowerCase()}
          </span>
          <span>
            {t("common.estimate")} {rupiahShort(weightedAmount)}
          </span>
          <span>{t("stage.daysInStage", { n: daysInStage })}</span>
        </p>
      )}
    </div>
  );
}

export { percent };
