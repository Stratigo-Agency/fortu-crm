import { describe, expect, it } from "vitest";
import { lineOf, prefillMessage, proposeCodes, repLetter, toCsv, type AdForCode } from "@/lib/adCodes";
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
    expect(csv[0]).toBe("Kampanye,Set iklan,Nama iklan,ID iklan di Meta,Kode,Pesan awal WhatsApp");
    expect(csv[1]).toContain('"Iklan ""satu"", baru"');
  });
});
