import type { SourceGroup } from "@/lib/leadFunnel";
import { PAGE_SIZE, type ProspekTab } from "@/lib/prospek";

/** /prospek link that keeps the tab, search, source group and page size in the URL (they survive a reload). */
export function prospekHref({ tab, q, limit, sumber }: { tab: ProspekTab; q?: string; limit?: number; sumber?: SourceGroup | null }): string {
  const params = new URLSearchParams();
  if (tab !== "baru") params.set("tab", tab);
  if (q) params.set("q", q);
  if (sumber) params.set("sumber", sumber);
  if (limit && limit > PAGE_SIZE) params.set("limit", String(limit));
  const qs = params.toString();
  return qs ? `/prospek?${qs}` : "/prospek";
}
