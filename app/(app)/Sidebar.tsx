"use client";

import {
  BarChart3, Boxes, Building2, Home, Inbox, KanbanSquare, Megaphone, Menu, Plus, Search, Settings, Users, X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

export type NavIcon = "home" | "pipeline" | "prospek" | "kontak" | "perusahaan" | "laporan" | "pengaturan" | "iklan" | "stok";
export type NavItem = { href: string; label: string; icon: NavIcon; badge?: number; also?: string[] };

const ICONS = {
  home: Home, pipeline: KanbanSquare, prospek: Inbox, kontak: Users, perusahaan: Building2,
  laporan: BarChart3, pengaturan: Settings, iklan: Megaphone, stok: Boxes,
} as const;

const noSubscribe = () => () => {};

function isActive(pathname: string, item: NavItem) {
  return [item.href, ...(item.also ?? [])].some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function NavLinks({ items, onPick }: { items: NavItem[]; onPick?: () => void }) {
  const pathname = usePathname();
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((item) => {
        const active = isActive(pathname, item);
        const Icon = ICONS[item.icon];
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onPick}
              aria-current={active ? "page" : undefined}
              className={`flex h-11 items-center gap-3 rounded-sm px-3 text-base desk:h-9 ${
                active ? "bg-white font-semibold text-ink shadow-card" : "text-slate hover:bg-black/[0.04] hover:text-ink"
              }`}
            >
              <Icon size={17} strokeWidth={1.8} aria-hidden="true" className={active ? "text-accent" : "text-faint"} />
              <span className="flex-1">{item.label}</span>
              {item.badge ? (
                <span className="tabular flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-semibold text-white">
                  {item.badge}
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

type Props = {
  items: NavItem[];
  bottomItems: NavItem[];
  labels: { search: string; add: string; menu: string; close: string; main: string; shortcutMac: string; shortcutOther: string };
  footer: React.ReactNode; // sales filter and the user menu, rendered on the server
  bell: React.ReactNode; // the reminders bell (needs the unread count from the server)
};

/** Desktop: a quiet sidebar (Attio's layout, Sana's look). Phones: a slim white bar with a menu sheet. */
export function Sidebar({ items, bottomItems, labels, footer, bell }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const isMac = useSyncExternalStore(noSubscribe, () => /Mac|iPhone|iPad/.test(navigator.platform), () => true);

  // ⌘K / Ctrl+K opens search, but never over a form or a dialog: that would throw away unsaved edits
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) return;
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
      if (document.querySelector('[aria-modal="true"]') || (typing && el?.getAttribute("type") !== "search")) return;
      e.preventDefault();
      const box = document.querySelector<HTMLInputElement>('form[role="search"][action="/cari"] input[name="q"]');
      if (box) box.focus(); // already on Beranda or Cari: keep what is typed
      else router.push("/cari");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  // the phone menu: Esc closes it, focus goes in and comes back, the page behind doesn't scroll
  useEffect(() => {
    if (!open) return;
    const button = menuButton.current;
    closeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      button?.focus();
    };
  }, [open]);

  const top = (
    <div className="flex flex-col gap-1.5">
      <Link
        href="/cari"
        onClick={() => setOpen(false)}
        className="flex h-11 items-center gap-3 rounded-sm px-3 text-base text-slate hover:bg-black/[0.04] hover:text-ink desk:h-9"
      >
        <Search size={17} strokeWidth={1.8} aria-hidden="true" className="text-faint" />
        <span className="flex-1">{labels.search}</span>
        <kbd className="hidden rounded-md border border-line bg-white px-1.5 font-sans text-xs text-faint md:inline">{isMac ? labels.shortcutMac : labels.shortcutOther}</kbd>
      </Link>
      <Link
        href="/tambah"
        onClick={() => setOpen(false)}
        className="flex h-11 items-center justify-center gap-2 rounded-full bg-ink px-4 text-base font-semibold text-white hover:bg-ink/85 desk:h-9"
      >
        <Plus size={16} strokeWidth={2.2} aria-hidden="true" />
        {labels.add}
      </Link>
    </div>
  );

  return (
    <>
      {/* desktop */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-5 border-r border-line bg-paper px-3 py-4 md:flex">
        <div className="flex items-center justify-between pr-1">
          <Link href="/beranda" className="flex h-9 items-center px-3">
            <Image src="/brand/fortu-logo-navy.png" alt="Fortu" width={84} height={25} priority />
          </Link>
          {bell}
        </div>
        {top}
        <nav aria-label={labels.main} className="flex flex-1 flex-col justify-between overflow-y-auto">
          <NavLinks items={items} />
          <NavLinks items={bottomItems} />
        </nav>
        <div className="border-t border-line pt-3">{footer}</div>
      </aside>

      {/* phone */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-white/90 px-4 backdrop-blur md:hidden">
        <Link href="/beranda" className="flex h-11 items-center">
          <Image src="/brand/fortu-logo-navy.png" alt="Fortu" width={76} height={23} priority />
        </Link>
        <div className="flex items-center gap-1">
          {bell}
          <Link href="/cari" aria-label={labels.search} className="flex h-11 w-11 items-center justify-center rounded-full text-ink">
            <Search size={20} strokeWidth={1.8} aria-hidden="true" />
          </Link>
          <button
            ref={menuButton}
            type="button"
            aria-label={labels.menu}
            aria-expanded={open}
            onClick={() => setOpen(true)}
            className="flex h-11 w-11 items-center justify-center rounded-full text-ink"
          >
            <Menu size={22} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label={labels.menu}>
          <button type="button" aria-label={labels.close} onClick={() => setOpen(false)} className="absolute inset-0 animate-fade bg-slate/30 backdrop-blur-[2px]" />
          <div className="absolute inset-y-0 right-0 flex w-[min(20rem,88vw)] animate-sheet flex-col gap-5 bg-paper px-3 py-3 shadow-pop">
            <div className="flex items-center justify-end">
              <button
                ref={closeButton}
                type="button"
                aria-label={labels.close}
                onClick={() => setOpen(false)}
                className="flex h-11 w-11 items-center justify-center rounded-full text-ink"
              >
                <X size={22} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </div>
            {top}
            <nav aria-label={labels.main} className="flex flex-1 flex-col justify-between overflow-y-auto">
              <NavLinks items={items} onPick={() => setOpen(false)} />
              <NavLinks items={bottomItems} onPick={() => setOpen(false)} />
            </nav>
            <div className="border-t border-line pt-3">{footer}</div>
          </div>
        </div>
      )}
    </>
  );
}
