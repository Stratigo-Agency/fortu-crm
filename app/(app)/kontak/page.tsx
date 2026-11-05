import Link from "next/link";
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
    <main className="mx-auto w-full max-w-screen-2xl px-4 py-8 md:px-8">
      <Suspense>
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
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-3xl font-bold text-ink">{t("kontak.title")}</h1>
        <p className="text-slate">{t("kontak.count", { n: total })}</p>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <form action="/kontak" method="get" role="search" className="min-w-0 basis-full md:max-w-md md:flex-1 md:basis-0">
          {sort !== "last_new" && <input type="hidden" name="sort" value={sort} />}
          {followupOnly && <input type="hidden" name="followup" value="1" />}
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
              placeholder={t("kontak.searchPlaceholder")}
              aria-label={t("kontak.searchPlaceholder")}
              className="h-11 w-full rounded-sm border border-input bg-white pl-10 pr-3 text-base text-ink"
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
        {user.role !== "marketing" && (
          <Link
            href={kontakHref({ q, sort, followup: followupOnly, contact: "new" })}
            className="flex h-11 items-center gap-2 rounded-sm bg-navy px-5 text-base font-bold text-white md:ml-auto"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            {t("kontak.new")}
          </Link>
        )}
      </div>

      <div className="mt-6 overflow-x-auto rounded-lg bg-white shadow-card">
        {rows.length === 0 ? (
          <p className="p-8 text-center text-slate">{q || followupOnly ? t("kontak.noResults") : t("kontak.empty")}</p>
        ) : (
          <table className="w-full min-w-[1000px] text-left">
            <thead className="text-sm text-slate">
              <tr className="border-b border-line">
                <th className="px-5 py-3 font-bold">{t("kontak.colName")}</th>
                <th className="px-3 py-3 font-bold">{t("kontak.colCompany")}</th>
                <th className="px-3 py-3 font-bold">{t("kontak.colPhone")}</th>
                <th className="px-3 py-3 font-bold">{t("kontak.colSource")}</th>
                <th className="px-3 py-3 font-bold">{t("kontak.colSales")}</th>
                <th className="px-3 py-3 font-bold">{t("kontak.colFirst")}</th>
                <th className="px-3 py-3 font-bold">{t("kontak.colLast")}</th>
                <th className="px-5 py-3 text-right font-bold">{t("kontak.colOpen")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <Row key={c.id} c={c} href={kontakHref({ q, sort, followup: followupOnly, contact: c.id })} />
              ))}
            </tbody>
          </table>
        )}
      </div>
      {hasMore && (
        <p className="mt-4 text-center">
          <Link href={kontakHref({ q, sort, followup: followupOnly, all: true })} className="font-bold text-navy underline">
            {t("common.showRest", { n: total - rows.length })}
          </Link>
        </p>
      )}
      {typeof params.contact === "string" && (
        <ContactPanel id={params.contact} closeHref={kontakHref({ q, sort, followup: followupOnly })} />
      )}
    </>
  );
}

function Row({ c, href }: { c: ContactRow; href: string }) {
  return (
    <tr className="border-b border-line align-top last:border-0">
      <td className="px-5 py-3">
        <Link href={href} className="font-bold text-ink hover:underline">
          {c.full_name ?? formatPhone(c.phone_e164)}
        </Link>
        {c.job_title && <p className="text-sm text-slate">{c.job_title}</p>}
      </td>
      <td className="px-3 py-3">{c.company_name ?? "—"}</td>
      <td className="tabular whitespace-nowrap px-3 py-3">{formatPhone(c.phone_e164)}</td>
      <td className="px-3 py-3">{c.source_channel ? t(`sourceChannel.${c.source_channel as "meta_ctwa"}`) : "—"}</td>
      <td className="whitespace-nowrap px-3 py-3">{c.owner_name ?? "—"}</td>
      <td className="whitespace-nowrap px-3 py-3">{dayMonth(c.first_chat_at)}</td>
      <td className="whitespace-nowrap px-3 py-3">
        <span className="inline-block first-letter:uppercase">{chatDate(c.last_chat_at)}</span>
        {c.needs_followup && (
          <span className="ml-2 rounded-sm bg-late-bg px-2 py-0.5 text-sm text-late">
            {t("kontak.overDays", { n: c.followup_days })}
          </span>
        )}
      </td>
      <td className="tabular px-5 py-3 text-right">{c.open_deals || "—"}</td>
    </tr>
  );
}
