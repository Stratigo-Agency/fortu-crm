"use server";

import { revalidatePath } from "next/cache";
import { ForbiddenError, requireUser } from "@/lib/authz";
import { t } from "@/lib/copy";
import { InvalidInputError, LeadClosedError, markContacted, markNotFit, reassignLead } from "@/lib/leads";

export type LeadActionState = {
  /** Counts finished actions, so the dialog knows when to close. */
  seq: number;
  error?: string;
};

const text = (formData: FormData, name: string) => {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
};

/** Runs one lead change as the signed-in user and turns the failure into text for the dialog. */
async function run(
  prev: LeadActionState,
  change: (user: Awaited<ReturnType<typeof requireUser>>) => Promise<void>,
): Promise<LeadActionState> {
  const user = await requireUser();
  try {
    await change(user);
  } catch (err) {
    if (err instanceof ForbiddenError) return { seq: prev.seq, error: t("authz.forbidden") };
    if (err instanceof LeadClosedError) return { seq: prev.seq, error: t("prospek.alreadyHandled") };
    if (err instanceof InvalidInputError) return { seq: prev.seq, error: t("errors.generic") };
    console.error("lead action failed", err);
    return { seq: prev.seq, error: t("errors.generic") };
  }
  revalidatePath("/prospek");
  revalidatePath("/", "layout"); // the Prospek badge in the top bar
  return { seq: prev.seq + 1 };
}

export async function markContactedAction(prev: LeadActionState, formData: FormData) {
  return run(prev, (user) => markContacted(user, text(formData, "leadId")));
}

export async function markNotFitAction(prev: LeadActionState, formData: FormData) {
  return run(prev, (user) =>
    markNotFit(user, text(formData, "leadId"), text(formData, "reason"), text(formData, "note")),
  );
}

export async function reassignLeadAction(prev: LeadActionState, formData: FormData) {
  return run(prev, (user) => reassignLead(user, text(formData, "leadId"), text(formData, "ownerId")));
}
