import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/lib/authz";
import { t, type MessageKey } from "@/lib/copy";
import { canOpenSettings } from "@/lib/shell";
import { PageHeader, PageSkeleton } from "../PageHeader";
import { Forbidden, isOwner, SECTIONS } from "./sections";

export default function Page() {
  return (
    <main className="w-full">
      <Suspense fallback={<PageSkeleton />}>
        <Menu />
      </Suspense>
    </main>
  );
}

type Card = { href: string; title: MessageKey; hint: MessageKey };

async function Menu() {
  const user = await requireUser();
  if (!canOpenSettings(user)) return <Forbidden title={t("pengaturan.title")} />;
  const owner = isOwner(user);

  const cards: Card[] = [
    ...SECTIONS.filter((s) => !s.ownerOnly || owner).map((s) => ({
      href: `/pengaturan/${s.slug}`,
      title: `pengaturan.nav.${s.navKey}` as MessageKey,
      hint: `pengaturan.menuHint.${s.navKey}` as MessageKey,
    })),
    // ads and WhatsApp keep their own routes, owner only as before
    ...(owner
      ? [
          { href: "/pengaturan/iklan", title: "iklan.title" as MessageKey, hint: "pengaturan.menuHint.iklan" as MessageKey },
          { href: "/pengaturan/whatsapp", title: "whatsapp.title" as MessageKey, hint: "pengaturan.menuHint.whatsapp" as MessageKey },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader title={t("pengaturan.title")} />
      <div className="px-4 py-5 md:px-6">
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((c) => (
            <li key={c.href}>
              <Link href={c.href} className="group block h-full rounded-lg bg-white p-5 shadow-card transition hover:bg-paper focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/15">
                <span className="block font-semibold text-ink group-hover:text-accent-strong">{t(c.title)}</span>
                <span className="mt-1 block text-sm text-slate">{t(c.hint)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
