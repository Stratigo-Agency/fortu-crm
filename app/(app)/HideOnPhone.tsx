"use client";

import { usePathname } from "next/navigation";

/** Hides the app chrome below 768 px on one page that draws its own phone header (e.g. /tambah). */
export function HideOnPhone({ path, children }: { path: string; children: React.ReactNode }) {
  const pathname = usePathname();
  return <div className={pathname === path ? "hidden md:block" : undefined}>{children}</div>;
}
