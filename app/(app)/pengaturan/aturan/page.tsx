import { Suspense } from "react";
import { requireUser } from "@/lib/authz";
import { t } from "@/lib/copy";
import { getRules, getStages } from "@/lib/settings";
import { PageHeader, PageSkeleton } from "../../PageHeader";
import { saveRulesAction } from "../actions";
import { inputCls } from "../formStyles";
import { Field } from "../Field";
import { SectionForm } from "../SectionForm";
import { SettingsNav } from "../SettingsNav";
import { Forbidden, isOwner, sectionNav } from "../sections";

const digits = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const fmt = (v: string | number | null) => (v === null || v === "" ? "" : digits.format(Number(v)));

export default function Page() {
  return (
    <main className="w-full">
      <Suspense fallback={<PageSkeleton />}>
        <Rules />
      </Suspense>
    </main>
  );
}

async function Rules() {
  const user = await requireUser();
  if (!isOwner(user)) return <Forbidden title={t("pengaturan.rules")} />;
  const [rules, stages] = await Promise.all([getRules(), getStages()]);
  const open = stages.filter((s) => !s.isWon && !s.isLost);

  return (
    <>
      <PageHeader title={t("pengaturan.rules")} />
      <div className="flex flex-col gap-4 px-4 py-5 md:px-6">
        <SettingsNav items={sectionNav(user)} />
        <SectionForm id="aturan" action={saveRulesAction}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Field id="md" label={t("pengaturan.maxDiscount")} hint={t("pengaturan.maxDiscountHint")}>
              <input id="md" name="maxDiscountPct" inputMode="decimal" defaultValue={String(rules.maxDiscountPct).replace(".", ",")} className={`${inputCls} tabular`} />
            </Field>
            <Field id="fd" label={t("pengaturan.followupDays")}>
              <input id="fd" name="followupDays" inputMode="numeric" defaultValue={rules.followupDays} className={`${inputCls} tabular`} />
            </Field>
            <Field id="pu" label={t("pengaturan.projectUnits")}>
              <input id="pu" name="projectMinUnits" inputMode="numeric" defaultValue={rules.projectMinUnits} className={`${inputCls} tabular`} />
            </Field>
            <Field id="pa" label={t("pengaturan.projectAmount")}>
              <input id="pa" name="projectMinAmount" inputMode="numeric" defaultValue={fmt(rules.projectMinAmount)} className={`${inputCls} tabular`} />
            </Field>
            <Field id="hv" label={t("pengaturan.highValue")}>
              <input id="hv" name="highValueAmount" inputMode="numeric" defaultValue={fmt(rules.highValueAmount)} className={`${inputCls} tabular`} />
            </Field>
          </div>
          <h3 className="mb-2 mt-6 font-semibold text-ink">{t("pengaturan.staleDays")}</h3>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {open.map((s) => (
              <Field key={s.id} id={`st-${s.id}`} label={s.name}>
                <input id={`st-${s.id}`} name={`stale:${s.id}`} inputMode="numeric" defaultValue={s.staleDays} className={`${inputCls} tabular`} />
              </Field>
            ))}
          </div>
        </SectionForm>
      </div>
    </>
  );
}
