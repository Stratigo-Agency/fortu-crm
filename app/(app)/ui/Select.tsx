"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

export type SelectOption = { value: string; label: string; hint?: string; disabled?: boolean };

type Props = {
  options: SelectOption[];
  /** controlled value; leave out and use defaultValue for a plain form field */
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** the form field name: a hidden input carries the value, so server forms keep working */
  name?: string;
  /** id of the trigger button, for a <label htmlFor> */
  id?: string;
  /** accessible name when there is no visible label */
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  /** show a filter box (on by default for long lists) */
  searchable?: boolean;
  searchLabel?: string;
  /** "field" = form input look; "pill" = a quiet rounded toolbar control */
  variant?: "field" | "pill";
  className?: string;
};

/**
 * Our own dropdown (Sana x Attio look) instead of the browser's: a button that opens a list.
 * Keyboard: arrows move, Enter or Space picks, Esc closes, typing jumps to a matching option.
 */
export function Select({
  options, value, defaultValue, onChange, name, id, label, placeholder, disabled, required, invalid,
  searchable, searchLabel, variant = "field", className = "",
}: Props) {
  const autoId = useId();
  const listId = `${autoId}-list`;
  const [inner, setInner] = useState(defaultValue ?? "");
  const current = value ?? inner;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState("");
  const [up, setUp] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const filterBox = useRef<HTMLInputElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const withSearch = searchable ?? options.length > 10;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q) || o.hint?.toLowerCase().includes(q)) : options;
  }, [options, query]);
  const selected = options.find((o) => o.value === current);

  function choose(o: SelectOption | undefined) {
    if (!o || o.disabled) return;
    if (value === undefined) setInner(o.value);
    setOpen(false);
    setQuery("");
    button.current?.focus();
    if (o.value !== current) onChange?.(o.value);
  }

  function openList() {
    if (disabled) return;
    const box = button.current?.getBoundingClientRect();
    setUp(!!box && window.innerHeight - box.bottom < 300 && box.top > 300);
    setActive(Math.max(0, shown.findIndex((o) => o.value === current)));
    setOpen(true);
  }

  // close on a click outside
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDown);
    if (withSearch) filterBox.current?.focus();
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, withSearch]);

  // keep the active option in view
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function move(delta: number) {
    if (shown.length === 0) return;
    let i = active;
    for (let n = 0; n < shown.length; n++) {
      i = (i + delta + shown.length) % shown.length;
      if (!shown[i].disabled) break;
    }
    setActive(i);
  }

  function onKey(e: React.KeyboardEvent) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation(); // don't also close the panel around us
      setOpen(false);
      setQuery("");
      button.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(shown.length - 1);
    } else if (e.key === "Enter" || (e.key === " " && !withSearch)) {
      e.preventDefault();
      choose(shown[active]);
    } else if (e.key === "Tab") {
      setOpen(false);
      setQuery("");
    } else if (!withSearch && e.key.length === 1) {
      // type-ahead: jump to the first option starting with what was typed
      const now = e.timeStamp;
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : "") + e.key.toLowerCase(), at: now };
      const i = shown.findIndex((o) => o.label.toLowerCase().startsWith(typed.current.text));
      if (i >= 0) setActive(i);
    }
  }

  const trigger =
    variant === "pill"
      ? "h-11 rounded-full border border-input bg-white pl-3.5 pr-2.5 hover:bg-paper desk:h-9"
      : `h-12 w-full rounded-sm border bg-white pl-3 pr-2.5 desk:h-10 ${invalid ? "border-2 border-bad" : "border-input"}`;

  return (
    <div ref={root} className={`relative min-w-0 ${variant === "field" ? "w-full" : ""} ${className}`} onKeyDown={onKey}>
      {name !== undefined && <input type="hidden" name={name} value={current} />}
      <button
        ref={button}
        id={id}
        type="button"
        role="combobox"
        aria-label={label}
        title={selected?.label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && shown[active] ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        aria-required={required || undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        className={`flex items-center gap-2 text-left text-base text-ink transition focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15 disabled:cursor-not-allowed disabled:bg-paper disabled:text-slate ${trigger}`}
      >
        <span className={`min-w-0 flex-1 truncate ${selected ? "" : "text-faint"}`}>{selected?.label ?? placeholder ?? ""}</span>
        <ChevronDown size={16} strokeWidth={1.8} aria-hidden="true" className={`shrink-0 text-faint transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          className={`absolute left-0 z-50 min-w-full max-w-[min(26rem,calc(100vw-2rem))] animate-pop rounded-md bg-white p-1 shadow-pop ${
            up ? "bottom-full mb-1.5 origin-bottom" : "top-full mt-1.5 origin-top"
          }`}
        >
          {withSearch && (
            <div className="relative mb-1">
              <Search size={14} strokeWidth={1.8} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
              <input
                ref={filterBox}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                aria-label={searchLabel ?? label}
                aria-controls={listId}
                className="h-11 w-full rounded-sm border-0 bg-paper pl-8 pr-2 text-base text-ink outline-none desk:h-9"
              />
            </div>
          )}
          <ul ref={list} id={listId} role="listbox" aria-label={label} className="max-h-72 overflow-y-auto overscroll-contain">
            {shown.map((o, i) => {
              const isSel = o.value === current;
              return (
                <li
                  key={o.value}
                  id={`${listId}-${i}`}
                  data-index={i}
                  data-value={o.value}
                  role="option"
                  aria-selected={isSel}
                  aria-disabled={o.disabled || undefined}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(o)}
                  className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-sm px-2.5 py-1.5 text-base desk:min-h-9 ${
                    o.disabled ? "cursor-default text-faint" : i === active ? "bg-accent-soft text-ink" : "text-ink"
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block">{o.label || " "}</span>
                    {o.hint && <span className="block text-sm text-slate">{o.hint}</span>}
                  </span>
                  {isSel && <Check size={15} strokeWidth={2.2} aria-hidden="true" className="shrink-0 text-accent" />}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
