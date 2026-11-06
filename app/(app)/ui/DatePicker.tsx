"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import {
  addDays, addMonths, clampDay, dayLong, dayShort, endOfWeek, inRange, isDay, jakartaToday, monthGrid, monthStart,
  monthTitle, startOfWeek, weekdayNames,
} from "@/lib/calendar";
import { t } from "@/lib/copy";
import { Popup } from "./Popup";

type Props = {
  /** controlled value, "YYYY-MM-DD" or ""; leave out and use defaultValue for a plain form field */
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
  /** earliest and latest day that can be picked, "YYYY-MM-DD" */
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  className?: string;
};

const WEEKDAYS = weekdayNames();

/**
 * Our own date field instead of the browser's: a button that opens a month calendar (Senin first,
 * Bahasa names, today in Jakarta). Keyboard: arrows move a day or a week, Page Up/Down a month
 * (with Shift a year), Home/End the start or end of the week, Enter or Space picks, Esc closes.
 */
export function DatePicker({
  value, defaultValue, onChange, name, id, label, placeholder, min, max, disabled, required, invalid, className = "",
}: Props) {
  const autoId = useId();
  const titleId = `${autoId}-title`;
  const calId = `${autoId}-calendar`;
  const [inner, setInner] = useState(defaultValue ?? "");
  const current = isDay(value ?? inner) ? (value ?? inner) : "";
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState("");
  const [today, setToday] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  // the grid mounts a frame after `open` (the popup places itself first), so it is state, not a ref
  const [grid, setGrid] = useState<HTMLTableElement | null>(null);

  function openCalendar() {
    if (disabled) return;
    const now = jakartaToday();
    setToday(now);
    setActive(clampDay(current || now, min, max));
    setOpen(true);
  }

  function close(refocus = true) {
    setOpen(false);
    if (refocus) button.current?.focus();
  }

  function choose(day: string) {
    if (!inRange(day, min, max)) return;
    if (value === undefined) setInner(day);
    close();
    if (day !== current) onChange?.(day);
  }

  function clear() {
    if (value === undefined) setInner("");
    close();
    if (current) onChange?.("");
  }

  // the active day takes the focus, so a screen reader reads it and the arrows keep working
  useEffect(() => {
    if (grid && active) grid.querySelector<HTMLElement>(`[data-day="${active}"]`)?.focus();
  }, [grid, active]);

  function onTriggerKey(e: React.KeyboardEvent) {
    if (!open && ["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      openCalendar();
    }
  }

  function onPanelKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation(); // don't also close the panel around us
      close();
      return;
    }
    if (e.key === "Tab") return;
    const inGrid = grid?.contains(e.target as Node);
    if (!inGrid) return;
    const moves: Record<string, () => string> = {
      ArrowLeft: () => addDays(active, -1),
      ArrowRight: () => addDays(active, 1),
      ArrowUp: () => addDays(active, -7),
      ArrowDown: () => addDays(active, 7),
      Home: () => startOfWeek(active),
      End: () => endOfWeek(active),
      PageUp: () => addMonths(active, e.shiftKey ? -12 : -1),
      PageDown: () => addMonths(active, e.shiftKey ? 12 : 1),
    };
    if (moves[e.key]) {
      e.preventDefault();
      setActive(clampDay(moves[e.key](), min, max));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(active);
    }
  }

  // moving the focus out of the calendar (Tab past its last button) closes it
  function onPanelBlur(e: React.FocusEvent) {
    const to = e.relatedTarget as Node | null;
    if (to && !e.currentTarget.contains(to) && !root.current?.contains(to)) close(false);
  }

  const view = active ? monthStart(active) : "";
  // the calendar's month exists only while it is open
  const canPrev = view !== "" && (!min || addMonths(view, -1) >= monthStart(min));
  const canNext = view !== "" && (!max || addMonths(view, 1) <= max);
  const step = (n: number) => setActive(clampDay(addMonths(active, n), min, max));
  const todayOk = today !== "" && inRange(today, min, max);

  const nav = "flex size-11 items-center justify-center rounded-full text-ink hover:bg-paper disabled:text-faint disabled:hover:bg-transparent desk:size-9";
  const foot = "h-11 rounded-full border border-line bg-white px-4 text-base font-medium text-ink hover:bg-paper disabled:text-faint desk:h-9";

  return (
    <div ref={root} className={`relative w-full min-w-0 ${className}`}>
      {name !== undefined &&
        (required ? (
          // a real (invisible) field, so the browser blocks an empty submit and says so next to the control
          <input
            name={name}
            value={current}
            required
            disabled={disabled}
            tabIndex={-1}
            aria-hidden="true"
            onChange={() => {}}
            onFocus={() => button.current?.focus()}
            className="pointer-events-none absolute inset-x-0 bottom-0 h-px w-full opacity-0"
          />
        ) : (
          <input type="hidden" name={name} value={current} disabled={disabled} />
        ))}
      <button
        ref={button}
        id={id}
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? calId : undefined}
        aria-invalid={invalid || undefined}
        aria-required={required || undefined}
        data-value={current}
        disabled={disabled}
        onClick={() => (open ? close() : openCalendar())}
        onKeyDown={onTriggerKey}
        className={`flex h-12 w-full items-center gap-2 rounded-sm border bg-white pl-3 pr-2.5 text-left text-base text-ink transition focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15 disabled:cursor-not-allowed disabled:bg-paper disabled:text-slate desk:h-10 ${
          invalid ? "border-2 border-navy" : "border-input"
        }`}
      >
        <span className={`tabular min-w-0 flex-1 ${current ? "" : "text-slate"}`}>
          {current ? dayShort(current) : (placeholder ?? t("datePicker.placeholder"))}
        </span>
        <CalendarDays size={16} strokeWidth={1.8} aria-hidden="true" className="shrink-0 text-faint" />
      </button>
      <Popup anchor={button} within={root} open={open && active !== ""} onClose={() => close(false)} width={332} room={400}>
        <div
          id={calId}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          onKeyDown={onPanelKey}
          onBlur={onPanelBlur}
          className="min-h-0 overflow-y-auto overscroll-contain p-1"
        >
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={() => step(-1)} disabled={!canPrev} aria-label={t("datePicker.prevMonth")} className={nav}>
              <ChevronLeft size={18} strokeWidth={1.8} aria-hidden="true" />
            </button>
            <p id={titleId} aria-live="polite" className="font-semibold text-ink first-letter:uppercase">
              {view && monthTitle(view)}
            </p>
            <button type="button" onClick={() => step(1)} disabled={!canNext} aria-label={t("datePicker.nextMonth")} className={nav}>
              <ChevronRight size={18} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
          <table ref={setGrid} role="grid" aria-labelledby={titleId} data-month={view.slice(0, 7)} className="mt-1 w-full border-collapse">
            <thead>
              <tr>
                {WEEKDAYS.map((d) => (
                  <th key={d} scope="col" className="h-8 text-center text-sm font-normal text-faint">
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view &&
                monthGrid(view).map((week) => (
                  <tr key={week[0]}>
                    {week.map((day) => {
                      const outside = day.slice(0, 7) !== view.slice(0, 7);
                      const selected = day === current;
                      const ok = inRange(day, min, max);
                      return (
                        <td key={day} role="gridcell" aria-selected={selected} className="p-0 text-center">
                          <button
                            type="button"
                            data-day={day}
                            tabIndex={day === active ? 0 : -1}
                            disabled={!ok}
                            aria-label={dayLong(day)}
                            aria-current={day === today ? "date" : undefined}
                            onClick={() => choose(day)}
                            className={`tabular mx-auto flex size-11 items-center justify-center rounded-full text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-accent desk:size-9 ${
                              selected
                                ? "bg-accent font-semibold text-white"
                                : !ok
                                  ? "cursor-not-allowed text-faint/50"
                                  : day === today
                                    ? "font-semibold text-accent-strong ring-1 ring-inset ring-accent hover:bg-accent-soft"
                                    : outside
                                      ? "text-faint hover:bg-paper"
                                      : "text-ink hover:bg-paper"
                            } ${day === active && !selected ? "bg-paper" : ""}`}
                          >
                            {Number(day.slice(8))}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
            </tbody>
          </table>
          <div className="mt-1 flex items-center justify-between gap-2 border-t border-line pt-2">
            <button type="button" onClick={() => choose(today)} disabled={!todayOk} className={foot}>
              {t("datePicker.today")}
            </button>
            {!required && current && (
              <button type="button" onClick={clear} className={foot}>
                {t("datePicker.clear")}
              </button>
            )}
          </div>
        </div>
      </Popup>
    </div>
  );
}
