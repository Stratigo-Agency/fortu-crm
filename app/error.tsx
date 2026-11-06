"use client";

import { t } from "@/lib/copy";

// Shown when a page outside the signed-in app fails (sign-in, the layout itself). There is no sidebar here;
// screens inside the app use app/(app)/error.tsx, which keeps it.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main role="alert" className="mx-auto flex w-full max-w-md flex-col items-start gap-3 px-4 py-16 md:px-6">
      <h1 className="text-lg font-semibold text-ink">{t("errors.pageTitle")}</h1>
      <p className="text-slate">{t("errors.pageHint")}</p>
      {error.digest && <p className="text-sm text-faint">{t("errors.reference", { digest: error.digest })}</p>}
      <div className="flex gap-2 pt-2">
        <button type="button" onClick={reset} className="rounded-[10px] bg-[#111318] px-4 py-2 text-sm font-semibold text-white">
          {t("errors.retry")}
        </button>
        <a href="/beranda" className="rounded-[10px] border border-line px-4 py-2 text-sm font-semibold text-ink">
          {t("errors.toHome")}
        </a>
      </div>
    </main>
  );
}
