import { describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/authz";
import { sql } from "@/lib/db";
import { boardCards, boardColumns, moveDeal, pipelineStats, UnknownStageError } from "@/lib/pipeline";
import { addLineItem, createContact, createDealFor, createQuotableDeal, createUser } from "./fixtures";

const stageOf = async (id: string) => {
  const [r] = await sql`SELECT s.key FROM deals d JOIN pipeline_stages s ON s.id = d.stage_id WHERE d.id = ${id}`;
  return r.key as string;
};
const history = (id: string) =>
  sql`SELECT f.key AS from_key, t.key AS to_key, h.changed_by
        FROM deal_stage_history h
        LEFT JOIN pipeline_stages f ON f.id = h.from_stage_id
        JOIN pipeline_stages t ON t.id = h.to_stage_id
       WHERE h.deal_id = ${id} AND h.from_stage_id IS NOT NULL ORDER BY h.id`;

describe("moveDeal", () => {
  it("writes exactly one stage history row with changed_by = the actor", async () => {
    const rep = await createUser();
    const deal = await createQuotableDeal(rep.id);
    const r = await moveDeal(rep, deal.id, "quotation");
    expect(r).toEqual({ ok: true, from: "chat", previous: expect.objectContaining({ nextStep: "Telepon" }) });
    expect(await stageOf(deal.id)).toBe("quotation");
    expect(await history(deal.id)).toEqual([{ from_key: "chat", to_key: "quotation", changed_by: rep.id }]);
  });

  it("records a sales lead moving someone else's deal as that sales lead", async () => {
    const rep = await createUser();
    const lead = await createUser({ role: "sales_lead" });
    const deal = await createQuotableDeal(rep.id);
    await moveDeal(lead, deal.id, "quotation");
    expect((await history(deal.id))[0].changed_by).toBe(lead.id);
  });

  it("refuses a rep moving another rep's deal: ForbiddenError, stage and history unchanged", async () => {
    const owner = await createUser();
    const other = await createUser();
    const marketing = await createUser({ role: "marketing" });
    const deal = await createQuotableDeal(owner.id);
    for (const who of [other, marketing]) {
      await expect(moveDeal(who, deal.id, "quotation")).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(await stageOf(deal.id)).toBe("chat");
    expect(await history(deal.id)).toHaveLength(0);
  });

  it("returns the stage rule when products or a close date are missing, and changes nothing", async () => {
    const rep = await createUser();
    const bare = await createDealFor((await createContact()).id, rep.id);
    expect(await moveDeal(rep, bare.id, "quotation")).toEqual({ ok: false, rule: "products" });
    await addLineItem(bare.id);
    expect(await moveDeal(rep, bare.id, "quotation")).toEqual({ ok: false, rule: "close_date" });
    expect(await stageOf(bare.id)).toBe("chat");
    expect(await history(bare.id)).toHaveLength(0);
  });

  it("returns lost_reason when moving to Lost without a reason", async () => {
    const rep = await createUser();
    const deal = await createQuotableDeal(rep.id);
    expect(await moveDeal(rep, deal.id, "lost")).toEqual({ ok: false, rule: "lost_reason" });
    expect(await stageOf(deal.id)).toBe("chat");
  });

  it("undo moves the deal back, also from Done deal where the next step was cleared", async () => {
    const rep = await createUser();
    const deal = await createQuotableDeal(rep.id);
    await moveDeal(rep, deal.id, "quotation");
    const done = await moveDeal(rep, deal.id, "done");
    if (!done.ok) throw new Error(`unexpected rule ${done.rule}`);
    const [cleared] = await sql`SELECT next_step, closed_on FROM deals WHERE id = ${deal.id}`;
    expect(cleared.next_step).toBeNull();
    expect(cleared.closed_on).not.toBeNull();

    // undo = the same move back, with what the move cleared
    const back = await moveDeal(rep, deal.id, done.from, done.previous);
    expect(back.ok).toBe(true);
    expect(await stageOf(deal.id)).toBe("quotation");
    const [restored] = await sql`SELECT next_step, closed_on FROM deals WHERE id = ${deal.id}`;
    expect(restored).toEqual({ next_step: "Telepon", closed_on: null });
    expect((await history(deal.id)).map((h) => h.to_key)).toEqual(["quotation", "done", "quotation"]);
  });

  it("does nothing for a move to the same stage, and refuses unknown stages and bad ids", async () => {
    const rep = await createUser();
    const deal = await createQuotableDeal(rep.id);
    expect((await moveDeal(rep, deal.id, "chat")).ok).toBe(true);
    expect(await history(deal.id)).toHaveLength(0);
    await expect(moveDeal(rep, deal.id, "won")).rejects.toBeInstanceOf(UnknownStageError);
    await expect(moveDeal(rep, "nope", "quotation")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("board reads", () => {
  it("columns follow the stages, Lost only when shown, and counts and amounts come from SQL", async () => {
    const rep = await createUser();
    const a = await createQuotableDeal(rep.id);
    await createQuotableDeal(rep.id);
    await moveDeal(rep, a.id, "quotation");
    const f = { viewerId: rep.id, ownerId: rep.id, q: "", showLost: false };
    const cols = await boardColumns(f);
    expect(cols.map((c) => c.key)).toEqual(["chat", "quotation", "negotiation", "po", "done"]);
    const byKey = Object.fromEntries(cols.map((c) => [c.key, c]));
    expect(byKey.chat).toMatchObject({ deal_count: 1, amount: "50000000", probability: "0.100" });
    expect(byKey.quotation).toMatchObject({ deal_count: 1, amount: "50000000" });
    expect((await boardColumns({ ...f, showLost: true })).map((c) => c.key)).toContain("lost");
  });

  it("cards say whether the viewer may move them, and search finds deal, contact and SKU", async () => {
    const rep = await createUser();
    const other = await createUser();
    const mine = await createQuotableDeal(rep.id);
    const theirs = await createQuotableDeal(other.id);
    await sql`UPDATE deals SET name = 'Hotel Arunika · lobi' WHERE id = ${mine.id}`;
    const cards = await boardCards({ viewerId: rep.id, ownerId: null, q: "", showLost: false });
    const by = (id: string) => cards.find((c) => c.id === id)!;
    expect(by(mine.id).can_edit).toBe(true);
    expect(by(theirs.id).can_edit).toBe(false);
    expect(by(mine.id)).toMatchObject({ amount: "50000000", has_products: true, screen_units: 2 });

    const [{ sku }] = await sql`
      SELECT p.sku FROM deal_line_items li JOIN products p ON p.id = li.product_id WHERE li.deal_id = ${mine.id}`;
    for (const q of ["arunika", sku as string]) {
      const found = await boardCards({ viewerId: rep.id, ownerId: rep.id, q, showLost: false });
      expect(found.map((c) => c.id), q).toContain(mine.id);
    }
  });

  it("the stat strip follows the owner and flags overdue next steps", async () => {
    const rep = await createUser();
    const d = await createQuotableDeal(rep.id);
    await sql`UPDATE deals SET next_step_date = jakarta_today() - 3 WHERE id = ${d.id}`; // Jakarta, not UTC
    const s = await pipelineStats(rep.id);
    expect(s).toMatchObject({ open_deals: 1, open_amount: "50000000", next_step_overdue: 1 });
    const [card] = await boardCards({ viewerId: rep.id, ownerId: rep.id, q: "", showLost: false });
    expect(card).toMatchObject({ next_step_overdue: true, days_overdue: 3 });
  });
});

describe("Lost → Done deal", () => {
  it("records today as the payment date, not the day it was lost", async () => {
    const rep = await createUser();
    const deal = await createQuotableDeal(rep.id);
    await sql`SELECT set_config('app.user_id', ${rep.id}, false)`;
    await sql`UPDATE deals SET lost_reason = 'harga' WHERE id = ${deal.id}`;
    expect((await moveDeal(rep, deal.id, "lost")).ok).toBe(true);
    await sql`UPDATE deals SET closed_on = jakarta_today() - 10 WHERE id = ${deal.id}`; // lost ten days ago
    expect((await moveDeal(rep, deal.id, "done")).ok).toBe(true);
    const [row] = await sql`SELECT closed_on = jakarta_today() AS today FROM deals WHERE id = ${deal.id}`;
    expect(row.today).toBe(true);
  });
});

describe("stageRuleOf", () => {
  it("reads the rule from any Postgres-shaped error, and ignores everything else", async () => {
    const { stageRuleOf } = await import("@/lib/pipeline");
    // shaped like postgres.js's PostgresError, but not that class (as when Next loads the package twice)
    const foreign = Object.assign(new Error("stage_rule:products"), { name: "PostgresError", code: "23514" });
    expect(stageRuleOf(foreign)).toBe("products");
    expect(stageRuleOf(new Error("stage_rule:products"))).toBeNull();
    expect(stageRuleOf(Object.assign(new Error("stage_rule:bogus"), { name: "PostgresError", code: "23514" }))).toBeNull();
    expect(stageRuleOf(null)).toBeNull();
  });
});
