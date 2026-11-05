import { X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { t } from "@/lib/copy";
import { QuickAddForm } from "./QuickAddForm";

// Tambah cepat: a rep logs a WhatsApp chat from the phone. On phones the page is full screen
// with its own slim header; the app bar is hidden there (see HideOnPhone in the layout).
export default function TambahPage() {
  return (
    <>
      <header className="flex h-14 items-center justify-between border-b border-line bg-white px-4 md:hidden">
        <Image src="/brand/fortu-logo-navy.png" alt="Fortu" width={76} height={23} priority />
        <Link
          href="/beranda"
          aria-label={t("common.close")}
          className="flex h-11 w-11 items-center justify-center rounded-full text-ink"
        >
          <X size={22} strokeWidth={1.8} aria-hidden="true" />
        </Link>
      </header>
      <main className="mx-auto w-full max-w-md px-4 pb-10 pt-6 md:px-0 md:pt-14">
        <h1 className="text-2xl font-semibold text-ink">{t("quickAdd.title")}</h1>
        <QuickAddForm />
      </main>
    </>
  );
}
