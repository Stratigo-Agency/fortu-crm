"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { periodParam, REPORT_PERIODS, type ReportPeriod } from "@/lib/reportPeriod";

export type PeriodOption = { value: ReportPeriod; label: string };

/** Bulan ini / Kuartal ini / Tahun ini. The choice lives in the URL (?periode=kuartal), so a link keeps it. */
export function PeriodSelect({ value, label, options }: { value: ReportPeriod; label: string; options: PeriodOption[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <select
      aria-label={label}
      value={value}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value as ReportPeriod;
        if (!REPORT_PERIODS.includes(next)) return;
        start(() => router.replace(next === "month" ? "/laporan" : `/laporan?periode=${periodParam(next)}`));
      }}
      className="h-11 rounded-full border border-line bg-white px-3.5 text-base font-medium text-ink md:h-9"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
