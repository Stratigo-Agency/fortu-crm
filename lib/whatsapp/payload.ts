// The parts of a WhatsApp Business Platform webhook the CRM reads, and the redaction that keeps message text out
// of stored payloads. Field names follow Meta's webhook reference (messages, smb_message_echoes, history):
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
  [k: string]: unknown;
};

export type WaContact = { wa_id?: string; user_id?: string; profile?: { name?: string; username?: string } };

export type WaHistory = {
  metadata?: { phase?: number; chunk_order?: number; progress?: number };
  threads?: { id?: string; context?: { wa_id?: string; user_id?: string }; messages?: WaMessage[] }[];
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

/** Meta's Unix seconds as ISO; now when missing or unreadable. */
export function messageTime(m: WaMessage): string {
  const n = Number(m.timestamp);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : new Date().toISOString();
}

/** A message with ids, time, type and the ad referral ids only: no text, caption, media or location. */
export function redactMessage(m: WaMessage): WaMessage {
  const out: WaMessage = { id: m.id };
  for (const k of ["from", "from_user_id", "to", "to_user_id", "timestamp", "type"] as const) {
    if (m[k] !== undefined) out[k] = m[k] as never;
  }
  if (m.referral) {
    const { source_id, source_type, source_url, ctwa_clid } = m.referral;
    out.referral = { source_id, source_type, source_url, ctwa_clid };
  }
  return out;
}

/** A copy of one change's value with every message redacted. */
export function redactValue(v: WaValue): WaValue {
  return {
    ...v,
    ...(v.messages && { messages: v.messages.map(redactMessage) }),
    ...(v.message_echoes && { message_echoes: v.message_echoes.map(redactMessage) }),
    ...(v.history && {
      history: v.history.map((h) => ({
        ...h,
        ...(h.threads && { threads: h.threads.map((th) => ({ ...th, messages: (th.messages ?? []).map(redactMessage) })) }),
      })),
    }),
  };
}
