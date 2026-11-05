import { notFound } from "next/navigation";
import { requireUser } from "@/lib/authz";
import { t } from "@/lib/copy";
import { dealSettings, emptyDeal, getDeal, parentDeals, productOptions } from "@/lib/deal";
import { STAGE_KEYS, STAGE_RULES } from "@/lib/pipelineTypes";
import { salesOptions } from "@/lib/salesFilter";
import { DealForm } from "./DealForm";
import { PanelFrame } from "./PanelFrame";

type Props = {
  id: string;
  variant: "panel" | "page";
  /** ?stage=&missing= from a drag that a stage rule stopped; ?fromLead= from Jadikan deal */
  query?: Record<string, string | string[] | undefined>;
};

/** Loads a deal (or a blank one for id "new") and shows it in the panel or on its own page. */
export async function DealView({ id, variant, query = {} }: Props) {
  const user = await requireUser();
  const isNew = id === "new";
  const deal = isNew ? emptyDeal(user.id, user.full_name, t("deal.nextStepDefault")) : await getDeal(id, user.id);
  if (!deal) notFound();

  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const wantedStage = STAGE_KEYS.find((k) => k === one(query.stage)) ?? null;
  const missingRule = STAGE_RULES.find((r) => r === one(query.missing)) ?? null;
  const canReassign = user.role === "sales_lead" || user.role === "ceo" || user.role === "admin";

  const [products, owners, settings, parents] = await Promise.all([
    productOptions(),
    salesOptions(),
    dealSettings(),
    deal.kind === "new" ? Promise.resolve([]) : parentDeals(deal.companyName),
  ]);

  return (
    <PanelFrame variant={variant}>
      <DealForm
        // a different deal (or a fresh save) starts the form over
        key={deal.id ?? "new"}
        deal={deal}
        products={products}
        owners={owners}
        settings={settings}
        canReassign={canReassign}
        fromLeadId={null}
        wantedStage={wantedStage}
        missingRule={missingRule}
        parentOptions={parents}
      />
    </PanelFrame>
  );
}
