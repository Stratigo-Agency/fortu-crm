"use server";

import { revalidatePath } from "next/cache";
import { ForbiddenError, requireUser } from "@/lib/authz";
import { t } from "@/lib/copy";
import { moveDeal, type Restore, UnknownStageError } from "@/lib/pipeline";
import type { MoveResult } from "@/lib/pipelineTypes";

export type MoveActionResult = MoveResult | { ok: false; error: string };

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

/** Drop on the board (or the stage select on phones): moves the deal as the signed-in user. */
export async function moveDealAction(dealId: string, toKey: string, restore?: Restore): Promise<MoveActionResult> {
  const user = await requireUser();
  const id = str(dealId);
  const to = str(toKey);
  if (!id || !to) return { ok: false, error: t("errors.generic") };
  try {
    const r = await moveDeal(user, id, to, {
      nextStep: str(restore?.nextStep) ?? null,
      nextStepDate: str(restore?.nextStepDate) ?? null,
    });
    if (r.ok) revalidatePath("/pipeline");
    return r;
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: t("authz.forbidden") };
    if (!(err instanceof UnknownStageError)) console.error("move deal failed", err);
    return { ok: false, error: t("errors.generic") };
  }
}
