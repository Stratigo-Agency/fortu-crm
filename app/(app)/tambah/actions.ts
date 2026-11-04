"use server";

import { requireUser } from "@/lib/authz";
import { t } from "@/lib/copy";
import type { Codes } from "@/lib/ingest/codes";
import {
  type CodeInfo,
  describeCodes,
  lookupPhoneStatus,
  type PhoneStatus,
  submitQuickAdd,
} from "@/lib/quickAdd";

// Server Actions can be called with anything, so the lookups check what they were given.
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);

/** The ad or link behind a code found in the first message, for the "Dari iklan" card. */
export async function lookupCode(codes: Codes): Promise<CodeInfo | null> {
  await requireUser();
  const adCode = str(codes?.adCode, 20);
  const clickCode = str(codes?.clickCode, 8);
  if (!adCode && !clickCode) return null;
  return describeCodes({ adCode, clickCode });
}

/** Whether the number typed so far is a known contact, for the hint under the phone field. */
export async function lookupPhone(raw: string): Promise<PhoneStatus | null> {
  await requireUser();
  const phone = str(raw, 40);
  return phone ? lookupPhoneStatus(phone) : null;
}

export type QuickAddState = {
  /** Counts finished saves; the form starts over when it changes. */
  seq: number;
  status: "idle" | "saved" | "duplicate" | "error";
  field?: "phone" | "receivedAt" | "form";
  message?: string;
};

/** Tambah cepat: saves the chat as a lead owned by the signed-in rep. */
export async function createLead(prev: QuickAddState, formData: FormData): Promise<QuickAddState> {
  const user = await requireUser();
  const text = (name: string) => formData.get(name)?.toString();
  const result = await submitQuickAdd(user.id, {
    phone: text("phone"),
    name: text("name"),
    message: text("message"),
    interest: text("interest"),
    when: text("when"),
    time: text("time"),
    source: text("source"),
  });
  if (result.status === "error") {
    return { seq: prev.seq, status: "error", field: result.field, message: t(result.messageKey) };
  }
  return {
    seq: prev.seq + 1,
    status: result.status,
    message: t(result.status === "saved" ? "quickAdd.saved" : "quickAdd.duplicate"),
  };
}
