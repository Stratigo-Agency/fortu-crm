"use client";

import { Select } from "../ui/Select";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { periodParam, REPORT_PERIODS, type ReportPeriod } from "@/lib/reportPeriod";

export type PeriodOption = { value: ReportPeriod; label: string };

/** Bulan ini / Kuartal ini / Tahun ini. The choice lives in the URL (?periode=kuartal), so a link keeps it. */
export function PeriodSelect({ value, label, options }: { value: ReportPeriod; label: string; options: PeriodOption[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Select
      variant="pill"
      label={label}
      value={value}
      disabled={pending}
      options={options}
      onChange={(v) => {
        const next = v as ReportPeriod;
        if (!REPORT_PERIODS.includes(next)) return;
        start(() => router.replace(next === "month" ? "/laporan" : `/laporan?periode=${periodParam(next)}`));
      }}
    />
  );
}
