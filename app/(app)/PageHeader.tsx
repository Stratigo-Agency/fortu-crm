/** The thin bar at the top of every screen (Attio): a small title, a quiet note, actions on the right. */
export function PageHeader({ title, meta, actions }: { title: string; meta?: string; actions?: React.ReactNode }) {
  return (
    <header className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2.5 md:px-6">
      <h1 className="text-lg font-semibold text-ink">{title}</h1>
      {meta && <p className="text-sm text-faint">{meta}</p>}
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Black pill, the one primary action of a screen (Sana). */
export const primaryButton =
  "inline-flex h-11 items-center justify-center gap-1.5 rounded-full bg-ink px-4 text-base font-semibold text-white hover:bg-ink/85 md:h-9";
/** Quiet pill next to it. */
export const secondaryButton =
  "inline-flex h-11 items-center justify-center gap-1.5 rounded-full border border-line bg-white px-4 text-base text-ink hover:bg-paper md:h-9";
