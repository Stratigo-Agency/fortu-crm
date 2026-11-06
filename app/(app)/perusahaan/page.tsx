import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { body, PageHeader, PageSkeleton, primaryButton, searchField, searchIcon } from "../PageHeader";
import { Suspense } from "react";
import { requireUser } from "@/lib/authz";
import { listCompanies, parseCompanySort } from "@/lib/companies";
import { COMPANY_SORTS, type CompanyRow } from "@/lib/contactTypes";
import { t } from "@/lib/copy";
import { chatDate, rupiahShort } from "@/lib/format";
import { industryLabel } from "@/lib/industry";
import { perusahaanHref } from "@/lib/perusahaanHref";
import { getSalesFilter } from "@/lib/salesFilter";
import { UrlSelect } from "../UrlControls";
import { CompanyPanel } from "./CompanyPanel";

const SORT_LABEL = { name: "perusahaan.sortName", pipeline: "perusahaan.sortPipeline", won: "perusahaan.sortWon" } as const;
const PAGE = 100;

export default function Page(props: PageProps<"/perusahaan">) {
  return (
    <main className="w-full">
      <Suspense fallback={<PageSkeleton />}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}

async function Content({ searchParams }: { searchParams: PageProps<"/perusahaan">["searchParams"] }) {
  const user = await requireUser();
  const params = await searchParams;
  const q = (typeof params.q === "string" ? params.q : "").trim().slice(0, 100);
  const sort = parseCompanySort(params.sort);
  const ownerId = await getSalesFilter();
  const { rows, total, hasMore } = await listCompanies({ ownerId, q, sort, limit: params.all === "1" ? 1000 : PAGE });

  return (
    <>
      <PageHeader
        title={t("perusahaan.title")}
        meta={t("perusahaan.count", { n: total })}
        actions={
          user.role !== "marketing" ? (
            <Link href={perusahaanHref({ q, sort, company: "new" })} className={primaryButton}>
              <Plus size={15} strokeWidth={2.2} aria-hidden="true" />
              {t("perusahaan.new")}
            </Link>
          ) : undefined
        }
      />
      <div className={body}>

      <div className="flex flex-wrap items-center gap-2 py-3">
        <form action="/perusahaan" method="get" role="search" className="min-w-0 basis-full md:w-80 md:basis-auto">
          {sort !== "name" && <input type="hidden" name="sort" value={sort} />}
          <div className="relative">
            <Search size={15} strokeWidth={1.8} aria-hidden="true" className={searchIcon} />
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder={t("perusahaan.searchPlaceholder")}
              aria-label={t("perusahaan.searchPlaceholder")}
              className={searchField}
            />
          </div>
        </form>
        <UrlSelect
          value={sort}
          label={t("kontak.viewOptions")}
          options={COMPANY_SORTS.map((s) => ({ value: s, label: t(SORT_LABEL[s]), href: perusahaanHref({ q, sort: s }) }))}
        />
      </div>

      <div className="-mx-4 overflow-x-auto border-t border-line md:-mx-6">
        {rows.length === 0 ? (
          <p className="py-16 text-center text-slate">{q ? t("perusahaan.noResults") : t("perusahaan.empty")}</p>
        ) : (
          <table className="w-full min-w-[1000px] text-left">
            <thead className="text-sm text-faint">
              <tr className="border-b border-line">
                <th className="px-4 py-2.5 md:px-6 font-medium">{t("perusahaan.title")}</th>
                <th className="px-3 py-2.5 font-medium">{t("perusahaan.colIndustry")}</th>
                <th className="px-3 py-2.5 font-medium">{t("perusahaan.colCity")}</th>
                <th className="px-3 py-2.5 font-medium">{t("perusahaan.colSales")}</th>
                <th className="px-3 py-2.5 text-right font-medium">{t("perusahaan.colContacts")}</th>
                <th className="px-3 py-2.5 text-right font-medium">{t("perusahaan.colOpen")}</th>
                <th className="px-3 py-2.5 text-right font-medium">{t("perusahaan.colPipeline")}</th>
                <th className="px-3 py-2.5 text-right font-medium">{t("perusahaan.colWon")}</th>
                <th className="px-4 py-2.5 md:px-6 font-medium">{t("perusahaan.colLast")}</th>
              </tr>
            </thead>
            <tbody className="stagger">
              {rows.map((c) => (
                <Row key={c.id} c={c} href={perusahaanHref({ q, sort, company: c.id })} />
              ))}
            </tbody>
          </table>
        )}
      </div>
      {hasMore && (
        <p className="mt-4 text-center">
          <Link href={perusahaanHref({ q, sort, all: true })} className="font-medium text-accent hover:text-accent-strong">
            {t("common.showRest", { n: total - rows.length })}
          </Link>
        </p>
      )}
      {typeof params.company === "string" && <CompanyPanel id={params.company} closeHref={perusahaanHref({ q, sort })} />}
      </div>
    </>
  );
}

function Row({ c, href }: { c: CompanyRow; href: string }) {
  return (
    <tr className="border-b border-line align-top hover:bg-paper/60">
      <td className="px-4 py-2.5 md:px-6">
        <Link href={href} className="font-medium text-ink hover:underline">
          {c.name}
        </Link>
      </td>
      <td className="px-3 py-2.5">{industryLabel(c.industry)}</td>
      <td className="px-3 py-2.5">{c.city ?? "—"}</td>
      <td className="whitespace-nowrap px-3 py-2.5">{c.owner_name ?? "—"}</td>
      <td className="tabular px-3 py-2.5 text-right">{c.contact_count}</td>
      <td className="tabular px-3 py-2.5 text-right">{c.open_deals || "—"}</td>
      <td className="tabular whitespace-nowrap px-3 py-2.5 text-right">{Number(c.pipeline) ? rupiahShort(c.pipeline) : "—"}</td>
      <td className="tabular whitespace-nowrap px-3 py-2.5 text-right">{Number(c.total_done) ? rupiahShort(c.total_done) : "—"}</td>
      <td className="whitespace-nowrap px-5 py-3">
        <span className="inline-block first-letter:uppercase">{c.last_chat_at ? chatDate(c.last_chat_at) : "—"}</span>
      </td>
    </tr>
  );
}
