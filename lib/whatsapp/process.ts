import type postgres from "postgres";
import { sql } from "@/lib/db";
import { parseCodes } from "@/lib/ingest/codes";
import { InvalidPhoneError } from "@/lib/ingest/errors";
import { ingestLead } from "@/lib/ingest/ingestLead";
import { normalizePhone } from "@/lib/ingest/phone";
import {
  messageText, messageTime, redactMessage, redactValue,
  type WaChange, type WaContact, type WaMessage, type WaPayload, type WaValue,
} from "./payload";

// Turns one stored webhook event (inbound_events, provider 'whatsapp_webhook') into CRM rows
// (docs/INTEGRATIONS.md · WhatsApp Cloud API webhook, docs/whatsapp-coexistence.md):
//   messages            a chat from a customer: a lead through ingestLead() when it starts a conversation
//                       (no lead from this contact on this line in 30 days) or comes from an ad; metadata always
//   smb_message_echoes  a reply the rep typed in the phone app: fills leads.first_response_at once; metadata
//   history             old chats shared at onboarding: metadata only, never leads
//   smb_app_state_sync  the phone's contact list: kept in the event, nothing else
//   account_update      PARTNER_REMOVED (the rep disconnected): the line goes back to business_app
//   statuses            ignored
// Only lines in mode coexistence / cloud_api with recorded consent are processed (the feature flag).
// Afterwards the stored payload is redacted: no message text stays in inbound_events.

export const WEBHOOK_PROVIDER = "whatsapp_webhook";
export const PROCESSED_MODES = ["coexistence", "cloud_api"] as const;
const CONVERSATION_GAP_DAYS = 30;
const NO_LEAD_TYPES = new Set(["reaction", "system", "unsupported", "errors", "revoke"]);

type Line = {
  id: string;
  user_id: string | null;
  mode: string;
  consent_at: Date | null;
  store_message_text: boolean;
  is_active: boolean;
};

export type SkipReason = "unknown_line" | "flag_off" | "no_consent";

/** Why a line's events are not processed, or null when they are. */
export function lineGate(line: Line | undefined): SkipReason | null {
  if (!line || !line.is_active) return "unknown_line";
  if (!(PROCESSED_MODES as readonly string[]).includes(line.mode)) return "flag_off";
  if (!line.consent_at) return "no_consent";
  return null;
}

export type ProcessResult = { status: "processed" | "skipped" | "failed"; leads: string[]; notes: string[] };

/** Processes one stored webhook event. Safe to run twice: every write is idempotent. Never throws. */
export async function processWebhookEvent(eventId: string | number): Promise<ProcessResult> {
  const [ev] = await sql<{ payload: WaPayload }[]>`
    UPDATE inbound_events SET attempts = attempts + 1
     WHERE id = ${String(eventId)} AND provider = ${WEBHOOK_PROVIDER} AND processed_at IS NULL
     RETURNING payload`;
  if (!ev) return { status: "skipped", leads: [], notes: [] };
  const leads: string[] = [];
  const notes: string[] = [];
  try {
    const stored = await processPayload(ev.payload, leads, notes);
    await sql`
      UPDATE inbound_events
         SET payload = ${sql.json(stored as postgres.JSONValue)}, processed_at = now(), error = NULL
       WHERE id = ${String(eventId)}`;
    return { status: "processed", leads, notes };
  } catch (err) {
    // the name only: a message could carry customer data
    const name = err instanceof Error ? err.name : "unknown";
    await sql`UPDATE inbound_events SET error = ${name} WHERE id = ${String(eventId)}`;
    console.error("whatsapp webhook processing failed", { eventId: String(eventId), name });
    return { status: "failed", leads, notes };
  }
}

async function processPayload(payload: WaPayload, leads: string[], notes: string[]): Promise<Record<string, unknown>> {
  const entries = [];
  for (const entry of payload.entry ?? []) {
    const changes = [];
    for (const change of entry.changes ?? []) changes.push(await processChange(entry.id, change, leads, notes));
    entries.push({ id: entry.id, changes });
  }
  return { object: payload.object, entry: entries, crm: { notes } };
}

async function processChange(
  wabaId: string | undefined,
  change: WaChange,
  leads: string[],
  notes: string[],
): Promise<WaChange | Record<string, unknown>> {
  const field = change.field ?? "";
  const value: WaValue = change.value ?? {};

  if (field === "account_update") {
    if (value.event === "PARTNER_REMOVED" && wabaId) {
      // the rep disconnected in the phone app: stop processing, forget the token
      await sql`
        UPDATE wa_lines SET mode = 'business_app', meta_business_token_enc = NULL
         WHERE meta_waba_id = ${wabaId}`;
      notes.push("partner_removed");
    }
    return { field, value: { event: value.event } };
  }

  const phoneNumberId = value.metadata?.phone_number_id;
  const [line] = phoneNumberId
    ? await sql<Line[]>`
        SELECT id, user_id, mode, consent_at, store_message_text, is_active
          FROM wa_lines WHERE meta_phone_number_id = ${phoneNumberId}`
    : [];
  const skip = lineGate(line);
  if (skip) {
    notes.push(`${field}:${skip}`);
    // nothing of an unprocessed line is kept: no names, numbers or text
    return { field, value: { metadata: { phone_number_id: phoneNumberId }, ignored: skip } };
  }
  await sql`UPDATE wa_lines SET last_event_at = now() WHERE id = ${line.id}`;

  if (field === "messages") {
    for (const m of value.messages ?? []) {
      const leadId = await handleInbound(line, m, value.contacts ?? [], notes);
      if (leadId && !leads.includes(leadId)) leads.push(leadId);
    }
  } else if (field === "smb_message_echoes") {
    for (const m of value.message_echoes ?? []) await handleEcho(line, m, value.contacts ?? []);
  } else if (field === "history") {
    for (const h of value.history ?? []) {
      if (h.errors?.length) notes.push(`history:declined:${h.errors[0]?.code ?? ""}`);
      for (const thread of h.threads ?? []) {
        const bsuid = thread.context?.user_id;
        const contactId = await contactIdFor(line, thread.context?.wa_id, bsuid);
        for (const m of thread.messages ?? []) {
          // the business sent it when `from` is not the customer
          const fromCustomer = m.from !== undefined && (m.from === thread.context?.wa_id || m.from === thread.id);
          await recordMessage(line, m, fromCustomer ? "in" : "out", "history", contactId, null, bsuid);
        }
      }
    }
  } else if (field === "smb_app_state_sync") {
    return { field, value };
  }
  // statuses and anything else: kept redacted, nothing done
  return { field, value: redactValue({ ...value, statuses: undefined }) };
}

/** A customer's message: maybe a lead, always metadata. Returns the lead it belongs to. */
async function handleInbound(line: Line, m: WaMessage, contacts: WaContact[], notes: string[]): Promise<string | null> {
  if (!m.id || (await seen(line, m.id))) return null;
  const profile = contacts.find((c) => (m.from_user_id && c.user_id === m.from_user_id) || (m.from && c.wa_id === m.from));
  const bsuid = m.from_user_id ?? profile?.user_id;
  const waId = m.from ?? profile?.wa_id;
  const sentAt = messageTime(m);
  const text = messageText(m);

  const phone = await phoneFor(line, waId, bsuid);
  if (!phone) {
    notes.push(waId ? "foreign_number" : "no_phone");
    await rememberUser(line, bsuid, waId, null);
    await recordMessage(line, m, "in", "messages", null, null, bsuid, text);
    return null;
  }

  const [recent] = await sql<{ id: string; contact_id: string }[]>`
    SELECT l.id, l.contact_id FROM leads l JOIN contacts c ON c.id = l.contact_id
     WHERE c.phone_e164 = ${phone} AND l.wa_line_id = ${line.id}
       AND l.received_at > ${sentAt}::timestamptz - make_interval(days => ${CONVERSATION_GAP_DAYS})
     ORDER BY l.received_at DESC LIMIT 1`;
  const referral = m.referral;
  const fromAd = Boolean(referral?.source_id) || Boolean(parseCodes(text).adCode);
  let leadId = recent?.id ?? null;
  let contactId = recent?.contact_id ?? null;

  if ((!recent || fromAd) && !NO_LEAD_TYPES.has(m.type ?? "")) {
    const result = await ingestLead({
      phone,
      name: profile?.profile?.name,
      sourceChannel: fromAd ? "meta_ctwa" : "whatsapp_direct",
      captureMethod: "cloud_api_webhook",
      waLineId: line.id,
      firstMessage: text,
      storeFirstMessage: line.store_message_text,
      metaAdId: referral?.source_type && referral.source_type !== "ad" ? undefined : referral?.source_id,
      ctwaClid: referral?.ctwa_clid,
      receivedAt: sentAt,
      external: { provider: "whatsapp", id: m.id, payload: redactMessage(m) },
    });
    leadId = result.leadId;
    contactId = result.contactId;
  }
  if (!contactId) {
    const [c] = await sql<{ id: string }[]>`SELECT id FROM contacts WHERE phone_e164 = ${phone}`;
    contactId = c?.id ?? null;
  }
  await rememberUser(line, bsuid, waId, contactId);
  await recordMessage(line, m, "in", "messages", contactId, leadId, bsuid, text);
  return leadId;
}

/** A reply the rep typed in the phone app: the first one after a lead came in is its first response. */
async function handleEcho(line: Line, m: WaMessage, contacts: WaContact[]) {
  if (!m.id || (await seen(line, m.id))) return;
  const profile = contacts.find((c) => (m.to_user_id && c.user_id === m.to_user_id) || (m.to && c.wa_id === m.to));
  const bsuid = m.to_user_id ?? profile?.user_id;
  const waId = m.to ?? profile?.wa_id;
  const sentAt = messageTime(m);
  const contactId = await contactIdFor(line, waId, bsuid);
  let leadId: string | null = null;
  if (contactId) {
    const [lead] = await sql<{ id: string }[]>`
      SELECT id FROM leads
       WHERE contact_id = ${contactId} AND wa_line_id = ${line.id} AND received_at <= ${sentAt}::timestamptz
       ORDER BY received_at DESC LIMIT 1`;
    leadId = lead?.id ?? null;
    if (lead && m.type !== "revoke") {
      await sql`
        UPDATE leads SET first_response_at = ${sentAt}::timestamptz
         WHERE id = ${lead.id} AND first_response_at IS NULL`;
    }
  }
  await rememberUser(line, bsuid, waId, contactId);
  await recordMessage(line, m, "out", "echo", contactId, leadId, bsuid, messageText(m));
}

async function seen(line: Line, waMessageId: string): Promise<boolean> {
  const [row] = await sql`SELECT 1 FROM wa_messages WHERE wa_line_id = ${line.id} AND wa_message_id = ${waMessageId}`;
  return Boolean(row);
}

function toPhone(waId: string | undefined): string | null {
  if (!waId) return null;
  try {
    return normalizePhone(`+${waId.replace(/^\+/, "")}`);
  } catch (err) {
    if (err instanceof InvalidPhoneError) return null; // outside Indonesia: the CRM keeps +62 numbers only
    throw err;
  }
}

/** The customer's phone: from wa_id, or from an earlier message of the same BSUID on this line. */
async function phoneFor(line: Line, waId: string | undefined, bsuid: string | undefined): Promise<string | null> {
  const direct = toPhone(waId);
  if (direct || waId || !bsuid) return direct;
  const [row] = await sql<{ phone_e164: string }[]>`
    SELECT c.phone_e164 FROM wa_contacts w JOIN contacts c ON c.id = w.contact_id
     WHERE w.wa_line_id = ${line.id} AND w.bsuid = ${bsuid}`;
  return row?.phone_e164 ?? null;
}

/** An existing contact for this WhatsApp user, never a new one. */
async function contactIdFor(line: Line, waId: string | undefined, bsuid: string | undefined): Promise<string | null> {
  const phone = toPhone(waId);
  if (phone) {
    const [c] = await sql<{ id: string }[]>`SELECT id FROM contacts WHERE phone_e164 = ${phone}`;
    if (c) return c.id;
  }
  if (!bsuid) return null;
  const [w] = await sql<{ contact_id: string | null }[]>`
    SELECT contact_id FROM wa_contacts WHERE wa_line_id = ${line.id} AND bsuid = ${bsuid}`;
  return w?.contact_id ?? null;
}

async function rememberUser(line: Line, bsuid: string | undefined, waId: string | undefined, contactId: string | null) {
  if (!bsuid) return;
  await sql`
    INSERT INTO wa_contacts (wa_line_id, bsuid, wa_id, contact_id)
    VALUES (${line.id}, ${bsuid}, ${waId ?? null}, ${contactId})
    ON CONFLICT (wa_line_id, bsuid) DO UPDATE
       SET wa_id = COALESCE(EXCLUDED.wa_id, wa_contacts.wa_id),
           contact_id = COALESCE(EXCLUDED.contact_id, wa_contacts.contact_id),
           updated_at = now()`;
}

async function recordMessage(
  line: Line,
  m: WaMessage,
  direction: "in" | "out",
  source: "messages" | "echo" | "history",
  contactId: string | null,
  leadId: string | null,
  bsuid: string | undefined,
  text: string | undefined = messageText(m),
) {
  if (!m.id) return;
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO wa_messages (wa_line_id, wa_message_id, direction, source, msg_type, sent_at, peer_bsuid, contact_id, lead_id)
    VALUES (${line.id}, ${m.id}, ${direction}, ${source}, ${m.type ?? "unknown"}, ${messageTime(m)}::timestamptz,
            ${bsuid ?? null}, ${contactId}, ${leadId})
    ON CONFLICT (wa_line_id, wa_message_id) DO NOTHING
    RETURNING id`;
  // the text only when the line keeps it (wa_lines.store_message_text, off by default)
  if (row && text && line.store_message_text) {
    await sql`INSERT INTO wa_message_texts (message_id, body) VALUES (${row.id}, ${text})`;
  }
}
