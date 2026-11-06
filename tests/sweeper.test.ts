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
  it("a Rp150 jt deal in Negotiation for 8 days: the owner hears once, the CEO and the sales leads never", async () => {
    const owner = await createUser();
    await createUser({ role: "ceo" });
    await createUser({ role: "sales_lead" });
    const id = await deal(owner.id, { amount: 150_000_000, stage: "negotiation", idleDays: 8 });

    await runSweep();
    expect((await alerts(id, "stale_deal")).map((a) => a.user_id)).toEqual([owner.id]);

    // running again the same day adds nothing for this deal
    await runSweep();
    expect((await alerts(id, "stale_deal")).map((a) => a.user_id)).toEqual([owner.id]);

    // the next day nobody else is told, and the owner is not told again
    await yesterday(id);
    await runSweep();
    await runSweep();
    expect((await alerts(id)).map((a) => a.user_id)).toEqual([owner.id]);
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

describe("nothing about other people's deals", () => {
  // Pak Jovian asked not to be alerted about deals (big, stuck, won or discounted): the CEO, the sales
  // leads and the admins get nothing from the sweeper, whatever the deal looks like.
  async function bosses() {
    return [await createUser({ role: "ceo" }), await createUser({ role: "sales_lead" }), await createUser({ role: "admin" })].map((u) => u.id);
  }
  async function toBosses(dealId: string, ids: string[]) {
    const [{ n }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM notifications WHERE deal_id = ${dealId} AND user_id = ANY(${ids}::uuid[])`;
    return n;
  }

  it("a new big deal tells nobody", async () => {
    const owner = await createUser();
    const ids = await bosses();
    const id = await deal(owner.id, { amount: 300_000_000, stage: "quotation" });
    await runSweep();
    await sql`UPDATE deal_line_items SET unit_price = 400000000 WHERE deal_id = ${id}`; // re-priced
    await runSweep();
    expect(await alerts(id)).toHaveLength(0);
    expect(await toBosses(id, ids)).toBe(0);
  });

  it("a deal paid today tells nobody, not even its owner", async () => {
    const owner = await createUser();
    const ids = await bosses();
    const id = await deal(owner.id, { amount: 140_000_000, stage: "done" });
    await runSweep();
    expect(await alerts(id)).toHaveLength(0);
    expect(await toBosses(id, ids)).toBe(0);
  });

  it("a discount above the limit tells nobody (Laporan lists it for approval)", async () => {
    const owner = await createUser();
    const ids = await bosses();
    const id = await deal(owner.id, { amount: 10_000_000, stage: "quotation" });
    await sql`UPDATE products SET list_price = 20000000 WHERE id = (SELECT product_id FROM deal_line_items WHERE deal_id = ${id})`; // 50% off MSRP
    const [{ needs }] = await sql<{ needs: boolean }[]>`SELECT needs_discount_approval AS needs FROM v_deals_enriched WHERE id = ${id}`;
    expect(needs).toBe(true);
    await runSweep();
    expect(await alerts(id)).toHaveLength(0);
    expect(await toBosses(id, ids)).toBe(0);
  });

  it("a big stale deal tells only its owner, even after days", async () => {
    const owner = await createUser();
    const ids = await bosses();
    const id = await deal(owner.id, { amount: 500_000_000, stage: "po", idleDays: 30, nextStepDays: -4 });
    await runSweep();
    await yesterday(id);
    await runSweep();
    expect(new Set((await alerts(id)).map((a) => a.user_id))).toEqual(new Set([owner.id]));
    expect(await toBosses(id, ids)).toBe(0);
  });

  it("a deal whose owner is gone tells nobody (not the CEO, not the sales leads)", async () => {
    const owner = await createUser({ isActive: false });
    const ids = await bosses();
    const overdue = await deal(owner.id, { amount: 30_000_000, stage: "quotation", nextStepDays: -3 });
    const stale = await deal(owner.id, { amount: 150_000_000, stage: "negotiation", idleDays: 8 });
    await runSweep();
    expect(await alerts(overdue)).toHaveLength(0);
    expect(await alerts(stale)).toHaveLength(0);
    expect((await toBosses(overdue, ids)) + (await toBosses(stale, ids))).toBe(0);
  });

  it("the CEO's own deal still reminds the CEO, as its owner", async () => {
    const ceo = await createUser({ role: "ceo" });
    const id = await deal(ceo.id, { amount: 30_000_000, stage: "quotation", nextStepDays: -1 });
    await runSweep();
    expect((await alerts(id, "next_step_overdue")).map((a) => a.user_id)).toEqual([ceo.id]);
  });
});

describe("what the bell says", () => {
  it("builds the title and detail from the payload", () => {
    const p = { deal: { name: "Hotel Arunika", amount: 312_000_000, stage: "Negotiation", next_step: "Kirim revisi" }, owner: { name: "Dimas" } };
    // an old row from before the change still reads well
    expect(notificationText("high_value_lead", p)).toEqual({ title: "Deal besar: Hotel Arunika", detail: "Rp312 jt · Dimas" });
    expect(notificationText("stale_deal", p)).toEqual({ title: "Hotel Arunika belum bergerak", detail: "Masih di Negotiation · Rp312 jt" });
    expect(notificationText("next_step_overdue", p)).toEqual({ title: "Next step terlambat: Hotel Arunika", detail: "Kirim revisi" });
  });
});
