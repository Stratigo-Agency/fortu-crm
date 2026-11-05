/** The thin bar at the top of every screen (Attio): a small title, a quiet note, actions on the right. */
export function PageHeader({ title, meta, actions }: { title: string; meta?: string; actions?: React.ReactNode }) {
  return (
    <header className="flex min-h-14 items-center gap-3 border-b border-line px-4 py-2.5 md:px-6">
      <div className="flex min-w-0 flex-1 flex-col md:flex-row md:items-baseline md:gap-3">
        <h1 className="truncate text-lg font-semibold text-ink">{title}</h1>
        {meta && <p className="truncate text-sm text-faint">{meta}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Black pill, the one primary action of a screen (Sana). */
export const primaryButton =
  "inline-flex h-11 items-center justify-center gap-1.5 rounded-full bg-ink px-4 text-base font-semibold text-white hover:bg-ink/85 md:h-9";
/** Quiet pill next to it. */
export const secondaryButton =
  "inline-flex h-11 items-center justify-center gap-1.5 rounded-full border border-line bg-white px-4 text-base text-ink hover:bg-paper md:h-9";

/** A row of figures without boxes (Attio): small grey label, value below. */
export function StatStrip({ children }: { children: React.ReactNode }) {
  return <dl className="flex flex-wrap gap-x-8 gap-y-3 border-b border-line py-4">{children}</dl>;
}

export function Stat({ label, value, hint, late }: { label: string; value: string; hint?: string; late?: boolean }) {
  return (
    <div>
      <dt className={`text-sm ${late ? "text-late" : "text-faint"}`}>{label}</dt>
      <dd className={`tabular mt-0.5 flex items-baseline gap-2 text-xl font-semibold ${late ? "text-late" : "text-ink"}`}>
        {value}
        {hint && <span className="text-sm font-normal text-faint">{hint}</span>}
      </dd>
    </div>
  );
}

/** Pill segmented control (Board / Ringkas / List, tabs). */
export const segmentGroup = "flex rounded-full bg-paper p-0.5";
export function segment(active: boolean): string {
  return `flex h-10 items-center rounded-full px-3.5 text-base md:h-8 ${active ? "bg-white font-semibold text-ink shadow-card" : "text-slate hover:text-ink"}`;
}

/** The small grey search field of a list screen. */
export const searchField =
  "h-11 w-full rounded-sm border border-line bg-paper pl-9 pr-3 text-base text-ink placeholder:text-faint focus:border-input focus:bg-white md:h-9";
export const searchIcon = "pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint";

/** Page body padding under the header. */
export const body = "px-4 md:px-6";
