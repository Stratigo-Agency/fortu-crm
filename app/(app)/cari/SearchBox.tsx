import { Search } from "lucide-react";

/** The big search box (Sana's prompt box): a plain GET form to /cari, so it works without JavaScript. */
export function SearchBox({ placeholder, label, value, autoFocus }: { placeholder: string; label: string; value?: string; autoFocus?: boolean }) {
  return (
    <form action="/cari" role="search" className="relative">
      <Search size={18} strokeWidth={1.8} aria-hidden="true" className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-faint" />
      <input
        type="search"
        name="q"
        aria-label={label}
        defaultValue={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        autoComplete="off"
        className="h-14 w-full rounded-lg border border-line bg-white pl-13 pr-5 text-base text-ink shadow-card outline-none placeholder:text-faint focus:border-input md:h-13"
      />
    </form>
  );
}
