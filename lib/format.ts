import { t } from "@/lib/copy";

// Money is whole Rupiah before PPN; times are shown in Asia/Jakarta (CLAUDE.md rules 7–8).
// Inputs accept numbers and numeric strings, since postgres numeric comes back as a string.

const TZ = "Asia/Jakarta";
const whole = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const upTo = (digits: number) =>
  new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: digits });
const oneDecimal = upTo(1);
const twoDecimals = upTo(2);

function toNumber(n: number | string): number {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? v : 0;
}

/** Rp540.000.000 */
export function rupiah(n: number | string): string {
  const v = Math.round(toNumber(n));
  return `${v < 0 ? "-" : ""}Rp${whole.format(Math.abs(v))}`;
}

/** Rp1,12 M (≥ 1 miliar) · Rp626,6 jt (≥ 1 juta) · otherwise rupiah(n) */
export function rupiahShort(n: number | string): string {
  const v = toNumber(n);
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  // Round first, so 999,96 jt becomes Rp1 M instead of Rp1.000 jt.
  const jt = Math.round(abs / 1e5) / 10;
  if (abs >= 1e9 || jt >= 1000) return `${sign}Rp${twoDecimals.format(Math.round(abs / 1e7) / 100)} M`;
  if (abs >= 1e6) return `${sign}Rp${oneDecimal.format(jt)} jt`;
  return rupiah(v);
}

/** YYYY-MM-DD of a moment in Jakarta. */
function jakartaDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
}

/** A date-only string ("2026-11-24", e.g. closed_on) is already a Jakarta date. */
function dayOf(d: Date | string): string {
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  return jakartaDay(typeof d === "string" ? new Date(d) : d);
}

function dayNumber(day: string): number {
  const [y, m, dd] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, dd) / 86_400_000;
}

function shortDate(day: string, today: string): string {
  const [y, m, dd] = day.split("-").map(Number);
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", timeZone: "UTC" };
  if (day.slice(0, 4) !== today.slice(0, 4)) opts.year = "numeric";
  return new Intl.DateTimeFormat("id-ID", opts).format(new Date(Date.UTC(y, m - 1, dd)));
}

/** hari ini · besok · kemarin · 3 hari lalu (< 31) · dalam 3 hari (< 8) · 24 Nov · 24 Nov 2025 */
export function relDate(d: Date | string, now: Date = new Date()): string {
  const day = dayOf(d);
  const today = jakartaDay(now);
  const diff = dayNumber(day) - dayNumber(today);
  if (diff === 0) return t("common.today");
  if (diff === 1) return t("common.tomorrow");
  if (diff === -1) return t("common.yesterday");
  if (diff < 0 && -diff < 31) return t("common.daysAgo", { n: -diff });
  if (diff > 0 && diff < 8) return t("common.inDays", { n: diff });
  return shortDate(day, today);
}

/** 5 menit lalu · 3 jam lalu · then relDate() */
export function relTime(ts: Date | string, now: Date = new Date()): string {
  const at = typeof ts === "string" ? new Date(ts) : ts;
  const minutes = Math.floor((now.getTime() - at.getTime()) / 60_000);
  if (minutes < 0) return relDate(at, now);
  if (minutes < 60) return t("common.minutesAgo", { n: Math.max(1, minutes) });
  if (minutes < 24 * 60) return t("common.hoursAgo", { n: Math.floor(minutes / 60) });
  return relDate(at, now);
}
