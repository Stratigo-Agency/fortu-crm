import { Suspense } from "react";
import { requireUser } from "@/lib/authz";
import { sql } from "@/lib/db";
import { t } from "@/lib/copy";
import { dayMonth } from "@/lib/format";
import { getReport } from "@/lib/reports";
import { getSalesFilter } from "@/lib/salesFilter";
import { CloseChart, DoneChart, StageChart } from "./Charts";
import { Kpis } from "./Kpis";
import { AdsToCrmCard, DemoLostCard, SkuTable, SourcesTable } from "./Panels";
import { Attention, RepTable } from "./Tables";

export default function Page() {
  return (
    <main className="mx-auto w-full max-w-screen-2xl px-4 py-8 md:px-8">
      <Suspense>
        <Content />
      </Suspense>
    </main>
  );
}

async function Content() {
  const user = await requireUser();
  // A sales rep sees only their own numbers: the owner is set here, whatever the top-bar filter says.
  const isRep = user.role === "sales_rep";
  const ownerId = isRep ? user.id : await getSalesFilter();
  const report = await getReport(ownerId);
  const [who] = ownerId ? await sql<{ full_name: string }[]>`SELECT full_name FROM users WHERE id = ${ownerId}` : [];

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-3xl font-bold text-ink">{t("laporan.title")}</h1>
        <p className="text-slate">
          {t("laporan.subtitle", { who: isRep ? t("laporan.yourNumbers") : (who?.full_name ?? t("nav.allReps")), date: dayMonth(report.kpis.asOf) })}
        </p>
      </div>
      <Kpis k={report.kpis} />
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <DoneChart months={report.months} target={report.monthTarget} />
        <StageChart stages={report.stages} openDeals={report.kpis.openDeals} />
        <CloseChart buckets={report.closeForecast} />
      </div>
      <div className="mt-4">
        <RepTable reps={report.reps} canPick={!isRep} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Attention rows={report.attention.rows} total={report.attention.total} />
        <AdsToCrmCard ads={report.adsToCrm} />
        <DemoLostCard demo={report.demo} reasons={report.lostReasons} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <SkuTable rows={report.skus} />
        <SourcesTable rows={report.sources} />
      </div>
    </>
  );
}
