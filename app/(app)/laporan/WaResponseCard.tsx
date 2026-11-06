import { t } from "@/lib/copy";
import { count, decimal } from "@/lib/format";
import type { WaResponseRow } from "@/lib/whatsapp/responseTimes";

const th = "px-2 py-2 text-right font-semibold";
const td = "tabular px-2 py-3 text-right";
const dash = "—";
const pct = (n: number | null) => (n === null ? dash : `${n}%`);

/** Kecepatan balas chat: per rep, from WhatsApp lines connected to the CRM (v_wa_response_times, 30 days). */
export function WaResponseCard({ rows }: { rows: WaResponseRow[] }) {
  return (
    <section className="min-w-0 rounded-lg bg-white p-5 shadow-card" aria-label={t("laporan.waTitle")}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-ink">{t("laporan.waTitle")}</h2>
        <p className="text-sm text-slate">{t("laporan.waPeriod")}</p>
      </div>
      {rows.length === 0 ? (
        <p className="mt-4 text-slate">{t("laporan.waEmpty")}</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[30rem] border-collapse text-base">
            <thead>
              <tr className="border-b border-line text-sm text-faint">
                <th className="px-2 py-2 text-left font-semibold">{t("laporan.colSales")}</th>
                <th className={th}>{t("laporan.waColChats")}</th>
                <th className={th}>{t("laporan.waMedian")}</th>
                <th className={th}>{t("laporan.waWithin15")}</th>
                <th className={th}>{t("laporan.waWithin1h")}</th>
                <th className={th}>{t("laporan.waUnanswered")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.userId} className="border-b border-line last:border-0">
                  <td className="px-2 py-3 font-semibold text-ink">{r.name}</td>
                  <td className={td}>{count(r.leads)}</td>
                  <td className={td}>{r.medianMin === null ? dash : t("laporan.waMinutes", { n: decimal(r.medianMin) })}</td>
                  <td className={td}>{pct(r.pct15)}</td>
                  <td className={td}>{pct(r.pct60)}</td>
                  <td className={td}>
                    {r.unanswered2h > 0 ? (
                      <span className="inline-block min-w-6 rounded-full bg-late-bg px-2 py-0.5 text-center text-late">{r.unanswered2h}</span>
                    ) : (
                      "0"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
