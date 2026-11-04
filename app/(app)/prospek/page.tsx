import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/lib/authz";
import { t } from "@/lib/copy";
import { relTime } from "@/lib/format";
import { formatPhone } from "@/lib/ingest/phone";
import { listProspects, PAGE_SIZE, parseLimit, parseTab, type ProspekRow, type ProspekTab, prospekStats } from "@/lib/prospek";
import { prospekHref } from "@/lib/prospekHref";
import { getSalesFilter, salesOptions } from "@/lib/salesFilter";
import { LeadActions } from "./LeadActions";

const COLS = "md:grid-cols-[1.2fr_2.2fr_1.5fr_0.6fr_0.9fr_0.7fr_1.4fr]";

export default function Page(props: PageProps<"/prospek">) {
  return (
    <main className="mx-auto w-full max-w-screen-2xl px-4 py-8 md:px-8">
      <Suspense>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}

async function Content({ searchParams }: { searchParams: PageProps<"/prospek">["searchParams"] }) {
  const user = await requireUser();
  const params = await searchParams;
  const tab = parseTab(params.tab);
  const q = (typeof params.q === "string" ? params.q : "").trim().slice(0, 100);
  const limit = parseLimit(params.limit);
  const ownerId = await getSalesFilter();

  // Only sales leads, the CEO and admins hand leads to someone else.
  const canReassign = user.role === "sales_lead" || user.role === "ceo" || user.role === "admin";
  const [{ rows, hasMore }, stats, owners] = await Promise.all([
    listProspects({ viewerId: user.id, ownerId, tab, q, limit }),
    prospekStats(ownerId),
    canReassign ? salesOptions() : Promise.resolve([]),
  ]);

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-3xl font-bold text-ink">{t("prospek.title")}</h1>
        <p className="text-slate">{t("prospek.summary", { n: stats.new_count })}</p>
      </div>

      <dl className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-4">
        <Stat label={t("prospek.statToday")} value={String(stats.received_today)} />
        <Stat
          label={t("prospek.statLogDelay")}
          value={stats.median_log_delay_min === null ? "—" : t("prospek.minutes", { n: stats.median_log_delay_min })}
          hint={stats.median_log_delay_min === null ? undefined : t("prospek.statLogDelayHint")}
        />
        <Stat label={t("prospek.statNoCode")} value={String(stats.meta_without_code)} />
      </dl>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <nav aria-label={t("prospek.tabsLabel")} className="flex overflow-hidden rounded-sm border border-input bg-white">
          <TabLink tab="baru" current={tab} q={q} label={`${t("prospek.tabNew")} · ${stats.new_count}`} />
          <TabLink tab="dihubungi" current={tab} q={q} label={`${t("prospek.tabContacted")} · ${stats.contacted_count}`} />
          <TabLink tab="semua" current={tab} q={q} label={t("common.all")} />
        </nav>
        <form action="/prospek" method="get" role="search" className="min-w-0 basis-full md:flex-1 md:basis-0 md:max-w-xl">
          {tab !== "baru" && <input type="hidden" name="tab" value={tab} />}
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
              placeholder={t("prospek.searchPlaceholder")}
              aria-label={t("prospek.searchPlaceholder")}
              className="h-11 w-full rounded-sm border border-input bg-white pl-10 pr-3 text-base text-ink"
            />
          </div>
        </form>
        <Link
          href="/tambah"
          className="flex h-11 w-full items-center justify-center gap-2 rounded-sm bg-navy px-5 text-base font-bold text-white md:ml-auto md:w-auto"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          {t("prospek.quickAdd")}
        </Link>
      </div>

      <div className="mt-6 rounded-lg bg-white shadow-card">
        {rows.length === 0 ? (
          <p className="p-8 text-center text-slate">{tab === "baru" && !q ? t("prospek.empty") : t("prospek.noResults")}</p>
        ) : (
          <>
            <div className={`hidden gap-x-4 px-5 py-3 text-sm font-bold text-slate md:grid ${COLS}`}>
              <span>{t("prospek.colContact")}</span>
              <span>{t("prospek.colMessage")}</span>
              <span>{t("prospek.colSource")}</span>
              <span>{t("prospek.colProduct")}</span>
              <span>{t("prospek.colReceived")}</span>
              <span>{t("prospek.colSales")}</span>
              <span>{t("prospek.colAction")}</span>
            </div>
            <ul>
              {rows.map((row) => (
                <Row key={row.id} row={row} canReassign={canReassign} owners={owners} />
              ))}
            </ul>
          </>
        )}
      </div>

      {hasMore && (
        <div className="mt-4 text-center">
          <Link
            href={prospekHref({ tab, q, limit: limit + PAGE_SIZE })}
            scroll={false}
            className="inline-flex h-11 items-center rounded-sm border border-input bg-white px-5 font-bold text-navy"
          >
            {t("prospek.loadMore")}
          </Link>
        </div>
      )}
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-white px-5 py-3 shadow-card md:min-h-24 md:py-4">
      <dt className="text-slate">{label}</dt>
      <dd className="tabular mt-1 text-2xl font-bold text-ink md:text-3xl">{value}</dd>
      {hint && <p className="mt-1 text-sm text-slate">{hint}</p>}
    </div>
  );
}

function TabLink({ tab, current, q, label }: { tab: ProspekTab; current: ProspekTab; q: string; label: string }) {
  const active = tab === current;
  return (
    <Link
      href={prospekHref({ tab, q })}
      aria-current={active ? "page" : undefined}
      className={`flex h-11 items-center px-4 text-base ${active ? "bg-navy font-bold text-white" : "text-slate"}`}
    >
      {label}
    </Link>
  );
}

function Row({
  row,
  canReassign,
  owners,
}: {
  row: ProspekRow;
  canReassign: boolean;
  owners: { id: string; full_name: string }[];
}) {
  const code = row.ad_code ?? (row.click_code ? `#${row.click_code}` : null);
  return (
    <li className={`grid gap-x-4 gap-y-2 border-t border-line px-5 py-4 md:items-start ${COLS}`}>
      <div className="min-w-0">
        <p className="font-bold text-ink">{row.contact_name ?? formatPhone(row.phone_e164)}</p>
        {row.contact_name && <p className="tabular text-sm text-slate">{formatPhone(row.phone_e164)}</p>}
      </div>
      <p className="line-clamp-2 min-w-0 text-ink">{row.first_message}</p>
      <div className="flex flex-wrap items-center gap-2">
        <span>{t(`sourceChannel.${row.source_channel as "meta_ctwa"}`)}</span>
        {code && (
          <span className="rounded-sm border border-line bg-paper px-1.5 py-0.5 font-mono text-xs text-slate">{code}</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 md:contents">
        <span>{row.product_interest ? t(`productLine.${row.product_interest as "IFP"}`) : "—"}</span>
        <span>
          {/* "kemarin" starts a sentence-style cell: capital first letter, as in the design */}
          <span className={`inline-block first-letter:uppercase ${row.is_late ? "rounded-sm bg-late-bg px-2 py-0.5 text-late" : ""}`}>
            {relTime(row.received_at)}
          </span>
        </span>
        <span>{row.owner_name ?? <span className="text-slate">{t("prospek.unowned")}</span>}</span>
      </div>
      <div className="flex items-center gap-2">
        {row.can_edit ? (
          <>
            <Link
              href={`/pipeline?fromLead=${row.id}`}
              className="flex h-11 items-center rounded-sm bg-navy px-4 font-bold text-white md:h-10"
            >
              {t("prospek.toDeal")}
            </Link>
            <LeadActions
              leadId={row.id}
              name={row.contact_name ?? formatPhone(row.phone_e164)}
              isNew={row.status === "new"}
              canReassign={canReassign}
              currentOwnerId={row.owner_user_id}
              owners={owners}
            />
          </>
        ) : (
          <span className="flex items-center gap-2 text-slate">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <rect x="2.5" y="6" width="9" height="6.5" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
              <path d="M4.5 6V4.5a2.5 2.5 0 015 0V6" stroke="currentColor" strokeWidth="1.4" />
            </svg>
            {t("common.viewOnly")}
          </span>
        )}
      </div>
    </li>
  );
}
