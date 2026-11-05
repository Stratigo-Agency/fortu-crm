"use client";

import { useRouter } from "next/navigation";
import { useId, useTransition } from "react";
import type { SalesOption } from "@/lib/salesFilter";
import { setSalesFilter } from "./actions";
import { Select } from "./ui/Select";

type Props = { options: SalesOption[]; selected: string | null; allLabel: string; label: string };

/** "Semua sales" or one rep, for every list and report. Saved in a cookie by the server action. */
export function SalesFilter({ options, selected, allLabel, label }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const id = useId(); // the sidebar and the phone menu each have one
  return (
    <div className="flex flex-col gap-1 px-2">
      <label htmlFor={id} className="text-sm text-faint">{label}</label>
      <Select
        id={id}
        value={selected ?? "all"}
        disabled={pending}
        options={[{ value: "all", label: allLabel }, ...options.map((o) => ({ value: o.id, label: o.full_name }))]}
        onChange={(v) =>
          start(async () => {
            const fd = new FormData();
            fd.set("sales", v);
            await setSalesFilter(fd);
            router.refresh();
          })
        }
        className="[&>button]:h-11 [&>button]:desk:h-9"
      />
    </div>
  );
}
