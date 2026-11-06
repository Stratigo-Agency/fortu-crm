// The parts of a WhatsApp Business Platform webhook the CRM reads, and the trimming that keeps message text, names
// and address books out of stored payloads (inbound_events): only ids, times, types and referral ids are kept. Field names follow Meta's webhook reference (messages, smb_message_echoes, history):
// https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/reference/messages
// https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/reference/smb_message_echoes
// https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/reference/history

export type WaReferral = {
  source_url?: string;
  source_id?: string;
  source_type?: string; // "ad" | "post"
  ctwa_clid?: string;
  headline?: string;
  body?: string;
};

import { type Codes, parseCodes } from "@/lib/ingest/codes";

export type WaMessage = {
  id: string;
  from?: string; // the user's phone number; missing when the user has a username and hides the number
  from_user_id?: string; // BSUID, always present
  to?: string; // echoes: the user's phone number (may be missing)
  to_user_id?: string; // echoes: the user's BSUID
  timestamp?: string | number;
  type?: string;
  text?: { body?: string };
  image?: { caption?: string };
  video?: { caption?: string };
  document?: { caption?: string };
  referral?: WaReferral;
  /** added when trimmed: the attribution codes read from the text, so the text itself need not be kept */
  crm_codes?: Codes;
  /** added when trimmed (history): who sent it, worked out while the thread's context was still there */
  dir?: "in" | "out";
  [k: string]: unknown;
};

export type WaContact = { wa_id?: string; user_id?: string; profile?: { name?: string; username?: string } };

export type WaThread = { id?: string; context?: { wa_id?: string; user_id?: string; [k: string]: unknown }; messages?: WaMessage[] };
export type WaHistory = {
  metadata?: { phase?: number; chunk_order?: number; progress?: number };
  threads?: WaThread[];
  errors?: { code?: number; title?: string }[];
};

export type WaValue = {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: WaContact[];
  messages?: WaMessage[];
  message_echoes?: WaMessage[];
  statuses?: unknown[];
  history?: WaHistory[];
  event?: string; // account_update
  [k: string]: unknown;
};

export type WaChange = { field?: string; value?: WaValue };
export type WaEntry = { id?: string; changes?: WaChange[] };
export type WaPayload = { object?: string; entry?: WaEntry[] };

/** The text a person typed, if any: text body or a media caption. */
export function messageText(m: WaMessage): string | undefined {
  const text = m.text?.body ?? m.image?.caption ?? m.video?.caption ?? m.document?.caption;
  return typeof text === "string" && text.trim() ? text : undefined;
}

/** Meta's Unix seconds as ISO; now when missing, unreadable or out of range. */
export function messageTime(m: WaMessage): string {
  const n = Number(m.timestamp);
  const d = new Date(n * 1000);
  return Number.isFinite(n) && n > 0 && Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
}

/**
 * Who sent a history message. `from` is the customer's number when they sent it; when the number is hidden
 * (username), `from` is missing and from_user_id is compared with the thread's BSUID instead.
 */
export function historyDirection(thread: WaThread, m: WaMessage): "in" | "out" {
  if (m.dir === "in" || m.dir === "out") return m.dir;
  const ctx = thread.context ?? {};
  if (m.from !== undefined) return m.from === ctx.wa_id || m.from === thread.id ? "in" : "out";
  if (m.from_user_id !== undefined && ctx.user_id !== undefined) return m.from_user_id === ctx.user_id ? "in" : "out";
  return "out";
}

const str = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : undefined);

/**
 * A message with ids, time, type, the attribution codes and the ad referral ids only: no text, caption, media,
 * location or contact cards. `keepPeer: false` also drops the customer's number (history of non-customers).
 */
export function redactMessage(m: WaMessage, o: { keepPeer?: boolean } = {}): WaMessage {
  const out: WaMessage = { id: String(m.id ?? "") };
  const keys = o.keepPeer === false ? (["from_user_id", "to_user_id", "timestamp", "type"] as const)
    : (["from", "from_user_id", "to", "to_user_id", "timestamp", "type"] as const);
  for (const k of keys) {
    const v = str(m[k]);
    if (v !== undefined) out[k] = v;
  }
  const codes = m.crm_codes ?? parseCodes(messageText(m));
  if (codes.adCode || codes.clickCode) out.crm_codes = { ...(codes.adCode && { adCode: codes.adCode }), ...(codes.clickCode && { clickCode: codes.clickCode }) };
  if (m.dir) out.dir = m.dir;
  if (m.referral) {
    const { source_id, source_type, source_url, ctwa_clid } = m.referral;
    out.referral = { source_id: str(source_id), source_type: str(source_type), source_url: str(source_url), ctwa_clid: str(ctwa_clid) };
  }
  return out;
}

/** The ids of a webhook's contacts: no profile name or username. */
export function redactContacts(contacts: WaContact[] | undefined): WaContact[] | undefined {
  return contacts?.map((c) => ({ ...(c.wa_id && { wa_id: str(c.wa_id) }), ...(c.user_id && { user_id: str(c.user_id) }) }));
}

/**
 * A trimmed copy of one change's value: line ids, contact ids, redacted messages, history with each message's
 * direction. `isCustomer(waId)` says whether a history thread's number is already in the CRM; other threads keep
 * their BSUID only (no number, no context).
 */
export function redactValue(v: WaValue, isCustomer: (waId: string) => boolean = () => true): WaValue {
  const out: WaValue = {};
  if (v.metadata) out.metadata = { phone_number_id: str(v.metadata.phone_number_id) };
  if (v.event !== undefined) out.event = str(v.event);
  const contacts = redactContacts(v.contacts);
  if (contacts) out.contacts = contacts;
  if (v.messages) out.messages = v.messages.map((m) => redactMessage(m));
  if (v.message_echoes) out.message_echoes = v.message_echoes.map((m) => redactMessage(m));
  if (v.history) {
    out.history = v.history.map((h) => ({
      ...(h.metadata && { metadata: { phase: h.metadata.phase, chunk_order: h.metadata.chunk_order, progress: h.metadata.progress } }),
      ...(h.errors && { errors: h.errors.map((e) => ({ code: e.code })) }),
      ...(h.threads && {
        threads: h.threads.map((th) => {
          const waId = str(th.context?.wa_id);
          const keepPeer = Boolean(waId && isCustomer(waId));
          const userId = str(th.context?.user_id);
          return {
            context: { ...(keepPeer && { wa_id: waId }), ...(userId && { user_id: userId }) },
            messages: (th.messages ?? []).map((m) => redactMessage({ ...m, dir: historyDirection(th, m) }, { keepPeer })),
          };
        }),
      }),
    }));
  }
  return out;
}
