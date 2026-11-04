import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/lib/authz";
import { t } from "@/lib/copy";
import { relTime } from "@/lib/format";
import { formatPhone } from "@/lib/ingest/phone";
import { listProspects, PAGE_SIZE, parseLimit, parseTab, type ProspekRow, type ProspekTab, prospekStats } from "@/lib/prospek";
import { prospekHref } from "@/lib/prospekHref";
import { getSalesFilter } from "@/lib/salesFilter";

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

  const [{ rows, hasMore }, stats] = await Promise.all([
    listProspects({ viewerId: user.id, ownerId, tab, q, limit }),
    prospekStats(ownerId),
  ]);

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-3xl font-bold text-ink">{t("prospek.title")}</h1>
        <p className="text-slate">{t("prospek.summary", { n: stats.new_count })}</p>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <nav aria-label={t("prospek.title")} className="flex overflow-hidden rounded-sm border border-input bg-white">
          <TabLink tab="baru" current={tab} q={q} label={`${t("prospek.tabNew")} · ${stats.new_count}`} />
          <TabLink tab="dihubungi" current={tab} q={q} label={`${t("prospek.tabContacted")} · ${stats.contacted_count}`} />
          <TabLink tab="semua" current={tab} q={q} label={t("common.all")} />
        </nav>
        <form action="/prospek" method="get" role="search" className="min-w-0 flex-1 md:max-w-xl">
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
          className="ml-auto flex h-11 items-center gap-2 rounded-sm bg-navy px-5 text-base font-bold text-white"
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
                <Row key={row.id} row={row} />
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

function Row({ row }: { row: ProspekRow }) {
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
          <Link
            href={`/pipeline?fromLead=${row.id}`}
            className="flex h-11 items-center rounded-sm bg-navy px-4 font-bold text-white md:h-10"
          >
            {t("prospek.toDeal")}
          </Link>
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
