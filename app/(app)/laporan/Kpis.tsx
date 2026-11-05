import { t } from "@/lib/copy";
import { monthYear, rupiahShort } from "@/lib/format";
import type { ReportKpis } from "@/lib/reports";

function Card({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-paper px-4 py-3.5">
      <p className="text-sm text-slate">{label}</p>
      <p className="tabular mt-1 text-2xl font-semibold text-ink">{value}</p>
      {children}
    </div>
  );
}

export function Kpis({ k }: { k: ReportKpis }) {
  const pct = k.attainmentPct;
  const when = t(`laporan.periodNow.${k.period}`);
  return (
    <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
      <Card label={t("laporan.kpiDoneWhen", { when })} value={rupiahShort(k.wonInPeriod)}>
        {k.targetAmount ? (
          <>
            <div className="mt-3 h-1.5 rounded-full bg-mist" role="img" aria-label={t("laporan.kpiDoneTarget", { pct: `${pct ?? 0}%`, target: rupiahShort(k.targetAmount) })}>
              <div className="h-1.5 rounded-full bg-ink" style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
            </div>
            <p className="mt-2 text-sm text-slate">{t("laporan.kpiDoneTarget", { pct: `${pct ?? 0}%`, target: rupiahShort(k.targetAmount) })}</p>
          </>
        ) : (
          <p className="mt-2 text-sm text-faint">{t("laporan.kpiNoTarget")}</p>
        )}
      </Card>
      <Card label={t("laporan.kpiUnitsWhen", { when })} value={`${k.unitsWon} unit`}>
        <p className="mt-2 text-sm text-faint">
          {k.targetUnits
            ? t(k.period === "month" ? "laporan.kpiUnitsTarget" : "laporan.kpiUnitsTargetPeriod", { n: k.targetUnits })
            : k.targetUnitsFrom
              ? t("laporan.kpiUnitsFrom", { n: k.targetUnitsNext ?? 0, m: monthYear(k.targetUnitsFrom) })
              : t("laporan.kpiNoTarget")}
        </p>
      </Card>
      <Card label={t("laporan.kpiForecastWhen", { end: t(`laporan.periodEnd.${k.period}`) })} value={rupiahShort(k.forecastEndOfPeriod)} />
      <Card label={t("laporan.kpiRunRate")} value={rupiahShort(k.runRate.month)}>
        <p className="mt-2 text-sm text-faint">
          {k.runRate.early
            ? t("laporan.kpiRunRateEarly")
            : k.runRate.yearly
              ? t("laporan.kpiRunRateYear", { v: rupiahShort(k.runRate.yearly) })
              : t("laporan.kpiRunRateNone")}
        </p>
      </Card>
      <Card label={t("laporan.kpiPipeline")} value={rupiahShort(k.weightedOpen)}>
        <p className="mt-2 text-sm text-faint">{t("laporan.kpiPipelineOf", { total: rupiahShort(k.openAmount), n: k.openDeals })}</p>
      </Card>
      <Card label={t("laporan.kpiWinRate")} value={k.winRatePct === null ? "—" : `${k.winRatePct}%`}>
        <p className="mt-2 text-sm text-faint">
          {k.winRatePct === null
            ? t("laporan.winRateNone")
            : t("laporan.kpiWinRateHint", { won: k.won90, lost: k.lost90, days: k.avgDaysToWin ?? 0 })}
        </p>
      </Card>
    </div>
  );
}
