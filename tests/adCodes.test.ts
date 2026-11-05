import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { applyCodes, lineOf, prefillMessage, proposeCodes, repLetter, toCsv, type AdForCode } from "@/lib/adCodes";
import { parseCodes } from "@/lib/ingest/codes";

const ad = (o: Partial<AdForCode> & { id: string }): AdForCode => ({
  metaAdId: o.id, name: `Iklan ${o.id}`, campaignName: "Lead Gen CTWA - No_Frisca - 18/10/26", adSetName: "Broad - IFP25% - No_Frisca",
  adSetLine: null, ownerName: null, code: null, spend30: "0", ...o,
});

describe("rep letter and product line", () => {
  it("reads the letter from the campaign name, else the owner", () => {
    expect(repLetter("Lead Gen CTWA - No_Frisca - 18/10/26", null)).toBe("F");
    expect(repLetter("Kampanye bebas", "Rudy")).toBe("R");
    expect(repLetter("Kampanye bebas", null)).toBeNull();
  });
  it("takes the line of the ad set, else the one in its name", () => {
    expect(lineOf("LED", "Set apa saja")).toBe("LED");
    expect(lineOf(null, "Broad Lead Gen CTWA -  DSS50% - No_Dimas")).toBe("DSS");
    expect(lineOf(null, "Set tanpa lini")).toBeNull();
    expect(lineOf(null, "Ledakan")).toBeNull();
  });
});

describe("proposeCodes", () => {
  it("numbers per rep and line, continuing after existing codes, in a stable order", () => {
    const ads = [
      ad({ id: "3" }), ad({ id: "1" }), ad({ id: "2", adSetName: "Broad - DSS50%" }),
      ad({ id: "9", code: "F-IFP-04" }), ad({ id: "4", campaignName: "x - No_Dimas" }),
    ];
    const { proposals, skipped } = proposeCodes(ads);
    expect(skipped).toEqual([]);
    expect(Object.fromEntries(proposals.map((p) => [p.adId, p.code]))).toEqual({
      "1": "F-IFP-05", "3": "F-IFP-06", "2": "F-DSS-01", "4": "D-IFP-01",
    });
  });

  it("is the same answer the second time (applied codes are kept, nothing new is proposed)", () => {
    const first = proposeCodes([ad({ id: "1" }), ad({ id: "2" })]).proposals;
    const applied = [ad({ id: "1", code: first[0].code }), ad({ id: "2", code: first[1].code })];
    expect(proposeCodes(applied).proposals).toEqual([]);
  });

  it("skips what it cannot decide instead of guessing", () => {
    const { proposals, skipped } = proposeCodes([ad({ id: "1", adSetName: "Tanpa lini" }), ad({ id: "2", campaignName: "Tanpa sales" })]);
    expect(proposals).toEqual([]);
    expect(skipped).toEqual([{ adId: "1", reason: "noLine" }, { adId: "2", reason: "noRep" }]);
  });

  it("writes a message that parseCodes reads back, and a CSV Excel can open", () => {
    const ads = [ad({ id: "1", name: 'Iklan "satu", baru' })];
    const { proposals } = proposeCodes(ads);
    expect(parseCodes(proposals[0].message).adCode).toBe(proposals[0].code);
    expect(prefillMessage("DSS", "F-DSS-01")).toBe("Halo Fortu, saya mau info digital signage. [F-DSS-01]");
    const csv = toCsv(ads, proposals).split("\n");
    expect(csv[0]).toBe("\uFEFFKampanye,Set iklan,Nama iklan,ID iklan di Meta,Kode,Pesan awal WhatsApp");
    expect(csv[1]).toContain('"Iklan ""satu"", baru"');
  });
});

describe("existing and odd codes", () => {
  it("treats any code in use as taken, also lower case or three digits", () => {
    const { proposals } = proposeCodes([ad({ id: "1" }), ad({ id: "2", code: "f-ifp-01" }), ad({ id: "3", code: "F-IFP-100" })]);
    expect(proposals.map((p) => p.code)).toEqual(["F-IFP-02"]);
  });
  it("says so when a rep and line have no numbers left", () => {
    const { proposals, skipped } = proposeCodes([ad({ id: "1" }), ad({ id: "2", code: "F-IFP-99" })]);
    expect(proposals).toEqual([]);
    expect(skipped).toEqual([{ adId: "1", reason: "full" }]);
  });
  it("keeps spreadsheet formulas from running", () => {
    const ads = [ad({ id: "1", name: "=HYPERLINK(\"x\")" })];
    expect(toCsv(ads, proposeCodes(ads).proposals)).toContain("'=HYPERLINK");
  });
});

describe("applyCodes", () => {
  it("only fills ads that are still without a code, and explains a taken code", async () => {
    const mk = async (code: string | null) => {
      const key = randomUUID();
      const [r] = await sql<{ ad: string }[]>`
        WITH c AS (INSERT INTO ad_campaigns (meta_campaign_id, name) VALUES (${`c-${key}`}, 'No_Zed') RETURNING id),
             s AS (INSERT INTO ad_sets (meta_adset_id, campaign_id, name) SELECT ${`s-${key}`}, id, 'Set IFP' FROM c RETURNING id),
             a AS (INSERT INTO ads (meta_ad_id, ad_set_id, name, prefill_code) SELECT ${`a-${key}`}, id, 'Iklan', ${code} FROM s RETURNING id)
        SELECT id AS ad FROM a`;
      return r.ad;
    };
    const free = await mk(null);
    const had = await mk("Z-LED-98");
    const p = (adId: string, code: string) => ({ adId, code, line: "IFP", message: "" });
    expect(await applyCodes([p(free, "Z-IFP-91"), p(had, "Z-IFP-92")])).toBe(1);
    const [row] = await sql<{ prefill_code: string }[]>`SELECT prefill_code FROM ads WHERE id = ${had}`;
    expect(row.prefill_code).toBe("Z-LED-98");
    const other = await mk(null);
    await expect(applyCodes([p(other, "Z-IFP-91")])).rejects.toThrow(/taken meanwhile/);
  });
});
