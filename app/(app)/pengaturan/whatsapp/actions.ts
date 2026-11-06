"use server";

import { revalidatePath } from "next/cache";
import type { Role } from "@/lib/auth";
import { ForbiddenError, requireUser } from "@/lib/authz";
import { t } from "@/lib/copy";
import { sql } from "@/lib/db";
import { GraphError } from "@/lib/whatsapp/graph";
import { revokeConsent, saveLineText } from "@/lib/whatsapp/lines";
import { connectLine, type ConnectInput, WhatsAppSetupError } from "@/lib/whatsapp/onboard";
import { runSave, type SaveResult } from "../run";

/** Keep or stop keeping message text for a line. */
export async function saveLineTextAction(_prev: SaveResult, form: FormData) {
  return runSave(form, (u, f) => saveLineText(u, f));
}

/** The rep withdrew consent. */
export async function revokeConsentAction(_prev: SaveResult, form: FormData) {
  return runSave(form, async (u, f) => {
    await revokeConsent(u, f);
    return t("whatsapp.revoked");
  });
}

export type ConnectResult = { ok: boolean; message: string };

/**
 * After Embedded Signup: the browser sends the short-lived code and the ids from Meta's signup event; the token
 * exchange and everything after it run here. Only a message goes back, never a token.
 */
export async function connectWhatsAppAction(input: ConnectInput): Promise<ConnectResult> {
  const session = await requireUser();
  try {
    const [row] = await sql<{ role: Role }[]>`SELECT role FROM users WHERE id = ${session.id} AND is_active`;
    if (!row) throw new ForbiddenError();
    const result = await connectLine({ id: session.id, role: row.role }, {
      code: String(input?.code ?? ""),
      wabaId: input?.wabaId ? String(input.wabaId) : null,
      phoneNumberId: input?.phoneNumberId ? String(input.phoneNumberId) : null,
      ownerId: String(input?.ownerId ?? ""),
      consentBy: String(input?.consentBy ?? ""),
      consent: input?.consent === true,
    });
    revalidatePath("/pengaturan/whatsapp");
    return { ok: true, message: t(result.synced ? "whatsapp.connected" : "whatsapp.connectedNoSync") };
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, message: t("authz.settingsOnly") };
    if (err instanceof WhatsAppSetupError) return { ok: false, message: t(`whatsapp.err.${err.key}`) };
    if (err instanceof GraphError) {
      console.warn("whatsapp onboarding: Meta refused", { step: err.step, status: err.status, code: err.code });
      return { ok: false, message: t("whatsapp.err.meta", { step: err.step }) };
    }
    console.error("whatsapp onboarding failed", err instanceof Error ? err.name : "unknown");
    return { ok: false, message: t("errors.generic") };
  }
}
