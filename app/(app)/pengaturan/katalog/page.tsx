import { Suspense } from "react";
import { requireUser } from "@/lib/authz";
import { t } from "@/lib/copy";
import { getCatalog } from "@/lib/settings";
import { PageHeader, PageSkeleton } from "../../PageHeader";
import { saveCatalogAction } from "../actions";
import { inputCls } from "../formStyles";
import { SectionForm } from "../SectionForm";
import { SettingsNav } from "../SettingsNav";
import { Forbidden, isOwner, sectionNav } from "../sections";

const digits = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const fmt = (v: string | number | null) => (v === null || v === "" ? "" : digits.format(Number(v)));
const th = "px-3 py-2 text-left text-sm font-medium text-faint";

export default function Page() {
  return (
    <main className="w-full">
      <Suspense fallback={<PageSkeleton />}>
        <Catalog />
      </Suspense>
    </main>
  );
}

async function Catalog() {
  const user = await requireUser();
  if (!isOwner(user)) return <Forbidden title={t("pengaturan.nav.katalog")} />;
  const catalog = await getCatalog();

  return (
    <>
      <PageHeader title={t("pengaturan.nav.katalog")} />
      <div className="flex flex-col gap-4 px-4 py-5 md:px-6">
        <SettingsNav items={sectionNav(user)} />
        <SectionForm id="katalog" hint={t("pengaturan.msrp")} action={saveCatalogAction}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-base">
              <thead>
                <tr className="border-b border-line">
                  <th className={th}>{t("pengaturan.colProduct")}</th>
                  <th className={th}>{t("pengaturan.msrp")}</th>
                  <th className={th}>{t("pengaturan.maxDiscountItem")}</th>
                </tr>
              </thead>
              <tbody>
                {catalog.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2">
                      <span className="mr-2 rounded-sm bg-paper px-2 py-0.5 font-mono text-sm text-slate">{p.sku}</span>
                      {p.name}
                    </td>
                    <td className="px-3 py-2"><input name={`price:${p.id}`} inputMode="numeric" defaultValue={fmt(p.listPrice)} aria-label={`${t("pengaturan.msrp")} ${p.sku}`} className={`${inputCls} tabular text-right`} /></td>
                    <td className="px-3 py-2">
                      <input name={`disc:${p.id}`} inputMode="decimal" defaultValue={p.maxDiscountPct ? p.maxDiscountPct.replace(".", ",").replace(/,00$/, "") : ""} placeholder={t("pengaturan.defaultLimit")} aria-label={`${t("pengaturan.maxDiscountItem")} ${p.sku}`} className={`${inputCls} tabular text-right`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionForm>
      </div>
    </>
  );
}
