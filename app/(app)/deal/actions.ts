"use server";

import { revalidatePath } from "next/cache";
import { ForbiddenError, requireUser } from "@/lib/authz";
import { t } from "@/lib/copy";
import { type ContactMatch, contactByPhone, parentDeals, searchCompanies } from "@/lib/deal";
import { approveDiscount } from "@/lib/discount";
import { DealInputError, parseDealInput, saveDeal } from "@/lib/dealSave";
import { LeadClosedError } from "@/lib/leads";
import type { StageRule } from "@/lib/pipelineTypes";

export type SaveActionResult =
  | { ok: true; id: string }
  | { ok: false; rule: StageRule }
  | { ok: false; field: "name" | "phone" | "parent" | "lines" | "date" | "owner" | "form"; message: string };

/** Save from the deal form. The amount is never read from the form: the database computes it. */
export async function saveDealAction(raw: unknown): Promise<SaveActionResult> {
  const user = await requireUser();
  try {
    const result = await saveDeal(user, parseDealInput(raw));
    if (!result.ok) return result;
    revalidatePath("/pipeline");
    revalidatePath(`/deal/${result.id}`);
    revalidatePath("/prospek");
    revalidatePath("/", "layout"); // the Prospek badge
    return result;
  } catch (err) {
    if (err instanceof DealInputError) return { ok: false, field: err.field, message: t(err.messageKey) };
    if (err instanceof ForbiddenError) return { ok: false, field: "form", message: t("authz.forbidden") };
    if (err instanceof LeadClosedError) return { ok: false, field: "form", message: t("prospek.alreadyHandled") };
    console.error("save deal failed", err);
    return { ok: false, field: "form", message: t("deal.saveFailed") };
  }
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

export async function lookupCompanies(q: string): Promise<string[]> {
  await requireUser();
  return searchCompanies(text(q, 100));
}

export async function lookupContact(phone: string): Promise<ContactMatch | null> {
  await requireUser();
  return contactByPhone(text(phone, 40));
}

export async function lookupParents(companyName: string): Promise<{ id: string; name: string }[]> {
  await requireUser();
  return parentDeals(text(companyName, 200));
}

export type ApproveResult = { ok: true } | { ok: false; message: string; changed?: boolean };

/** The CEO or an admin approves the discount on a deal (Deal panel and Laporan · Perlu perhatian). */
export async function approveDiscountAction(dealId: string, seenFingerprint: string): Promise<ApproveResult> {
  const user = await requireUser();
  try {
    const r = await approveDiscount(user, text(dealId, 40), text(seenFingerprint, 64));
    if (r === "changed") return { ok: false, changed: true, message: t("deal.approveChanged") };
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, message: t("deal.approveForbidden") };
    console.error("approve discount failed", err);
    return { ok: false, message: t("deal.approveFailed") };
  }
  revalidatePath("/pipeline");
  revalidatePath(`/deal/${dealId}`);
  revalidatePath("/laporan");
  revalidatePath("/beranda");
  return { ok: true };
}
