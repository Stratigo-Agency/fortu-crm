import type { MessageKey } from "@/lib/copy";
import { sql } from "@/lib/db";
import { type Codes, parseCodes } from "@/lib/ingest/codes";
import { InvalidActorError, InvalidPhoneError, InvalidTimeError } from "@/lib/ingest/errors";
import { ingestLead, type SourceChannel } from "@/lib/ingest/ingestLead";
import { normalizePhone } from "@/lib/ingest/phone";
import { QUICK_ADD_SOURCES } from "@/lib/quickAddSources";

// Server-side parts of Tambah cepat (/tambah). Pure functions over the database, so they can be
// tested without Next; the Server Actions in app/(app)/tambah/actions.ts only add the sign-in check.

export type ProductInterest = "IFP" | "DSS" | "LED";

/** What a code in the first message stands for, shown to the rep as "Dari iklan: …". */
export type CodeInfo =
  | { kind: "ad"; adName: string; code: string; productLine: ProductInterest; sourceChannel: "meta_ctwa" }
  | { kind: "link"; sourceChannel: SourceChannel };

/**
 * Looks up the ad code (an ad's prefill code) or click code (a tracked /go/wa link) from the message.
 * An ad wins over a click, like in ingestLead. A click that already belongs to a lead is ignored.
 */
export async function describeCodes(codes: Codes): Promise<CodeInfo | null> {
  if (codes.adCode) {
    const [ad] = await sql<{ name: string }[]>`
      SELECT name FROM ads WHERE upper(prefill_code) = ${codes.adCode.toUpperCase()}`;
    const line = codes.adCode.split("-")[1] as ProductInterest;
    // only the ad's name and its code go back to the browser: nothing about any customer
    if (ad) return { kind: "ad", adName: ad.name, code: codes.adCode.toUpperCase(), productLine: line, sourceChannel: "meta_ctwa" };
  }
  if (codes.clickCode) {
    const [click] = await sql<{ source_channel: SourceChannel }[]>`
      SELECT source_channel FROM wa_click_events
       WHERE upper(ref_code) = ${codes.clickCode.toUpperCase()} AND matched_lead_id IS NULL`;
    if (click) return { kind: "link", sourceChannel: click.source_channel };
  }
  return null;
}

export type PhoneStatus = { state: "new" } | { state: "known"; name: string | null; phone: string };

/** Whether this number already is a contact. null while the number can't be read yet. */
export async function lookupPhoneStatus(raw: string): Promise<PhoneStatus | null> {
  let phone: string;
  try {
    phone = normalizePhone(raw);
  } catch {
    return null;
  }
  const [contact] = await sql<{ full_name: string | null }[]>`
    SELECT full_name FROM contacts WHERE phone_e164 = ${phone}`;
  return contact ? { state: "known", name: contact.full_name, phone } : { state: "new" };
}

export type QuickAddInput = {
  phone?: string;
  name?: string;
  message?: string;
  interest?: string; // IFP | DSS | LED | unknown
  when?: string; // now | time
  time?: string; // HH:MM today, Jakarta
  source?: string; // used only when the message has no code
};

export type QuickAddResult =
  | { status: "saved" | "duplicate"; leadId: string }
  | { status: "error"; field: "phone" | "receivedAt" | "form"; messageKey: MessageKey };

const PRODUCTS = new Set<string>(["IFP", "DSS", "LED"]);
const SOURCES = new Set<string>(QUICK_ADD_SOURCES);

/** Today's date in Jakarta, YYYY-MM-DD. */
function jakartaToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(now);
}

/**
 * Saves a quick-add from the phone through ingestLead (the only way a lead is created).
 * The source comes from the code in the message when there is one, never from the client's say-so.
 */
export async function submitQuickAdd(actorId: string, input: QuickAddInput): Promise<QuickAddResult> {
  const message = input.message?.trim().slice(0, 2000) || undefined;
  const codeInfo = await describeCodes(parseCodes(message));

  let sourceChannel: SourceChannel;
  if (codeInfo) sourceChannel = codeInfo.sourceChannel;
  else sourceChannel = (input.source && SOURCES.has(input.source) ? input.source : "meta_ctwa") as SourceChannel;

  // Only an absent interest falls back to the ad's product; "Belum tahu" is the rep's answer.
  const interest = input.interest === undefined && codeInfo?.kind === "ad" ? codeInfo.productLine : input.interest;
  const productInterest = interest && PRODUCTS.has(interest) ? (interest as ProductInterest) : undefined;

  let receivedAt: string | undefined;
  if (input.when === "time") {
    if (!/^\d{2}:\d{2}$/.test(input.time ?? "")) {
      return { status: "error", field: "receivedAt", messageKey: "quickAdd.timeMissing" };
    }
    receivedAt = `${jakartaToday()}T${input.time}:00+07:00`;
  }

  try {
    const result = await ingestLead(
      {
        phone: input.phone ?? "",
        name: input.name?.trim().slice(0, 120) || undefined,
        sourceChannel,
        captureMethod: "manual_quick_add",
        firstMessage: message,
        productInterest,
        receivedAt,
      },
      { actorId },
    );
    return { status: result.deduped ? "duplicate" : "saved", leadId: result.leadId };
  } catch (err) {
    if (err instanceof InvalidPhoneError) return { status: "error", field: "phone", messageKey: "quickAdd.invalidPhone" };
    if (err instanceof InvalidTimeError) return { status: "error", field: "receivedAt", messageKey: "quickAdd.futureTime" };
    if (err instanceof InvalidActorError) return { status: "error", field: "form", messageKey: "authz.forbidden" };
    console.error("quick-add failed", err);
    return { status: "error", field: "form", messageKey: "errors.generic" };
  }
}
