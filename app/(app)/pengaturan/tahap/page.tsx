import { Suspense } from "react";
import { requireUser } from "@/lib/authz";
import { t } from "@/lib/copy";
import { getStages } from "@/lib/settings";
import { PageHeader, PageSkeleton } from "../../PageHeader";
import { saveDefinitionsAction } from "../actions";
import { Field } from "../Field";
import { SectionForm } from "../SectionForm";
import { SettingsNav } from "../SettingsNav";
import { Forbidden, isOwner, sectionNav } from "../sections";

export default function Page() {
  return (
    <main className="w-full">
      <Suspense fallback={<PageSkeleton />}>
        <Definitions />
      </Suspense>
    </main>
  );
}

async function Definitions() {
  const user = await requireUser();
  if (!isOwner(user)) return <Forbidden title={t("pengaturan.nav.definisi")} />;
  const stages = await getStages();

  return (
    <>
      <PageHeader title={t("pengaturan.nav.definisi")} />
      <div className="flex flex-col gap-4 px-4 py-5 md:px-6">
        <SettingsNav items={sectionNav(user)} />
        <SectionForm id="definisi" action={saveDefinitionsAction}>
          <div className="flex flex-col gap-4">
            {stages.map((s) => (
              <Field key={s.id} id={`df-${s.id}`} label={s.name}>
                <textarea id={`df-${s.id}`} name={`def:${s.id}`} rows={2} maxLength={400} defaultValue={s.definition} className="w-full rounded-sm border border-input bg-white px-3 py-2 text-base text-ink focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15" />
              </Field>
            ))}
          </div>
        </SectionForm>
      </div>
    </>
  );
}
