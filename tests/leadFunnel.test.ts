import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { leadTrace } from "@/lib/deal";
import { pageOf } from "@/lib/format";
import { getLeadFunnel, leadFunnelRange, parseSourceGroup, type LeadFunnel } from "@/lib/leadFunnel";
import { listProspects, prospekStats } from "@/lib/prospek";
import { addLineItem, createAd, createDeal, createLead, createUser, freeAdCode } from "./fixtures";

// Lead dan funnel (migration 016): every figure is checked against numbers counted by hand.
// Each test uses its own month in 2018 (or its own rep); reviewPack.test.ts owns March 2019 for all reps.

type Stage = "chat" | "quotation" | "negotiation" | "po" | "done" | "lost";

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

/** No change on the deal for 60 days: past every stage's stale_after_days, so it has stopped. */
async function makeStale(dealId: string) {
  await sql.begin(async (tx) => {
    await tx`SET LOCAL session_replication_role = replica`;
    await tx`UPDATE deals SET updated_at = now() - interval '60 days' WHERE id = ${dealId}`;
  });
}

const at = (day: string, time = "03:00:00") => `${day}T${time}Z`; // 10:00 in Jakarta
const stepOf = (f: LeadFunnel, step: string) => f.steps.find((s) => s.step === step);

describe("lead_funnel: March 2018, counted by hand", () => {
  it("counts leads, stopped and running per step and source group, and the leads counted apart", async () => {
    const rep = await createUser();
    const other = await createUser();
    const L = (source: string, o: { status?: string; receivedAt?: string } = {}) =>
      createLead(rep.id, { source, status: o.status ?? "new", receivedAt: o.receivedAt ?? at("2018-03-10") });

    // Iklan Meta (7)
    await L("meta_ctwa"); // 1 new, not handled, old → stopped before Ditangani
    await L("meta_ctwa", { status: "contacted" }); // 2 handled, no deal, old → stopped before Jadi deal
    await dealFrom((await L("instagram_dm")).id, rep.id); // 3 open in Chat masuk, changed today → running
    await dealFrom((await L("meta_leadform")).id, rep.id, ["quotation", "lost"]); // 4 lost after Quotation
    await makeStale(await dealFrom((await L("meta_ctwa")).id, rep.id, ["po"])); // 5 skipped to PO, stale → stopped
    await dealFrom((await L("meta_ctwa")).id, rep.id, ["quotation", "negotiation", "po", "done"]); // 6 done
    await dealFrom((await L("meta_ctwa")).id, rep.id, ["lost"]); // 7 lost in Chat masuk
    // Website (2)
    await dealFrom((await L("website_form")).id, rep.id, ["negotiation", "lost"]); // 8 lost after Negotiation
    const answered = await L("website_wa_link"); // 9 new, but answered, old → stopped before Jadi deal
    await sql`UPDATE leads SET first_response_at = received_at + interval '5 minutes' WHERE id = ${answered.id}`;
    // Offline (1)
    await dealFrom((await L("walk_in")).id, rep.id, ["done"]); // 10 straight to Done deal
    // Jakarta boundary: 1 March 00:30 in Jakarta counts, 1 April 00:30 does not
    await L("other", { receivedAt: "2018-02-28T17:30:00Z" }); // 11
    await L("other", { receivedAt: "2018-03-31T17:30:00Z" });
    // WhatsApp langsung (2): spam is a lead, but not part of Ditangani → Jadi deal; a budget no is a stop
    const spam = await L("whatsapp_direct");
    await sql`UPDATE leads SET status = 'disqualified', disqualify_reason = 'not_buyer' WHERE id = ${spam.id}`; // 12
    const budget = await L("whatsapp_direct");
    await sql`UPDATE leads SET status = 'disqualified', disqualify_reason = 'budget' WHERE id = ${budget.id}`; // 13
    // Chat lanjutan: the contact already had an open deal (made 1 March) when this chat came in on 12 March
    const running = await createDeal(rep.id);
    await sql`UPDATE deals SET created_at = ${at("2018-03-01")} WHERE id = ${running.id}`;
    await sql`UPDATE deal_stage_history SET changed_at = ${at("2018-03-01")} WHERE deal_id = ${running.id}`;
    const again = await L("whatsapp_direct", { receivedAt: at("2018-03-12") });
    await sql`UPDATE leads SET contact_id = (SELECT contact_id FROM deals WHERE id = ${running.id}) WHERE id = ${again.id}`;
    // A repeat order without a lead: made and paid in March
    const repeat = await createDeal(rep.id);
    await move(repeat.id, "done");
    await sql`UPDATE deals SET created_at = ${at("2018-03-18")}, closed_on = '2018-03-20' WHERE id = ${repeat.id}`;
    // a sample lead with a Done deal never counts
    const sample = await L("meta_ctwa");
    await dealFrom(sample.id, rep.id, ["done"]);
    await sql`UPDATE leads SET is_sample = true WHERE id = ${sample.id}`;
    // another rep's lead
    await createLead(other.id, { source: "whatsapp_direct", status: "contacted", receivedAt: at("2018-03-15") });

    const f = await leadFunnelRange(rep.id, "2018-03-01", "2018-03-31");
    expect(f.total).toMatchObject({
      leads: 13, handled: 11, deals: 7, quotation: 5, negotiation: 4, po: 3, done: 2, lost: 3, unhandled: 2,
      notBuyer: 1, reentry: 1,
      // conversion = passed / (passed + stopped): 11/13, 7/10 (spam left out), 5/6 (one running), 4/5, 3/4, 2/3
      pct: { handled: 85, deal: 70, quotation: 83, negotiation: 80, po: 75, done: 67 },
      pctLeadToDone: 15,
      // leads stopped somewhere, but at most 3 at one step: too few to name a step
      status: "insufficient",
      bottleneck: null,
    });
    expect(f.outside).toEqual({ deals: 2, done: 1 });
    expect(f.minStopped).toBe(5);
    expect(f.steps.map((s) => [s.step, s.entered, s.passed, s.stopped, s.running])).toEqual([
      ["handled", 13, 11, 2, 0],
      ["deal", 10, 7, 3, 0],
      ["quotation", 7, 5, 1, 1],
      ["negotiation", 5, 4, 1, 0],
      ["po", 4, 3, 1, 0],
      ["done", 3, 2, 1, 0],
    ]);

    const g = Object.fromEntries(f.groups.map((r) => [r.group, r]));
    expect(f.groups.map((r) => r.group)).toEqual(["meta", "website", "offline", "wa_direct", "other"]);
    expect(g.meta).toMatchObject({ leads: 7, handled: 6, deals: 5, quotation: 3, negotiation: 2, po: 2, done: 1, lost: 2, unhandled: 1 });
    expect(g.website).toMatchObject({ leads: 2, handled: 2, deals: 1, quotation: 1, negotiation: 1, po: 0, done: 0, lost: 1 });
    expect(g.offline).toMatchObject({ leads: 1, deals: 1, quotation: 1, negotiation: 1, po: 1, done: 1, lost: 0 });
    expect(g.wa_direct).toMatchObject({ leads: 2, handled: 2, deals: 0, notBuyer: 1, reentry: 1, pct: { deal: 0 } });
    expect(g.other).toMatchObject({ leads: 1, handled: 0, unhandled: 1 });

    // with a lower threshold, Ditangani → Jadi deal (3 stopped, 70%) is named; at 2 it still beats Ditangani (85%)
    await sql`UPDATE app_settings SET value = '3' WHERE key = 'funnel_min_entering'`;
    try {
      const low = await leadFunnelRange(rep.id, "2018-03-01", "2018-03-31");
      expect(low.total).toMatchObject({ status: "found", bottleneck: { steps: ["deal"], pct: 70 } });
      expect(stepOf(low, "deal")).toMatchObject({ enoughData: true, isBottleneck: true });
      expect(stepOf(low, "handled")).toMatchObject({ enoughData: false, isBottleneck: false });
    } finally {
      await sql`UPDATE app_settings SET value = '5' WHERE key = 'funnel_min_entering'`;
    }

    // All sales: the other rep's WhatsApp lead is in, sample rows are still out
    const all = await leadFunnelRange(null, "2018-03-01", "2018-03-31");
    expect(all.total).toMatchObject({ leads: 14, handled: 12, deals: 7, done: 2 });
    // the other rep sees only their own lead
    expect((await leadFunnelRange(other.id, "2018-03-01", "2018-03-31")).total).toMatchObject({ leads: 1, deals: 0 });
  });
});

describe("lead_funnel: stopped or still running", () => {
  it("does not call young deals stopped: 'none' while they run, the step is named once 5 have gone stale", async () => {
    const rep = await createUser();
    const deals: string[] = [];
    for (let i = 0; i < 5; i++) {
      const l = await createLead(rep.id, { source: "event", receivedAt: at("2018-05-05") });
      deals.push(await dealFrom(l.id, rep.id, ["quotation"]));
    }
    let f = await leadFunnelRange(rep.id, "2018-05-01", "2018-05-31");
    expect(stepOf(f, "negotiation")).toMatchObject({ entered: 5, passed: 0, stopped: 0, running: 5, pct: null, isBottleneck: false });
    expect(f.total).toMatchObject({ status: "none", bottleneck: null });

    for (const d of deals.slice(0, 4)) await makeStale(d);
    f = await leadFunnelRange(rep.id, "2018-05-01", "2018-05-31");
    // 4 stopped: some stopped, too few to judge
    expect(stepOf(f, "negotiation")).toMatchObject({ stopped: 4, running: 1, pct: 0 });
    expect(f.total).toMatchObject({ status: "insufficient", bottleneck: null });

    await makeStale(deals[4]);
    f = await leadFunnelRange(rep.id, "2018-05-01", "2018-05-31");
    expect(f.total).toMatchObject({ status: "found", bottleneck: { steps: ["negotiation"], pct: 0 } });
    expect(f.groups.find((g) => g.group === "offline")).toMatchObject({ status: "found", bottleneck: { steps: ["negotiation"] } });
  });

  it("counts a lead received today and not answered yet as running, not stopped", async () => {
    const rep = await createUser();
    await createLead(rep.id, { source: "meta_ctwa" });
    const [{ today }] = await sql<{ today: string }[]>`SELECT jakarta_today()::text AS today`;
    const f = await leadFunnelRange(rep.id, today, today);
    expect(stepOf(f, "handled")).toMatchObject({ entered: 1, passed: 0, stopped: 0, running: 1 });
    expect(f.total.status).toBe("none");
  });

  it("names every step tied for the lowest conversion", async () => {
    const rep = await createUser();
    // 20 leads: 10 never handled (stopped), 10 handled; 5 of those became a deal, 5 stopped → 50% and 50%
    for (let i = 0; i < 10; i++) await createLead(rep.id, { source: "tender", receivedAt: at("2018-07-03") });
    for (let i = 0; i < 10; i++) {
      const l = await createLead(rep.id, { source: "tender", status: "contacted", receivedAt: at("2018-07-03") });
      if (i < 5) await dealFrom(l.id, rep.id);
    }
    const f = await leadFunnelRange(rep.id, "2018-07-01", "2018-07-31");
    expect(f.total).toMatchObject({ leads: 20, handled: 10, deals: 5, status: "found", bottleneck: { steps: ["handled", "deal"], pct: 50 } });
    expect(f.steps.filter((s) => s.isBottleneck).map((s) => s.step)).toEqual(["handled", "deal"]);
  });

  it("follows a deal moved back: Negotiation → Quotation has passed Quotation, Done → PO reopened is not Done", async () => {
    const rep = await createUser();
    const back = await createLead(rep.id, { source: "referral", receivedAt: at("2018-08-02") });
    await dealFrom(back.id, rep.id, ["quotation", "negotiation", "quotation"]);
    const reopened = await createLead(rep.id, { source: "referral", receivedAt: at("2018-08-02") });
    const d = await dealFrom(reopened.id, rep.id, ["quotation", "negotiation", "po", "done", "po"]);
    let f = await leadFunnelRange(rep.id, "2018-08-01", "2018-08-31");
    expect(f.total).toMatchObject({ leads: 2, deals: 2, quotation: 2, negotiation: 2, po: 1, done: 0, lost: 0 });
    // both open and changed today: still running at Negotiation → PO and PO → Done deal
    expect(stepOf(f, "po")).toMatchObject({ entered: 2, passed: 1, stopped: 0, running: 1 });
    expect(stepOf(f, "done")).toMatchObject({ entered: 1, passed: 0, stopped: 0, running: 1 });
    await makeStale(d);
    f = await leadFunnelRange(rep.id, "2018-08-01", "2018-08-31");
    expect(stepOf(f, "done")).toMatchObject({ stopped: 1, running: 0, pct: 0 });
  });
});

describe("lead_funnel: owner", () => {
  it("counts a lead for the current owner of its deal, and an unowned lead without a deal only for all sales", async () => {
    const a = await createUser();
    const b = await createUser();
    // handed over: the lead was A's, the deal now belongs to B
    const handed = await createLead(a.id, { source: "walk_in", receivedAt: at("2018-09-04") });
    const d = await dealFrom(handed.id, a.id);
    await sql`UPDATE deals SET owner_user_id = ${b.id} WHERE id = ${d}`;
    // unowned lead whose deal is A's
    const unowned = await createLead(null, { source: "walk_in", receivedAt: at("2018-09-04") });
    await dealFrom(unowned.id, a.id);
    // unowned lead, no deal
    await createLead(null, { source: "walk_in", receivedAt: at("2018-09-04") });

    expect((await leadFunnelRange(a.id, "2018-09-01", "2018-09-30")).total).toMatchObject({ leads: 1, deals: 1 });
    expect((await leadFunnelRange(b.id, "2018-09-01", "2018-09-30")).total).toMatchObject({ leads: 1, deals: 1 });
    const owners = await sql<{ lead_id: string; owner_user_id: string }[]>`
      SELECT lead_id, owner_user_id FROM lead_funnel_cohort('2018-09-01', '2018-09-30')
       WHERE lead_id IN (${handed.id}, ${unowned.id})`;
    expect(Object.fromEntries(owners.map((o) => [o.lead_id, o.owner_user_id]))).toEqual({ [handed.id]: b.id, [unowned.id]: a.id });
    const all = await leadFunnelRange(null, "2018-09-01", "2018-09-30");
    expect(all.groups.find((g) => g.group === "offline")?.leads).toBeGreaterThanOrEqual(3);
  });
});

describe("lead_funnel: usual days", () => {
  it("gives the median days in each stage from completed stays in that same stage", async () => {
    const rep = await createUser();
    const a = await createLead(rep.id, { source: "tender", receivedAt: at("2018-06-01") });
    const b = await createLead(rep.id, { source: "tender", receivedAt: at("2018-06-01") });
    const da = await dealFrom(a.id, rep.id, ["quotation", "negotiation"]);
    const db = await dealFrom(b.id, rep.id, ["quotation"]);
    // a: Chat masuk 2 days, Quotation 1 day, still in Negotiation
    // b: Chat masuk 4 days, still in Quotation
    const setAt = (deal: string, stage: string, day: string) => sql`
      UPDATE deal_stage_history SET changed_at = ${at(day)}
       WHERE deal_id = ${deal} AND to_stage_id = (SELECT id FROM pipeline_stages WHERE key = ${stage})`;
    await setAt(da, "chat", "2018-06-02");
    await setAt(da, "quotation", "2018-06-04");
    await setAt(da, "negotiation", "2018-06-05");
    await setAt(db, "chat", "2018-06-04");
    await setAt(db, "quotation", "2018-06-08");

    const f = await leadFunnelRange(rep.id, "2018-06-01", "2018-06-30");
    const days = Object.fromEntries(f.steps.map((s) => [s.step, s.medianDays]));
    // Jadi deal = days in Chat masuk (2 and 4), Quotation = days in Quotation (1; b is still there)
    expect(days).toEqual({ handled: null, deal: 3, quotation: 1, negotiation: null, po: null, done: null });
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

describe("traceability", () => {
  it("maps every channel to a source group, and unknown values to other", async () => {
    const rows = await sql<{ c: string; g: string }[]>`
      SELECT c::text AS c, source_group(c) AS g FROM unnest(enum_range(NULL::source_channel)) c`;
    const map = Object.fromEntries(rows.map((r) => [r.c, r.g]));
    expect(map).toMatchObject({
      meta_ctwa: "meta", meta_leadform: "meta", instagram_dm: "meta",
      website_form: "website", website_wa_link: "website", google_ads: "website",
      walk_in: "offline", event: "offline", referral: "offline", partner_si: "offline", tender: "offline", repeat_order: "offline",
      whatsapp_direct: "wa_direct", other: "other",
    });
    expect(parseSourceGroup("meta")).toBe("meta");
    expect(parseSourceGroup(["website"])).toBe("website");
    expect(parseSourceGroup("bogus")).toBeNull();
  });

  it("shows the ad, the UTM campaign and the source group on each prospect, and filters by group", async () => {
    const rep = await createUser();
    const ad = await createAd(await freeAdCode("Q"), "IFP Sekolah Jakarta");
    const fromAd = await createLead(rep.id, { source: "meta_ctwa", adId: ad.id, name: "Dari iklan" });
    const fromWeb = await createLead(rep.id, { source: "website_form", name: "Dari web" });
    await sql`UPDATE leads SET utm_campaign = 'promo-sekolah', utm_source = 'google' WHERE id = ${fromWeb.id}`;
    const sample = await createLead(rep.id, { source: "meta_ctwa", name: "Contoh" });
    await sql`UPDATE leads SET is_sample = true WHERE id = ${sample.id}`;

    const all = await listProspects({ viewerId: rep.id, ownerId: rep.id, tab: "semua", q: "", limit: 50 });
    expect(all.rows.map((r) => r.id).sort()).toEqual([fromAd.id, fromWeb.id].sort());
    const ad1 = all.rows.find((r) => r.id === fromAd.id);
    expect(ad1).toMatchObject({ source_group: "meta", ad_name: "IFP Sekolah Jakarta" });
    expect(all.rows.find((r) => r.id === fromWeb.id)).toMatchObject({ source_group: "website", utm_campaign: "promo-sekolah", utm_source: "google" });

    const meta = await listProspects({ viewerId: rep.id, ownerId: rep.id, tab: "semua", q: "", limit: 50, group: "meta" });
    expect(meta.rows.map((r) => r.id)).toEqual([fromAd.id]);
  });

  it("takes the landing page from the tracked WhatsApp click, else from the web form's page_url", async () => {
    const rep = await createUser();
    const clicked = await createLead(rep.id, { source: "website_wa_link" });
    await sql`
      INSERT INTO wa_click_events (ref_code, source_channel, landing_url, clicked_at, matched_lead_id)
      VALUES (${`LP${Date.now() % 1e8}`}, 'website_wa_link', 'https://www.fortu.co.id/ifp?utm_source=ig#harga', now(), ${clicked.id})`;
    const form = await createLead(rep.id, { source: "website_form" });
    const [ev] = await sql<{ id: string }[]>`
      INSERT INTO inbound_events (provider, external_id, payload)
      VALUES ('web_form', ${`lp-${form.id}`}, ${sql.json({ page_url: "https://fortu.co.id/led-videowall?ref=menu" })}) RETURNING id`;
    await sql`UPDATE leads SET inbound_event_id = ${ev.id} WHERE id = ${form.id}`;

    const rows = (await listProspects({ viewerId: rep.id, ownerId: rep.id, tab: "semua", q: "", limit: 50 })).rows;
    const page = (id: string) => rows.find((r) => r.id === id)?.landing_url ?? "";
    expect(pageOf(page(clicked.id))).toBe("fortu.co.id/ifp");
    expect(pageOf(page(form.id))).toBe("fortu.co.id/led-videowall");
    expect(pageOf("bukan url")).toBe("bukan url");

    // the same trace on the deal
    expect(await leadTrace(form.id, rep.id)).toMatchObject({ firstChat: null, group: "website", channel: "website_form", landingUrl: "https://fortu.co.id/led-videowall?ref=menu" });
  });

  it("leaves sample rows out of the Prospek figures, and follows the source filter", async () => {
    const rep = await createUser();
    await createLead(rep.id, { source: "meta_ctwa" });
    await createLead(rep.id, { source: "meta_ctwa", status: "contacted" });
    await createLead(rep.id, { source: "website_form" });
    const sample = await createLead(rep.id, { source: "meta_ctwa" });
    await sql`UPDATE leads SET is_sample = true WHERE id = ${sample.id}`;

    expect(await prospekStats(rep.id)).toMatchObject({ new_count: 2, contacted_count: 1, open_count: 3, received_today: 3 });
    expect(await prospekStats(rep.id, "meta")).toMatchObject({ new_count: 1, contacted_count: 1, meta_without_code: 2 });
    expect(await prospekStats(rep.id, "website")).toMatchObject({ new_count: 1, contacted_count: 0 });
    expect(await prospekStats(rep.id, "offline")).toMatchObject({ new_count: 0, open_count: 0 });
    // all sales, one group: never fewer than this rep's own
    expect((await prospekStats(null, "meta")).new_count).toBeGreaterThanOrEqual(1);
  });
});
