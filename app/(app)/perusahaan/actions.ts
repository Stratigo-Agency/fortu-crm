"use server";

import { revalidatePath } from "next/cache";
import { ForbiddenError, requireUser } from "@/lib/authz";
import { CompanyInputError, DuplicateCompanyError, parseCompanyInput, saveCompany } from "@/lib/companies";
import { t } from "@/lib/copy";

export type CompanyActionResult = { ok: true; id: string } | { ok: false; field: "name" | "industry" | "form"; message: string };

/** Save from the company form. A name that already exists (any letter case) is refused. */
export async function saveCompanyAction(raw: unknown): Promise<CompanyActionResult> {
  const user = await requireUser();
  try {
    const id = await saveCompany(user, parseCompanyInput(raw));
    revalidatePath("/perusahaan");
    revalidatePath("/kontak");
    return { ok: true, id };
  } catch (err) {
    if (err instanceof DuplicateCompanyError) return { ok: false, field: "name", message: t("perusahaan.nameTaken") };
    if (err instanceof CompanyInputError) return { ok: false, field: err.field, message: err.field === "name" ? t("deal.nameRequired") : t("errors.generic") };
    if (err instanceof ForbiddenError) return { ok: false, field: "form", message: t("authz.forbidden") };
    console.error("company save failed", err);
    return { ok: false, field: "form", message: t("errors.generic") };
  }
}
