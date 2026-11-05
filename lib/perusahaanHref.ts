import type { CompanySort } from "@/lib/contactTypes";

/** /perusahaan link keeping the search, sort and the open company in the URL. */
export function perusahaanHref(p: { q?: string; sort?: CompanySort; company?: string; all?: boolean }): string {
  const params = new URLSearchParams();
  if (p.q) params.set("q", p.q);
  if (p.sort && p.sort !== "name") params.set("sort", p.sort);
  if (p.all) params.set("all", "1");
  if (p.company) params.set("company", p.company);
  const qs = params.toString();
  return qs ? `/perusahaan?${qs}` : "/perusahaan";
}
