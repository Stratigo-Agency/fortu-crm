import type { PipelineView } from "@/lib/pipelineTypes";

/** /pipeline link keeping the view, search and Lost toggle in the URL (they survive a reload). */
export function pipelineHref(p: { view: PipelineView; q?: string; lost?: boolean }): string {
  const params = new URLSearchParams();
  if (p.view !== "board") params.set("view", p.view);
  if (p.q) params.set("q", p.q);
  if (p.lost) params.set("lost", "1");
  const qs = params.toString();
  return qs ? `/pipeline?${qs}` : "/pipeline";
}

export function parseView(v: string | string[] | undefined): PipelineView {
  return v === "ringkas" || v === "list" ? v : "board";
}
