import { LogOut } from "lucide-react";
import { t } from "@/lib/copy";
import { initials } from "@/lib/shell";
import { signOutAction } from "./actions";

export function UserChip({ fullName, role }: { fullName: string; role: string }) {
  return (
    <details className="group relative">
      <summary className="flex h-11 cursor-pointer list-none items-center gap-2.5 rounded-sm px-2 hover:bg-black/[0.04] desk:h-10 [&::-webkit-details-marker]:hidden">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-white">
          {initials(fullName)}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-base font-semibold text-ink">{fullName}</span>
          <span className="block truncate text-sm text-faint">{role}</span>
        </span>
      </summary>
      <form action={signOutAction} className="absolute bottom-full left-0 right-0 z-10 mb-2 rounded-md bg-white p-1 shadow-pop">
        <button type="submit" className="flex h-11 w-full items-center gap-2 rounded-sm px-3 text-left text-ink hover:bg-paper desk:h-9">
          <LogOut size={15} strokeWidth={1.8} aria-hidden="true" className="text-faint" />
          {t("nav.signOut")}
        </button>
      </form>
    </details>
  );
}
