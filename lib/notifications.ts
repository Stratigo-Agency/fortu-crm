import { sql } from "@/lib/db";
import { relTime } from "@/lib/format";
import { type AlertKind, type AlertPayload, notificationText } from "@/lib/notificationText";

// The bell: a person's own in-app notifications. A person reads and marks only their own.

export type BellItem = { id: string; title: string; detail: string; href: string | null; at: string; unread: boolean };

export async function unreadCount(userId: string): Promise<number> {
  const [{ n }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM notifications WHERE user_id = ${userId} AND channel = 'in_app' AND read_at IS NULL`;
  return n;
}

/** The latest notifications (default 20), newest first, with their text ready to show. */
export async function listNotifications(userId: string, limit = 20): Promise<BellItem[]> {
  const rows = await sql<{ id: string; kind: AlertKind; deal_id: string | null; payload: AlertPayload; sent_at: Date; read_at: Date | null }[]>`
    SELECT id::text AS id, kind::text AS kind, deal_id, payload, sent_at, read_at FROM notifications
     WHERE user_id = ${userId} AND channel = 'in_app'
     ORDER BY sent_at DESC, id DESC LIMIT ${limit}`;
  return rows.map((r) => {
    const { title, detail } = notificationText(r.kind, r.payload);
    return { id: r.id, title, detail, href: r.deal_id ? `/deal/${r.deal_id}` : null, at: relTime(r.sent_at), unread: r.read_at === null };
  });
}

/** Marks one of the person's own notifications as read (someone else's id changes nothing). */
export async function markRead(userId: string, id: string): Promise<void> {
  if (!/^\d+$/.test(id)) return;
  await sql`UPDATE notifications SET read_at = now() WHERE id = ${id}::bigint AND user_id = ${userId} AND read_at IS NULL`;
}

export async function markAllRead(userId: string): Promise<void> {
  await sql`UPDATE notifications SET read_at = now() WHERE user_id = ${userId} AND channel = 'in_app' AND read_at IS NULL`;
}
