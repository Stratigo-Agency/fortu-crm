import { Suspense } from "react";
import { requireUser } from "@/lib/authz";
import { t } from "@/lib/copy";
import { PageHeader, PageSkeleton } from "../../PageHeader";
import { SettingsNav } from "../SettingsNav";
import { Forbidden, isOwner, sectionNav } from "../sections";

export default function Page() {
  return (
    <main className="w-full">
      <Suspense fallback={<PageSkeleton />}>
        <Data />
      </Suspense>
    </main>
  );
}

async function Data() {
  const user = await requireUser();
  if (!isOwner(user)) return <Forbidden title={t("pengaturan.data")} />;

  return (
    <>
      <PageHeader title={t("pengaturan.data")} />
      <div className="flex flex-col gap-4 px-4 py-5 md:px-6">
        <SettingsNav items={sectionNav(user)} />
        <section aria-labelledby="data-h" className="rounded-lg bg-white p-5 shadow-card">
          <h2 id="data-h" className="text-base font-semibold text-ink">{t("pengaturan.export")}</h2>
          <p className="mt-1 text-sm text-slate">{t("pengaturan.exportHint")}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a href="/pengaturan/ekspor/deals" download className="flex h-11 items-center rounded-full border border-line bg-white px-4 font-medium text-ink hover:bg-paper desk:h-9">{t("pengaturan.exportDeals")}</a>
            <a href="/pengaturan/ekspor/kontak" download className="flex h-11 items-center rounded-full border border-line bg-white px-4 font-medium text-ink hover:bg-paper desk:h-9">{t("pengaturan.exportContacts")}</a>
          </div>
        </section>
      </div>
    </>
  );
}
