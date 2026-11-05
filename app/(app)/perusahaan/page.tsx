import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/lib/authz";
import { listCompanies, parseCompanySort } from "@/lib/companies";
import { COMPANY_SORTS, type CompanyRow } from "@/lib/contactTypes";
import { t } from "@/lib/copy";
import { relDate, rupiahShort } from "@/lib/format";
import { perusahaanHref } from "@/lib/perusahaanHref";
import { getSalesFilter } from "@/lib/salesFilter";
import { UrlSelect } from "../UrlControls";
import { CompanyPanel } from "./CompanyPanel";

const SORT_LABEL = { name: "perusahaan.sortName", pipeline: "perusahaan.sortPipeline", won: "perusahaan.sortWon" } as const;
const PAGE = 100;

export default function Page(props: PageProps<"/perusahaan">) {
  return (
    <main className="mx-auto w-full max-w-screen-2xl px-4 py-8 md:px-8">
      <Suspense>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}

async function Content({ searchParams }: { searchParams: PageProps<"/perusahaan">["searchParams"] }) {
  await requireUser();
  const params = await searchParams;
  const q = (typeof params.q === "string" ? params.q : "").trim().slice(0, 100);
  const sort = parseCompanySort(params.sort);
  const ownerId = await getSalesFilter();
  const { rows, total, hasMore } = await listCompanies({ ownerId, q, sort, limit: PAGE });

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-3xl font-bold text-ink">{t("perusahaan.title")}</h1>
        <p className="text-slate">{t("perusahaan.count", { n: total })}</p>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <form action="/perusahaan" method="get" role="search" className="min-w-0 basis-full md:max-w-md md:flex-1 md:basis-0">
          {sort !== "name" && <input type="hidden" name="sort" value={sort} />}
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder={t("perusahaan.searchPlaceholder")}
            aria-label={t("perusahaan.searchPlaceholder")}
            className="h-11 w-full rounded-sm border border-input bg-white px-3 text-base text-ink"
          />
        </form>
        <UrlSelect
          value={sort}
          label={t("kontak.viewOptions")}
          options={COMPANY_SORTS.map((s) => ({ value: s, label: t(SORT_LABEL[s]), href: perusahaanHref({ q, sort: s }) }))}
        />
        <Link href={perusahaanHref({ q, sort, company: "new" })} className="flex h-11 items-center gap-2 rounded-sm bg-navy px-5 text-base font-bold text-white md:ml-auto">
          <span aria-hidden="true">+</span> {t("perusahaan.new")}
        </Link>
      </div>

      <div className="mt-6 overflow-x-auto rounded-lg bg-white shadow-card">
        {rows.length === 0 ? (
          <p className="p-8 text-center text-slate">{q ? t("perusahaan.noResults") : t("perusahaan.empty")}</p>
        ) : (
          <table className="w-full min-w-[1000px] text-left">
            <thead className="text-sm text-slate">
              <tr className="border-b border-line">
                <th className="px-5 py-3 font-bold">{t("perusahaan.title")}</th>
                <th className="px-3 py-3 font-bold">{t("perusahaan.colIndustry")}</th>
                <th className="px-3 py-3 font-bold">{t("perusahaan.colCity")}</th>
                <th className="px-3 py-3 font-bold">{t("perusahaan.colSales")}</th>
                <th className="px-3 py-3 text-right font-bold">{t("perusahaan.colContacts")}</th>
                <th className="px-3 py-3 text-right font-bold">{t("perusahaan.colOpen")}</th>
                <th className="px-3 py-3 text-right font-bold">{t("perusahaan.colPipeline")}</th>
                <th className="px-3 py-3 text-right font-bold">{t("perusahaan.colWon")}</th>
                <th className="px-5 py-3 font-bold">{t("perusahaan.colLast")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <Row key={c.id} c={c} href={perusahaanHref({ q, sort, company: c.id })} />
              ))}
            </tbody>
          </table>
        )}
      </div>
      {hasMore && <p className="mt-4 text-center text-sm text-slate">{t("pipeline.more", { n: total - rows.length })}</p>}
      {typeof params.company === "string" && <CompanyPanel id={params.company} closeHref={perusahaanHref({ q, sort })} />}
    </>
  );
}

function Row({ c, href }: { c: CompanyRow; href: string }) {
  return (
    <tr className="border-b border-line align-top last:border-0">
      <td className="px-5 py-3">
        <Link href={href} className="font-bold text-ink hover:underline">
          {c.name}
        </Link>
      </td>
      <td className="px-3 py-3">{c.industry ? t(`industry.${c.industry as "hotel"}`) : "—"}</td>
      <td className="px-3 py-3">{c.city ?? "—"}</td>
      <td className="whitespace-nowrap px-3 py-3">{c.owner_name ?? "—"}</td>
      <td className="tabular px-3 py-3 text-right">{c.contact_count}</td>
      <td className="tabular px-3 py-3 text-right">{c.open_deals || "—"}</td>
      <td className="tabular whitespace-nowrap px-3 py-3 text-right">{Number(c.pipeline) ? rupiahShort(c.pipeline) : "—"}</td>
      <td className="tabular whitespace-nowrap px-3 py-3 text-right">{Number(c.total_done) ? rupiahShort(c.total_done) : "—"}</td>
      <td className="whitespace-nowrap px-5 py-3">
        <span className="inline-block first-letter:uppercase">{c.last_chat_at ? relDate(c.last_chat_at) : "—"}</span>
      </td>
    </tr>
  );
}
