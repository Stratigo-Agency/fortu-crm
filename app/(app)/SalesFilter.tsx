"use client";

import type { SalesOption } from "@/lib/salesFilter";
import { setSalesFilter } from "./actions";

type Props = { options: SalesOption[]; selected: string | null; allLabel: string; label: string };

export function SalesFilter({ options, selected, allLabel, label }: Props) {
  return (
    <form action={setSalesFilter}>
      <select
        name="sales"
        aria-label={label}
        defaultValue={selected ?? "all"}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="h-11 w-34 rounded-sm md:w-36 border border-white/30 bg-navy px-2 md:px-3 text-base text-white"
      >
        <option value="all">{allLabel}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.full_name}
          </option>
        ))}
      </select>
    </form>
  );
}
