import { notFound } from "next/navigation";
import { requireUser } from "@/lib/authz";
import { t } from "@/lib/copy";
import { dealSettings, emptyDeal, getDeal, parentDeals, productOptions } from "@/lib/deal";
import { leadPrefill } from "@/lib/dealLead";
import { ForbiddenError } from "@/lib/authz";
import { LeadClosedError } from "@/lib/leads";
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
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  // Jadikan deal: /deal/new?fromLead=<id> starts from the prospect
  const fromLeadId = isNew ? (one(query.fromLead) ?? null) : null;
  let deal = null;
  if (fromLeadId) {
    try {
      deal = await leadPrefill(user, fromLeadId, {
        nextStep: t("deal.nextStepDefault"),
        productLabel: (line) => t(`productLine.${line as "IFP"}`),
      });
    } catch (err) {
      if (!(err instanceof ForbiddenError || err instanceof LeadClosedError)) throw err;
      notFound(); // not yours, gone, or already a deal
    }
  } else {
    deal = isNew ? emptyDeal(user.id, user.full_name, t("deal.nextStepDefault")) : await getDeal(id, user.id);
  }
  if (!deal) notFound();

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
        key={deal.id ?? `new-${fromLeadId ?? ""}`}
        deal={deal}
        products={products}
        owners={owners}
        settings={settings}
        canReassign={canReassign}
        fromLeadId={fromLeadId}
        wantedStage={wantedStage}
        missingRule={missingRule}
        parentOptions={parents}
      />
    </PanelFrame>
  );
}
