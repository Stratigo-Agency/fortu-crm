"use client";

import { usePathname, useRouter } from "next/navigation";
import { useId, useTransition } from "react";
import type { Role } from "@/lib/auth";
import type { SalesOption } from "@/lib/salesFilter";
import { filterLockedOn } from "@/lib/salesScope";
import { setSalesFilter } from "./actions";
import { Select } from "./ui/Select";

type Props = {
  options: SalesOption[];
  selected: string | null;
  allLabel: string;
  label: string;
  /** the viewer, so a sales rep sees their own name (locked) where pages show only their numbers */
  viewer: { role: Role; name: string };
};

/** "Semua sales" or one rep, for every list and report. Saved in a cookie by the server action. */
export function SalesFilter({ options, selected, allLabel, label, viewer }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const id = useId(); // the sidebar and the phone menu each have one
  if (filterLockedOn(viewer.role, pathname)) {
    // Beranda and Laporan always show a rep's own numbers: say so instead of a choice that does nothing
    return (
      <div className="flex flex-col gap-1 px-2">
        <label htmlFor={id} className="text-sm text-faint">{label}</label>
        <Select id={id} value="own" disabled options={[{ value: "own", label: viewer.name }]} className="[&>button]:h-11 [&>button]:desk:h-9" />
      </div>
    );
  }
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
