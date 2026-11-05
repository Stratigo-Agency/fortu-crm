// The period select on /laporan. The URL says it in Bahasa (?periode=kuartal), the views say it in English.

export type ReportPeriod = "month" | "quarter" | "year";

const BY_PARAM: Record<string, ReportPeriod> = { bulan: "month", kuartal: "quarter", tahun: "year" };

/** The period a `periode` query value stands for; anything else (or nothing) is this month. */
export function parsePeriod(value: string | string[] | undefined): ReportPeriod {
  const v = Array.isArray(value) ? value[0] : value;
  return (v && BY_PARAM[v]) || "month";
}

export function periodParam(period: ReportPeriod): string {
  return Object.keys(BY_PARAM).find((k) => BY_PARAM[k] === period) as string;
}

export const REPORT_PERIODS: ReportPeriod[] = ["month", "quarter", "year"];
