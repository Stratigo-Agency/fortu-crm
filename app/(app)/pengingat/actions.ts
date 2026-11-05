"use server";

import { requireUser } from "@/lib/authz";
import { type BellItem, listNotifications, markAllRead, markRead, unreadCount } from "@/lib/notifications";

export type BellState = { items: BellItem[]; unread: number };

/** The bell's content for the signed-in person. */
export async function loadBellAction(): Promise<BellState> {
  const user = await requireUser();
  const [items, unread] = await Promise.all([listNotifications(user.id), unreadCount(user.id)]);
  return { items, unread };
}

export async function markReadAction(id: string): Promise<void> {
  const user = await requireUser();
  await markRead(user.id, id);
}

export async function markAllReadAction(): Promise<void> {
  const user = await requireUser();
  await markAllRead(user.id);
}

/** Just the number on the bell, to keep it fresh without loading the list. */
export async function unreadCountAction(): Promise<number> {
  const user = await requireUser();
  return unreadCount(user.id);
}
