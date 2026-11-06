// Date math for ui/DatePicker, on plain "YYYY-MM-DD" days (no time, no time zone shifts).
// Pure, so it runs in the browser and in tests. Names come from Intl in Bahasa Indonesia.

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const toUtc = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const fromUtc = (d: Date) => d.toISOString().slice(0, 10);

/** A real calendar day ("2026-02-30" is not). */
export function isDay(v: string | null | undefined): v is string {
  return typeof v === "string" && DAY.test(v) && fromUtc(toUtc(v)) === v;
}

/** Today in Jakarta, YYYY-MM-DD. */
export function jakartaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(now);
}

export function addDays(day: string, n: number): string {
  const d = toUtc(day);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUtc(d);
}

/** Same day of the month n months later, or that month's last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return fromUtc(first);
}

/** The first day of the day's month. */
export function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

/** Monday = 0 … Sunday = 6: weeks in Indonesia start on Senin. */
function weekdayIndex(day: string): number {
  return (toUtc(day).getUTCDay() + 6) % 7;
}

export function startOfWeek(day: string): string {
  return addDays(day, -weekdayIndex(day));
}

export function endOfWeek(day: string): string {
  return addDays(day, 6 - weekdayIndex(day));
}

/** Six weeks of seven days (Monday first) that cover the month of `day`; days of other months included. */
export function monthGrid(day: string): string[][] {
  const first = startOfWeek(monthStart(day));
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, i) => addDays(first, w * 7 + i)));
}

export function inRange(day: string, min?: string, max?: string): boolean {
  return (!min || day >= min) && (!max || day <= max);
}

export function clampDay(day: string, min?: string, max?: string): string {
  if (min && day < min) return min;
  if (max && day > max) return max;
  return day;
}

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("id-ID", { ...opts, timeZone: "UTC" });
const short = fmt({ weekday: "short", day: "numeric", month: "short", year: "numeric" });
const long = fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" });
const title = fmt({ month: "long", year: "numeric" });
const weekday = fmt({ weekday: "short" });

/** "Jum, 6 Nov 2026": what the closed picker shows. */
export function dayShort(day: string): string {
  return short.format(toUtc(day)).replace(/\./g, "");
}

/** "Jumat, 6 November 2026": the accessible name of a day in the grid. */
export function dayLong(day: string): string {
  return long.format(toUtc(day));
}

/** "November 2026" */
export function monthTitle(day: string): string {
  return title.format(toUtc(day));
}

/** Sen, Sel, Rab, Kam, Jum, Sab, Min */
export function weekdayNames(): string[] {
  return monthGrid("2026-11-01")[0].map((d) => weekday.format(toUtc(d)).replace(/\./g, ""));
}
