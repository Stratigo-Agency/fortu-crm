import Link from "next/link";
import { t } from "@/lib/copy";
import { dayMonth, relDate, rupiahShort } from "@/lib/format";
import type { DealCard, StageKey } from "@/lib/pipelineTypes";
import { initials } from "@/lib/shellInitials";
import { personTone, STAGE_DOT } from "@/lib/tones";

/** The stage marker: one soft color per stage (lib/tones.ts). */
export const MARKER: Record<StageKey, string> = STAGE_DOT;

function Tag({ tone, children }: { tone: "navy" | "late" | "plain"; children: React.ReactNode }) {
  const cls =
    tone === "navy" ? "bg-teal-bg text-teal-ink" : tone === "late" ? "bg-late-bg text-late" : "bg-paper text-slate";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

export function Lock() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="shrink-0 text-slate">
      <rect x="2.5" y="6" width="9" height="6.5" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4.5 6V4.5a2.5 2.5 0 015 0V6" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

/** The next step line of a card: what and when, orange when late; Done / Lost show their date. */
export function NextStepLine({ card }: { card: DealCard }) {
  if (card.stage_key === "done" && card.closed_on) return <>{t("pipeline.doneOn", { date: dayMonth(card.closed_on) })}</>;
  if (card.stage_key === "lost" && card.closed_on) return <>{t("pipeline.lostOn", { date: dayMonth(card.closed_on) })}</>;
  if (!card.next_step || !card.next_step_date) return <>{t("pipeline.noNextStep")}</>;
  if (card.next_step_overdue) return <>{`${t("pipeline.late", { n: card.days_overdue ?? 0 })} · ${card.next_step}`}</>;
  return <>{`${card.next_step} · ${relDate(card.next_step_date)}`}</>;
}

/** A full deal card (Board view). */
export function DealCardBody({ card }: { card: DealCard }) {
  const late = card.next_step_overdue;
  return (
    <>
      <p className="font-semibold leading-snug text-ink">
        <Link href={`/deal/${card.id}`} className="hover:underline">
          {card.name}
        </Link>
      </p>
      {card.company_name && <p className="mt-0.5 truncate text-sm text-slate">{card.company_name}</p>}
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <span className="tabular font-semibold text-ink">{rupiahShort(card.amount)}</span>
        <span className="text-sm text-faint">
          {card.has_products ? t("common.units", { n: card.screen_units }) : t("pipeline.estimateOnly")}
        </span>
      </div>
      {(card.is_project || card.needs_discount_approval || card.is_stale || card.has_demo) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {card.is_project && <Tag tone="navy">{t("pipeline.tagProject")}</Tag>}
          {card.needs_discount_approval && <Tag tone="late">{t("pipeline.tagDiscount")}</Tag>}
          {card.is_stale && <Tag tone="plain">{t("pipeline.tagStale", { n: card.days_since_update })}</Tag>}
          {card.has_demo && <Tag tone="plain">{t("pipeline.tagDemo")}</Tag>}
        </div>
      )}
      <p className={`mt-2 flex items-start gap-1.5 text-sm ${late ? "text-late" : "text-slate"}`}>
        <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${late ? "bg-late animate-pulse-dot" : "bg-accent"}`} aria-hidden="true" />
        <span className="min-w-0"><NextStepLine card={card} /></span>
      </p>
      <div className="mt-3 flex items-center gap-2 text-sm">
        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${personTone(card.owner_name)}`}>
          {initials(card.owner_name ?? "")}
        </span>
        <span className="min-w-0 flex-1 truncate text-slate">{card.owner_name}</span>
        <span className="text-faint">{t("common.days", { n: card.days_in_stage })}</span>
        {!card.can_edit && <Lock />}
      </div>
    </>
  );
}

/** A two-line card (Ringkas view). */
export function DealCardCompact({ card }: { card: DealCard }) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <p className="min-w-0 truncate font-semibold text-ink">
          <Link href={`/deal/${card.id}`} className="hover:underline">
            {card.name}
          </Link>
        </p>
        <span className="tabular shrink-0 font-semibold text-ink">{rupiahShort(card.amount)}</span>
      </div>
      <div className="mt-0.5 flex items-center gap-2 text-sm text-slate">
        <span className="min-w-0 flex-1 truncate">
          {[card.company_name, card.owner_name].filter(Boolean).join(" · ")}
        </span>
        {card.next_step_overdue && <span className="text-late">{t("pipeline.late", { n: card.days_overdue ?? 0 })}</span>}
        {!card.can_edit && <Lock />}
      </div>
    </>
  );
}
