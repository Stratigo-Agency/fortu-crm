import { t } from "@/lib/copy";
import type { Role } from "@/lib/auth";
import { canOpenSettings } from "@/lib/shell";
import { PageHeader } from "../PageHeader";

/** Each Pengaturan section has its own route (/pengaturan/<slug>). Target is open to sales lead; the rest is owner only. */
export const SECTIONS = [
  { slug: "target", navKey: "target", ownerOnly: false },
  { slug: "aturan", navKey: "aturan", ownerOnly: true },
  { slug: "peluang", navKey: "peluang", ownerOnly: true },
  { slug: "tahap", navKey: "definisi", ownerOnly: true },
  { slug: "tim", navKey: "tim", ownerOnly: true },
  { slug: "katalog", navKey: "katalog", ownerOnly: true },
  { slug: "data", navKey: "data", ownerOnly: true },
] as const;

export function isOwner(user: { role: Role }): boolean {
  return user.role === "admin" || user.role === "ceo";
}

/** The sub-navigation for this user: only the sections they may open. */
export function sectionNav(user: { role: Role }): { href: string; label: string }[] {
  if (!canOpenSettings(user)) return [];
  return SECTIONS.filter((s) => !s.ownerOnly || isOwner(user)).map((s) => ({
    href: `/pengaturan/${s.slug}`,
    label: t(`pengaturan.nav.${s.navKey}`),
  }));
}

/** The message a page shows instead of its form when the user may not open it. */
export function Forbidden({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <p role="alert" className="px-4 py-10 text-slate md:px-6">{t("authz.settingsOnly")}</p>
    </>
  );
}
