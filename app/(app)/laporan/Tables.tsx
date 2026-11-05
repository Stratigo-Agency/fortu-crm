import Link from "next/link";
import { setSalesFilter } from "@/app/(app)/actions";
import { t } from "@/lib/copy";
import { rupiahShort } from "@/lib/format";
import type { AttentionRow, RepRow } from "@/lib/reports";

const num = "tabular px-3 py-3 text-right";

function Chip({ n, late }: { n: number; late?: boolean }) {
  if (n === 0) return <span>0</span>;
  return <span className={`inline-block min-w-6 rounded-sm px-2 py-0.5 text-center ${late ? "bg-late-bg text-late" : "bg-paper text-ink"}`}>{n}</span>;
}

/** Kinerja sales. A name sets the sales filter (only when the viewer may pick another person). */
export function RepTable({ reps, canPick }: { reps: RepRow[]; canPick: boolean }) {
  return (
    <section className="rounded-lg bg-white p-5 shadow-card" aria-label={t("laporan.byRep")}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-ink">{t("laporan.byRep")}</h2>
      </div>
      {reps.length === 0 ? (
        <p className="mt-4 text-slate">{t("laporan.noRows")}</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[56rem] border-collapse text-base">
            <thead>
              <tr className="border-b border-line text-sm text-faint">
                <th className="px-3 py-2 text-left font-semibold">{t("laporan.colSales")}</th>
                {(["colOpen", "colPipeline", "colEstimate", "colDone", "colTarget", "colAttainment", "colUnits", "colWinRate", "colLate", "colStale"] as const).map((k) => (
                  <th key={k} className="px-3 py-2 text-right font-semibold">{t(`laporan.${k}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reps.map((r) => (
                <tr key={r.userId} className="border-b border-line last:border-0">
                  <td className="px-3 py-3 font-semibold text-ink">
                    {canPick ? (
                      <form action={setSalesFilter}>
                        <input type="hidden" name="sales" value={r.userId} />
                        <button type="submit" className="min-h-11 text-left font-semibold text-ink hover:underline desk:min-h-0">{r.name}</button>
                      </form>
                    ) : (
                      r.name
                    )}
                  </td>
                  <td className={num}>{r.openDeals}</td>
                  <td className={num}>{rupiahShort(r.openAmount)}</td>
                  <td className={num}>{rupiahShort(r.weighted)}</td>
                  <td className={num}>{rupiahShort(r.won)}</td>
                  <td className={num}>{r.target ? rupiahShort(r.target) : "—"}</td>
                  <td className={num}>{r.attainmentPct === null ? "—" : `${r.attainmentPct}%`}</td>
                  <td className={num}>{r.units}</td>
                  <td className={num}>{r.winRatePct === null ? "—" : `${r.winRatePct}%`}</td>
                  <td className={num}><Chip n={r.overdue} late /></td>
                  <td className={num}><Chip n={r.stale} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function reasonText(a: AttentionRow): string {
  switch (a.reason) {
    case "next_step_overdue":
      return t("laporan.attentionNextStep", { n: a.daysOverdue ?? 0, what: a.nextStep ?? "" });
    case "close_date_passed":
      return t("laporan.attentionClose");
    case "stale":
      return t("laporan.attentionStale", { n: a.daysStale ?? 0 });
    case "discount":
      return t("laporan.attentionDiscount");
  }
}

export function Attention({ rows, total }: { rows: AttentionRow[]; total: number }) {
  return (
    <section className="rounded-lg bg-white p-5 shadow-card" aria-label={t("laporan.attention")}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-ink">{t("laporan.attention")}</h2>
        <p className="text-sm text-slate">{t("laporan.dealsCount", { n: total })}</p>
      </div>
      {rows.length === 0 ? (
        <p className="mt-4 text-slate">{t("laporan.attentionNone")}</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {rows.map((a) => (
            <li key={a.dealId}>
              <Link href={`/deal/${a.dealId}`} className="flex min-h-11 items-start gap-3 py-3 hover:bg-paper">
                <span className={`mt-2 inline-block h-3 w-3 shrink-0 ${a.severity === 0 ? "bg-stage-3" : a.severity === 1 ? "bg-stage-3" : "bg-stage-2"}`} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-ink">{a.name}</span>
                  <span className={`block text-sm ${a.reason === "next_step_overdue" ? "text-late" : "text-slate"}`}>{reasonText(a)}</span>
                </span>
                <span className="tabular shrink-0 text-right text-slate">
                  <span className="block">{rupiahShort(a.amount)}</span>
                  <span className="block text-sm">{a.ownerName ?? "—"}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
