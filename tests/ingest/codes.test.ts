import { describe, expect, it } from "vitest";
import { parseCodes } from "@/lib/ingest/codes";

describe("parseCodes", () => {
  it.each([
    ["Halo, saya mau tanya IFP [F-IFP-01]", { adCode: "F-IFP-01" }],
    ["[f-ifp-01] halo", { adCode: "F-IFP-01" }],
    ["Info harga #W7K2", { clickCode: "W7K2" }],
    ["info #w7k2 ya", { clickCode: "W7K2" }],
    ["[R-LED-12] dan #AB12", { adCode: "R-LED-12", clickCode: "AB12" }],
    ["[F-DSS-03] [F-IFP-01] #AAAA #BBBB", { adCode: "F-DSS-03", clickCode: "AAAA" }],
  ])("%s", (text, out) => expect(parseCodes(text)).toEqual(out));

  it.each([
    "Halo saya mau tanya harga",
    "[F-XYZ-01] wrong product line",
    "[FF-IFP-01] two letters",
    "[F-IFP-1] one digit",
    "#W7K2X five characters",
    "#W7K",
    "",
  ])("finds nothing in %j", (text) => expect(parseCodes(text)).toEqual({}));

  it("accepts null and undefined", () => {
    expect(parseCodes(null)).toEqual({});
    expect(parseCodes(undefined)).toEqual({});
  });
});
