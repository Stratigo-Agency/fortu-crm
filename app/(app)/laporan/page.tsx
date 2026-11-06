import { Suspense } from "react";
import { requireUser } from "@/lib/authz";
import { sql } from "@/lib/db";
import { t } from "@/lib/copy";
import { dayMonth } from "@/lib/format";
import { parsePeriod } from "@/lib/reportPeriod";
import { getLeadFunnel } from "@/lib/leadFunnel";
import { getReport } from "@/lib/reports";
import { canOpenStock } from "@/lib/shell";
import { getSalesFilter } from "@/lib/salesFilter";
import { CloseChart, DoneChart, StageChart } from "./Charts";
import { FunnelSection } from "./Funnel";
import { Kpis } from "./Kpis";
import { PeriodSelect } from "./PeriodSelect";
import { body, PageHeader, PageSkeleton } from "../PageHeader";
import { AdsToCrmCard, DemoLostCard, SkuTable, SourcesTable } from "./Panels";
import { Attention, RepTable } from "./Tables";
import { WaResponseCard } from "./WaResponseCard";
import { getMyUnansweredChats, getWaResponseTimes } from "@/lib/whatsapp/responseTimes";

export default function Page({ searchParams }: { searchParams: Promise<{ periode?: string | string[] }> }) {
  return (
    <main className="w-full">
      <Suspense fallback={<PageSkeleton />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Content({ searchParams }: { searchParams: Promise<{ periode?: string | string[] }> }) {
  const user = await requireUser();
  const period = parsePeriod((await searchParams).periode);
  // A sales rep sees only their own numbers: the owner is set here, whatever the top-bar filter says.
  const isRep = user.role === "sales_rep";
  const ownerId = isRep ? user.id : await getSalesFilter();
  const [report, funnel, waRows, myUnanswered] = await Promise.all([
    getReport(ownerId, period),
    getLeadFunnel(ownerId, period),
    getWaResponseTimes(ownerId),
    getMyUnansweredChats(user.id), // the viewer's own chats only, never someone else's
  ]);
  const [who] = ownerId ? await sql<{ full_name: string }[]>`SELECT full_name FROM users WHERE id = ${ownerId}` : [];

  return (
    <>
      <PageHeader
        title={t("laporan.title")}
        meta={t("laporan.subtitle", { who: isRep ? t("laporan.yourNumbers") : (who?.full_name ?? t("nav.allReps")), date: dayMonth(report.kpis.asOf) })}
        actions={
          <PeriodSelect
            value={period}
            label={t("laporan.periodLabel")}
            options={[
              { value: "month", label: t("laporan.periodMonth") },
              { value: "quarter", label: t("laporan.periodQuarter") },
              { value: "year", label: t("laporan.periodYear") },
            ]}
          />
        }
      />
      <div className={`${body} pb-10`}>
      <FunnelSection f={funnel} period={period} />
      <Kpis k={report.kpis} />
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <DoneChart months={report.months} target={report.monthTarget} />
        <StageChart stages={report.stages} openDeals={report.kpis.openDeals} />
        <div className="md:col-span-2 xl:col-span-1"><CloseChart buckets={report.closeForecast} /></div>
      </div>
      <div className="mt-4">
        <RepTable reps={report.reps} canPick={!isRep} />
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Attention rows={report.attention.rows} total={report.attention.total} canApprove={user.role === "ceo" || user.role === "admin"} unansweredChats={myUnanswered} />
        <AdsToCrmCard ads={report.adsToCrm} />
        <div className="md:col-span-2 xl:col-span-1"><DemoLostCard demo={report.demo} reasons={report.lostReasons} /></div>
      </div>
      <div className="mt-4">
        <WaResponseCard rows={waRows} />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <SkuTable rows={report.skus} canOpenStock={canOpenStock(user)} />
        <SourcesTable rows={report.sources} />
      </div>
      </div>
    </>
  );
}
