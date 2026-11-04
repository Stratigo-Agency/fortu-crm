"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; badge?: number; also?: string[] };

function isActive(pathname: string, item: NavItem) {
  return [item.href, ...(item.also ?? [])].some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function TopNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="order-last flex w-full flex-wrap gap-1 md:order-none md:w-auto md:flex-nowrap">
      {items.map((item) => {
        const active = isActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex h-11 items-center gap-2 rounded-sm px-3 text-base md:h-10 md:px-4 ${
              active ? "bg-white/10 font-bold text-white" : "text-mist hover:text-white"
            }`}
          >
            {item.label}
            {item.badge ? (
              <span className="tabular flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1.5 text-xs font-bold text-navy">
                {item.badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
