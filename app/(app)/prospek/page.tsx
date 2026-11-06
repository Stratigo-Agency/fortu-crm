import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { body, PageHeader, PageSkeleton, primaryButton, searchField, searchIcon, secondaryButton, segment, segmentGroup, Stat, StatStrip } from "../PageHeader";
import { Suspense } from "react";
import { requireUser } from "@/lib/authz";
import { t } from "@/lib/copy";
import { dayMonthTime, pageOf, relTime } from "@/lib/format";
import { formatPhone } from "@/lib/ingest/phone";
import { parseSourceGroup, SOURCE_GROUPS, type SourceGroup } from "@/lib/leadFunnel";
import { listProspects, PAGE_SIZE, parseLimit, parseTab, type ProspekRow, type ProspekTab, prospekStats } from "@/lib/prospek";
import { prospekHref } from "@/lib/prospekHref";
import { getSalesFilter, salesOptions } from "@/lib/salesFilter";
import { LeadActions } from "./LeadActions";
import { SourceFilter } from "./SourceFilter";

const COLS = "md:grid-cols-[1.2fr_2.2fr_1.5fr_0.6fr_0.9fr_0.7fr_1.4fr]";

export default function Page(props: PageProps<"/prospek">) {
  return (
    <main className="w-full">
      <Suspense fallback={<PageSkeleton />}>
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
  const sumber = parseSourceGroup(params.sumber);
  const ownerId = await getSalesFilter();

  // Only sales leads, the CEO and admins hand leads to someone else.
  const canReassign = user.role === "sales_lead" || user.role === "ceo" || user.role === "admin";
  const [{ rows, hasMore }, stats, owners] = await Promise.all([
    listProspects({ viewerId: user.id, ownerId, tab, q, limit, group: sumber }),
    prospekStats(ownerId, sumber),
    canReassign ? salesOptions() : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader
        title={t("prospek.title")}
        meta={t("prospek.summary", { n: stats.new_count })}
        actions={
          <Link href="/tambah" className={primaryButton}>
            <Plus size={15} strokeWidth={2.2} aria-hidden="true" />
            {t("prospek.quickAdd")}
          </Link>
        }
      />
      <div className={body}>
      <StatStrip>
        <Stat label={t("prospek.statToday")} value={String(stats.received_today)} />
        <Stat
          label={t("prospek.statLogDelay")}
          value={stats.median_log_delay_min === null ? "—" : t("prospek.minutes", { n: stats.median_log_delay_min })}
        />
        <Stat label={t("prospek.statNoCode")} value={String(stats.meta_without_code)} />
      </StatStrip>

      <div className="flex flex-wrap items-center gap-2 py-3">
        <nav aria-label={t("prospek.tabsLabel")} className={segmentGroup}>
          <TabLink tab="baru" current={tab} q={q} sumber={sumber} label={`${t("prospek.tabNew")} · ${stats.new_count}`} />
          <TabLink tab="dihubungi" current={tab} q={q} sumber={sumber} label={`${t("prospek.tabContacted")} · ${stats.contacted_count}`} />
          <TabLink tab="semua" current={tab} q={q} sumber={sumber} label={t("common.all")} />
        </nav>
        <SourceFilter
          value={sumber ?? ""}
          label={t("prospek.sourceFilter")}
          options={[
            { value: "", label: t("sourceGroup.total") },
            ...SOURCE_GROUPS.map((g) => ({ value: g, label: t(`sourceGroup.${g}`) })),
          ]}
          hrefs={Object.fromEntries(["", ...SOURCE_GROUPS].map((g) => [g, prospekHref({ tab, q, sumber: (g || null) as SourceGroup | null })]))}
        />
        <form action="/prospek" method="get" role="search" className="min-w-0 basis-full md:w-80 md:basis-auto">
          {tab !== "baru" && <input type="hidden" name="tab" value={tab} />}
          {sumber && <input type="hidden" name="sumber" value={sumber} />}
          <div className="relative">
            <Search size={15} strokeWidth={1.8} aria-hidden="true" className={searchIcon} />
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder={t("prospek.searchPlaceholder")}
              aria-label={t("prospek.searchPlaceholder")}
              className={searchField}
            />
          </div>
        </form>
      </div>

      <div className="-mx-4 border-t border-line md:-mx-6">
        {rows.length === 0 ? (
          <p className="py-16 text-center text-slate">{tab === "baru" && !q ? t("prospek.empty") : t("prospek.noResults")}</p>
        ) : (
          <>
            <div className={`hidden gap-x-4 px-6 py-2.5 text-sm font-medium text-faint md:grid ${COLS}`}>
              <span>{t("prospek.colContact")}</span>
              <span>{t("prospek.colMessage")}</span>
              <span>{t("prospek.colSource")}</span>
              <span>{t("prospek.colProduct")}</span>
              <span>{t("prospek.colReceived")}</span>
              <span>{t("prospek.colSales")}</span>
              <span>{t("prospek.colAction")}</span>
            </div>
            <ul className="stagger">
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
            href={prospekHref({ tab, q, sumber, limit: limit + PAGE_SIZE })}
            scroll={false}
            className={secondaryButton}
          >
            {t("prospek.loadMore")}
          </Link>
        </div>
      )}
      </div>
    </>
  );
}

function TabLink({ tab, current, q, sumber, label }: { tab: ProspekTab; current: ProspekTab; q: string; sumber: SourceGroup | null; label: string }) {
  const active = tab === current;
  return (
    <Link
      href={prospekHref({ tab, q, sumber })}
      aria-current={active ? "page" : undefined}
      className={segment(active)}
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
    <li className={`grid gap-x-4 gap-y-2 border-t border-line px-4 py-3.5 hover:bg-paper/60 md:items-start md:px-6 ${COLS}`}>
      <div className="min-w-0">
        <p className="font-medium text-ink">{row.contact_name ?? formatPhone(row.phone_e164)}</p>
        {row.contact_name && <p className="tabular text-sm text-slate">{formatPhone(row.phone_e164)}</p>}
      </div>
      <p className="line-clamp-2 min-w-0 text-ink">{row.first_message}</p>
      <SourceTrace row={row} code={code} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 md:contents">
        <span>{row.product_interest ? t(`productLine.${row.product_interest as "IFP"}`) : "—"}</span>
        <span>
          {/* "kemarin" starts a sentence-style cell: capital first letter, as in the design */}
          <span className={`inline-block first-letter:uppercase ${row.is_late ? "rounded-full bg-late-bg px-2 py-0.5 text-late" : ""}`}>
            {relTime(row.received_at)}
          </span>
          <span className="tabular block text-sm text-faint">{dayMonthTime(row.received_at)}</span>
        </span>
        <span>{row.owner_name ?? <span className="text-slate">{t("prospek.unowned")}</span>}</span>
      </div>
      <div className="flex items-center gap-2">
        {row.can_edit ? (
          <>
            <Link
              href={`/deal/new?fromLead=${row.id}`}
              className={secondaryButton}
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

/** Where a prospect came from: the source group, the exact channel, and the ad, campaign or page behind it. */
function SourceTrace({ row, code }: { row: ProspekRow; code: string | null }) {
  const detail = row.ad_name
    ? t("prospek.traceAd", { name: row.ad_name })
    : row.utm_campaign
      ? t("prospek.traceCampaign", { name: row.utm_campaign })
      : row.landing_url
        ? t("prospek.tracePage", { page: pageOf(row.landing_url) })
        : null;
  const group = t(`sourceGroup.${row.source_group}`);
  const channel = t(`sourceChannel.${row.source_channel as "meta_ctwa"}`);
  return (
    <div className="min-w-0">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium text-ink">{group}</span>
        {code && (
          <span className="rounded-md border border-line bg-paper px-1.5 py-0.5 font-mono text-xs text-slate">{code}</span>
        )}
      </p>
      {channel !== group && <p className="text-sm text-slate">{channel}</p>}
      {detail && <p className="break-words text-sm text-slate">{detail}</p>}
    </div>
  );
}
