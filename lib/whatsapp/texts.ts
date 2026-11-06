import { sql } from "@/lib/db";
import type { Tx } from "@/lib/ingest/owner";

// Message text kept for lines with store_message_text on. Unlike the rest of the CRM (view all), only the line's
// owner, the ceo and admin may read it: these are a rep's own chats. The text is never copied to leads.first_message
// (everyone can read and search that column).

export type MessageText = { waMessageId: string; direction: "in" | "out"; sentAt: Date; body: string };

/** The role is read from the database, so a demoted account loses access at once. */
export async function readMessageTexts(user: { id: string }, leadId: string): Promise<MessageText[]> {
  return sql<MessageText[]>`
    SELECT m.wa_message_id AS "waMessageId", m.direction, m.sent_at AS "sentAt", t.body
      FROM wa_messages m
      JOIN wa_message_texts t ON t.message_id = m.id
      JOIN wa_lines l ON l.id = m.wa_line_id
      JOIN users u ON u.id = ${user.id} AND u.is_active
     WHERE m.lead_id = ${leadId}
       AND (u.role IN ('ceo', 'admin') OR l.user_id = u.id)
     ORDER BY m.sent_at`;
}

/**
 * The customer's first kept message of each lead, for Prospek and the deal: only the leads this user may read
 * (line owner, ceo, admin). Leads without kept text, or not readable, are missing from the map.
 */
export async function firstChatTexts(user: { id: string }, leadIds: string[]): Promise<Map<string, string>> {
  if (leadIds.length === 0) return new Map();
  const rows = await sql<{ lead_id: string; body: string }[]>`
    SELECT DISTINCT ON (m.lead_id) m.lead_id, t.body
      FROM wa_messages m
      JOIN wa_message_texts t ON t.message_id = m.id
      JOIN wa_lines l ON l.id = m.wa_line_id
      JOIN users u ON u.id = ${user.id} AND u.is_active
     WHERE m.lead_id = ANY(${leadIds}::uuid[]) AND m.direction = 'in'
       AND (u.role IN ('ceo', 'admin') OR l.user_id = u.id)
     ORDER BY m.lead_id, m.sent_at, m.id`;
  return new Map(rows.map((r) => [r.lead_id, r.body]));
}

/**
 * Deletes every kept text of a line: wa_message_texts, and any text that reached leads.first_message for the
 * line's webhook leads (rows written before the text was kept apart). For text off, consent withdrawn, a
 * reconnect and a disconnect in the phone app.
 */
export async function clearLineText(tx: Tx, lineId: string): Promise<void> {
  await tx`DELETE FROM wa_message_texts t USING wa_messages m WHERE m.id = t.message_id AND m.wa_line_id = ${lineId}`;
  await tx`
    UPDATE leads SET first_message = NULL
     WHERE wa_line_id = ${lineId} AND capture_method = 'cloud_api_webhook' AND first_message IS NOT NULL`;
}
