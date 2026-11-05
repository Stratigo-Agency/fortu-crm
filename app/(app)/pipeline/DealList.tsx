import { t } from "@/lib/copy";
import { dayMonth, rupiahShort } from "@/lib/format";
import type { DealCard } from "@/lib/pipelineTypes";
import { Lock, MARKER, NextStepLine } from "./DealCardView";

/** List view: one row per deal. Numbers are the SQL values of each deal (no totals here). */
export function DealList({ cards }: { cards: DealCard[] }) {
  return (
    <div className="mt-6 overflow-x-auto rounded-lg bg-white shadow-card">
      <table className="w-full min-w-[960px] text-left">
        <thead className="text-sm text-slate">
          <tr className="border-b border-line">
            <th className="px-5 py-3 font-bold">{t("pipeline.colDeal")}</th>
            <th className="px-3 py-3 font-bold">{t("pipeline.colStage")}</th>
            <th className="px-3 py-3 text-right font-bold">{t("common.value")}</th>
            <th className="px-3 py-3 text-right font-bold">{t("common.estimate")}</th>
            <th className="px-3 py-3 text-right font-bold">{t("deal.unit")}</th>
            <th className="px-3 py-3 font-bold">{t("common.sales")}</th>
            <th className="px-3 py-3 font-bold">{t("deal.closeDate")}</th>
            <th className="px-5 py-3 font-bold">{t("deal.nextStep")}</th>
          </tr>
        </thead>
        <tbody>
          {cards.map((c) => (
            <tr key={c.id} className="border-b border-line last:border-0 align-top">
              <td className="px-5 py-3">
                <p className="flex items-center gap-1.5 font-bold text-ink">
                  {c.name}
                  {!c.can_edit && <Lock />}
                </p>
                {c.company_name && <p className="text-sm text-slate">{c.company_name}</p>}
              </td>
              <td className="px-3 py-3">
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm bg-paper px-2 py-0.5 text-sm">
                  <span className={`h-2.5 w-2.5 ${MARKER[c.stage_key]}`} aria-hidden="true" />
                  {t(`stage.${c.stage_key}`)}
                </span>
              </td>
              <td className="tabular whitespace-nowrap px-3 py-3 text-right font-bold">
                {rupiahShort(c.amount)}
                {!c.has_products && <span className="block text-xs font-normal text-slate">{t("pipeline.estimateOnly")}</span>}
              </td>
              <td className="tabular whitespace-nowrap px-3 py-3 text-right">{rupiahShort(c.weighted_amount)}</td>
              <td className="tabular px-3 py-3 text-right">{c.has_products ? c.screen_units : "—"}</td>
              <td className="whitespace-nowrap px-3 py-3">{c.owner_name}</td>
              <td className="whitespace-nowrap px-3 py-3">{c.expected_close_date ? dayMonth(c.expected_close_date) : "—"}</td>
              <td className={`px-5 py-3 text-sm ${c.next_step_overdue ? "text-late" : "text-ink"}`}>
                <NextStepLine card={c} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
