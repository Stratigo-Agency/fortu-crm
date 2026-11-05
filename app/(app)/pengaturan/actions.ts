"use server";

import { addMember, saveCatalog, saveDefinitions, saveProbabilities, saveRules, saveTargets, saveTeam } from "@/lib/settings";
import { t } from "@/lib/copy";
import { runSave, type SaveResult } from "./run";

export type { SaveResult } from "./run";

export async function saveTargetsAction(_prev: SaveResult, form: FormData) {
  return runSave(form, (u, f) => saveTargets(u, String(f.get("month") ?? ""), f));
}
export async function saveRulesAction(_prev: SaveResult, form: FormData) {
  return runSave(form, (u, f) => saveRules(u, f));
}
export async function saveProbabilitiesAction(_prev: SaveResult, form: FormData) {
  return runSave(form, (u, f) => saveProbabilities(u, f));
}
export async function saveDefinitionsAction(_prev: SaveResult, form: FormData) {
  return runSave(form, (u, f) => saveDefinitions(u, f));
}
export async function saveTeamAction(_prev: SaveResult, form: FormData) {
  return runSave(form, (u, f) => saveTeam(u, f));
}
export async function addMemberAction(_prev: SaveResult, form: FormData) {
  return runSave(form, async (u, f) => {
    await addMember(u, f);
    return t("pengaturan.memberAdded");
  });
}
export async function saveCatalogAction(_prev: SaveResult, form: FormData) {
  return runSave(form, (u, f) => saveCatalog(u, f));
}
