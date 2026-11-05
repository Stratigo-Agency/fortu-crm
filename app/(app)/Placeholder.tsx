import { t } from "@/lib/copy";
import { PageHeader } from "./PageHeader";

/** Temporary page body until the screen is built. */
export function Placeholder({ title }: { title: string }) {
  return (
    <main className="w-full">
      <PageHeader title={title} />
      <p className="px-4 py-10 text-slate md:px-6">{t("common.placeholder")}</p>
    </main>
  );
}
