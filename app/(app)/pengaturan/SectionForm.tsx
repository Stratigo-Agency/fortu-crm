"use client";

import { useActionState } from "react";
import { t } from "@/lib/copy";
import type { SaveResult } from "./actions";

type Props = {
  title: string;
  hint?: string;
  action: (prev: SaveResult, form: FormData) => Promise<SaveResult>;
  children: React.ReactNode;
  saveLabel?: string;
  id: string;
  /** shown above the form, outside it (a form can't sit inside another form) */
  toolbar?: React.ReactNode;
};

/** One settings section = one form = one Save. The result shows next to the button. */
export function SectionForm({ id, title, hint, action, children, saveLabel, toolbar }: Props) {
  const [result, formAction, pending] = useActionState(action, null);
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-16 rounded-lg bg-white p-5 shadow-card">
      <h2 id={`${id}-h`} className="text-base font-semibold text-ink">{title}</h2>
      {hint && <p className="mt-1 text-sm text-slate">{hint}</p>}
      {toolbar && <div className="mt-4">{toolbar}</div>}
      <form action={formAction} className="mt-4">
        {children}
        <div className="mt-5 flex items-center gap-4">
          <button type="submit" disabled={pending} className="h-11 rounded-full bg-ink px-6 text-base font-semibold text-white hover:bg-ink/85 desk:h-9 disabled:opacity-60">
            {saveLabel ?? t("pengaturan.save")}
          </button>
          {result && (
            <p role={result.ok ? "status" : "alert"} className={result.ok ? "text-slate" : "font-semibold text-ink"}>
              {result.message}
            </p>
          )}
        </div>
      </form>
    </section>
  );
}

