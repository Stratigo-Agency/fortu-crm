import { Suspense } from "react";
import { requireUser } from "@/lib/authz";
import { t } from "@/lib/copy";
import { monthYear } from "@/lib/format";
import { getTargets } from "@/lib/settings";
import { canOpenSettings } from "@/lib/shell";
import { UrlSelect } from "../../UrlControls";
import { PageHeader, PageSkeleton } from "../../PageHeader";
import { saveTargetsAction } from "../actions";
import { inputCls } from "../formStyles";
import { SectionForm } from "../SectionForm";
import { SettingsNav } from "../SettingsNav";
import { Forbidden, sectionNav } from "../sections";

const digits = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const fmt = (v: string | number | null) => (v === null || v === "" ? "" : digits.format(Number(v)));

export default function Page(props: PageProps<"/pengaturan/target">) {
  return (
    <main className="w-full">
      <Suspense fallback={<PageSkeleton />}>
        <Target searchParams={props.searchParams} />
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

async function Target({ searchParams }: { searchParams: PageProps<"/pengaturan/target">["searchParams"] }) {
  const user = await requireUser();
  if (!canOpenSettings(user)) return <Forbidden title={t("pengaturan.nav.target")} />;
  const params = await searchParams;
  const now = jakartaMonth();
  const options = monthOptions(now);
  const month = typeof params.bulan === "string" && options.includes(params.bulan) ? params.bulan : now;
  const targets = await getTargets(`${month}-01`);

  return (
    <>
      <PageHeader title={t("pengaturan.nav.target")} />
      <div className="flex flex-col gap-4 px-4 py-5 md:px-6">
        <SettingsNav items={sectionNav(user)} />
        <SectionForm
          id="target"
          action={saveTargetsAction}
          toolbar={
            <UrlSelect
              value={month}
              label={t("pengaturan.month")}
              options={options.map((m) => ({ value: m, label: monthYear(`${m}-01`), href: `/pengaturan/target?bulan=${m}` }))}
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
      </div>
    </>
  );
}
