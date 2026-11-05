"use server";

import { revalidatePath } from "next/cache";
import { ForbiddenError, requireUser } from "@/lib/authz";
import { ContactInputError, DuplicatePhoneError, logActivity, parseContactInput, saveContact } from "@/lib/contacts";
import { t } from "@/lib/copy";
import { formatPhone } from "@/lib/ingest/phone";

export type ContactActionResult =
  | { ok: true; id: string }
  | { ok: false; field: "name" | "phone" | "email" | "date" | "type" | "form"; message: string };

function failure(err: unknown): ContactActionResult {
  if (err instanceof DuplicatePhoneError) {
    return {
      ok: false,
      field: "phone",
      message: t("deal.phoneTaken", { name: err.contactName ?? formatPhone(err.phone), rep: err.repName ?? "—" }),
    };
  }
  if (err instanceof ContactInputError) {
    const message = err.field === "phone" ? t("quickAdd.invalidPhone") : err.field === "date" ? t("kontak.invalidDate") : err.field === "email" ? t("kontak.invalidEmail") : t("errors.generic");
    return { ok: false, field: err.field, message };
  }
  if (err instanceof ForbiddenError) return { ok: false, field: "form", message: t("authz.forbidden") };
  console.error("contact action failed", err);
  return { ok: false, field: "form", message: t("errors.generic") };
}

/** Save from the contact form (create or update). A number used by another contact is refused. */
export async function saveContactAction(raw: unknown): Promise<ContactActionResult> {
  const user = await requireUser();
  try {
    const id = await saveContact(user, parseContactInput(raw));
    revalidatePath("/kontak");
    revalidatePath("/perusahaan");
    return { ok: true, id };
  } catch (err) {
    return failure(err);
  }
}

/** Catat: log an activity on a contact (it moves "Chat terakhir"). */
export async function logActivityAction(contactId: string, type: string, date: string, note: string): Promise<ContactActionResult> {
  const user = await requireUser();
  try {
    await logActivity(user, String(contactId), String(type), String(date), String(note));
    revalidatePath("/kontak");
    revalidatePath("/perusahaan");
    return { ok: true, id: contactId };
  } catch (err) {
    return failure(err);
  }
}
