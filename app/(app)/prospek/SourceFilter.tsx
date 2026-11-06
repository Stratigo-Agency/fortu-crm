"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Select, type SelectOption } from "../ui/Select";

/** Semua sumber / Iklan Meta / Website / …: the choice lives in the URL (?sumber=meta), next to tab and search. */
export function SourceFilter({ value, label, options, hrefs }: { value: string; label: string; options: SelectOption[]; hrefs: Record<string, string> }) {
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
        const href = hrefs[v];
        if (href) start(() => router.replace(href));
      }}
    />
  );
}
