import { t } from "@/lib/copy";
import { initials } from "@/lib/shell";
import { signOutAction } from "./actions";

export function UserChip({ fullName }: { fullName: string }) {
  return (
    <details className="relative">
      <summary className="flex h-11 cursor-pointer list-none items-center gap-2 rounded-sm px-1 [&::-webkit-details-marker]:hidden">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-mist text-xs font-bold text-navy">
          {initials(fullName)}
        </span>
        <span className="hidden text-base text-white md:inline">{fullName}</span>
      </summary>
      <form
        action={signOutAction}
        className="absolute right-0 z-10 mt-2 min-w-40 rounded-md bg-white p-1 shadow-card"
      >
        <button type="submit" className="h-11 w-full rounded-sm px-3 text-left text-ink hover:bg-paper">
          {t("nav.signOut")}
        </button>
      </form>
    </details>
  );
}
