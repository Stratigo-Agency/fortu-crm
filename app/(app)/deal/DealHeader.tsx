"use client";

import { t } from "@/lib/copy";
import { percent, rupiahShort } from "@/lib/format";
import { STAGE_KEYS, type StageKey } from "@/lib/pipelineTypes";
import { MARKER } from "../pipeline/DealCardView";

type Props = {
  kind: string;
  name: string;
  stageKey: StageKey;
  /** where the deal was before this visit; stages before it read as "done" */
  amount: number;
  weightedAmount: number;
  daysInStage: number;
  isNew: boolean;
  onStage?: (key: StageKey) => void;
  disabled?: boolean;
};

/** Kind label, name, stage buttons (Chat masuk … Done deal, Lost) and the three numbers under them. */
export function DealHeader({ kind, name, stageKey, amount, weightedAmount, daysInStage, isNew, onStage, disabled }: Props) {
  const current = STAGE_KEYS.indexOf(stageKey);
  return (
    <div className="px-6 pb-4 pt-5">
      <p className="text-sm text-faint">{kind}</p>
      <h1 className="mt-0.5 pr-14 text-xl font-semibold text-ink">{name || t("deal.new")}</h1>
      <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label={t("pipeline.colStage")}>
        {STAGE_KEYS.map((key, i) => {
          const active = key === stageKey;
          const passed = i < current && key !== "lost" && stageKey !== "lost";
          return (
            <button
              key={key}
              type="button"
              disabled={disabled || !onStage}
              aria-pressed={active}
              onClick={() => onStage?.(key)}
              className={`flex h-11 items-center gap-1.5 rounded-full border px-3 text-base desk:h-8 ${
                active
                  ? "border-ink bg-ink font-semibold text-white"
                  : passed
                    ? "border-transparent bg-paper text-ink"
                    : "border-line bg-white text-slate hover:text-ink"
              }`}
            >
              <span className={`h-2 w-2 shrink-0 rounded-[3px] ${active ? "bg-white" : MARKER[key]}`} aria-hidden="true" />
              {t(`stage.${key}`)}
            </button>
          );
        })}
      </div>
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
