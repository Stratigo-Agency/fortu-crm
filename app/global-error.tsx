"use client";

import "./globals.css";
import { t } from "@/lib/copy";

// Last resort: the page around everything failed, so this brings its own <html>.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="id" className="h-full antialiased">
      <body className="min-h-full">
        <main role="alert" className="mx-auto flex w-full max-w-md flex-col items-start gap-3 px-4 py-16">
          <h1 className="text-lg font-semibold text-ink">{t("errors.pageTitle")}</h1>
          <p className="text-slate">{t("errors.pageHint")}</p>
          {error.digest && <p className="text-sm text-faint">{t("errors.reference", { digest: error.digest })}</p>}
          <button type="button" onClick={reset} className="mt-2 rounded-[10px] bg-[#111318] px-4 py-2 text-sm font-semibold text-white">
            {t("errors.retry")}
          </button>
        </main>
      </body>
    </html>
  );
}
