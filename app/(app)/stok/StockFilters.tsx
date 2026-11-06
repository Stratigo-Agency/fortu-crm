"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Select } from "../ui/Select";
import { type StockFilter, type StockLine, stockHref } from "@/lib/stockFilter";

type Props = {
  filter: StockFilter;
  lines: { value: string; label: string }[]; // first option = all lines
  labels: { line: string; onlyRisk: string };
};

/** Lini produk and "Hanya yang berisiko". The choice lives in the URL, so a link or a reload keeps it. */
export function StockFilters({ filter, lines, labels }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (next: StockFilter) => start(() => router.replace(stockHref("/stok", next)));
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <Select
        variant="pill"
        label={labels.line}
        value={filter.line ?? ""}
        disabled={pending}
        options={lines}
        onChange={(v) => go({ ...filter, line: (v || null) as StockLine | null })}
      />
      <label className="flex h-11 cursor-pointer items-center gap-2 text-base text-slate desk:h-9">
        <input
          type="checkbox"
          className="check"
          checked={filter.risk}
          disabled={pending}
          onChange={(e) => go({ ...filter, risk: e.target.checked })}
        />
        {labels.onlyRisk}
      </label>
    </div>
  );
}
