"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { t } from "@/lib/copy";

type Props = { variant: "panel" | "page"; children: React.ReactNode };

/** Closing the deal: back to wherever the user came from, or to the Pipeline. */
export function useCloseDeal(variant: Props["variant"]) {
  const router = useRouter();
  return () => {
    if (variant === "panel") router.back();
    else router.push("/pipeline");
  };
}

/** The 700 px side panel over the board (overlay, Esc closes) or the page around a full-page deal. */
export function PanelFrame({ variant, children }: Props) {
  const close = useCloseDeal(variant);
  useEffect(() => {
    if (variant !== "panel") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  if (variant === "page") {
    return (
      <main className="relative mx-auto w-full max-w-3xl bg-white md:my-6 md:rounded-lg md:shadow-card">
        <CloseButton onClick={close} />
        {children}
      </main>
    );
  }
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/40" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={t("deal.kind")}
        className="relative h-full w-full max-w-[700px] overflow-y-auto bg-white shadow-card"
      >
        <CloseButton onClick={close} />
        {children}
      </aside>
    </div>
  );
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t("common.close")}
      className="absolute right-5 top-5 z-10 flex h-11 w-11 items-center justify-center rounded-sm bg-paper text-ink"
    >
      <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <path d="M3 3l12 12M15 3L3 15" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    </button>
  );
}
