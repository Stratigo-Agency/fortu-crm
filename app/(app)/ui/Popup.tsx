"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  /** the control the popup hangs from */
  anchor: React.RefObject<HTMLElement | null>;
  open: boolean;
  className?: string;
  children: React.ReactNode;
  /** a click or press outside both the anchor's wrapper and the popup closes it */
  onClose: () => void;
  /** the wrapper that holds the anchor (so a click on the control itself doesn't count as outside) */
  within: React.RefObject<HTMLElement | null>;
};

/**
 * A floating list that is never clipped: it is drawn outside scrolling tables and panels (fixed, at the
 * anchor), inside the open dialog when there is one (a modal dialog sits above everything else), and it
 * flips above the control when there is no room below. It follows the anchor on scroll and resize.
 */
export function Popup({ anchor, open, className = "", children, onClose, within }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxH: number } | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = anchor.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      const up = below < 220 && above > below;
      setHost((el.closest("dialog[open]") as HTMLElement | null) ?? document.body);
      setPos({
        left: Math.max(8, Math.min(r.left, window.innerWidth - Math.min(r.width, 360) - 8)),
        width: r.width,
        maxH: Math.max(160, Math.min(320, up ? above : below)),
        ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchor]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (within.current?.contains(target) || ref.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, onClose, within]);

  if (!open || !pos || !host) return null;
  return createPortal(
    <div
      ref={ref}
      style={{ position: "fixed", left: pos.left, minWidth: pos.width, top: pos.top, bottom: pos.bottom, zIndex: 60 }}
      className={`max-w-[min(26rem,calc(100vw-1rem))] animate-pop rounded-md bg-white p-1 shadow-pop ${pos.bottom !== undefined ? "origin-bottom" : "origin-top"} ${className}`}
    >
      <div style={{ maxHeight: pos.maxH }} className="flex flex-col">
        {children}
      </div>
    </div>,
    host,
  );
}
