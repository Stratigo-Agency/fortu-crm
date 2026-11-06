import { describe, expect, it } from "vitest";
import {
  addDays, addMonths, clampDay, dayLong, dayShort, endOfWeek, inRange, isDay, jakartaToday, monthGrid, monthTitle, startOfWeek,
  weekdayNames,
} from "@/lib/calendar";

describe("calendar for ui/DatePicker", () => {
  it("today is Jakarta's date, not the server's", () => {
    // 17:30 UTC on 31 Dec is already 1 Jan in Jakarta
    expect(jakartaToday(new Date("2026-12-31T17:30:00Z"))).toBe("2027-01-01");
    expect(jakartaToday(new Date("2026-12-31T16:59:00Z"))).toBe("2026-12-31");
  });

  it("moves by days and months, keeping the end of a month", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonths("2026-11-06", -12)).toBe("2025-11-06");
  });

  it("weeks start on Senin, six weeks cover any month", () => {
    expect(weekdayNames()).toEqual(["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"]);
    const grid = monthGrid("2026-11-15");
    expect(grid).toHaveLength(6);
    expect(grid[0][0]).toBe("2026-10-26"); // 1 Nov 2026 is a Sunday
    expect(grid[0][6]).toBe("2026-11-01");
    expect(startOfWeek("2026-11-06")).toBe("2026-11-02");
    expect(endOfWeek("2026-11-06")).toBe("2026-11-08");
  });

  it("keeps min and max", () => {
    expect(inRange("2026-11-07", undefined, "2026-11-06")).toBe(false);
    expect(clampDay("2026-11-07", undefined, "2026-11-06")).toBe("2026-11-06");
    expect(clampDay("2026-10-01", "2026-11-01")).toBe("2026-11-01");
  });

  it("names days and months in Bahasa", () => {
    expect(dayShort("2026-11-06")).toBe("Jum, 6 Nov 2026");
    expect(dayLong("2026-11-06")).toBe("Jumat, 6 November 2026");
    expect(monthTitle("2026-08-01")).toBe("Agustus 2026");
    expect(isDay("2026-02-30")).toBe(false);
    expect(isDay("2026-02-28")).toBe(true);
    expect(isDay("")).toBe(false);
  });
});
