import { t } from "@/lib/copy";
import { dayMonth, rupiahShort } from "@/lib/format";
import type { DealCard } from "@/lib/pipelineTypes";
import { Lock, MARKER, NextStepLine } from "./DealCardView";

/** List view: one row per deal. Numbers are the SQL values of each deal (no totals here). */
export function DealList({ cards }: { cards: DealCard[] }) {
  return (
    <div className="-mx-4 overflow-x-auto md:-mx-6">
      <table className="w-full min-w-[960px] text-left">
        <thead className="text-sm text-faint">
          <tr className="border-b border-line">
            <th className="px-4 py-2.5 md:px-6 font-medium">{t("pipeline.colDeal")}</th>
            <th className="px-3 py-2.5 font-medium">{t("pipeline.colStage")}</th>
            <th className="px-3 py-2.5 text-right font-medium">{t("common.value")}</th>
            <th className="px-3 py-2.5 text-right font-medium">{t("common.estimate")}</th>
            <th className="px-3 py-2.5 text-right font-medium">{t("deal.unit")}</th>
            <th className="px-3 py-2.5 font-medium">{t("common.sales")}</th>
            <th className="px-3 py-2.5 font-medium">{t("deal.closeDate")}</th>
            <th className="px-4 py-2.5 md:px-6 font-medium">{t("deal.nextStep")}</th>
          </tr>
        </thead>
        <tbody>
          {cards.map((c) => (
            <tr key={c.id} className="border-b border-line align-top hover:bg-paper">
              <td className="px-4 py-2.5 md:px-6">
                <p className="flex items-center gap-1.5 font-medium text-ink">
                  {c.name}
                  {!c.can_edit && <Lock />}
                </p>
                {c.company_name && <p className="text-sm text-slate">{c.company_name}</p>}
              </td>
              <td className="px-3 py-2.5">
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-paper px-2 py-0.5 text-sm">
                  <span className={`h-2 w-2 rounded-[3px] ${MARKER[c.stage_key]}`} aria-hidden="true" />
                  {t(`stage.${c.stage_key}`)}
                </span>
              </td>
              <td className="tabular whitespace-nowrap px-3 py-2.5 text-right font-medium">
                {rupiahShort(c.amount)}
                {!c.has_products && <span className="block text-xs font-normal text-slate">{t("pipeline.estimateOnly")}</span>}
              </td>
              <td className="tabular whitespace-nowrap px-3 py-2.5 text-right">{rupiahShort(c.weighted_amount)}</td>
              <td className="tabular px-3 py-2.5 text-right">{c.has_products ? c.screen_units : "—"}</td>
              <td className="whitespace-nowrap px-3 py-2.5">{c.owner_name}</td>
              <td className="whitespace-nowrap px-3 py-2.5">{c.expected_close_date ? dayMonth(c.expected_close_date) : "—"}</td>
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
