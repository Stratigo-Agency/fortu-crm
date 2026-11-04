import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { listProspects, PAGE_SIZE, parseLimit, parseTab, prospekStats } from "@/lib/prospek";
import { createAd, createLead, createUser, freeAdCode } from "./fixtures";

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const list = (viewerId: string, o: Partial<Parameters<typeof listProspects>[0]> = {}) =>
  listProspects({ viewerId, ownerId: null, tab: "baru", q: "", limit: PAGE_SIZE, ...o });

describe("parseTab / parseLimit", () => {
  it("accepts known values and falls back safely", () => {
    expect(parseTab("dihubungi")).toBe("dihubungi");
    expect(parseTab("semua")).toBe("semua");
    expect(parseTab("x")).toBe("baru");
    expect(parseTab(undefined)).toBe("baru");
    expect(parseTab(["semua"])).toBe("baru");
    expect(parseLimit("100")).toBe(100);
    expect(parseLimit("120")).toBe(150);
    expect(parseLimit("-5")).toBe(50);
    expect(parseLimit("abc")).toBe(50);
    expect(parseLimit("999999")).toBe(500);
  });
});

describe("listProspects", () => {
  it("shows tabs by status, newest first, with the sales filter", async () => {
    const a = await createUser({ fullName: "Siska" });
    const b = await createUser({ fullName: "Dimas" });
    const old = await createLead(a.id, { name: "Lama", receivedAt: hoursAgo(5) });
    const fresh = await createLead(a.id, { name: "Baru", receivedAt: hoursAgo(1) });
    const contacted = await createLead(a.id, { status: "contacted", name: "Dihubungi" });
    const otherRep = await createLead(b.id, { name: "Punya Dimas" });
    const done = await createLead(a.id, { status: "converted" });
    const nope = await createLead(a.id, { status: "disqualified" });

    const mine = await list(a.id, { ownerId: a.id });
    const ids = mine.rows.map((r) => r.id);
    expect(ids.indexOf(fresh.id)).toBeLessThan(ids.indexOf(old.id));
    expect(ids).toEqual(expect.arrayContaining([old.id, fresh.id]));
    expect(ids).not.toContain(contacted.id);
    expect(ids).not.toContain(otherRep.id);

    expect((await list(a.id, { ownerId: a.id, tab: "dihubungi" })).rows.map((r) => r.id)).toEqual([contacted.id]);
    const all = (await list(a.id, { ownerId: a.id, tab: "semua" })).rows.map((r) => r.id);
    expect(all).toEqual(expect.arrayContaining([old.id, fresh.id, contacted.id]));
    expect(all).not.toContain(done.id);
    expect(all).not.toContain(nope.id);
    expect((await list(a.id, { ownerId: null })).rows.map((r) => r.id)).toContain(otherRep.id);
  });

  it("says which rows the viewer may act on, and flags a late new chat", async () => {
    const mine = await createUser();
    const theirs = await createUser();
    const marketing = await createUser({ role: "marketing" });
    const l1 = await createLead(mine.id, { receivedAt: hoursAgo(3) });
    const l2 = await createLead(theirs.id, { receivedAt: hoursAgo(1) });
    const l3 = await createLead(null);
    const rows = (await list(mine.id)).rows;
    const by = (id: string) => rows.find((r) => r.id === id)!;
    expect([by(l1.id).can_edit, by(l2.id).can_edit, by(l3.id).can_edit]).toEqual([true, false, true]);
    expect([by(l1.id).is_late, by(l2.id).is_late]).toEqual([true, false]);
    const asMarketing = (await list(marketing.id)).rows;
    expect(asMarketing.find((r) => r.id === l3.id)!.can_edit).toBe(false);
  });

  it("searches name, message and phone (written any way), and treats % and _ as text", async () => {
    const rep = await createUser();
    const l = await createLead(rep.id, { name: "Bu Ratna", message: "Signage 55% diskon_ya?" });
    const [c] = await sql<{ phone_e164: string }[]>`
      SELECT phone_e164 FROM contacts c JOIN leads l ON l.contact_id = c.id WHERE l.id = ${l.id}`;
    const local = `0${c.phone_e164.slice(3)}`;
    for (const q of ["ratna", "RATNA", "diskon_ya", "55%", local, local.slice(0, 9), c.phone_e164.slice(1)]) {
      expect((await list(rep.id, { q })).rows.map((r) => r.id), q).toContain(l.id);
    }
    expect((await list(rep.id, { q: "%" })).rows.map((r) => r.id)).not.toContain(
      (await createLead(rep.id, { message: "tanpa tanda" })).id,
    );
    expect((await list(rep.id, { q: "tidak-ada-yang-cocok-xyz" })).rows).toHaveLength(0);
  });

  it("shows the ad code, pages by 50 and says whether there is more", async () => {
    const rep = await createUser();
    const code = await freeAdCode("F-IFP");
    const ad = await createAd(code);
    const withAd = await createLead(rep.id, { adId: ad.id, source: "meta_ctwa", product: "IFP" });
    const row = (await list(rep.id, { ownerId: rep.id })).rows.find((r) => r.id === withAd.id)!;
    expect(row).toMatchObject({ ad_code: code, source_channel: "meta_ctwa", product_interest: "IFP" });

    for (let i = 0; i < 3; i++) await createLead(rep.id);
    const page = await listProspects({ viewerId: rep.id, ownerId: rep.id, tab: "baru", q: "", limit: 2 });
    expect(page.rows).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    const full = await listProspects({ viewerId: rep.id, ownerId: rep.id, tab: "baru", q: "", limit: 50 });
    expect(full.hasMore).toBe(false);
  });
});

describe("prospekStats (from v_prospek_stats)", () => {
  it("counts per owner: chats today, median delay in the last 7 days, Meta chats without a code", async () => {
    const rep = await createUser();
    const code = await freeAdCode("F-IFP");
    const ad = await createAd(code);
    // delays of 10, 20 and 90 minutes → median 20; one chat is 9 days old and is ignored
    for (const min of [10, 20, 90]) {
      await createLead(rep.id, { receivedAt: hoursAgo(1), loggedAt: new Date(Date.now() - 3_600_000 + min * 60_000).toISOString() });
    }
    await createLead(rep.id, { receivedAt: hoursAgo(9 * 24), loggedAt: hoursAgo(9 * 24 - 5) });
    await createLead(rep.id, { source: "meta_ctwa" }); // Meta, no code
    await createLead(rep.id, { source: "meta_ctwa", adId: ad.id }); // Meta with a code
    await createLead(rep.id, { status: "contacted" });

    const s = await prospekStats(rep.id);
    expect(s.new_count).toBe(6);
    expect(s.contacted_count).toBe(1);
    expect(s.open_count).toBe(7); // 6 new + 1 contacted
    expect(s.meta_without_code).toBe(1);
    // the three delayed chats, the two Meta chats and the contacted one were logged "now" (0 min):
    // delays are [0,0,0,10,20,90] plus a 5-minute one from 9 days ago, which is outside the 7 days.
    expect(s.median_log_delay_min).toBe(5);
  });

  it("returns zeros and no median for an owner with no leads, and totals for all owners", async () => {
    const empty = await createUser();
    expect(await prospekStats(empty.id)).toEqual({
      new_count: 0,
      contacted_count: 0,
      open_count: 0,
      received_today: 0,
      median_log_delay_min: null,
      meta_without_code: 0,
    });
    const rep = await createUser();
    await createLead(rep.id);
    const all = await prospekStats(null);
    const mine = await prospekStats(rep.id);
    expect(all.new_count).toBeGreaterThanOrEqual(mine.new_count);
    expect(all.received_today).toBeGreaterThanOrEqual(1);
  });
});
