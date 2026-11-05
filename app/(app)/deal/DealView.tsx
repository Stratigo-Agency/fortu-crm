import { notFound } from "next/navigation";
import { requireUser } from "@/lib/authz";
import { t } from "@/lib/copy";
import { emptyDeal, getDeal } from "@/lib/deal";
import { DealHeader } from "./DealHeader";
import { PanelFrame } from "./PanelFrame";

type Props = {
  id: string;
  variant: "panel" | "page";
};

/** Loads a deal (or a blank one for id "new") and shows it in the panel or on its own page. */
export async function DealView({ id, variant }: Props) {
  const user = await requireUser();
  const isNew = id === "new";
  const deal = isNew ? emptyDeal(user.id, user.full_name, t("deal.nextStepDefault")) : await getDeal(id, user.id);
  if (!deal) notFound();

  return (
    <PanelFrame variant={variant}>
      <DealHeader
        kind={t("deal.kind")}
        name={deal.name}
        stageKey={deal.stageKey}
        amount={deal.amount}
        weightedAmount={deal.weightedAmount}
        daysInStage={deal.daysInStage}
        isNew={isNew}
        disabled
      />
    </PanelFrame>
  );
}
