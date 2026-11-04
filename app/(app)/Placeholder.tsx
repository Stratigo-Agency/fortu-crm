import { t } from "@/lib/copy";

/** Temporary page body until the screen is built (T05–T11). */
export function Placeholder({ title }: { title: string }) {
  return (
    <main className="mx-auto w-full max-w-screen-2xl px-4 py-8 md:px-8">
      <h1 className="text-3xl font-bold text-ink">{title}</h1>
      <p className="mt-6 rounded-lg bg-white p-6 text-slate shadow-card">{t("common.placeholder")}</p>
    </main>
  );
}
