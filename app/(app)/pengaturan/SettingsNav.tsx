"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { t } from "@/lib/copy";
import { segment, segmentGroup } from "../PageHeader";

/** Sub-navigation between the Pengaturan pages; the current page is highlighted. */
export function SettingsNav({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();
  if (items.length === 0) return null;
  return (
    <nav aria-label={t("pengaturan.title")} className="flex">
      <div className={`${segmentGroup} max-w-full flex-wrap gap-1 rounded-2xl p-1`}>
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={segment(active)}>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
