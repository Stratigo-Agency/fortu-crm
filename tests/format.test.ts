import { describe, expect, it } from "vitest";
import { chatDate, dayMonth, percent, relDate, relTime, rupiah, rupiahShort } from "@/lib/format";

describe("rupiah", () => {
  it.each([
    [540_000_000, "Rp540.000.000"],
    ["540000000", "Rp540.000.000"],
    [999_999, "Rp999.999"],
    [0, "Rp0"],
    [-25_000, "-Rp25.000"],
    ["abc", "Rp0"],
  ])("%s → %s", (n, out) => expect(rupiah(n)).toBe(out));
});

describe("rupiahShort", () => {
  it.each([
    [1_120_000_000, "Rp1,12 M"],
    ["1120000000", "Rp1,12 M"],
    [4_820_000_000, "Rp4,82 M"],
    [1_500_000_000, "Rp1,5 M"],
    [2_000_000_000, "Rp2 M"],
    [540_000_000, "Rp540 jt"],
    [626_600_000, "Rp626,6 jt"],
    [1_000_000, "Rp1 jt"],
    [999_960_000, "Rp1 M"],
    [999_999, "Rp999.999"],
    [-312_000_000, "-Rp312 jt"],
  ])("%s → %s", (n, out) => expect(rupiahShort(n)).toBe(out));
});

// 24 Nov 2026, 10:00 in Jakarta (03:00 UTC)
const now = new Date("2026-11-24T03:00:00Z");

describe("chatDate", () => {
  it.each([
    ["2026-11-24T01:00:00Z", "hari ini"],
    ["2026-11-23T08:00:00Z", "kemarin"],
    ["2026-11-08T08:00:00Z", "8 Nov"],
    ["2026-10-25T08:00:00Z", "25 Okt"],
  ])("%s → %s", (d, out) => expect(chatDate(d, now)).toBe(out));
});

describe("relDate", () => {
  it.each([
    ["2026-11-24", "hari ini"],
    ["2026-11-25", "besok"],
    ["2026-11-23", "kemarin"],
    ["2026-11-21", "3 hari lalu"],
    ["2026-10-25", "30 hari lalu"],
    ["2026-10-24", "24 Okt"],
    ["2026-11-27", "dalam 3 hari"],
    ["2026-12-01", "dalam 7 hari"],
    ["2026-12-02", "2 Des"],
    ["2026-08-05", "5 Agu"],
    ["2025-11-24", "24 Nov 2025"],
    ["2027-01-10", "10 Jan 2027"],
  ])("%s → %s", (d, out) => expect(relDate(d, now)).toBe(out));

  it("uses the Jakarta day, not the UTC day", () => {
    // 23 Nov 18:00 UTC is already 24 Nov 01:00 in Jakarta
    expect(relDate(new Date("2026-11-23T18:00:00Z"), now)).toBe("hari ini");
    // 23 Nov 16:59 UTC is still 23 Nov 23:59 in Jakarta
    expect(relDate(new Date("2026-11-23T16:59:00Z"), now)).toBe("kemarin");
  });
});

describe("relTime", () => {
  it.each([
    ["2026-11-24T02:59:40Z", "1 menit lalu"],
    ["2026-11-24T02:55:00Z", "5 menit lalu"],
    ["2026-11-24T00:00:00Z", "3 jam lalu"],
    ["2026-11-23T03:00:00Z", "kemarin"],
    ["2026-11-20T03:00:00Z", "4 hari lalu"],
    ["2026-11-25T03:00:00Z", "besok"],
  ])("%s → %s", (ts, out) => expect(relTime(ts, now)).toBe(out));
});

describe("dayMonth and percent", () => {
  it("formats close dates and probabilities", () => {
    expect(dayMonth("2026-11-21", now)).toBe("21 Nov");
    expect(dayMonth("2025-11-21", now)).toBe("21 Nov 2025");
    expect(percent("0.100")).toBe("10%");
    expect(percent("0.900")).toBe("90%");
    expect(percent(1)).toBe("100%");
  });
});
