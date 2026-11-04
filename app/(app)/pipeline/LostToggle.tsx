"use client";

import { useRouter } from "next/navigation";

/** "Tampilkan Lost": a real checkbox that puts lost=1 in the URL. */
export function LostToggle({ checked, label, hrefOn, hrefOff }: { checked: boolean; label: string; hrefOn: string; hrefOff: string }) {
  const router = useRouter();
  return (
    <label className="flex h-11 cursor-pointer items-center gap-2 text-base text-ink">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => router.push(e.target.checked ? hrefOn : hrefOff)}
        className="h-5 w-5 accent-navy"
      />
      {label}
    </label>
  );
}
