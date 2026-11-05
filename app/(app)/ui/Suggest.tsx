"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Popup } from "./Popup";

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "list"> & {
  value: string;
  onChange: (value: string) => void;
  /** names to suggest while typing (the input still takes any text) */
  suggestions: string[];
};

/** A text field with our own suggestion list under it, instead of the browser's datalist. */
export function Suggest({ value, onChange, suggestions, className = "", onKeyDown, onBlur, onFocus, ...rest }: Props) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const shown = useMemo(() => {
    const q = value.trim().toLowerCase();
    const list = q ? suggestions.filter((s) => s.toLowerCase().includes(q) && s.toLowerCase() !== q) : suggestions;
    return list.slice(0, 8);
  }, [suggestions, value]);
  const visible = open && shown.length > 0;

  function pick(s: string) {
    onChange(s);
    setOpen(false);
    setActive(-1);
  }

  return (
    <div ref={root} className="relative">
      <input
        {...rest}
        ref={field}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={visible}
        aria-controls={visible ? listId : undefined}
        aria-activedescendant={visible && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        value={value}
        className={className}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={(e) => {
          setOpen(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setOpen(false);
          onBlur?.(e);
        }}
        onKeyDown={(e) => {
          if (visible && e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => (a + 1) % shown.length);
          } else if (visible && e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (a <= 0 ? shown.length - 1 : a - 1));
          } else if (visible && e.key === "Enter" && active >= 0) {
            e.preventDefault();
            pick(shown[active]);
          } else if (visible && e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }
          onKeyDown?.(e);
        }}
      />
      <Popup anchor={field} within={root} open={visible} onClose={() => setOpen(false)}>
        <ul id={listId} role="listbox" className="min-h-0 flex-1 overflow-y-auto">
          {shown.map((s, i) => (
            <li
              key={s}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onPointerDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex min-h-11 cursor-pointer items-center rounded-sm px-2.5 text-base text-ink desk:min-h-9 ${i === active ? "bg-accent-soft" : ""}`}
            >
              {s}
            </li>
          ))}
        </ul>
      </Popup>
    </div>
  );
}
