import type postgres from "postgres";
import { sql } from "@/lib/db";
import { parseCodes } from "@/lib/ingest/codes";
import { InvalidPhoneError } from "@/lib/ingest/errors";
import { ingestLead } from "@/lib/ingest/ingestLead";
import { normalizePhone } from "@/lib/ingest/phone";
import {
  historyDirection, messageText, messageTime, redactMessage, redactValue,
  type WaChange, type WaContact, type WaMessage, type WaPayload, type WaValue,
} from "./payload";
import { clearLineText } from "./texts";

// Turns one webhook event (provider 'whatsapp_webhook') into CRM rows
// (docs/INTEGRATIONS.md · WhatsApp Cloud API webhook, docs/whatsapp-coexistence.md):
//   messages            a chat from a customer: a lead through ingestLead() when it starts a conversation
//                       (no lead from this contact on this line in 30 days) or comes from an ad; metadata always
//   smb_message_echoes  a reply the rep typed in the phone app: metadata (first replies: v_wa_lead_first_reply)
//   history             old chats shared at onboarding: metadata only, never leads
//   smb_app_state_sync  the phone's address book: dropped before storing (the CRM does not need it)
//   account_update      PARTNER_REMOVED (the rep disconnected): the line goes back to business_app, consent and
//                       kept text are cleared
//   statuses, others    dropped before storing
// Only lines in mode coexistence / cloud_api with recorded consent are processed (the feature flag); changes for
// other lines are dropped before anything is stored.
//
// prepareEvent() trims the payload BEFORE it is stored: ids, times, types, referral ids and the attribution codes
// read from the text. The text (only for lines that keep it) and the profile names travel in memory to the
// processing that runs right after the response (Transient); a retry from the database works without them.

export const WEBHOOK_PROVIDER = "whatsapp_webhook";
export const PROCESSED_MODES = ["coexistence", "cloud_api"] as const;
const CONVERSATION_GAP_DAYS = 30;
const NO_LEAD_TYPES = new Set(["reaction", "system", "unsupported", "errors", "revoke", "edit"]);
const KEPT_FIELDS = new Set(["messages", "smb_message_echoes", "history"]);

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

/** What the live request knows but never stores: message text (lines that keep it) and profile names. */
export type Transient = { texts: Map<string, string>; names: Map<string, string> };
const NOTHING: Transient = { texts: new Map(), names: new Map() };

const LINE_COLUMNS = sql`id, user_id, mode, consent_at, store_message_text, is_active`;

/**
 * The payload as it may be stored, and what stays in memory. null when nothing in it is for a processed line
 * (nothing is stored then). Changes for unknown lines, lines without consent or with the flag off are dropped.
 */
export async function prepareEvent(payload: WaPayload): Promise<{ stored: WaPayload; transient: Transient } | null> {
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  const numberIds = new Set<string>();
  const wabaIds = new Set<string>();
  const historyPhones = new Set<string>();
  for (const entry of entries) {
    if (entry.id) wabaIds.add(String(entry.id));
    for (const change of entry.changes ?? []) {
      const id = change.value?.metadata?.phone_number_id;
      if (id) numberIds.add(String(id));
      for (const h of change.value?.history ?? []) {
        for (const th of h.threads ?? []) {
          const phone = toPhone(th.context?.wa_id);
          if (phone) historyPhones.add(phone);
        }
      }
    }
  }
  const lines = numberIds.size
    ? await sql<(Line & { meta_phone_number_id: string })[]>`
        SELECT ${LINE_COLUMNS}, meta_phone_number_id FROM wa_lines WHERE meta_phone_number_id = ANY(${[...numberIds]})`
    : [];
  const byNumber = new Map(lines.map((l) => [l.meta_phone_number_id, l]));
  const knownWabas = wabaIds.size
    ? new Set((await sql<{ meta_waba_id: string }[]>`
        SELECT meta_waba_id FROM wa_lines WHERE meta_waba_id = ANY(${[...wabaIds]})`).map((r) => r.meta_waba_id))
    : new Set<string>();
  const customers = historyPhones.size
    ? new Set((await sql<{ phone_e164: string }[]>`
        SELECT phone_e164 FROM contacts WHERE phone_e164 = ANY(${[...historyPhones]})`).map((r) => r.phone_e164))
    : new Set<string>();
  const isCustomer = (waId: string) => {
    const phone = toPhone(waId);
    return Boolean(phone && customers.has(phone));
  };

  const transient: Transient = { texts: new Map(), names: new Map() };
  const keptEntries: WaPayload["entry"] = [];
  for (const entry of entries) {
    const changes: WaChange[] = [];
    for (const change of entry.changes ?? []) {
      const field = String(change.field ?? "");
      const value: WaValue = change.value ?? {};
      if (field === "account_update") {
        if (entry.id && knownWabas.has(String(entry.id)) && typeof value.event === "string") {
          changes.push({ field, value: { event: value.event } });
        }
        continue;
      }
      if (!KEPT_FIELDS.has(field)) continue; // statuses, the address book (smb_app_state_sync) and anything else
      const line = byNumber.get(String(value.metadata?.phone_number_id ?? ""));
      if (!line || lineGate(line)) continue;
      // delivery statuses come as field "messages" without messages: nothing to keep
      if (!value.messages?.length && !value.message_echoes?.length && !value.history?.length) continue;
      for (const c of value.contacts ?? []) {
        const name = c.profile?.name?.trim();
        if (!name) continue;
        if (c.user_id) transient.names.set(String(c.user_id), name);
        if (c.wa_id) transient.names.set(String(c.wa_id), name);
      }
      if (line.store_message_text) {
        const all = [
          ...(value.messages ?? []),
          ...(value.message_echoes ?? []),
          ...(value.history ?? []).flatMap((h) => (h.threads ?? []).flatMap((th) => th.messages ?? [])),
        ];
        for (const m of all) {
          const text = messageText(m);
          if (m.id && text) transient.texts.set(String(m.id), text);
        }
      }
      changes.push({ field, value: redactValue(value, isCustomer) });
    }
    if (changes.length) keptEntries.push({ id: entry.id ? String(entry.id) : undefined, changes });
  }
  if (keptEntries.length === 0) return null;
  return { stored: { object: payload.object, entry: keptEntries }, transient };
}

export type ProcessResult = { status: "processed" | "skipped" | "failed"; leads: string[]; notes: string[] };

/**
 * Processes one stored webhook event. Safe to run twice: the event is claimed first (the live request and the
 * retry job never work on it at once; a claim older than 5 minutes counts as abandoned) and every write is
 * idempotent. Never throws.
 */
export async function processWebhookEvent(eventId: string | number, transient: Transient = NOTHING): Promise<ProcessResult> {
  const [ev] = await sql<{ payload: WaPayload }[]>`
    UPDATE inbound_events SET attempts = attempts + 1, claimed_at = now()
     WHERE id = ${String(eventId)} AND provider = ${WEBHOOK_PROVIDER} AND processed_at IS NULL
       AND (claimed_at IS NULL OR claimed_at < now() - interval '5 minutes')
     RETURNING payload`;
  if (!ev) return { status: "skipped", leads: [], notes: [] };
  const leads: string[] = [];
  const notes: string[] = [];
  try {
    const stored = await processPayload(ev.payload, transient, leads, notes);
    await sql`
      UPDATE inbound_events
         SET payload = ${sql.json(stored as postgres.JSONValue)}, processed_at = now(), error = NULL, claimed_at = NULL
       WHERE id = ${String(eventId)}`;
    return { status: "processed", leads, notes };
  } catch (err) {
    // the name only: a message could carry customer data. The stored payload was trimmed before it was saved.
    const name = err instanceof Error ? err.name : "unknown";
    await sql`UPDATE inbound_events SET error = ${name}, claimed_at = NULL WHERE id = ${String(eventId)}`;
    console.error("whatsapp webhook processing failed", { eventId: String(eventId), name });
    return { status: "failed", leads, notes };
  }
}

async function processPayload(payload: WaPayload, transient: Transient, leads: string[], notes: string[]): Promise<Record<string, unknown>> {
  const entries = [];
  for (const entry of payload.entry ?? []) {
    const changes = [];
    for (const change of entry.changes ?? []) changes.push(await processChange(entry.id, change, transient, leads, notes));
    entries.push({ id: entry.id, changes });
  }
  return { object: payload.object, entry: entries, crm: { notes } };
}

async function processChange(
  wabaId: string | undefined,
  change: WaChange,
  transient: Transient,
  leads: string[],
  notes: string[],
): Promise<WaChange | Record<string, unknown>> {
  const field = change.field ?? "";
  const value: WaValue = change.value ?? {};

  if (field === "account_update") {
    if (value.event === "PARTNER_REMOVED" && wabaId) {
      // the rep disconnected in the phone app: stop processing, forget the token, the consent and kept text
      await sql.begin(async (tx) => {
        const lines = await tx<{ id: string }[]>`
          UPDATE wa_lines SET mode = 'business_app', meta_business_token_enc = NULL, consent_at = NULL, consent_by = NULL,
                              store_message_text = false
           WHERE meta_waba_id = ${wabaId}
          RETURNING id`;
        for (const l of lines) await clearLineText(tx, l.id);
      });
      notes.push("partner_removed");
    }
    return { field, value: { event: value.event } };
  }

  const phoneNumberId = value.metadata?.phone_number_id;
  const [line] = phoneNumberId
    ? await sql<Line[]>`SELECT ${LINE_COLUMNS} FROM wa_lines WHERE meta_phone_number_id = ${phoneNumberId}`
    : [];
  const skip = lineGate(line);
  if (skip) {
    notes.push(`${field}:${skip}`);
    // consent was withdrawn after the event arrived: nothing of it is kept
    return { field, value: { metadata: { phone_number_id: phoneNumberId }, ignored: skip } };
  }
  await sql`UPDATE wa_lines SET last_event_at = now() WHERE id = ${line.id}`;
  // text only while the line still keeps it
  const texts = line.store_message_text ? transient.texts : NOTHING.texts;

  if (field === "messages") {
    for (const m of value.messages ?? []) {
      const leadId = await handleInbound(line, m, value.contacts ?? [], transient.names, texts, notes);
      if (leadId && !leads.includes(leadId)) leads.push(leadId);
    }
  } else if (field === "smb_message_echoes") {
    for (const m of value.message_echoes ?? []) await handleEcho(line, m, value.contacts ?? [], texts);
  } else if (field === "history") {
    for (const h of value.history ?? []) {
      if (h.errors?.length) notes.push(`history:declined:${h.errors[0]?.code ?? ""}`);
      for (const thread of h.threads ?? []) {
        const bsuid = thread.context?.user_id;
        const contactId = await contactIdFor(line, thread.context?.wa_id, bsuid);
        for (const m of thread.messages ?? []) {
          await recordMessage(line, m, historyDirection(thread, m), "history", contactId, null, bsuid, texts.get(m.id));
        }
      }
    }
  } else {
    return { field, value: { ignored: "field" } };
  }
  return { field, value: redactValue(value) };
}

/** A customer's message: maybe a lead, always metadata. Returns the lead it belongs to. */
async function handleInbound(
  line: Line,
  m: WaMessage,
  contacts: WaContact[],
  names: Map<string, string>,
  texts: Map<string, string>,
  notes: string[],
): Promise<string | null> {
  if (!m.id || (await seen(line, m.id))) return null;
  const profile = contacts.find((c) => (m.from_user_id && c.user_id === m.from_user_id) || (m.from && c.wa_id === m.from));
  const bsuid = m.from_user_id ?? profile?.user_id;
  const waId = m.from ?? profile?.wa_id;
  const sentAt = messageTime(m);
  const text = texts.get(m.id);
  // codes were read before the text was dropped (redactMessage); an older untrimmed row still has its text
  const codes = m.crm_codes ?? parseCodes(messageText(m));
  const name = (bsuid && names.get(bsuid)) || (waId && names.get(waId)) || profile?.profile?.name;

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
  const fromAd = Boolean(referral?.source_id) || Boolean(codes.adCode);
  let leadId = recent?.id ?? null;
  let contactId = recent?.contact_id ?? null;

  if ((!recent || fromAd) && !NO_LEAD_TYPES.has(m.type ?? "")) {
    const result = await ingestLead({
      phone,
      name: name || undefined,
      sourceChannel: fromAd ? "meta_ctwa" : "whatsapp_direct",
      captureMethod: "cloud_api_webhook",
      waLineId: line.id,
      // never firstMessage: leads.first_message is visible to every user; the text stays in wa_message_texts
      codes,
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
  if (contactId) {
    // the rep's reply may have arrived first (webhooks come in any order): link it to the contact now
    if (bsuid) {
      await sql`
        UPDATE wa_messages SET contact_id = ${contactId}
         WHERE wa_line_id = ${line.id} AND contact_id IS NULL AND peer_bsuid = ${bsuid}`;
    }
    if (leadId) {
      await sql`
        UPDATE wa_messages m SET lead_id = ${leadId}
          FROM leads l
         WHERE l.id = ${leadId} AND m.wa_line_id = ${line.id} AND m.contact_id = ${contactId}
           AND m.lead_id IS NULL AND m.sent_at >= l.received_at`;
      await syncFirstResponse(leadId);
    }
  }
  return leadId;
}

/** leads.first_response_at from the first real reply in wa_messages (v_wa_lead_first_reply), never later. */
async function syncFirstResponse(leadId: string) {
  await sql`
    UPDATE leads l SET first_response_at = r.first_reply_at
      FROM v_wa_lead_first_reply r
     WHERE r.lead_id = l.id AND l.id = ${leadId} AND r.first_reply_at IS NOT NULL
       AND (l.first_response_at IS NULL OR l.first_response_at > r.first_reply_at)`;
}

/** A reply the rep sent from the phone app: metadata; the first real one after a lead came in is its first response. */
async function handleEcho(line: Line, m: WaMessage, contacts: WaContact[], texts: Map<string, string>) {
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
  }
  await rememberUser(line, bsuid, waId, contactId);
  await recordMessage(line, m, "out", "echo", contactId, leadId, bsuid, texts.get(m.id));
  if (leadId) await syncFirstResponse(leadId);
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
  text: string | undefined,
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
