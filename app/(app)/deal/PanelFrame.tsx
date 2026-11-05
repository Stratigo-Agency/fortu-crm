"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { t } from "@/lib/copy";

type Props = {
  /** panel = intercepted route over the board, page = its own page, query = a ?contact= / ?company= panel */
  variant: "panel" | "page" | "query";
  /** where a "query" panel goes when it closes (the list without the panel parameter) */
  closeHref?: string;
  /** the dialog's accessible name */
  label?: string;
  children: React.ReactNode;
};

type Frame = {
  /** The form tells the frame whether it has unsaved changes. */
  setDirty: (dirty: boolean) => void;
  /** Close (asks first when there are unsaved changes). */
  close: () => void;
  /** Close without asking (after a save). */
  closeNow: () => void;
};

const FrameContext = createContext<Frame | null>(null);

export function useDealFrame(): Frame {
  const frame = useContext(FrameContext);
  if (!frame) throw new Error("useDealFrame outside PanelFrame");
  return frame;
}

/** The 700 px side panel over the board (overlay, Esc closes) or the page around a full-page deal. */
export function PanelFrame({ variant, closeHref, label, children }: Props) {
  const router = useRouter();
  const dirty = useRef(false);
  const [asking, setAsking] = useState(false);

  const closeNow = useCallback(() => {
    if (variant === "panel") router.back();
    else if (variant === "query") router.push(closeHref ?? "/");
    else router.push("/pipeline");
  }, [router, variant, closeHref]);

  const close = useCallback(() => {
    if (dirty.current) setAsking(true);
    else closeNow();
  }, [closeNow]);

  const setDirty = useCallback((d: boolean) => {
    dirty.current = d;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && variant !== "page" && !asking) close();
    };
    // closing the tab or reloading with unsaved changes
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [variant, asking, close]);

  const body = (
    <>
      <CloseButton onClick={close} />
      {children}
      {asking && (
        <div role="alertdialog" aria-modal="true" aria-label={t("common.unsaved")} className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-6">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-pop">
            <p className="font-semibold text-ink">{t("common.unsaved")}</p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                autoFocus
                onClick={() => setAsking(false)}
                className="h-11 rounded-full bg-ink px-5 text-base font-semibold text-white hover:bg-ink/85 md:h-9"
              >
                {t("common.keepEditing")}
              </button>
              <button
                type="button"
                onClick={() => {
                  dirty.current = false;
                  closeNow();
                }}
                className="h-11 rounded-full border border-line bg-white px-5 text-base text-ink hover:bg-paper md:h-9"
              >
                {t("common.discard")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  return (
    <FrameContext.Provider value={{ setDirty, close, closeNow }}>
      {variant === "page" ? (
        <main className="relative mx-auto w-full max-w-3xl bg-white md:my-8 md:rounded-lg md:shadow-card">{body}</main>
      ) : (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/20 md:p-2" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={label ?? t("deal.kind")}
            className="relative h-full w-full max-w-[680px] overflow-y-auto bg-white shadow-pop md:rounded-lg"
          >
            {body}
          </aside>
        </div>
      )}
    </FrameContext.Provider>
  );
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t("common.close")}
      className="absolute right-4 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-full text-slate hover:bg-paper hover:text-ink md:h-9 md:w-9"
    >
      <X size={18} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}
