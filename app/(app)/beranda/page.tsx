import { AlarmClock, ArrowRight, BarChart3, CircleCheck, Inbox, KanbanSquare, Plus, TrendingUp } from "lucide-react";
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
    // Sana's sky: a soft wash behind the greeting that fades into the white page
    <main className="w-full bg-gradient-to-b from-sky-soft via-white to-white">
      <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-10 md:pt-20">
        <Suspense fallback={<HomeSkeleton />}>
          <Content />
        </Suspense>
      </div>
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

function HomeSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col items-center gap-6">
      <div className="skeleton h-9 w-72" />
      <div className="skeleton h-14 w-full rounded-lg" />
      <div className="grid w-full grid-cols-3 gap-3">
        <div className="skeleton h-24 rounded-md" />
        <div className="skeleton h-24 rounded-md" />
        <div className="skeleton h-24 rounded-md" />
      </div>
    </div>
  );
}

const TONES = {
  good: { box: "bg-good-bg", icon: "text-good", Icon: CircleCheck },
  accent: { box: "bg-accent-soft", icon: "text-accent", Icon: TrendingUp },
  late: { box: "bg-late-bg", icon: "text-late", Icon: AlarmClock },
} as const;

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: keyof typeof TONES }) {
  const { box, icon, Icon } = TONES[tone];
  return (
    <div className={`min-w-0 rounded-md px-3 py-3 transition-transform duration-200 hover:-translate-y-0.5 sm:px-4 sm:py-3.5 ${box}`}>
      <p className="flex items-start justify-between gap-2 text-sm leading-snug text-slate">
        {label}
        <Icon size={16} strokeWidth={2} aria-hidden="true" className={`mt-0.5 shrink-0 ${icon}`} />
      </p>
      <p className="tabular mt-1 truncate text-lg font-semibold text-ink sm:text-2xl">{value}</p>
      <p className="mt-0.5 text-sm leading-snug text-faint">{sub}</p>
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
      <h1 className="animate-enter text-center text-3xl font-semibold text-ink md:text-4xl">
        {t(`beranda.greeting.${greetingKey()}`, { name: firstName })}
      </h1>
      <div className="mt-7 animate-enter [animation-delay:60ms]">
        <SearchBox autoFocus={false} placeholder={t("beranda.searchPlaceholder")} label={t("cari.title")} />
      </div>
      <ul className="stagger mt-4 flex flex-wrap justify-center gap-2">
        {chips.map(({ href, label, Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className="flex h-11 items-center gap-2 rounded-full border border-line bg-white/80 px-4 text-base text-ink shadow-card backdrop-blur transition hover:-translate-y-0.5 hover:shadow-lift desk:h-9"
            >
              <Icon size={15} strokeWidth={1.8} aria-hidden="true" className="text-accent" />
              {label}
            </Link>
          </li>
        ))}
      </ul>

      <div className="stagger mt-10 grid grid-cols-3 gap-2 sm:mt-12 sm:gap-3">
        <Stat
          label={t("beranda.done")}
          value={rupiahShort(home.wonThisMonth)}
          sub={home.target ? t("beranda.ofTarget", { pct: `${home.attainmentPct ?? 0}%` }) : t("beranda.noTarget")}
          tone="good"
        />
        <Stat label={t("beranda.estimate")} value={rupiahShort(home.weightedOpen)} sub={t("beranda.openDeals", { n: home.openDeals })} tone="accent" />
        <Stat label={t("beranda.late")} value={String(home.overdue)} sub={t("beranda.lateHint")} tone="late" />
      </div>
      <p className="mt-2 text-sm text-faint">{t("common.beforeTax")}</p>

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
          <ul className="stagger mt-2 divide-y divide-line">
            {home.attention.rows.map((a) => (
              <li key={a.dealId}>
                <Link href={`/deal/${a.dealId}`} className="-mx-3 flex min-h-11 items-center gap-3 rounded-sm px-3 py-2.5 hover:bg-paper">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${a.reason === "next_step_overdue" ? "bg-late" : a.reason === "discount" ? "bg-violet" : "bg-amber"}`} aria-hidden="true" />
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
