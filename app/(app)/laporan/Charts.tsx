import { t } from "@/lib/copy";
import { monthShort, percent, rupiahShort } from "@/lib/format";
import type { StageKey } from "@/lib/pipelineTypes";
import { STAGE_DOT } from "@/lib/tones";
import type { CloseBucket, MonthBar, StageBar } from "@/lib/reports";

/** Done deal per bulan: six months, this one lighter, with the monthly target as a dashed line. Plain HTML. */
export function DoneChart({ months, target }: { months: MonthBar[]; target: string | null }) {
  const values = months.map((m) => Number(m.amount));
  const tgt = target ? Number(target) : 0;
  const max = Math.max(...values, tgt, 1);
  const last = months.length - 1;
  return (
    <section className="rounded-lg bg-white p-5 shadow-card" aria-label={t("laporan.doneByMonth")}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-ink">{t("laporan.doneByMonth")}</h2>
        <p className="text-sm text-slate">{t("laporan.currentMonth", { m: monthShort(months[last].month) })}</p>
      </div>
      <div className="relative mt-6 h-56">
        {tgt > 0 && (
          <div className="absolute inset-x-0 z-10 border-t-2 border-dashed border-ink" style={{ bottom: `${(tgt / max) * 100}%` }}>
            <span className="tabular absolute -top-6 left-0 bg-white pr-2 text-sm font-semibold text-ink">{t("laporan.targetLine", { v: rupiahShort(tgt) })}</span>
          </div>
        )}
        <ol className="absolute inset-0 flex items-end gap-3 border-b border-line">
          {months.map((m, i) => {
            const v = values[i];
            return (
              <li key={m.month} className="flex h-full flex-1 flex-col items-center justify-end">
                <span className="tabular mb-1 text-sm font-semibold text-ink">{rupiahShort(v)}</span>
                <div
                  className={`w-full max-w-14 origin-bottom animate-grow-y rounded-t-md ${i === last ? "bg-accent/35" : "bg-accent"}`}
                  style={{ height: `${(v / max) * 82}%`, minHeight: v > 0 ? 4 : 0 }}
                />
              </li>
            );
          })}
        </ol>
      </div>
      <ol className="mt-2 flex gap-1.5">
        {months.map((m) => (
          <li key={m.month} className="flex-1 text-center text-slate">
            {monthShort(m.month)}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Pipeline per tahap: the light bar is the value, the dark bar is the probability-weighted value. */
export function StageChart({ stages, openDeals }: { stages: StageBar[]; openDeals: number }) {
  const max = Math.max(...stages.map((s) => Number(s.amount)), 1);
  return (
    <section className="rounded-lg bg-white p-5 shadow-card" aria-label={t("laporan.byStage")}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-ink">{t("laporan.byStage")}</h2>
        <p className="text-sm text-slate">{t("laporan.openDeals", { n: openDeals })}</p>
      </div>
      <p className="mt-3 flex gap-4 text-sm text-slate">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-st-po/30" aria-hidden="true" />{t("laporan.legendValue")}</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-st-po" aria-hidden="true" />{t("laporan.legendForecast")}</span>
      </p>
      <ul className="mt-4 flex flex-col gap-4">
        {stages.map((s) => (
          <li key={s.key} className="grid grid-cols-[8.5rem_1fr] items-center gap-x-4">
            <div>
              <p className="font-semibold text-ink">{s.name}</p>
              <p className="text-sm text-slate">{t("laporan.stageMeta", { p: percent(s.probability).replace("%", ""), n: s.deals })}</p>
            </div>
            <div>
              <div className="relative h-3 rounded-full bg-paper" aria-hidden="true">
                <div className={`absolute inset-y-0 left-0 origin-left animate-grow-x rounded-full opacity-30 ${STAGE_DOT[s.key as StageKey] ?? "bg-stage-2"}`} style={{ width: `${(Number(s.amount) / max) * 100}%` }} />
                <div className={`absolute inset-y-0 left-0 origin-left animate-grow-x rounded-full ${STAGE_DOT[s.key as StageKey] ?? "bg-ink"}`} style={{ width: `${(Number(s.weighted) / max) * 100}%` }} />
              </div>
              <p className="tabular mt-1.5 text-sm text-slate">{t("laporan.stageAmounts", { value: rupiahShort(s.amount), forecast: rupiahShort(s.weighted) })}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Perkiraan per bulan close: the weighted value of open deals by expected close month. "Lewat" is the only orange bar. */
export function CloseChart({ buckets }: { buckets: CloseBucket[] }) {
  const values = buckets.map((b) => Number(b.weighted));
  const max = Math.max(...values, 1);
  const label = (b: CloseBucket) =>
    b.key === "past" ? t("laporan.closePassed") : b.key === "later" ? t("laporan.closeLater") : b.key === "none" ? t("laporan.closeEmpty") : monthShort(b.month as string);
  return (
    <section className="rounded-lg bg-white p-5 shadow-card" aria-label={t("laporan.byCloseMonth")}>
      <h2 className="text-base font-semibold text-ink">{t("laporan.byCloseMonth")}</h2>
      <ol className="mt-6 flex h-56 items-end gap-3 border-b border-line">
        {buckets.map((b, i) => (
          <li key={b.key} className="flex h-full flex-1 flex-col items-center justify-end" title={t("laporan.dealsCount", { n: b.deals })}>
            {values[i] > 0 && <span className="tabular mb-1 whitespace-nowrap text-center text-sm font-semibold text-ink">{rupiahShort(values[i])}</span>}
            <div
              className={`w-full max-w-14 origin-bottom animate-grow-y rounded-t-md ${b.key === "past" ? "bg-late" : b.key === "none" || b.key === "later" ? "bg-violet/40" : "bg-violet"}`}
              style={{ height: `${(values[i] / max) * 82}%`, minHeight: values[i] > 0 ? 4 : 0 }}
            />
          </li>
        ))}
      </ol>
      <ol className="mt-2 flex gap-1.5">
        {buckets.map((b) => (
          <li key={b.key} className="min-w-0 flex-1 truncate text-center text-sm text-slate" title={label(b)}>
            {label(b)}
          </li>
        ))}
      </ol>
    </section>
  );
}
