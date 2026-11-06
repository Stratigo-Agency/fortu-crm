import Link from "next/link";
import { setSalesFilter } from "@/app/(app)/actions";
import { ApproveDiscountButton } from "@/app/(app)/deal/ApproveDiscountButton";
import { t } from "@/lib/copy";
import { rupiahShort } from "@/lib/format";
import type { ReportPeriod } from "@/lib/reportPeriod";
import type { AttentionRow, RepRow } from "@/lib/reports";

const num = "tabular whitespace-nowrap px-3 py-3 text-right";

function Chip({ n, late }: { n: number; late?: boolean }) {
  if (n === 0) return <span>0</span>;
  return <span className={`inline-block min-w-6 rounded-full px-2 py-0.5 text-center ${late ? "bg-late-bg text-late" : "bg-paper text-ink"}`}>{n}</span>;
}

/** Kinerja sales, for the selected period. A name sets the sales filter (only when the viewer may pick another person). */
export function RepTable({ reps, canPick, period }: { reps: RepRow[]; canPick: boolean; period: ReportPeriod }) {
  const when = t(`laporan.periodNow.${period}`);
  const heads = [
    t("laporan.colOpen"), t("laporan.colPipeline"), t("laporan.colEstimate"),
    t("laporan.colDonePeriod", { when }), t("laporan.colTargetPeriod", { when }), t("laporan.colAttainment"),
    t("laporan.colUnits"), t("laporan.colWinRate"), t("laporan.colLate"), t("laporan.colStale"),
  ];
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
                {heads.map((h) => (
                  <th key={h} className="px-3 py-2 text-right font-semibold">{h}</th>
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

/** "Chat belum dibalas > 2 jam": the viewer's own WhatsApp chats waiting for a first reply (shown to them only). */
export function UnansweredChatsRow({ n, compact = false }: { n: number; compact?: boolean }) {
  return (
    <Link href="/prospek" className={`flex min-h-11 items-center gap-3 hover:bg-paper ${compact ? "-mx-3 rounded-sm px-3 py-2.5" : "py-3"}`}>
      <span className="h-2 w-2 shrink-0 rounded-full bg-late" aria-hidden="true" />
      <span className="min-w-0 flex-1 font-semibold text-ink">{t("laporan.attentionWa")}</span>
      <span className="tabular shrink-0 text-late">{t("laporan.attentionWaCount", { n })}</span>
    </Link>
  );
}

export function Attention({ rows, total, canApprove = false, unansweredChats = 0 }: { rows: AttentionRow[]; total: number; canApprove?: boolean; unansweredChats?: number }) {
  return (
    <section className="rounded-lg bg-white p-5 shadow-card" aria-label={t("laporan.attention")}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-ink">{t("laporan.attention")}</h2>
        <p className="text-sm text-slate">{t("laporan.dealsCount", { n: total })}</p>
      </div>
      {unansweredChats > 0 && (
        <div className="mt-2 border-b border-line">
          <UnansweredChatsRow n={unansweredChats} />
        </div>
      )}
      {rows.length === 0 ? (
        <p className="mt-4 text-slate">{t("laporan.attentionNone")}</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {rows.map((a) => (
            <li key={a.dealId} className="py-0">
              <Link href={`/deal/${a.dealId}`} className="flex min-h-11 items-start gap-3 py-3 hover:bg-paper">
                <span className={`mt-2 inline-block h-2 w-2 shrink-0 rounded-full ${a.reason === "next_step_overdue" ? "bg-late" : a.reason === "discount" ? "bg-violet" : "bg-amber"}`} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-ink">{a.name}</span>
                  <span className={`block text-sm ${a.reason === "next_step_overdue" ? "text-late" : "text-slate"}`}>{reasonText(a)}</span>
                </span>
                <span className="tabular shrink-0 text-right text-slate">
                  <span className="block">{rupiahShort(a.amount)}</span>
                  <span className="block text-sm">{a.ownerName ?? "—"}</span>
                </span>
              </Link>
              {canApprove && a.reason === "discount" && (
                <div className="pb-3 pl-5">
                  <ApproveDiscountButton dealId={a.dealId} dealName={a.name} fingerprint={a.linesFingerprint ?? ""} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
