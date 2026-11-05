import { ArrowRight, Inbox, KanbanSquare, BarChart3, Plus } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/lib/authz";
import { t } from "@/lib/copy";
import { rupiahShort } from "@/lib/format";
import { getHome, greetingKey } from "@/lib/home";
import type { AttentionRow } from "@/lib/reports";
import { getSalesFilter } from "@/lib/salesFilter";
import { newLeadCount } from "@/lib/shell";
import { SearchBox } from "../cari/SearchBox";

export default function Page() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-10 md:pt-24">
      <Suspense>
        <Content />
      </Suspense>
    </main>
  );
}

function reasonText(a: AttentionRow): string {
  switch (a.reason) {
    case "next_step_overdue":
      return t("laporan.attentionNextStep", { n: a.daysOverdue ?? 0, what: a.nextStep ?? "" });
    case "close_date_passed":
      return t("laporan.attentionClose");
    case "stale":
      return t("laporan.attentionStale", { n: a.daysStale ?? 0 });
    case "discount":
      return t("laporan.attentionDiscount");
  }
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-md bg-paper px-4 py-3.5">
      <p className="text-sm text-slate">{label}</p>
      <p className="tabular mt-1 text-2xl font-semibold text-ink">{value}</p>
      <p className="mt-0.5 text-sm text-faint">{sub}</p>
    </div>
  );
}

async function Content() {
  const user = await requireUser();
  // a sales rep sees their own day; everyone else follows the sales filter
  const ownerId = user.role === "sales_rep" ? user.id : await getSalesFilter();
  const [home, newLeads] = await Promise.all([getHome(ownerId), newLeadCount(user)]);
  const firstName = user.full_name.split(" ")[0];

  const chips = [
    { href: "/tambah", label: t("beranda.addLead"), Icon: Plus },
    { href: "/prospek", label: newLeads > 0 ? `${t("beranda.newLeads")} · ${newLeads}` : t("beranda.newLeads"), Icon: Inbox },
    { href: "/pipeline", label: t("nav.pipeline"), Icon: KanbanSquare },
    { href: "/laporan", label: t("nav.laporan"), Icon: BarChart3 },
  ];

  return (
    <>
      <h1 className="text-center text-3xl font-semibold text-ink md:text-4xl">
        {t(`beranda.greeting.${greetingKey()}`, { name: firstName })}
      </h1>
      <div className="mt-7">
        <SearchBox autoFocus={false} placeholder={t("beranda.searchPlaceholder")} label={t("cari.title")} />
      </div>
      <ul className="mt-4 flex flex-wrap justify-center gap-2">
        {chips.map(({ href, label, Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className="flex h-11 items-center gap-2 rounded-full border border-line bg-white px-4 text-base text-ink hover:bg-paper md:h-9"
            >
              <Icon size={15} strokeWidth={1.8} aria-hidden="true" className="text-slate" />
              {label}
            </Link>
          </li>
        ))}
      </ul>

      <div className="mt-12 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          label={t("beranda.done")}
          value={rupiahShort(home.wonThisMonth)}
          sub={home.target ? t("beranda.ofTarget", { pct: `${home.attainmentPct ?? 0}%` }) : t("beranda.noTarget")}
        />
        <Stat label={t("beranda.estimate")} value={rupiahShort(home.weightedOpen)} sub={t("beranda.openDeals", { n: home.openDeals })} />
        <Stat label={t("beranda.late")} value={String(home.overdue)} sub={t("beranda.lateHint")} />
      </div>

      <section className="mt-10" aria-label={t("beranda.attention")}>
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold text-ink">{t("beranda.attention")}</h2>
          {home.attention.total > home.attention.rows.length && (
            <Link href="/laporan" className="flex items-center gap-1 text-sm text-slate hover:text-ink">
              {t("beranda.seeAll")} <ArrowRight size={14} aria-hidden="true" />
            </Link>
          )}
        </div>
        {home.attention.rows.length === 0 ? (
          <p className="mt-3 text-slate">{t("beranda.allClear")}</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {home.attention.rows.map((a) => (
              <li key={a.dealId}>
                <Link href={`/deal/${a.dealId}`} className="-mx-3 flex min-h-11 items-center gap-3 rounded-sm px-3 py-2.5 hover:bg-paper">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${a.reason === "next_step_overdue" ? "bg-late" : "bg-stage-3"}`} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{a.name}</span>
                    <span className={`block truncate text-sm ${a.reason === "next_step_overdue" ? "text-late" : "text-slate"}`}>{reasonText(a)}</span>
                  </span>
                  <span className="tabular shrink-0 text-right text-sm text-slate">
                    <span className="block font-medium text-ink">{rupiahShort(a.amount)}</span>
                    <span className="block">{a.ownerName ?? "—"}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
