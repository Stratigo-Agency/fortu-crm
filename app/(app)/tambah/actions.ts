"use server";

import { requireUser } from "@/lib/authz";
import type { Codes } from "@/lib/ingest/codes";
import { type CodeInfo, describeCodes, lookupPhoneStatus, type PhoneStatus } from "@/lib/quickAdd";

/** The ad or link behind a code found in the first message, for the "Dari iklan" card. */
export async function lookupCode(codes: Codes): Promise<CodeInfo | null> {
  await requireUser();
  return describeCodes({ adCode: codes.adCode?.slice(0, 20), clickCode: codes.clickCode?.slice(0, 8) });
}

/** Whether the number typed so far is a known contact, for the hint under the phone field. */
export async function lookupPhone(raw: string): Promise<PhoneStatus | null> {
  await requireUser();
  return lookupPhoneStatus(raw.slice(0, 40));
}
