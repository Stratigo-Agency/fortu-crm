import { describe, expect, it } from "vitest";
import { filterLockedOn, ownNumbersOwner } from "@/lib/salesScope";

describe("sales filter for a sales rep", () => {
  it("Beranda and Laporan show a rep's own numbers, whatever the filter says", () => {
    expect(ownNumbersOwner({ id: "rep", role: "sales_rep" }, "other")).toBe("rep");
    expect(ownNumbersOwner({ id: "rep", role: "sales_rep" }, null)).toBe("rep");
    expect(ownNumbersOwner({ id: "boss", role: "ceo" }, "other")).toBe("other");
    expect(ownNumbersOwner({ id: "lead", role: "sales_lead" }, null)).toBeNull();
  });

  it("the sidebar filter is locked to the rep's name exactly where it has no effect", () => {
    for (const p of ["/beranda", "/laporan", "/laporan/x"]) expect(filterLockedOn("sales_rep", p)).toBe(true);
    for (const p of ["/pipeline", "/prospek", "/kontak", "/perusahaan", "/berandaa"]) expect(filterLockedOn("sales_rep", p)).toBe(false);
    for (const r of ["sales_lead", "ceo", "admin", "marketing"] as const) expect(filterLockedOn(r, "/laporan")).toBe(false);
  });
});
