import { sql } from "@/lib/db";

// Message text kept for lines with store_message_text on. Unlike the rest of the CRM (view all), only the line's
// owner, the ceo and admin may read it: these are a rep's own chats.

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
