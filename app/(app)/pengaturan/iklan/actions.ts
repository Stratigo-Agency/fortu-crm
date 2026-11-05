"use server";

import { saveAdCodes, saveAdSetLines, saveCampaignOwners } from "@/lib/ads";
import { runSave, type SaveResult } from "../run";

export async function saveCampaignOwnersAction(_prev: SaveResult, form: FormData) {
  return runSave(form, (u, f) => saveCampaignOwners(u, f));
}
export async function saveAdSetLinesAction(_prev: SaveResult, form: FormData) {
  return runSave(form, (u, f) => saveAdSetLines(u, f));
}
export async function saveAdCodesAction(_prev: SaveResult, form: FormData) {
  return runSave(form, (u, f) => saveAdCodes(u, f));
}
