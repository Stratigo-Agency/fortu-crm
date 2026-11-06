import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { getLeadFunnel, leadFunnelRange } from "@/lib/leadFunnel";
import { addLineItem, createDeal, createLead, createUser } from "./fixtures";

// Lead dan funnel (migration 016): every figure is checked against numbers counted by hand.
// Each test uses its own month in 2019 (or its own rep), so the shared test database doesn't interfere.

type Stage = "quotation" | "negotiation" | "po" | "done" | "lost";

/** Moves a deal to a stage, filling what the stage rules ask for (products, close date, lost reason). */
async function move(dealId: string, stage: Stage) {
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM deal_line_items WHERE deal_id = ${dealId}`;
  if (n === 0 && stage !== "lost") await addLineItem(dealId, { qty: 1, unitPrice: 10_000_000 });
  await sql`
    UPDATE deals SET stage_id = (SELECT id FROM pipeline_stages WHERE key = ${stage}),
           expected_close_date = COALESCE(expected_close_date, jakarta_today() + 10),
           next_step = COALESCE(next_step, 'Follow up'), next_step_date = COALESCE(next_step_date, jakarta_today() + 2),
           lost_reason = CASE WHEN ${stage} = 'lost' THEN 'harga'::lost_reason END
     WHERE id = ${dealId}`;
}

/** A deal made from a lead (as Jadikan deal does), starting in Chat masuk, then moved along `path`. */
async function dealFrom(leadId: string, ownerId: string, path: Stage[] = []) {
  const d = await createDeal(ownerId);
  await sql`UPDATE deals SET lead_id = ${leadId} WHERE id = ${d.id}`;
  await sql`UPDATE leads SET status = 'converted', deal_id = ${d.id} WHERE id = ${leadId}`;
  for (const stage of path) await move(d.id, stage);
  return d.id;
}

const at = (day: string, time = "03:00:00") => `${day}T${time}Z`; // 10:00 in Jakarta

describe("lead_funnel: March 2019, counted by hand", () => {
  it("counts leads, handled, deals and every stage reached per source group, with conversions and the bottleneck", async () => {
    const rep = await createUser();
    const other = await createUser();
    const L = (source: string, o: { status?: string; receivedAt?: string } = {}) =>
      createLead(rep.id, { source, status: o.status ?? "new", receivedAt: o.receivedAt ?? at("2019-03-10") });

    // Iklan Meta (7)
    await L("meta_ctwa"); // 1 new, not handled
    await L("meta_ctwa", { status: "contacted" }); // 2 handled, no deal
    await dealFrom((await L("instagram_dm")).id, rep.id); // 3 open in Chat masuk
    await dealFrom((await L("meta_leadform")).id, rep.id, ["quotation", "lost"]); // 4 lost after Quotation
    await dealFrom((await L("meta_ctwa")).id, rep.id, ["po"]); // 5 skipped Quotation and Negotiation, open at PO
    await dealFrom((await L("meta_ctwa")).id, rep.id, ["quotation", "negotiation", "po", "done"]); // 6 done
    await dealFrom((await L("meta_ctwa")).id, rep.id, ["lost"]); // 7 lost in Chat masuk
    // Website (2)
    await dealFrom((await L("website_form")).id, rep.id, ["negotiation", "lost"]); // 8 lost after Negotiation
    const answered = await L("website_wa_link"); // 9 new, but answered
    await sql`UPDATE leads SET first_response_at = received_at + interval '5 minutes' WHERE id = ${answered.id}`;
    // Offline (1)
    await dealFrom((await L("walk_in")).id, rep.id, ["done"]); // 10 straight to Done deal
    // Jakarta boundary: 1 March 00:30 in Jakarta counts, 1 April 00:30 does not
    await L("other", { receivedAt: "2019-02-28T17:30:00Z" }); // 12
    await L("other", { receivedAt: "2019-03-31T17:30:00Z" });
    // a sample lead with a Done deal never counts
    const sample = await L("meta_ctwa");
    await dealFrom(sample.id, rep.id, ["done"]);
    await sql`UPDATE leads SET is_sample = true WHERE id = ${sample.id}`;
    // another rep's lead
    await createLead(other.id, { source: "whatsapp_direct", status: "contacted", receivedAt: at("2019-03-15") });

    const f = await leadFunnelRange(rep.id, "2019-03-01", "2019-03-31");
    expect(f.total).toMatchObject({
      leads: 11, handled: 9, deals: 7, quotation: 5, negotiation: 4, po: 3, done: 2, lost: 3, unhandled: 2,
      pct: { handled: 82, deal: 78, quotation: 71, negotiation: 80, po: 75, done: 67 },
      pctLeadToDone: 18,
      // steps with at least 5 entering: 82, 78, 71, 80 → Jadi deal → Quotation is the weakest
      bottleneck: { step: "quotation", pct: 71 },
      status: "found",
    });

    const g = Object.fromEntries(f.groups.map((r) => [r.group, r]));
    expect(f.groups.map((r) => r.group)).toEqual(["meta", "website", "offline", "wa_direct", "other"]);
    expect(g.meta).toMatchObject({
      leads: 7, handled: 6, deals: 5, quotation: 3, negotiation: 2, po: 2, done: 1, lost: 2, unhandled: 1,
      bottleneck: { step: "quotation", pct: 60 }, status: "found",
    });
    expect(g.website).toMatchObject({ leads: 2, handled: 2, deals: 1, quotation: 1, negotiation: 1, po: 0, done: 0, lost: 1, status: "insufficient", bottleneck: null });
    expect(g.offline).toMatchObject({ leads: 1, deals: 1, quotation: 1, negotiation: 1, po: 1, done: 1, lost: 0 });
    expect(g.wa_direct).toMatchObject({ leads: 0, pct: { handled: null } });
    expect(g.other).toMatchObject({ leads: 1, handled: 0, unhandled: 1 });

    const steps = Object.fromEntries(f.steps.map((s) => [s.step, s]));
    expect(steps.po).toMatchObject({ entered: 4, passed: 3, enoughData: false, isBottleneck: false });
    expect(steps.quotation).toMatchObject({ entered: 7, passed: 5, enoughData: true, isBottleneck: true });

    // All sales: the other rep's WhatsApp lead is in, sample rows are still out
    const all = await leadFunnelRange(null, "2019-03-01", "2019-03-31");
    expect(all.total).toMatchObject({ leads: 12, handled: 10, deals: 7, done: 2 });
    expect(all.groups.find((r) => r.group === "wa_direct")).toMatchObject({ leads: 1, handled: 1 });
    // the other rep sees only their own lead
    expect((await leadFunnelRange(other.id, "2019-03-01", "2019-03-31")).total).toMatchObject({ leads: 1, deals: 0 });
  });
});

describe("lead_funnel: threshold and median days", () => {
  it("says 'data belum cukup' below 5 leads entering a step, and finds the bottleneck once there are 5", async () => {
    const rep = await createUser();
    for (let i = 0; i < 4; i++) await createLead(rep.id, { source: "referral", status: "contacted", receivedAt: at("2019-04-05") });
    let f = await leadFunnelRange(rep.id, "2019-04-01", "2019-04-30");
    expect(f.total).toMatchObject({ leads: 4, handled: 4, deals: 0, status: "insufficient", bottleneck: null });
    expect(f.minEntering).toBe(5);

    await createLead(rep.id, { source: "referral", status: "contacted", receivedAt: at("2019-04-06") });
    f = await leadFunnelRange(rep.id, "2019-04-01", "2019-04-30");
    // 5 entered Ditangani → Jadi deal and none became a deal
    expect(f.total).toMatchObject({ leads: 5, deals: 0, status: "found", bottleneck: { step: "deal", pct: 0 } });
  });

  it("says nobody stopped when every step with enough leads passes them all", async () => {
    const rep = await createUser();
    for (let i = 0; i < 5; i++) {
      const l = await createLead(rep.id, { source: "event", receivedAt: at("2019-05-05") });
      await dealFrom(l.id, rep.id, ["done"]);
    }
    const f = await leadFunnelRange(rep.id, "2019-05-01", "2019-05-31");
    expect(f.total).toMatchObject({ leads: 5, done: 5, pctLeadToDone: 100, status: "none", bottleneck: null });
    expect(f.groups.find((g) => g.group === "offline")?.status).toBe("none");

    // the threshold is a setting: at 6, five leads are not enough to judge
    await sql`UPDATE app_settings SET value = '6' WHERE key = 'funnel_min_entering'`;
    try {
      const g = await leadFunnelRange(rep.id, "2019-05-01", "2019-05-31");
      expect(g.total.status).toBe("insufficient");
      expect(g.minEntering).toBe(6);
    } finally {
      await sql`UPDATE app_settings SET value = '5' WHERE key = 'funnel_min_entering'`;
    }
  });

  it("gives the median days spent in each stage and from lead to deal, for finished stays only", async () => {
    const rep = await createUser();
    const a = await createLead(rep.id, { source: "tender", receivedAt: at("2019-06-01") });
    const b = await createLead(rep.id, { source: "tender", receivedAt: at("2019-06-01") });
    const da = await dealFrom(a.id, rep.id, ["quotation", "negotiation"]);
    const db = await dealFrom(b.id, rep.id, ["quotation"]);
    // a: deal on 2 Jun (1 day after the lead), Chat masuk 2 days, Quotation 1 day, still in Negotiation
    // b: deal on 4 Jun (3 days after), Chat masuk 4 days, still in Quotation
    await sql`UPDATE deals SET created_at = ${at("2019-06-02")} WHERE id = ${da}`;
    await sql`UPDATE deals SET created_at = ${at("2019-06-04")} WHERE id = ${db}`;
    const setAt = (deal: string, stage: string, day: string) => sql`
      UPDATE deal_stage_history SET changed_at = ${at(day)}
       WHERE deal_id = ${deal} AND to_stage_id = (SELECT id FROM pipeline_stages WHERE key = ${stage})`;
    await setAt(da, "chat", "2019-06-02");
    await setAt(da, "quotation", "2019-06-04");
    await setAt(da, "negotiation", "2019-06-05");
    await setAt(db, "chat", "2019-06-04");
    await setAt(db, "quotation", "2019-06-08");

    const f = await leadFunnelRange(rep.id, "2019-06-01", "2019-06-30");
    const days = Object.fromEntries(f.steps.map((s) => [s.step, s.medianDays]));
    expect(days).toEqual({ handled: null, deal: 2, quotation: 3, negotiation: 1, po: null, done: null });
  });
});

describe("getLeadFunnel", () => {
  it("covers this month up to today in Jakarta, and leaves out leads received before it", async () => {
    const rep = await createUser();
    await createLead(rep.id, { source: "meta_ctwa" });
    await createLead(rep.id, { source: "website_form", status: "contacted" });
    const [{ before }] = await sql<{ before: string }[]>`
      SELECT ((date_trunc('month', jakarta_today()::timestamp) - interval '1 hour') AT TIME ZONE 'Asia/Jakarta')::text AS before`;
    await createLead(rep.id, { source: "meta_ctwa", receivedAt: before });
    const f = await getLeadFunnel(rep.id, "month");
    expect(f.total).toMatchObject({ leads: 2, handled: 1, unhandled: 1 });
    expect(f.groups.find((g) => g.group === "meta")?.leads).toBe(1);
    expect(f.groups.find((g) => g.group === "website")?.leads).toBe(1);
    const year = await getLeadFunnel(rep.id, "year");
    expect(year.total.leads).toBeGreaterThanOrEqual(2);
  });
});
