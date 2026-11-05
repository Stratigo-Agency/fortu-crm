import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { listNotifications, markAllRead, markRead, unreadCount } from "@/lib/notifications";
import { createDeal, createUser } from "./fixtures";

async function notify(userId: string, dealId: string, kind: string, o: { channel?: string; minutesAgo?: number } = {}) {
  const [{ id }] = await sql<{ id: string }[]>`
    INSERT INTO notifications (user_id, kind, deal_id, channel, payload, sent_at)
    VALUES (${userId}, ${kind}::notif_kind, ${dealId}, ${o.channel ?? "in_app"},
            ${sql.json({ kind, deal: { id: dealId, name: "Hotel Arunika", amount: 312000000, stage: "Negotiation", next_step: "Kirim revisi" }, owner: { name: "Dimas" } })},
            now() - make_interval(mins => ${o.minutesAgo ?? 0}::int))
    RETURNING id::text`;
  return id;
}

describe("the bell", () => {
  it("lists the person's own in-app notifications, newest first, with ready text and a link", async () => {
    const me = await createUser();
    const other = await createUser();
    const d = await createDeal(me.id);
    await notify(me.id, d.id, "stale_deal", { minutesAgo: 90 });
    await notify(me.id, d.id, "next_step_overdue", { minutesAgo: 5 });
    await notify(other.id, d.id, "won"); // someone else's
    await notify(me.id, d.id, "high_value_lead", { channel: "email" }); // an email record, not for the bell

    const items = await listNotifications(me.id);
    expect(items.map((i) => i.title)).toEqual(["Next step terlambat: Hotel Arunika", "Hotel Arunika belum bergerak"]);
    expect(items[0]).toMatchObject({ detail: "Kirim revisi", href: `/deal/${d.id}`, unread: true });
    expect(items[1].detail).toBe("Masih di Negotiation · Rp312 jt");
    expect(await unreadCount(me.id)).toBe(2);
  });

  it("shows at most 20", async () => {
    const me = await createUser();
    const d = await createDeal(me.id);
    for (let i = 0; i < 23; i++) await notify(me.id, d.id, "next_step_overdue", { minutesAgo: i * 1440 }); // one a day: the unique index
    expect(await listNotifications(me.id)).toHaveLength(20);
  });

  it("marking one as read changes only that one, and only for its owner", async () => {
    const me = await createUser();
    const other = await createUser();
    const d = await createDeal(me.id);
    const a = await notify(me.id, d.id, "stale_deal");
    await notify(me.id, d.id, "next_step_overdue");
    await markRead(other.id, a); // not theirs: nothing happens
    expect(await unreadCount(me.id)).toBe(2);
    await markRead(me.id, a);
    expect(await unreadCount(me.id)).toBe(1);
    await markRead(me.id, "1; DROP TABLE notifications"); // junk is ignored
    expect(await unreadCount(me.id)).toBe(1);
  });

  it("mark all read clears the person's count and nobody else's", async () => {
    const me = await createUser();
    const other = await createUser();
    const d = await createDeal(me.id);
    await notify(me.id, d.id, "stale_deal");
    await notify(other.id, d.id, "stale_deal");
    await markAllRead(me.id);
    expect(await unreadCount(me.id)).toBe(0);
    expect(await unreadCount(other.id)).toBe(1);
  });

  it("a person can get the same alert for one deal only once a day", async () => {
    const me = await createUser();
    const d = await createDeal(me.id);
    await notify(me.id, d.id, "stale_deal");
    await expect(notify(me.id, d.id, "stale_deal")).rejects.toThrow(/notifications_dedupe/);
  });
});
