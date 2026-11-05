"use client";

import { Select } from "./ui/Select";
import { useRouter } from "next/navigation";

/** A select that puts its choice in the URL (e.g. the sort order), so it survives a reload. */
export function UrlSelect({
  value,
  label,
  options,
}: {
  value: string;
  label: string;
  options: { href: string; label: string; value: string }[];
}) {
  const router = useRouter();
  return (
    <Select
      variant="pill"
      label={label}
      value={value}
      options={options}
      onChange={(v) => router.push(options.find((o) => o.value === v)?.href ?? "")}
    />
  );
}
