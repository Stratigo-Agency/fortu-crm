import Image from "next/image";
import Link from "next/link";
import { t } from "@/lib/copy";
import { QuickAddForm } from "./QuickAddForm";

// Tambah cepat: a rep logs a WhatsApp chat from the phone. On phones the page is full screen
// with its own navy header; the app top bar is hidden there (see HideOnPhone in the layout).
export default function TambahPage() {
  return (
    <>
      <header className="flex h-18 items-center justify-between bg-navy px-4 md:hidden">
        <Image src="/brand/fortu-logo-white.png" alt="Fortu" width={104} height={31} priority />
        <Link
          href="/prospek"
          aria-label={t("common.close")}
          className="flex h-11 w-11 items-center justify-center rounded-sm bg-white/10 text-white"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <path d="M3 3l12 12M15 3L3 15" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        </Link>
      </header>
      <main className="mx-auto w-full max-w-md px-4 pb-10 pt-6 md:px-0 md:pt-8">
        <h1 className="text-3xl font-bold text-navy">{t("quickAdd.title")}</h1>
        <QuickAddForm />
      </main>
    </>
  );
}
