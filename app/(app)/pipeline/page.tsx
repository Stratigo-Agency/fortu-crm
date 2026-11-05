import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/lib/authz";
import { t } from "@/lib/copy";
import { rupiahShort } from "@/lib/format";
import { boardCards, boardColumns, pipelineStats } from "@/lib/pipeline";
import { parseView, pipelineHref } from "@/lib/pipelineHref";
import type { PipelineView } from "@/lib/pipelineTypes";
import { getSalesFilter, salesOptions } from "@/lib/salesFilter";
import { Board } from "./Board";
import { DealList } from "./DealList";
import { LostToggle } from "./LostToggle";

export default function Page(props: PageProps<"/pipeline">) {
  return (
    <main className="mx-auto w-full max-w-screen-2xl px-4 py-8 md:px-8">
      <Suspense>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}

async function Content({ searchParams }: { searchParams: PageProps<"/pipeline">["searchParams"] }) {
  const user = await requireUser();
  const params = await searchParams;
  const view = parseView(params.view);
  const q = (typeof params.q === "string" ? params.q : "").trim().slice(0, 100);
  const showLost = params.lost === "1";
  const ownerId = await getSalesFilter();
  const filter = { viewerId: user.id, ownerId, q, showLost };
  const [stats, owners, columns, cards] = await Promise.all([
    pipelineStats(ownerId),
    salesOptions(),
    boardColumns(filter),
    boardCards(filter),
  ]);
  const ownerName = owners.find((o) => o.id === ownerId)?.full_name;

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-3xl font-bold text-ink">{t("pipeline.title")}</h1>
        <p className="text-slate">
          {ownerName ?? t("nav.allReps")} · {t("common.beforeTax")}
        </p>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-5">
        <Stat label={t("pipeline.statOpen")} value={String(stats.open_deals)} />
        <Stat label={t("pipeline.statValue")} value={rupiahShort(stats.open_amount)} />
        <Stat label={t("pipeline.statEstimate")} value={rupiahShort(stats.weighted_open_amount)} />
        <Stat
          label={t("pipeline.statDoneMonth")}
          value={rupiahShort(stats.won_this_month)}
          hint={t("common.screenUnits", { n: stats.units_won_this_month })}
        />
        <Stat label={t("pipeline.statLate")} value={String(stats.next_step_overdue)} late={stats.next_step_overdue > 0} />
      </dl>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <form action="/pipeline" method="get" role="search" className="min-w-0 basis-full md:max-w-md md:flex-1 md:basis-0">
          {view !== "board" && <input type="hidden" name="view" value={view} />}
          {showLost && <input type="hidden" name="lost" value="1" />}
          <div className="relative">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate"
              width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"
            >
              <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.6" />
              <path d="M12.5 12.5L16 16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder={t("pipeline.searchPlaceholder")}
              aria-label={t("pipeline.searchPlaceholder")}
              className="h-11 w-full rounded-sm border border-input bg-white pl-10 pr-3 text-base text-ink"
            />
          </div>
        </form>
        <nav aria-label={t("pipeline.views")} className="flex overflow-hidden rounded-sm border border-input bg-white">
          {(["board", "ringkas", "list"] as const).map((v) => (
            <ViewLink key={v} view={v} current={view} q={q} lost={showLost} />
          ))}
        </nav>
        <LostToggle
          checked={showLost}
          label={t("pipeline.showLost")}
          hrefOn={pipelineHref({ view, q, lost: true })}
          hrefOff={pipelineHref({ view, q, lost: false })}
        />
        <Link
          href="/pipeline?deal=new"
          className="flex h-11 items-center gap-2 rounded-sm bg-navy px-5 text-base font-bold text-white md:ml-auto"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          {t("pipeline.newDeal")}
        </Link>
      </div>

      {cards.length === 0 ? (
        <p className="mt-6 rounded-lg bg-white p-8 text-center text-slate shadow-card">
          {q ? t("pipeline.noMatch") : t("pipeline.empty")}
        </p>
      ) : view === "list" ? (
        <DealList cards={cards} />
      ) : (
        <Board columns={columns} cards={cards} compact={view === "ringkas"} />
      )}
    </>
  );
}

const VIEW_LABEL = { board: "pipeline.viewBoard", ringkas: "pipeline.viewCompact", list: "pipeline.viewList" } as const;

function ViewLink({ view, current, q, lost }: { view: PipelineView; current: PipelineView; q: string; lost: boolean }) {
  const active = view === current;
  return (
    <Link
      href={pipelineHref({ view, q, lost })}
      aria-current={active ? "page" : undefined}
      className={`flex h-11 items-center px-4 text-base ${active ? "bg-navy font-bold text-white" : "text-slate"}`}
    >
      {t(VIEW_LABEL[view])}
    </Link>
  );
}

function Stat({ label, value, hint, late }: { label: string; value: string; hint?: string; late?: boolean }) {
  return (
    // the fifth tile would sit alone on a phone's two-column grid: let it take the row
    <div
      className={`rounded-lg px-5 py-3 shadow-card last:col-span-2 md:min-h-24 md:py-4 md:last:col-span-1 ${late ? "bg-late-bg" : "bg-white"}`}
    >
      <dt className={late ? "text-late" : "text-slate"}>{label}</dt>
      <dd className={`tabular mt-1 text-2xl font-bold md:text-3xl ${late ? "text-late" : "text-ink"}`}>{value}</dd>
      {hint && <p className="mt-1 text-sm text-slate">{hint}</p>}
    </div>
  );
}
