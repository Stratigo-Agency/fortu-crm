"use client";

import { useId, useMemo, useState } from "react";

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
    <div className="relative">
      <input
        {...rest}
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
      {visible && (
        <ul id={listId} role="listbox" className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-64 animate-pop overflow-y-auto rounded-md bg-white p-1 shadow-pop">
          {shown.map((s, i) => (
            <li
              key={s}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
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
      )}
    </div>
  );
}
