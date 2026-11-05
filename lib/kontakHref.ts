import type { ContactSort } from "@/lib/contactTypes";

type Params = { q?: string; sort?: ContactSort; followup?: boolean; contact?: string };

/** /kontak link that keeps the search, sort, follow-up filter and the open contact in the URL. */
export function kontakHref(p: Params): string {
  const params = new URLSearchParams();
  if (p.q) params.set("q", p.q);
  if (p.sort && p.sort !== "last_new") params.set("sort", p.sort);
  if (p.followup) params.set("followup", "1");
  if (p.contact) params.set("contact", p.contact);
  const qs = params.toString();
  return qs ? `/kontak?${qs}` : "/kontak";
}
