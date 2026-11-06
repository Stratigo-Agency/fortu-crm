import type { Role } from "@/lib/auth";

// Where a sales rep always sees their own numbers, whatever the sidebar filter says.
// Beranda and Laporan are their own day and their own results; Pipeline, Prospek, Kontak and
// Perusahaan stay view all (rule 3) and follow the filter for everyone.

export const OWN_NUMBERS_PATHS = ["/beranda", "/laporan"] as const;

/** The owner a page of own numbers shows: the rep themself, otherwise what the filter says (null = all sales). */
export function ownNumbersOwner(user: { id: string; role: Role }, filter: string | null): string | null {
  return user.role === "sales_rep" ? user.id : filter;
}

/** True when the sidebar filter has no effect on this page for this person, so it shows their name, locked. */
export function filterLockedOn(role: Role, pathname: string): boolean {
  return role === "sales_rep" && OWN_NUMBERS_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
