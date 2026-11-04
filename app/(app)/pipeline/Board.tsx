"use client";

import { t } from "@/lib/copy";
import { percent, rupiahShort } from "@/lib/format";
import type { Column, DealCard, StageKey } from "@/lib/pipelineTypes";
import { DealCardBody, DealCardCompact } from "./DealCardView";

/** Cards shown per column; the rest is "+n deal lainnya". */
export const CARDS_PER_COLUMN = 30;

const MARKER: Record<StageKey, string> = {
  chat: "bg-stage-1",
  quotation: "bg-stage-2",
  negotiation: "bg-stage-3",
  po: "bg-stage-4",
  done: "bg-stage-5",
  lost: "border border-slate bg-white",
};

type Props = { columns: Column[]; cards: DealCard[]; compact: boolean };

export function Board({ columns, cards, compact }: Props) {
  return (
    <div className="-mx-4 mt-6 overflow-x-auto px-4 pb-2 md:-mx-8 md:px-8">
      <div className="flex gap-4 xl:grid xl:auto-cols-fr xl:grid-flow-col">
        {columns.map((col) => (
          <BoardColumn
            key={col.key}
            column={col}
            cards={cards.filter((c) => c.stage_key === col.key)}
            compact={compact}
          />
        ))}
      </div>
    </div>
  );
}

function BoardColumn({ column, cards, compact }: { column: Column; cards: DealCard[]; compact: boolean }) {
  const shown = cards.slice(0, CARDS_PER_COLUMN);
  const more = column.deal_count - shown.length;
  const closed = column.is_won || column.is_lost;
  return (
    <section
      aria-label={column.name}
      className="flex w-[300px] shrink-0 flex-col rounded-lg bg-mist/40 p-3 xl:w-auto xl:min-w-0"
    >
      <header className="px-1 pb-3">
        <div className="flex items-center gap-2">
          <span className={`h-3 w-3 shrink-0 ${MARKER[column.key]}`} aria-hidden="true" />
          <h2 className="flex-1 font-bold text-ink">{t(`stage.${column.key}`)}</h2>
          <span className="text-sm text-slate">{closed ? t("stage.thisMonth") : percent(column.probability)}</span>
        </div>
        <p className="tabular mt-1 text-sm text-slate">
          {t("pipeline.dealsAmount", { n: column.deal_count, amount: rupiahShort(column.amount) })}
        </p>
      </header>
      <ul className="flex flex-col gap-3">
        {shown.map((card) => (
          <li
            key={card.id}
            className={`rounded-md bg-white shadow-card ${compact ? "px-3 py-2.5" : "p-4"}`}
          >
            {compact ? <DealCardCompact card={card} /> : <DealCardBody card={card} />}
          </li>
        ))}
      </ul>
      {more > 0 && <p className="mt-3 text-center text-sm text-slate">{t("pipeline.more", { n: more })}</p>}
      {closed && column.older_count > 0 && (
        <a href="/laporan" className="mt-3 block text-center text-sm text-slate underline">
          {t("stage.olderInReport", { n: column.older_count })}
        </a>
      )}
    </section>
  );
}
