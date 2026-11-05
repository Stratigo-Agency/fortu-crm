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

const digits = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const fmt = (v: string | number | null) => (v === null || v === "" ? "" : digits.format(Number(v)));

export default function Page(props: PageProps<"/pengaturan">) {
  return (
    <main className="mx-auto w-full max-w-screen-2xl px-4 py-8 md:px-8">
      <Suspense>
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
        <h1 className="text-3xl font-bold text-ink">{t("pengaturan.title")}</h1>
        <p role="alert" className="mt-6 rounded-lg bg-white p-6 text-slate shadow-card">{t("authz.settingsOnly")}</p>
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
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-3xl font-bold text-ink">{t("pengaturan.title")}</h1>
        {owner && <Link href="/pengaturan/iklan" className="font-bold text-navy underline">{t("iklan.linkFromSettings")}</Link>}
      </div>
      <div className="mt-6 flex flex-col gap-4">
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
                <tr className="border-b border-line text-left text-sm text-slate">
                  <th className="py-2 pr-3 font-bold">{t("pengaturan.colName")}</th>
                  <th className="px-3 py-2 font-bold">{t("pengaturan.colAmount")}</th>
                  <th className="px-3 py-2 font-bold">{t("pengaturan.colUnits")}</th>
                </tr>
              </thead>
              <tbody>
                {targets.map((r) => {
                  const key = r.userId ?? "company";
                  return (
                    <tr key={key} className="border-b border-line last:border-0">
                      <th scope="row" className="py-2 pr-3 text-left font-bold text-ink">{r.userId ? r.name : t("pengaturan.company")}</th>
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
