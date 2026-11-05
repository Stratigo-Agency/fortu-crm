"use client";

import type { SalesOption } from "@/lib/salesFilter";
import { setSalesFilter } from "./actions";

type Props = { options: SalesOption[]; selected: string | null; allLabel: string; label: string };

export function SalesFilter({ options, selected, allLabel, label }: Props) {
  return (
    <form action={setSalesFilter}>
      <label className="flex flex-col gap-1 px-2">
        <span className="text-sm text-faint">{label}</span>
        <select
          name="sales"
          defaultValue={selected ?? "all"}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="h-11 w-full rounded-sm border border-line bg-white px-2.5 text-base text-ink md:h-9"
        >
          <option value="all">{allLabel}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.full_name}
            </option>
          ))}
        </select>
      </label>
    </form>
  );
}
