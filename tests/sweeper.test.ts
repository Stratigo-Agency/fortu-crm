import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { notificationText } from "@/lib/notificationText";
import { runSweep } from "@/lib/sweeper";
import { addLineItem, createDeal, createUser } from "./fixtures";

// Tests share one database, so every check looks only at the notifications of its own deal.

type Stage = "chat" | "quotation" | "negotiation" | "po" | "done";

/** A deal worth `amount` (one line) at `stage`, last touched `idleDays` ago, with its next step in `nextStepDays` days. */
async function deal(ownerId: string, o: { amount: number; stage: Stage; idleDays?: number; nextStepDays?: number }) {
  const d = await createDeal(ownerId);
  if (o.stage !== "chat") await addLineItem(d.id, { qty: 1, unitPrice: o.amount });
  else await sql`UPDATE deals SET est_amount = ${o.amount} WHERE id = ${d.id}`;
  await sql`
    UPDATE deals SET stage_id = (SELECT id FROM pipeline_stages WHERE key = ${o.stage}),
           expected_close_date = jakarta_today() + 20,
           next_step_date = jakarta_today() + ${o.nextStepDays ?? 5}::int,
           closed_on = ${o.stage === "done" ? sql`jakarta_today()` : null}
     WHERE id = ${d.id}`;
  if (o.idleDays) await age(d.id, o.idleDays);
  return d.id;
}

/** Makes a deal look untouched for `days` (the update trigger would reset it, so it is switched off for this one statement). */
async function age(dealId: string, days: number) {
  await sql.begin(async (tx) => {
    await tx`SET LOCAL session_replication_role = replica`;
    await tx`UPDATE deals SET updated_at = now() - make_interval(days => ${days}::int) WHERE id = ${dealId}`;
  });
}

/** Moves every notification of a deal one day back, as if the sweeper had run yesterday. */
async function yesterday(dealId: string) {
  await sql`UPDATE notifications SET sent_at = sent_at - interval '1 day' WHERE deal_id = ${dealId}`;
}

async function alerts(dealId: string, kind?: string) {
  return sql<{ user_id: string; kind: string; channel: string; payload: Record<string, unknown> & { deal: { next_step?: string; url?: string; name?: string; amount?: number; stage?: string; id?: string }; owner: { id: string } } }[]>`
    SELECT user_id, kind::text AS kind, channel, payload FROM notifications
     WHERE deal_id = ${dealId} AND channel = 'in_app' AND (${kind ?? null}::text IS NULL OR kind::text = ${kind ?? null}) ORDER BY id`;
}

describe("stale deals", () => {
  it("a Rp150 jt deal in Negotiation for 8 days: the owner on day 1, the CEO on day 2, nobody twice", async () => {
    const owner = await createUser();
    const ceo = await createUser({ role: "ceo" });
    const id = await deal(owner.id, { amount: 150_000_000, stage: "negotiation", idleDays: 8 });

    await runSweep();
    expect((await alerts(id, "stale_deal")).map((a) => a.user_id)).toEqual([owner.id]);

    // running again the same day adds nothing for this deal
    await runSweep();
    expect((await alerts(id, "stale_deal")).map((a) => a.user_id)).toEqual([owner.id]);

    // the next day the CEO hears, once; the owner is not told again
    await yesterday(id);
    await runSweep();
    // (other test files add CEOs at the same time, so count the two people of this test)
    const count = async (uid: string) => (await alerts(id, "stale_deal")).filter((a) => a.user_id === uid).length;
    expect([await count(owner.id), await count(ceo.id)]).toEqual([1, 1]);
    await runSweep();
    expect([await count(owner.id), await count(ceo.id)]).toEqual([1, 1]);
  });

  it("a deal below the high-value line, or not stale yet, makes no stale alert", async () => {
    const owner = await createUser();
    const small = await deal(owner.id, { amount: 20_000_000, stage: "negotiation", idleDays: 30 });
    const fresh = await deal(owner.id, { amount: 150_000_000, stage: "negotiation", idleDays: 1 });
    await runSweep();
    expect(await alerts(small, "stale_deal")).toHaveLength(0);
    expect(await alerts(fresh, "stale_deal")).toHaveLength(0);
  });

  it("an update starts a new episode: when it goes stale again the owner is told again", async () => {
    const owner = await createUser();
    const id = await deal(owner.id, { amount: 150_000_000, stage: "negotiation", idleDays: 9 });
    await runSweep();
    expect(await alerts(id, "stale_deal")).toHaveLength(1);
    await sql`UPDATE deals SET next_step = 'Telepon lagi' WHERE id = ${id}`; // updated_at = now: not stale
    await runSweep();
    expect(await alerts(id, "stale_deal")).toHaveLength(1);
    // time passes: the first alert is now older than the update, and the deal sits idle again
    await sql`UPDATE notifications SET sent_at = sent_at - interval '20 days' WHERE deal_id = ${id}`;
    await age(id, 9);
    await runSweep();
    expect((await alerts(id, "stale_deal")).filter((a) => a.user_id === owner.id)).toHaveLength(2);
  });
});

describe("overdue next step", () => {
  it("goes to the owner only, once a day", async () => {
    const owner = await createUser();
    await createUser({ role: "ceo" });
    const id = await deal(owner.id, { amount: 30_000_000, stage: "quotation", nextStepDays: -2 });
    await runSweep();
    await runSweep();
    const a = await alerts(id, "next_step_overdue");
    expect(a.map((x) => x.user_id)).toEqual([owner.id]);
    expect(a[0].payload.deal.next_step).toBe("Telepon");
    // the next day it reminds again
    await yesterday(id);
    await runSweep();
    expect(await alerts(id, "next_step_overdue")).toHaveLength(2);
  });

  it("a deal whose next step is today or later is left alone", async () => {
    const owner = await createUser();
    const id = await deal(owner.id, { amount: 30_000_000, stage: "quotation", nextStepDays: 0 });
    await runSweep();
    expect(await alerts(id, "next_step_overdue")).toHaveLength(0);
  });
});

describe("high value, won and discount", () => {
  it("a Rp100 jt deal tells the CEO and the sales leads once, and again when it is re-priced", async () => {
    const owner = await createUser();
    const ceo = await createUser({ role: "ceo" });
    const lead = await createUser({ role: "sales_lead" });
    const id = await deal(owner.id, { amount: 120_000_000, stage: "quotation" });
    await runSweep();
    await runSweep();
    const first = await alerts(id, "high_value_lead");
    expect(first.map((a) => a.user_id)).toEqual(expect.arrayContaining([ceo.id, lead.id]));
    expect(first.map((a) => a.user_id)).not.toContain(owner.id);
    const n = first.length;
    expect(first[0].payload).toMatchObject({ kind: "high_value_lead", deal: { id, name: "Uji deal", amount: 120_000_000, stage: "Quotation" } });
    expect(first[0].payload.deal.url).toMatch(/\/deal\//);
    expect(first[0].payload.owner.id).toBe(owner.id);

    await sql`UPDATE deal_line_items SET unit_price = 150000000 WHERE deal_id = ${id}`; // re-priced
    await yesterday(id);
    await runSweep();
    expect((await alerts(id, "high_value_lead")).length).toBe(n * 2);
  });

  it("a big deal nobody has touched for weeks is not announced as new", async () => {
    const owner = await createUser();
    const id = await deal(owner.id, { amount: 300_000_000, stage: "quotation", idleDays: 10 });
    await runSweep();
    expect(await alerts(id, "high_value_lead")).toHaveLength(0);
  });

  it("a deal under the line makes no high-value alert", async () => {
    const owner = await createUser();
    const id = await deal(owner.id, { amount: 50_000_000, stage: "quotation" });
    await runSweep();
    expect(await alerts(id, "high_value_lead")).toHaveLength(0);
  });

  it("a deal paid today tells the CEO, the sales leads and the owner", async () => {
    const owner = await createUser();
    const ceo = await createUser({ role: "ceo" });
    const lead = await createUser({ role: "sales_lead" });
    const other = await createUser(); // another rep: not told
    const id = await deal(owner.id, { amount: 40_000_000, stage: "done" });
    await runSweep();
    const ids = (await alerts(id, "won")).map((a) => a.user_id);
    expect(ids).toEqual(expect.arrayContaining([owner.id, ceo.id, lead.id]));
    expect(ids).not.toContain(other.id);
    await runSweep();
    expect(await alerts(id, "won")).toHaveLength(ids.length);
  });

  it("a discount above the limit asks the CEO once", async () => {
    const owner = await createUser();
    const ceo = await createUser({ role: "ceo" });
    const id = await deal(owner.id, { amount: 10_000_000, stage: "quotation" });
    await sql`UPDATE products SET list_price = 20000000 WHERE id = (SELECT product_id FROM deal_line_items WHERE deal_id = ${id})`; // 50% off MSRP
    await runSweep();
    await yesterday(id);
    await runSweep();
    const a = await alerts(id, "discount_approval");
    expect(a.map((x) => x.user_id)).toContain(ceo.id);
    expect(a.filter((x) => x.user_id === ceo.id)).toHaveLength(1);
    expect(a.map((x) => x.user_id)).not.toContain(owner.id);

    // re-priced (still over the limit): asked again, once more
    await sql`UPDATE deal_line_items SET unit_price = 12000000 WHERE deal_id = ${id}`;
    await runSweep();
    expect((await alerts(id, "discount_approval")).filter((x) => x.user_id === ceo.id)).toHaveLength(2);
  });

  it("an inactive owner is not notified; the sales leads and the CEO hear instead", async () => {
    const owner = await createUser({ isActive: false });
    const ceo = await createUser({ role: "ceo" });
    const lead = await createUser({ role: "sales_lead" });
    const id = await deal(owner.id, { amount: 30_000_000, stage: "quotation", nextStepDays: -3 });
    await runSweep();
    const ids = (await alerts(id, "next_step_overdue")).map((a) => a.user_id);
    expect(ids).not.toContain(owner.id);
    expect(ids).toEqual(expect.arrayContaining([ceo.id, lead.id]));
  });

  it("a big stale deal whose owner is gone goes straight to the CEO, once", async () => {
    const owner = await createUser({ isActive: false });
    const ceo = await createUser({ role: "ceo" });
    const id = await deal(owner.id, { amount: 150_000_000, stage: "negotiation", idleDays: 8 });
    await runSweep();
    await runSweep();
    const stale = (await alerts(id, "stale_deal")).filter((a) => a.user_id === ceo.id);
    expect(stale).toHaveLength(1);
    expect((await alerts(id, "stale_deal")).map((a) => a.user_id)).not.toContain(owner.id);
  });

  it("a deal that went Done after hours or was paid in the past is still announced once, and an old one is not", async () => {
    const owner = await createUser();
    const ceo = await createUser({ role: "ceo" });
    const lateNight = await deal(owner.id, { amount: 40_000_000, stage: "done" });
    await sql`UPDATE deals SET closed_on = jakarta_today() - 3 WHERE id = ${lateNight}`; // payment date in the past
    await sql.begin(async (tx) => {
      await tx`SET LOCAL session_replication_role = replica`;
      await tx`UPDATE deals SET stage_entered_at = now() - interval '30 hours' WHERE id = ${lateNight}`; // since yesterday evening
    });
    const old = await deal(owner.id, { amount: 40_000_000, stage: "done" });
    await sql.begin(async (tx) => {
      await tx`SET LOCAL session_replication_role = replica`;
      await tx`UPDATE deals SET stage_entered_at = now() - interval '5 days' WHERE id = ${old}`;
    });
    await runSweep();
    await yesterday(lateNight);
    await runSweep();
    expect((await alerts(lateNight, "won")).filter((a) => a.user_id === ceo.id)).toHaveLength(1);
    expect(await alerts(old, "won")).toHaveLength(0);
  });
});

describe("what the bell says", () => {
  it("builds the title and detail from the payload", () => {
    const p = { deal: { name: "Hotel Arunika", amount: 312_000_000, stage: "Negotiation", next_step: "Kirim revisi" }, owner: { name: "Dimas" } };
    expect(notificationText("high_value_lead", p)).toEqual({ title: "Deal besar: Hotel Arunika", detail: "Rp312 jt · Dimas" });
    expect(notificationText("stale_deal", p)).toEqual({ title: "Hotel Arunika belum bergerak", detail: "Masih di Negotiation · Rp312 jt" });
    expect(notificationText("next_step_overdue", p)).toEqual({ title: "Next step terlambat: Hotel Arunika", detail: "Kirim revisi" });
  });
});
