import { Suspense } from "react";
import { requireUser } from "@/lib/authz";
import { t } from "@/lib/copy";
import { getStages } from "@/lib/settings";
import { PageHeader, PageSkeleton } from "../../PageHeader";
import { saveProbabilitiesAction } from "../actions";
import { inputCls } from "../formStyles";
import { Field } from "../Field";
import { SectionForm } from "../SectionForm";
import { SettingsNav } from "../SettingsNav";
import { Forbidden, isOwner, sectionNav } from "../sections";

export default function Page() {
  return (
    <main className="w-full">
      <Suspense fallback={<PageSkeleton />}>
        <Probabilities />
      </Suspense>
    </main>
  );
}

async function Probabilities() {
  const user = await requireUser();
  if (!isOwner(user)) return <Forbidden title={t("pengaturan.nav.peluang")} />;
  const open = (await getStages()).filter((s) => !s.isWon && !s.isLost);

  return (
    <>
      <PageHeader title={t("pengaturan.nav.peluang")} />
      <div className="flex flex-col gap-4 px-4 py-5 md:px-6">
        <SettingsNav items={sectionNav(user)} />
        <SectionForm id="peluang" hint={t("pengaturan.probabilitiesHint")} action={saveProbabilitiesAction}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {open.map((s) => (
              <Field key={s.id} id={`pr-${s.id}`} label={s.name}>
                <input id={`pr-${s.id}`} name={`prob:${s.id}`} inputMode="numeric" defaultValue={s.probabilityPct} className={`${inputCls} tabular`} />
              </Field>
            ))}
          </div>
        </SectionForm>
      </div>
    </>
  );
}
