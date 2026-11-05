"use server";

import { revalidatePath } from "next/cache";
import { ForbiddenError, requireUser } from "@/lib/authz";
import { t } from "@/lib/copy";
import {
  addMember, saveCatalog, saveDefinitions, saveProbabilities, saveRules, saveTargets, saveTeam, SettingsError,
} from "@/lib/settings";

export type SaveResult = { ok: true; message: string } | { ok: false; message: string } | null;

type Save = (user: Awaited<ReturnType<typeof requireUser>>, form: FormData) => Promise<string | void>;

async function run(form: FormData, save: Save): Promise<SaveResult> {
  const user = await requireUser();
  try {
    const message = await save(user, form);
    revalidatePath("/", "layout");
    return { ok: true, message: message || t("pengaturan.saved") };
  } catch (err) {
    if (err instanceof SettingsError) return { ok: false, message: t(`pengaturan.err.${err.key}`) };
    if (err instanceof ForbiddenError) return { ok: false, message: t("authz.settingsOnly") };
    console.error("settings save failed", err instanceof Error ? err.name : "unknown");
    return { ok: false, message: t("errors.generic") };
  }
}

export async function saveTargetsAction(_prev: SaveResult, form: FormData) {
  return run(form, (u, f) => saveTargets(u, String(f.get("month") ?? ""), f));
}
export async function saveRulesAction(_prev: SaveResult, form: FormData) {
  return run(form, (u, f) => saveRules(u, f));
}
export async function saveProbabilitiesAction(_prev: SaveResult, form: FormData) {
  return run(form, (u, f) => saveProbabilities(u, f));
}
export async function saveDefinitionsAction(_prev: SaveResult, form: FormData) {
  return run(form, (u, f) => saveDefinitions(u, f));
}
export async function saveTeamAction(_prev: SaveResult, form: FormData) {
  return run(form, (u, f) => saveTeam(u, f));
}
export async function addMemberAction(_prev: SaveResult, form: FormData) {
  return run(form, async (u, f) => {
    await addMember(u, f);
    return t("pengaturan.memberAdded");
  });
}
export async function saveCatalogAction(_prev: SaveResult, form: FormData) {
  return run(form, (u, f) => saveCatalog(u, f));
}
