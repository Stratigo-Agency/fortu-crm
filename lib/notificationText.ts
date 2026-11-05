import { t } from "@/lib/copy";
import { rupiahShort } from "@/lib/format";

// The words of a notification, built from the copy keys and the payload (INTEGRATIONS.md · Alerts).
// Used by the bell and by the emails, so both say the same thing.

export type AlertKind = "high_value_lead" | "stale_deal" | "won" | "sla_breach" | "next_step_overdue" | "discount_approval";

export type AlertPayload = {
  kind?: string;
  deal?: { id?: string; name?: string; amount?: number | string; stage?: string; next_step?: string | null; url?: string };
  owner?: { name?: string | null };
};

export function notificationText(kind: AlertKind, p: AlertPayload): { title: string; detail: string } {
  const deal = p.deal?.name ?? "";
  const vars = {
    deal,
    amount: p.deal?.amount === undefined ? "" : rupiahShort(p.deal.amount),
    owner: p.owner?.name ?? "",
    stage: p.deal?.stage ?? "",
    step: p.deal?.next_step ?? "",
  };
  return { title: t(`notif.kind.${kind}`, vars), detail: t(`notif.detail.${kind}`, vars).replace(/^ · | · $/g, "").trim() };
}
