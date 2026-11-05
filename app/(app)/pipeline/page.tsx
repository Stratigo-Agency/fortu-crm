import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
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
import { PageHeader, PageSkeleton, primaryButton } from "../PageHeader";

export default function Page(props: PageProps<"/pipeline">) {
  return (
    <main className="w-full">
      <Suspense fallback={<PageSkeleton />}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}

async function Content({ searchParams }: { searchParams: PageProps<"/pipeline">["searchParams"] }) {
  const user = await requireUser();
  const params = await searchParams;
  // Prospek's "Jadikan deal" used /pipeline?fromLead=<id>: it opens the deal form for that prospect
  if (typeof params.fromLead === "string") redirect(`/deal/new?fromLead=${encodeURIComponent(params.fromLead)}`);
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
      <PageHeader
        title={t("pipeline.title")}
        meta={`${ownerName ?? t("nav.allReps")} · ${t("common.beforeTax")}`}
        actions={
          <Link href="/deal/new" className={primaryButton}>
            <Plus size={15} strokeWidth={2.2} aria-hidden="true" />
            {t("pipeline.newDeal")}
          </Link>
        }
      />
      <div className="px-4 md:px-6">
        <dl className="flex flex-wrap gap-x-8 gap-y-3 border-b border-line py-4">
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

        <div className="flex flex-wrap items-center gap-2 py-3">
          <form action="/pipeline" method="get" role="search" className="min-w-0 basis-full md:w-72 md:basis-auto">
            {view !== "board" && <input type="hidden" name="view" value={view} />}
            {showLost && <input type="hidden" name="lost" value="1" />}
            <div className="relative">
              <Search size={15} strokeWidth={1.8} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder={t("pipeline.searchPlaceholder")}
                aria-label={t("pipeline.searchPlaceholder")}
                className="h-11 w-full rounded-sm border border-input bg-white pl-9 pr-3 text-base text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15 desk:h-9"
              />
            </div>
          </form>
          <nav aria-label={t("pipeline.views")} className="flex rounded-full bg-paper p-0.5">
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
        </div>

        {cards.length === 0 ? (
          <p className="py-16 text-center text-slate">{q ? t("pipeline.noMatch") : t("pipeline.empty")}</p>
        ) : view === "list" ? (
          <DealList cards={cards} />
        ) : (
          <Board columns={columns} cards={cards} compact={view === "ringkas"} />
        )}
      </div>
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
      className={`flex h-11 items-center rounded-full px-3.5 text-base desk:h-8 ${active ? "bg-white font-semibold text-ink shadow-card" : "text-slate hover:text-ink"}`}
    >
      {t(VIEW_LABEL[view])}
    </Link>
  );
}

function Stat({ label, value, hint, late }: { label: string; value: string; hint?: string; late?: boolean }) {
  return (
    <div>
      <dt className={`text-sm ${late ? "text-late" : "text-faint"}`}>{label}</dt>
      <dd className={`tabular mt-0.5 flex items-baseline gap-2 text-xl font-semibold ${late ? "text-late" : "text-ink"}`}>
        {value}
        {hint && <span className="text-sm font-normal text-faint">{hint}</span>}
      </dd>
    </div>
  );
}
