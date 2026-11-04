import { Suspense } from "react";
import { requireUser } from "@/lib/authz";
import { t } from "@/lib/copy";
import { canOpenSettings } from "@/lib/shell";
import { Placeholder } from "../Placeholder";

async function Settings() {
  const user = await requireUser();
  if (!canOpenSettings(user)) {
    return (
      <main className="mx-auto w-full max-w-screen-2xl px-4 py-8 md:px-8">
        <h1 className="text-3xl font-bold text-ink">{t("pengaturan.title")}</h1>
        <p role="alert" className="mt-6 rounded-lg bg-white p-6 text-slate shadow-card">
          {t("authz.settingsOnly")}
        </p>
      </main>
    );
  }
  return <Placeholder title={t("pengaturan.title")} />;
}

export default function Page() {
  return (
    <Suspense>
      <Settings />
    </Suspense>
  );
}
