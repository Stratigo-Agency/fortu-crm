import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AdsError, canManageAds, getAdsConfig, saveAdCodes, saveAdSetLines, saveCampaignOwners } from "@/lib/ads";
import { ForbiddenError } from "@/lib/authz";
import { sql } from "@/lib/db";
import { createUser } from "./fixtures";

// A form as the page sends it: every field carries the value it showed when it opened (orig:<field>, blank unless given).
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  for (const k of Object.keys(o)) if (!k.startsWith("orig:") && !(`orig:${k}` in o)) f.append(`orig:${k}`, "");
  return f;
};

async function makeAd(name = "Iklan uji") {
  const key = randomUUID();
  const [r] = await sql<{ camp: string; set: string; ad: string }[]>`
    WITH c AS (INSERT INTO ad_campaigns (meta_campaign_id, name) VALUES (${`c-${key}`}, ${`Kampanye ${key.slice(0, 4)}`}) RETURNING id),
         s AS (INSERT INTO ad_sets (meta_adset_id, campaign_id, name) SELECT ${`s-${key}`}, id, 'Set uji' FROM c RETURNING id),
         a AS (INSERT INTO ads (meta_ad_id, ad_set_id, name) SELECT ${`a-${key}`}, id, ${name} FROM s RETURNING id)
    SELECT (SELECT id FROM c) AS camp, (SELECT id FROM s) AS set, (SELECT id FROM a) AS ad`;
  return r;
}
const fails = async (p: Promise<unknown>, key: string) => {
  const err = await p.then(() => null, (e) => e);
  expect(err).toBeInstanceOf(AdsError);
  expect(err.key).toBe(key);
};

describe("who may manage ads", () => {
  it("admin, CEO and marketing; not sales", async () => {
    expect(["admin", "ceo", "marketing"].every((role) => canManageAds({ role: role as never }))).toBe(true);
    expect(["sales_rep", "sales_lead"].some((role) => canManageAds({ role: role as never }))).toBe(false);
    const rep = await createUser();
    const lead = await createUser({ role: "sales_lead" });
    const { ad, camp, set } = await makeAd();
    for (const u of [rep, lead]) {
      await expect(saveAdCodes(u, form({ [`code:${ad}`]: "F-IFP-01" }))).rejects.toBeInstanceOf(ForbiddenError);
      await expect(saveCampaignOwners(u, form({ [`owner:${camp}`]: "" }))).rejects.toBeInstanceOf(ForbiddenError);
      await expect(saveAdSetLines(u, form({ [`line:${set}`]: "IFP" }))).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});

describe("campaign owner and product line", () => {
  it("sets and clears them, and only an active sales person can own a campaign", async () => {
    const marketing = await createUser({ role: "marketing" });
    const rep = await createUser({ fullName: "Pemilik" });
    const off = await createUser({ isActive: false });
    const mkt = await createUser({ role: "marketing" });
    const { camp, set } = await makeAd();
    await saveCampaignOwners(marketing, form({ [`owner:${camp}`]: rep.id }));
    await saveAdSetLines(marketing, form({ [`line:${set}`]: "LED" }));
    expect((await sql`SELECT owner_user_id FROM ad_campaigns WHERE id = ${camp}`)[0].owner_user_id).toBe(rep.id);
    expect((await sql`SELECT product_line FROM ad_sets WHERE id = ${set}`)[0].product_line).toBe("LED");

    // someone who is switched off, or marketing, can't own a campaign: refused, the owner stays
    await fails(saveCampaignOwners(marketing, form({ [`owner:${camp}`]: off.id, [`orig:owner:${camp}`]: rep.id })), "form");
    await fails(saveCampaignOwners(marketing, form({ [`owner:${camp}`]: mkt.id, [`orig:owner:${camp}`]: rep.id })), "form");
    expect((await sql`SELECT owner_user_id FROM ad_campaigns WHERE id = ${camp}`)[0].owner_user_id).toBe(rep.id);
    await saveCampaignOwners(marketing, form({ [`owner:${camp}`]: "", [`orig:owner:${camp}`]: rep.id }));
    expect((await sql`SELECT owner_user_id FROM ad_campaigns WHERE id = ${camp}`)[0].owner_user_id).toBeNull();

    await saveAdSetLines(marketing, form({ [`line:${set}`]: "", [`orig:line:${set}`]: "LED" }));
    expect((await sql`SELECT product_line FROM ad_sets WHERE id = ${set}`)[0].product_line).toBeNull();
    await fails(saveAdSetLines(marketing, form({ [`line:${set}`]: "XYZ" })), "form");
    await fails(saveCampaignOwners(marketing, form({ "owner:bukan-uuid": "" })), "form");
    await fails(saveCampaignOwners(marketing, form({ [`owner:${camp}`]: rep.id, [`orig:owner:${camp}`]: "bukan-uuid" })), "form");
  });
});

describe("ad codes", () => {
  const free = async () => {
    const [r] = await sql<{ code: string }[]>`
      SELECT 'F-IFP-' || lpad(n::text, 2, '0') AS code FROM generate_series(1, 99) n
       WHERE NOT EXISTS (SELECT 1 FROM ads WHERE prefill_code = 'F-IFP-' || lpad(n::text, 2, '0')) ORDER BY random() LIMIT 1`;
    return r.code;
  };

  it("saves a valid code in upper case, and a blank clears it", async () => {
    const admin = await createUser({ role: "admin" });
    const { ad } = await makeAd();
    const code = await free();
    await saveAdCodes(admin, form({ [`code:${ad}`]: ` ${code.toLowerCase()} ` }));
    expect((await sql`SELECT prefill_code FROM ads WHERE id = ${ad}`)[0].prefill_code).toBe(code);
    await saveAdCodes(admin, form({ [`code:${ad}`]: "", [`orig:code:${ad}`]: code }));
    expect((await sql`SELECT prefill_code FROM ads WHERE id = ${ad}`)[0].prefill_code).toBeNull();
  });

  it("refuses a code in the wrong shape, and says nothing was saved", async () => {
    const admin = await createUser({ role: "admin" });
    const { ad } = await makeAd();
    for (const bad of ["IFP-01", "F-XYZ-01", "FF-IFP-01", "F-IFP-1", "F-IFP-001", "f ifp 01"]) await fails(saveAdCodes(admin, form({ [`code:${ad}`]: bad })), "code");
    expect((await sql`SELECT prefill_code FROM ads WHERE id = ${ad}`)[0].prefill_code).toBeNull();
  });

  it("a code is unique: another ad, or twice in one save, is refused; two ads can swap", async () => {
    const ceo = await createUser({ role: "ceo" });
    const a = await makeAd();
    const b = await makeAd();
    const [c1, c2] = [await free(), ""];
    await saveAdCodes(ceo, form({ [`code:${a.ad}`]: c1 }));
    await fails(saveAdCodes(ceo, form({ [`code:${b.ad}`]: c1 })), "codeTaken");
    await fails(saveAdCodes(ceo, form({ [`code:${a.ad}`]: c1, [`orig:code:${a.ad}`]: c1, [`code:${b.ad}`]: c1 })), "codeTaken");
    expect((await sql`SELECT prefill_code FROM ads WHERE id = ${b.ad}`)[0].prefill_code).toBeNull();
    void c2;

    const other = await free();
    await saveAdCodes(ceo, form({ [`code:${b.ad}`]: other }));
    await saveAdCodes(ceo, form({ [`code:${a.ad}`]: other, [`orig:code:${a.ad}`]: c1, [`code:${b.ad}`]: c1, [`orig:code:${b.ad}`]: other })); // swap in one save
    expect((await sql`SELECT prefill_code FROM ads WHERE id = ${a.ad}`)[0].prefill_code).toBe(other);
    expect((await sql`SELECT prefill_code FROM ads WHERE id = ${b.ad}`)[0].prefill_code).toBe(c1);
  });

  it("a code set here is what a lead's first message is matched to", async () => {
    const admin = await createUser({ role: "admin" });
    const { ad } = await makeAd("Iklan kode");
    const code = await free();
    await saveAdCodes(admin, form({ [`code:${ad}`]: code }));
    const { ingestLead } = await import("@/lib/ingest/ingestLead");
    const lead = await ingestLead({ phone: `0813${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, sourceChannel: "meta_ctwa", captureMethod: "wa_link_ref", firstMessage: `Halo [${code}]` });
    expect(lead.adId).toBe(ad);
  });
});

describe("the screen's data", () => {
  it("lists campaigns, ad sets and ads with 30-day spend, and the last sync or failure", async () => {
    const { camp, ad } = await makeAd("Iklan angka");
    await sql`INSERT INTO ad_insights_daily (ad_id, date, spend, link_clicks, meta_conversations) VALUES (${ad}, jakarta_today() - 2, 250000, 10, 3), (${ad}, jakarta_today() - 45, 999000, 1, 1)`;
    const cfg = await getAdsConfig();
    expect(cfg.campaigns.find((c) => c.id === camp)?.spend30).toBe("250000"); // the 45-day-old row is outside the window
    expect(cfg.ads.find((a) => a.id === ad)).toMatchObject({ name: "Iklan angka", spend30: "250000", code: "" });
    // failure after the last good sync shows; one before it doesn't
    await sql`INSERT INTO app_settings (key, value) VALUES ('insights_last_sync', ${sql.json({ at: "2026-11-01T00:00:00Z", from: "a", to: "b", rows: 1 })}),
                                                          ('insights_last_failure', ${sql.json({ at: "2026-10-01T00:00:00Z", message: "lama" })})
              ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
    expect((await getAdsConfig()).lastFailure).toBeNull();
    await sql`UPDATE app_settings SET value = ${sql.json({ at: "2026-11-02T00:00:00Z", message: "token salah" })} WHERE key = 'insights_last_failure'`;
    expect((await getAdsConfig()).lastFailure).toMatchObject({ message: "token salah" });
    await sql`DELETE FROM app_settings WHERE key IN ('insights_last_sync', 'insights_last_failure')`;
  });
});

describe("a form that is older than the data", () => {
  it("only changed rows are written, and a row someone else changed meanwhile is refused, not overwritten", async () => {
    const mkt = await createUser({ role: "marketing" });
    const x = await makeAd("Iklan X");
    const y = await makeAd("Iklan Y");
    const codeB = "B-IFP-" + String(Math.floor(Math.random() * 90) + 10);
    // B (another person) sets X's code after A opened the page
    await saveAdCodes(mkt, form({ [`code:${x.ad}`]: codeB }));
    // A's page still shows X blank; A changes only Y
    const codeA = "A-IFP-" + String(Math.floor(Math.random() * 90) + 10);
    await saveAdCodes(mkt, form({ [`code:${x.ad}`]: "", [`code:${y.ad}`]: codeA }));
    expect((await sql`SELECT prefill_code FROM ads WHERE id = ${x.ad}`)[0].prefill_code).toBe(codeB); // not wiped by A's stale blank
    expect((await sql`SELECT prefill_code FROM ads WHERE id = ${y.ad}`)[0].prefill_code).toBe(codeA);
    // A now edits X itself from the stale view: refused as stale, nothing else in that save is written either
    const other = "C-IFP-" + String(Math.floor(Math.random() * 90) + 10);
    await fails(saveAdCodes(mkt, form({ [`code:${x.ad}`]: other, [`code:${y.ad}`]: "", [`orig:code:${y.ad}`]: codeA })), "stale");
    expect((await sql`SELECT prefill_code FROM ads WHERE id = ${y.ad}`)[0].prefill_code).toBe(codeA);
  });

  it("owner and product line follow the same rule", async () => {
    const mkt = await createUser({ role: "marketing" });
    const a = await createUser();
    const b = await createUser();
    const { camp, set } = await makeAd();
    await saveCampaignOwners(mkt, form({ [`owner:${camp}`]: a.id }));
    await fails(saveCampaignOwners(mkt, form({ [`owner:${camp}`]: b.id })), "stale"); // the page still showed "no owner"
    expect((await sql`SELECT owner_user_id FROM ad_campaigns WHERE id = ${camp}`)[0].owner_user_id).toBe(a.id);
    await saveAdSetLines(mkt, form({ [`line:${set}`]: "IFP" }));
    await fails(saveAdSetLines(mkt, form({ [`line:${set}`]: "DSS" })), "stale");
    expect((await sql`SELECT product_line FROM ad_sets WHERE id = ${set}`)[0].product_line).toBe("IFP");
  });

  it("a row that has gone, or a form without the original values, is refused", async () => {
    const mkt = await createUser({ role: "marketing" });
    await fails(saveAdCodes(mkt, form({ [`code:${randomUUID()}`]: "F-IFP-55" })), "stale");
    const f = new FormData();
    f.append(`code:${randomUUID()}`, "F-IFP-56"); // no orig:…
    await fails(saveAdCodes(mkt, f), "form");
  });

  it("the code named in a clash is the one held by another ad, not one of this form's own", async () => {
    const mkt = await createUser({ role: "marketing" });
    const mine = await makeAd();
    const mine2 = await makeAd();
    const theirs = await makeAd();
    const own = "D-IFP-" + String(Math.floor(Math.random() * 90) + 10);
    const held = "E-IFP-" + String(Math.floor(Math.random() * 90) + 10);
    await sql`UPDATE ads SET prefill_code = ${own} WHERE id = ${mine.ad}`;
    await sql`UPDATE ads SET prefill_code = ${held} WHERE id = ${theirs.ad}`;
    const err = await saveAdCodes(mkt, form({ [`code:${mine.ad}`]: own, [`orig:code:${mine.ad}`]: own, [`code:${mine2.ad}`]: held })).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(AdsError);
    expect(err.key).toBe("codeTaken");
    expect(err.code).toBe(held);
  });
});

describe("the list order", () => {
  it("is by spend as a number, so 9.000 does not come after 52.000.000", async () => {
    const big = await makeAd("Besar");
    const small = await makeAd("Kecil");
    await sql`INSERT INTO ad_insights_daily (ad_id, date, spend) VALUES (${big.ad}, jakarta_today() - 1, 52000000), (${small.ad}, jakarta_today() - 1, 9000)`;
    const cfg = await getAdsConfig();
    const iBig = cfg.ads.findIndex((a) => a.id === big.ad);
    const iSmall = cfg.ads.findIndex((a) => a.id === small.ad);
    expect(iBig).toBeGreaterThanOrEqual(0);
    expect(iBig).toBeLessThan(iSmall);
    expect(cfg.campaigns.findIndex((c) => c.id === big.camp)).toBeLessThan(cfg.campaigns.findIndex((c) => c.id === small.camp));
  });
});
