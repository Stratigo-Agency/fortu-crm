"use client";

import { Bell, BellOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { loadBellAction, markAllReadAction, markReadAction, unreadCountAction, type BellState } from "./pengingat/actions";
import { Popup } from "./ui/Popup";

type Labels = { title: string; open: string; unread: string; empty: string; markAll: string; error: string };

/** The bell: the number of unread reminders, and the latest 20 in a small panel. Opening one marks it read. */
export function NotificationBell({ initialUnread, labels }: { initialUnread: number; labels: Labels }) {
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<BellState | null>(null);
  const [unread, setUnread] = useState(initialUnread);
  const [failed, setFailed] = useState(false);
  const [, start] = useTransition();

  // keep the number fresh: when the window comes back into view, and every two minutes
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") unreadCountAction().then(setUnread).catch(() => {});
    };
    const timer = window.setInterval(refresh, 120_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  async function toggle() {
    if (open) return setOpen(false);
    setOpen(true);
    setFailed(false);
    try {
      const s = await loadBellAction();
      setState(s);
      setUnread(s.unread);
    } catch {
      setFailed(true);
    }
  }

  function pick(id: string, href: string | null, wasUnread: boolean) {
    setOpen(false);
    if (wasUnread) setUnread((n) => Math.max(0, n - 1));
    start(async () => {
      await markReadAction(id);
      if (href) router.push(href);
      else router.refresh();
    });
  }

  function markAll() {
    setUnread(0);
    setState((s) => (s ? { ...s, items: s.items.map((i) => ({ ...i, unread: false })) } : s));
    start(async () => {
      await markAllReadAction();
      router.refresh();
    });
  }

  return (
    <div ref={root} className="relative" onKeyDown={(e) => e.key === "Escape" && open && (e.stopPropagation(), setOpen(false), button.current?.focus())}>
      <button
        ref={button}
        type="button"
        onClick={toggle}
        aria-label={unread > 0 ? `${labels.open}, ${labels.unread.replace("{n}", String(unread))}` : labels.open}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="relative flex h-11 w-11 items-center justify-center rounded-full text-slate transition hover:bg-black/[0.04] hover:text-ink desk:h-9 desk:w-9"
      >
        <Bell size={18} strokeWidth={1.8} aria-hidden="true" className={unread > 0 ? "text-accent" : ""} />
        {unread > 0 && (
          <span className="tabular absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-late px-1 text-[10px] font-semibold text-white desk:right-0 desk:top-0">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      <Popup anchor={button} within={root} open={open} onClose={() => setOpen(false)} align="start" width={384}>
        <div role="dialog" aria-label={labels.title} className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-3 px-2.5 pb-1.5 pt-2">
            <h2 className="text-base font-semibold text-ink">{labels.title}</h2>
            {unread > 0 && (
              <button type="button" onClick={markAll} className="flex h-11 items-center rounded-full px-2.5 text-sm font-medium text-accent-strong hover:bg-accent-soft desk:h-9">
                {labels.markAll}
              </button>
            )}
          </div>
          {failed ? (
            <p role="alert" className="px-4 py-8 text-center text-slate">{labels.error}</p>
          ) : state === null ? (
            <div aria-hidden="true" className="flex flex-col gap-2 p-2.5">
              <div className="skeleton h-10 w-full" />
              <div className="skeleton h-10 w-full" />
              <div className="skeleton h-10 w-full" />
            </div>
          ) : state.items.length === 0 ? (
            <p className="flex flex-col items-center gap-2 px-4 py-8 text-center text-slate">
              <BellOff size={20} strokeWidth={1.6} aria-hidden="true" className="text-faint" />
              {labels.empty}
            </p>
          ) : (
            <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
              {state.items.map((i) => (
                <li key={i.id}>
                  <button
                    type="button"
                    onClick={() => pick(i.id, i.href, i.unread)}
                    className="flex min-h-11 w-full items-start gap-2.5 px-2.5 py-2.5 text-left transition hover:bg-paper"
                  >
                    <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${i.unread ? "bg-accent" : "bg-transparent"}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className={`block text-base ${i.unread ? "font-semibold text-ink" : "text-ink"}`}>{i.title}</span>
                      {i.detail && <span className="block text-sm text-slate">{i.detail}</span>}
                    </span>
                    <span className="shrink-0 pt-0.5 text-sm text-faint">{i.at}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Popup>
    </div>
  );
}
