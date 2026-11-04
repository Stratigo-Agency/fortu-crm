import { sql } from "@/lib/db";
import type { Codes } from "@/lib/ingest/codes";
import type { SourceChannel } from "@/lib/ingest/ingestLead";
import { normalizePhone } from "@/lib/ingest/phone";

// Server-side parts of Tambah cepat (/tambah). Pure functions over the database, so they can be
// tested without Next; the Server Actions in app/(app)/tambah/actions.ts only add the sign-in check.

export type ProductInterest = "IFP" | "DSS" | "LED";

/** What a code in the first message stands for, shown to the rep as "Dari iklan: …". */
export type CodeInfo =
  | { kind: "ad"; adName: string; productLine: ProductInterest; sourceChannel: "meta_ctwa" }
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
    if (ad) return { kind: "ad", adName: ad.name, productLine: line, sourceChannel: "meta_ctwa" };
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
