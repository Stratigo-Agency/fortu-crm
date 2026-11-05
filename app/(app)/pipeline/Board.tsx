"use client";

import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { t } from "@/lib/copy";
import { percent, rupiahShort } from "@/lib/format";
import { type Column, type DealCard, STAGE_KEYS, type StageKey } from "@/lib/pipelineTypes";
import type { Restore } from "@/lib/pipeline";
import { moveDealAction } from "./actions";
import { DealCardBody, DealCardCompact, MARKER } from "./DealCardView";

/** Cards shown per column; the rest is "+n deal lainnya". */
export const CARDS_PER_COLUMN = 30;

type Toast = { id: number; text: string; undo?: () => void };
type Props = { columns: Column[]; cards: DealCard[]; compact: boolean };

export function Board({ columns, cards, compact }: Props) {
  const router = useRouter();
  // Optimistic stage per card until the server's new board arrives.
  const [moves, setMoves] = useState<Record<string, StageKey>>({});
  const [prevCards, setPrevCards] = useState(cards);
  if (cards !== prevCards) {
    setPrevCards(cards);
    // keep a pending move until the server's board shows the card in its new stage
    const pending = Object.fromEntries(
      Object.entries(moves).filter(([id, to]) => cards.some((c) => c.id === id && c.stage_key !== to)),
    );
    setMoves(pending);
  }
  const shown = cards.map((c) => (moves[c.id] ? { ...c, stage_key: moves[c.id] } : c));

  const [toast, setToast] = useState<Toast | null>(null);
  // The toast stays while the pointer or keyboard focus is on it, so Batalkan can be reached.
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!toast || paused) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast, paused]);
  const toastSeq = useRef(0);
  const say = (text: string, undo?: () => void) => setToast({ id: ++toastSeq.current, text, undo });

  const [active, setActive] = useState<DealCard | null>(null);
  // Mouse and keyboard only: on phones the stage select moves a card, so scrolling stays scrolling.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  // Screen reader texts in Bahasa, naming the deal and the stage (dnd-kit's defaults are English ids).
  const nameOf = (id: unknown) => shown.find((c) => c.id === id)?.name ?? "";
  const stageOf = (id: unknown) => (STAGE_KEYS.includes(id as StageKey) ? t(`stage.${id as StageKey}`) : "");
  const accessibility = {
    screenReaderInstructions: { draggable: t("pipeline.dragHelp") },
    announcements: {
      onDragStart: ({ active }: { active: { id: unknown } }) => t("pipeline.dragStart", { name: nameOf(active.id) }),
      onDragOver: ({ active, over }: { active: { id: unknown }; over: { id: unknown } | null }) =>
        over ? t("pipeline.dragOver", { name: nameOf(active.id), stage: stageOf(over.id) }) : undefined,
      onDragEnd: ({ active, over }: { active: { id: unknown }; over: { id: unknown } | null }) =>
        over
          ? t("pipeline.dragEnd", { name: nameOf(active.id), stage: stageOf(over.id) })
          : t("pipeline.dragCancel", { name: nameOf(active.id) }),
      onDragCancel: ({ active }: { active: { id: unknown } }) => t("pipeline.dragCancel", { name: nameOf(active.id) }),
    },
  };

  async function move(card: DealCard, to: StageKey) {
    if (to === card.stage_key || !card.can_edit) return;
    const from = card.stage_key;
    setMoves((m) => ({ ...m, [card.id]: to }));
    const r = await moveDealAction(card.id, to);
    if (r.ok) {
      // Undo is the same move back, putting back what the move cleared (Done deal / Lost clear the next step).
      say(t("stage.moved", { stage: t(`stage.${to}`) }), () => void undo(card, to, r.from, r.previous));
      router.refresh();
      return;
    }
    setMoves((m) => ({ ...m, [card.id]: from }));
    if ("rule" in r) {
      say(t(`stageRule.${r.rule}`));
      // The deal panel opens with the target stage chosen and the missing field marked.
      router.push(`/deal/${card.id}?stage=${to}&missing=${r.rule}`);
    } else {
      say(r.error);
    }
  }

  async function undo(card: DealCard, now: StageKey, back: StageKey, previous: Restore) {
    setToast(null);
    setMoves((m) => ({ ...m, [card.id]: back }));
    const r = await moveDealAction(card.id, back, previous);
    if (r.ok) {
      say(t("stage.moved", { stage: t(`stage.${back}`) }));
      router.refresh();
      return;
    }
    setMoves((m) => ({ ...m, [card.id]: now }));
    say("rule" in r ? t(`stageRule.${r.rule}`) : r.error);
  }

  function onDragStart(e: DragStartEvent) {
    setActive(shown.find((c) => c.id === e.active.id) ?? null);
  }

  function onDragEnd(e: DragEndEvent) {
    setActive(null);
    const card = shown.find((c) => c.id === e.active.id);
    const to = e.over?.id as StageKey | undefined;
    if (card && to) void move(card, to);
  }

  return (
    <DndContext
      id="pipeline-board" // stable ids for aria-describedby, so server and client HTML match
      accessibility={accessibility}
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActive(null)}
    >
      <div className="-mx-4 mt-6 overflow-x-auto px-4 pb-2 md:-mx-8 md:px-8">
        <div className="flex gap-4 xl:grid xl:auto-cols-fr xl:grid-flow-col">
          {columns.map((col) => (
            <BoardColumn
              key={col.key}
              column={col}
              cards={shown.filter((c) => c.stage_key === col.key)}
              serverShown={Math.min(CARDS_PER_COLUMN, cards.filter((c) => c.stage_key === col.key).length)}
              compact={compact}
              onMove={move}
            />
          ))}
        </div>
      </div>
      {/* no drop animation: the card is already moved (optimistically) when the mouse lets go */}
      <DragOverlay dropAnimation={null}>
        {active && (
          <div className={`rotate-1 rounded-md bg-white shadow-card ring-1 ring-line ${compact ? "px-3 py-2.5" : "p-4"}`}>
            {compact ? <DealCardCompact card={active} /> : <DealCardBody card={active} />}
          </div>
        )}
      </DragOverlay>
      {/* One live region that stays mounted; only its text changes, so screen readers announce it. */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-30 mx-auto max-w-md"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
      >
        {toast && (
          <div
            key={toast.id}
            className="pointer-events-auto flex items-center gap-4 rounded-md bg-navy px-4 py-3 text-white shadow-card"
          >
            <span className="flex-1">{toast.text}</span>
            {toast.undo && (
              <button
                type="button"
                onClick={toast.undo}
                className="-my-1 h-11 shrink-0 rounded-sm px-3 font-bold text-white underline underline-offset-2"
              >
                {t("common.undo")}
              </button>
            )}
          </div>
        )}
      </div>
    </DndContext>
  );
}

type ColumnProps = {
  column: Column;
  cards: DealCard[];
  /** cards of this column on the server's board, for "+n deal lainnya" (not the optimistic ones) */
  serverShown: number;
  compact: boolean;
  onMove: (card: DealCard, to: StageKey) => void;
};

function BoardColumn({ column, cards, serverShown, compact, onMove }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key });
  const shown = cards.slice(0, CARDS_PER_COLUMN);
  const more = Math.max(0, column.deal_count - serverShown);
  const closed = column.is_won || column.is_lost;
  return (
    <section
      ref={setNodeRef}
      aria-label={t(`stage.${column.key}`)}
      className={`flex w-[300px] shrink-0 flex-col rounded-lg p-3 xl:w-auto xl:min-w-0 ${
        isOver ? "bg-mist ring-2 ring-navy" : "bg-mist/40"
      }`}
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
      <ul className="flex min-h-16 flex-col gap-3">
        {shown.map((card) => (
          <Card key={card.id} card={card} compact={compact} onMove={onMove} />
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

function Card({ card, compact, onMove }: { card: DealCard; compact: boolean; onMove: ColumnProps["onMove"] }) {
  const router = useRouter();
  // A card the user may not edit can't be picked up at all.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.id,
    disabled: !card.can_edit,
    attributes: { roleDescription: t("pipeline.cardRole") },
  });
  return (
    <li
      data-deal-id={card.id}
      data-locked={!card.can_edit || undefined}
      className={`rounded-md bg-white shadow-card ${compact ? "px-3 py-2.5" : "p-4"} ${isDragging ? "opacity-40" : ""}`}
    >
      {/* the drag handle is the card body; the stage select stays outside it, reachable on its own */}
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        data-drag-handle
        onClick={(e) => {
          // a click (not a drag) opens the deal; links inside do it themselves
          if (!(e.target as HTMLElement).closest("a")) router.push(`/deal/${card.id}`);
        }}
        className={`rounded-sm outline-offset-4 outline-navy ${card.can_edit ? "cursor-grab" : "cursor-pointer"}`}
      >
        {compact ? <DealCardCompact card={card} /> : <DealCardBody card={card} />}
      </div>
      {card.can_edit && (
        <select
          aria-label={t("pipeline.moveTo")}
          value={card.stage_key}
          onChange={(e) => onMove(card, e.target.value as StageKey)}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          className="stage-select mt-3 h-11 w-full rounded-sm border border-input bg-white px-3 text-base text-ink"
        >
          {STAGE_KEYS.map((key) => (
            <option key={key} value={key}>
              {t(`stage.${key}`)}
            </option>
          ))}
        </select>
      )}
    </li>
  );
}
