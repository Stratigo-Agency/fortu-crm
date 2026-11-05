"use client";

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
    <select
      aria-label={label}
      value={value}
      onChange={(e) => router.push(options.find((o) => o.value === e.target.value)?.href ?? "")}
      className="h-11 rounded-full border border-line bg-white px-3.5 text-base text-ink hover:bg-paper md:h-9"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
