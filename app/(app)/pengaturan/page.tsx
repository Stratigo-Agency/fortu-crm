import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/lib/authz";
import { t } from "@/lib/copy";
import { monthYear } from "@/lib/format";
import { canOpenSettings } from "@/lib/shell";
import { getTargets } from "@/lib/settings";
import { saveTargetsAction } from "./actions";
import { UrlSelect } from "../UrlControls";
import { OwnerSections } from "./OwnerSections";
import { inputCls } from "./formStyles";
import { SectionForm } from "./SectionForm";
import { PageHeader, PageSkeleton, secondaryButton } from "../PageHeader";

const digits = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const fmt = (v: string | number | null) => (v === null || v === "" ? "" : digits.format(Number(v)));

export default function Page(props: PageProps<"/pengaturan">) {
  return (
    <main className="w-full">
      <Suspense fallback={<PageSkeleton />}>
        <Settings searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}

function jakartaMonth(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date()).slice(0, 7);
}

function monthOptions(from: string): string[] {
  const [y, m] = from.split("-").map(Number);
  return Array.from({ length: 15 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

async function Settings({ searchParams }: { searchParams: PageProps<"/pengaturan">["searchParams"] }) {
  const user = await requireUser();
  if (!canOpenSettings(user)) {
    return (
      <>
        <PageHeader title={t("pengaturan.title")} />
        <p role="alert" className="px-4 py-10 text-slate md:px-6">{t("authz.settingsOnly")}</p>
      </>
    );
  }
  const owner = user.role === "admin" || user.role === "ceo";
  const params = await searchParams;
  const now = jakartaMonth();
  const options = monthOptions(now);
  const month = typeof params.bulan === "string" && options.includes(params.bulan) ? params.bulan : now;
  const targets = await getTargets(`${month}-01`);

  return (
    <>
      <PageHeader
        title={t("pengaturan.title")}
        actions={owner ? <Link href="/pengaturan/iklan" className={secondaryButton}>{t("iklan.linkFromSettings")}</Link> : undefined}
      />
      <div className="flex flex-col gap-4 px-4 py-5 md:px-6">
        {owner && (
          <nav aria-label={t("pengaturan.title")} className="sticky top-0 z-20 -mx-4 flex gap-1 overflow-x-auto border-b border-line bg-white/90 px-4 py-2 backdrop-blur md:-mx-6 md:px-6">
            {(["target", "aturan", "peluang", "definisi", "tim", "katalog", "data"] as const).map((id) => (
              <a key={id} href={`#${id}`} className="flex h-11 shrink-0 items-center rounded-full px-3.5 text-base text-slate transition hover:bg-accent-soft hover:text-accent-strong desk:h-9">
                {t(`pengaturan.nav.${id}`)}
              </a>
            ))}
          </nav>
        )}
        <SectionForm
          id="target"
          title={t("pengaturan.targets")}
          action={saveTargetsAction}
          toolbar={
            <UrlSelect
              value={month}
              label={t("pengaturan.month")}
              options={options.map((m) => ({ value: m, label: monthYear(`${m}-01`), href: `/pengaturan?bulan=${m}` }))}
            />
          }
        >
          <input type="hidden" name="month" value={month} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-base">
              <thead>
                <tr className="border-b border-line text-left text-sm text-faint">
                  <th className="py-2 pr-3 font-medium">{t("pengaturan.colName")}</th>
                  <th className="px-3 py-2 font-medium">{t("pengaturan.colAmount")}</th>
                  <th className="px-3 py-2 font-medium">{t("pengaturan.colUnits")}</th>
                </tr>
              </thead>
              <tbody>
                {targets.map((r) => {
                  const key = r.userId ?? "company";
                  return (
                    <tr key={key} className="border-b border-line last:border-0">
                      <th scope="row" className="py-2 pr-3 text-left font-medium text-ink">{r.userId ? r.name : t("pengaturan.company")}</th>
                      <td className="px-3 py-2">
                        <input name={`amount:${key}`} inputMode="numeric" defaultValue={fmt(r.amount)} aria-label={`${t("pengaturan.colAmount")} ${r.userId ? r.name : t("pengaturan.company")}`} className={`${inputCls} tabular text-right`} />
                      </td>
                      <td className="px-3 py-2">
                        <input name={`units:${key}`} inputMode="numeric" defaultValue={fmt(r.units)} aria-label={`${t("pengaturan.colUnits")} ${r.userId ? r.name : t("pengaturan.company")}`} className={`${inputCls} tabular text-right`} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionForm>

        {owner && <OwnerSections />}
      </div>
    </>
  );
}
