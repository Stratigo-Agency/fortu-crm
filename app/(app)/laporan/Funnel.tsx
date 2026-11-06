import { t } from "@/lib/copy";
import { count, decimal } from "@/lib/format";
import { FUNNEL_STEPS, type FunnelRow, type FunnelStep, type LeadFunnel } from "@/lib/leadFunnel";
import type { ReportPeriod } from "@/lib/reportPeriod";
import { STAGE_DOT } from "@/lib/tones";
import { Stat, StatStrip } from "../PageHeader";

// Lead dan funnel (Pak Jovian): how many leads came in this period, from which source, and where they stop.
// Every number is from lead_funnel() / lead_funnel_steps() (rule 5); nothing is added up here.

const dash = "—";
const pctText = (p: number | null) => (p === null ? dash : `${p}%`);

/** The count in a row for the column a step leads to. */
function passedOf(r: FunnelRow, step: FunnelStep): number {
  return step === "handled" ? r.handled : step === "deal" ? r.deals : r[step];
}

const BAR: Record<FunnelStep | "leads", string> = {
  leads: "bg-accent",
  handled: "bg-accent/60",
  deal: STAGE_DOT.chat,
  quotation: STAGE_DOT.quotation,
  negotiation: STAGE_DOT.negotiation,
  po: STAGE_DOT.po,
  done: STAGE_DOT.done,
};

/** One line under the figures: the weakest step, in orange only when it really is one. */
function Callout({ f }: { f: LeadFunnel }) {
  const { total } = f;
  if (total.status === "found" && total.bottleneck) {
    return (
      <p className="mt-4 inline-flex max-w-full rounded-lg bg-late-bg px-3 py-2 font-medium text-late">
        {t("funnel.bottleneck", { step: t(`funnel.step.${total.bottleneck.step}`), pct: `${total.bottleneck.pct}%` })}
      </p>
    );
  }
  return (
    <p className="mt-4 text-slate">
      {total.status === "none" ? t("funnel.none") : t("funnel.insufficient", { n: f.minEntering })}
    </p>
  );
}

/** Semua sumber: one bar per step, the share of leads that got that far, the conversion and the usual days. */
function Steps({ f }: { f: LeadFunnel }) {
  const leads = Math.max(f.total.leads, 1);
  const rows: { key: FunnelStep | "leads"; label: string; n: number; pct: number | null; days: number | null; weak: boolean }[] = [
    { key: "leads", label: t("funnel.col.leads"), n: f.total.leads, pct: null, days: null, weak: false },
    ...f.steps.map((s) => ({
      key: s.step,
      label: t(`funnel.col.${s.step}`),
      n: s.passed,
      pct: s.pct,
      days: s.medianDays,
      weak: s.isBottleneck,
    })),
  ];
  return (
    <section className="min-w-0 rounded-lg bg-white p-5 shadow-card" aria-label={t("funnel.stepsLabel")}>
      <h3 className="text-base font-semibold text-ink">{t("funnel.allSources")}</h3>
      <ol className="mt-3 divide-y divide-line">
        {rows.map((r) => (
          <li key={r.key} className="py-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="text-ink">{r.label}</span>
              <span className="tabular flex items-baseline gap-2">
                <span className="font-semibold text-ink">{count(r.n)}</span>
                {r.key !== "leads" && (
                  <span className={`text-sm ${r.weak ? "font-semibold text-late" : "text-faint"}`}>{pctText(r.pct)}</span>
                )}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-paper" aria-hidden="true">
              <div
                className={`h-1.5 origin-left animate-grow-x rounded-full ${BAR[r.key]}`}
                style={{ width: `${Math.min(100, (r.n / leads) * 100)}%`, minWidth: r.n > 0 ? 4 : 0 }}
              />
            </div>
            {(r.weak || r.days !== null) && (
              <p className="mt-1 text-sm text-faint">
                {r.weak && <span className="font-medium text-late">{t("funnel.weakest")}</span>}
                {r.weak && r.days !== null && " · "}
                {r.days !== null && t("funnel.typically", { n: decimal(r.days) })}
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** A count with the conversion from the step before under it; the bottleneck of the row in orange. */
function Cell({ n, pct, weak }: { n: number; pct?: number | null; weak?: boolean }) {
  return (
    <>
      <span className="block font-semibold text-ink">{count(n)}</span>
      {pct !== undefined && (
        <span className={`block text-sm ${weak ? "font-semibold text-late" : "text-faint"}`} title={weak ? t("funnel.weakest") : undefined}>
          {pctText(pct)}
        </span>
      )}
    </>
  );
}

function groupName(r: FunnelRow) {
  return t(`sourceGroup.${r.group}`);
}

/** Per sumber: rows are source groups, columns are the steps. A table on wide screens, a list on phones. */
function Groups({ f }: { f: LeadFunnel }) {
  const rows = [...f.groups, f.total];
  const weak = (r: FunnelRow, s: FunnelStep) => r.status === "found" && r.bottleneck?.step === s;
  return (
    <section className="min-w-0 rounded-lg bg-white p-5 shadow-card" aria-label={t("funnel.bySource")}>
      <h3 className="text-base font-semibold text-ink">{t("funnel.bySource")}</h3>

      <table className="mt-3 hidden w-full border-collapse text-base md:table">
        <thead>
          <tr className="border-b border-line text-sm text-faint">
            <th className="py-2 pr-2 text-left font-semibold">{t("funnel.col.group")}</th>
            <th className="px-2 py-2 text-right font-semibold">{t("funnel.col.leads")}</th>
            {FUNNEL_STEPS.map((s) => (
              <th key={s} className="px-2 py-2 text-right font-semibold">{t(`funnel.col.${s}`)}</th>
            ))}
            <th className="py-2 pl-2 text-right font-semibold">{t("funnel.col.lost")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.group} className={r.isTotal ? "border-t-2 border-line" : "border-b border-line"}>
              <th scope="row" className={`py-2.5 pr-2 text-left align-top ${r.isTotal ? "font-semibold text-ink" : "font-normal text-ink"}`}>
                {groupName(r)}
              </th>
              <td className="tabular px-2 py-2.5 text-right align-top"><Cell n={r.leads} /></td>
              {FUNNEL_STEPS.map((s) => (
                <td key={s} className="tabular px-2 py-2.5 text-right align-top">
                  <Cell n={passedOf(r, s)} pct={r.pct[s]} weak={weak(r, s)} />
                </td>
              ))}
              <td className="tabular py-2.5 pl-2 text-right align-top"><Cell n={r.lost} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="mt-2 divide-y divide-line md:hidden">
        {rows.map((r) => (
          <li key={r.group} className="py-3">
            <p className="flex items-baseline justify-between gap-3">
              <span className={r.isTotal ? "font-semibold text-ink" : "text-ink"}>{groupName(r)}</span>
              <span className="tabular text-sm text-slate">
                {t("funnel.leadsCount", { n: count(r.leads) })}
              </span>
            </p>
            <dl className="mt-2 grid grid-cols-4 gap-x-2 gap-y-2">
              {FUNNEL_STEPS.map((s) => (
                <div key={s} className="tabular min-w-0">
                  <dt className="text-sm text-faint">{t(`funnel.col.${s}`)}</dt>
                  <dd><Cell n={passedOf(r, s)} pct={r.pct[s]} weak={weak(r, s)} /></dd>
                </div>
              ))}
              <div className="tabular min-w-0">
                <dt className="text-sm text-faint">{t("funnel.col.lost")}</dt>
                <dd><Cell n={r.lost} /></dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The first section of /laporan. */
export function FunnelSection({ f, period }: { f: LeadFunnel; period: ReportPeriod }) {
  const when = t(`laporan.periodNow.${period}`);
  return (
    <section className="mt-2" aria-labelledby="funnel-title">
      <div className="flex flex-wrap items-baseline gap-x-3 pt-4">
        <h2 id="funnel-title" className="text-base font-semibold text-ink">{t("funnel.title")}</h2>
        <p className="text-sm text-faint">{t("funnel.note", { when })}</p>
      </div>
      <StatStrip>
        <Stat label={t("funnel.statLeads", { when })} value={count(f.total.leads)} />
        <Stat label={t("funnel.statUnhandled")} value={count(f.total.unhandled)} />
        <Stat
          label={t("funnel.statConversion")}
          value={pctText(f.total.pctLeadToDone)}
          hint={t("funnel.statConversionHint", { done: count(f.total.done), leads: count(f.total.leads) })}
        />
      </StatStrip>
      {f.total.leads === 0 ? (
        <p className="mt-4 text-slate">{t("funnel.noLeads", { when })}</p>
      ) : (
        <>
          <Callout f={f} />
          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <Steps f={f} />
            <Groups f={f} />
          </div>
        </>
      )}
    </section>
  );
}
