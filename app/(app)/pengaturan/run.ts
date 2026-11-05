import { revalidatePath } from "next/cache";
import type { Role } from "@/lib/auth";
import { AdsError } from "@/lib/ads";
import { ForbiddenError, requireUser } from "@/lib/authz";
import { t } from "@/lib/copy";
import { sql } from "@/lib/db";
import { SettingsError } from "@/lib/settings";

export type SaveResult = { ok: true; message: string } | { ok: false; message: string } | null;
export type Actor = { id: string; role: Role; email: string; full_name: string };
export type Save = (user: Actor, form: FormData) => Promise<string | void>;

/**
 * Runs one settings save for a Server Action: the role is read from the database (not the sign-in cookie, so a
 * demoted or switched-off account stops at once), known errors become a Bahasa message, the pages are refreshed.
 */
export async function runSave(form: FormData, save: Save): Promise<SaveResult> {
  const session = await requireUser();
  try {
    const [row] = await sql<{ role: Role }[]>`SELECT role FROM users WHERE id = ${session.id} AND is_active`;
    if (!row) throw new ForbiddenError();
    const message = await save({ ...session, role: row.role }, form);
    revalidatePath("/", "layout");
    return { ok: true, message: message || t("pengaturan.saved") };
  } catch (err) {
    if (err instanceof SettingsError) return { ok: false, message: t(`pengaturan.err.${err.key}`) };
    if (err instanceof AdsError) return { ok: false, message: t(`iklan.err.${err.key}`, { code: err.code ?? "" }) };
    if (err instanceof ForbiddenError) return { ok: false, message: t("authz.settingsOnly") };
    console.error("settings save failed", err instanceof Error ? err.name : "unknown");
    return { ok: false, message: t("errors.generic") };
  }
}
