import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { body, PageHeader, PageSkeleton, primaryButton, searchField, searchIcon } from "../PageHeader";
import { Suspense } from "react";
import { requireUser } from "@/lib/authz";
import { CONTACT_SORTS, type ContactRow } from "@/lib/contactTypes";
import { listContacts, parseContactSort } from "@/lib/contacts";
import { t } from "@/lib/copy";
import { chatDate, dayMonth } from "@/lib/format";
import { formatPhone } from "@/lib/ingest/phone";
import { kontakHref } from "@/lib/kontakHref";
import { getSalesFilter } from "@/lib/salesFilter";
import { LostToggle } from "../pipeline/LostToggle";
import { UrlSelect } from "../UrlControls";
import { ContactPanel } from "./ContactPanel";

const SORT_LABEL = {
  last_new: "kontak.sortLastNew",
  last_old: "kontak.sortLastOld",
  first_new: "kontak.sortFirstNew",
  name: "kontak.sortName",
} as const;

const PAGE = 100;

export default function Page(props: PageProps<"/kontak">) {
  return (
    <main className="w-full">
      <Suspense fallback={<PageSkeleton />}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}

async function Content({ searchParams }: { searchParams: PageProps<"/kontak">["searchParams"] }) {
  const user = await requireUser();
  const params = await searchParams;
  const q = (typeof params.q === "string" ? params.q : "").trim().slice(0, 100);
  const sort = parseContactSort(params.sort);
  const followupOnly = params.followup === "1";
  const ownerId = await getSalesFilter();
  const { rows, total, followup, hasMore } = await listContacts({ ownerId, q, sort, followupOnly, limit: params.all === "1" ? 1000 : PAGE });

  return (
    <>
      <PageHeader
        title={t("kontak.title")}
        meta={t("kontak.count", { n: total })}
        actions={
          user.role !== "marketing" ? (
            <Link href={kontakHref({ q, sort, followup: followupOnly, contact: "new" })} className={primaryButton}>
              <Plus size={15} strokeWidth={2.2} aria-hidden="true" />
              {t("kontak.new")}
            </Link>
          ) : undefined
        }
      />
      <div className={body}>

      <div className="flex flex-wrap items-center gap-2 py-3">
        <form action="/kontak" method="get" role="search" className="min-w-0 basis-full md:w-80 md:basis-auto">
          {sort !== "last_new" && <input type="hidden" name="sort" value={sort} />}
          {followupOnly && <input type="hidden" name="followup" value="1" />}
          <div className="relative">
            <Search size={15} strokeWidth={1.8} aria-hidden="true" className={searchIcon} />
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder={t("kontak.searchPlaceholder")}
              aria-label={t("kontak.searchPlaceholder")}
              className={searchField}
            />
          </div>
        </form>
        <UrlSelect
          value={sort}
          label={t("kontak.viewOptions")}
          options={CONTACT_SORTS.map((s) => ({ value: s, label: t(SORT_LABEL[s]), href: kontakHref({ q, sort: s, followup: followupOnly }) }))}
        />
        <LostToggle
          checked={followupOnly}
          label={t("kontak.needsFollowup", { n: followup })}
          hrefOn={kontakHref({ q, sort, followup: true })}
          hrefOff={kontakHref({ q, sort })}
        />
      </div>

      <div className="-mx-4 overflow-x-auto border-t border-line md:-mx-6">
        {rows.length === 0 ? (
          <p className="py-16 text-center text-slate">{q || followupOnly ? t("kontak.noResults") : t("kontak.empty")}</p>
        ) : (
          <table className="w-full min-w-[1000px] text-left">
            <thead className="text-sm text-faint">
              <tr className="border-b border-line">
                <th className="px-4 py-2.5 md:px-6 font-medium">{t("kontak.colName")}</th>
                <th className="px-3 py-2.5 font-medium">{t("kontak.colCompany")}</th>
                <th className="px-3 py-2.5 font-medium">{t("kontak.colPhone")}</th>
                <th className="px-3 py-2.5 font-medium">{t("kontak.colSource")}</th>
                <th className="px-3 py-2.5 font-medium">{t("kontak.colSales")}</th>
                <th className="px-3 py-2.5 font-medium">{t("kontak.colFirst")}</th>
                <th className="px-3 py-2.5 font-medium">{t("kontak.colLast")}</th>
                <th className="px-4 py-2.5 md:px-6 text-right font-medium">{t("kontak.colOpen")}</th>
              </tr>
            </thead>
            <tbody className="stagger">
              {rows.map((c) => (
                <Row key={c.id} c={c} href={kontakHref({ q, sort, followup: followupOnly, contact: c.id })} />
              ))}
            </tbody>
          </table>
        )}
      </div>
      {hasMore && (
        <p className="mt-4 text-center">
          <Link href={kontakHref({ q, sort, followup: followupOnly, all: true })} className="font-medium text-accent hover:text-accent-strong">
            {t("common.showRest", { n: total - rows.length })}
          </Link>
        </p>
      )}
      {typeof params.contact === "string" && (
        <ContactPanel id={params.contact} closeHref={kontakHref({ q, sort, followup: followupOnly })} />
      )}
      </div>
    </>
  );
}

function Row({ c, href }: { c: ContactRow; href: string }) {
  return (
    <tr className="border-b border-line align-top hover:bg-paper/60">
      <td className="px-4 py-2.5 md:px-6">
        <Link href={href} className="font-medium text-ink hover:underline">
          {c.full_name ?? formatPhone(c.phone_e164)}
        </Link>
        {c.job_title && <p className="text-sm text-slate">{c.job_title}</p>}
      </td>
      <td className="px-3 py-2.5">{c.company_name ?? "—"}</td>
      <td className="tabular whitespace-nowrap px-3 py-2.5">{formatPhone(c.phone_e164)}</td>
      <td className="px-3 py-2.5">{c.source_channel ? t(`sourceChannel.${c.source_channel as "meta_ctwa"}`) : "—"}</td>
      <td className="whitespace-nowrap px-3 py-2.5">{c.owner_name ?? "—"}</td>
      <td className="whitespace-nowrap px-3 py-2.5">{dayMonth(c.first_chat_at)}</td>
      <td className="whitespace-nowrap px-3 py-2.5">
        <span className="inline-block first-letter:uppercase">{chatDate(c.last_chat_at)}</span>
        {c.needs_followup && (
          <span className="ml-2 rounded-full bg-late-bg px-2 py-0.5 text-sm text-late">
            {t("kontak.overDays", { n: c.followup_days })}
          </span>
        )}
      </td>
      <td className="tabular px-4 py-2.5 md:px-6 text-right">{c.open_deals || "—"}</td>
    </tr>
  );
}
