import { Suspense } from "react";
import { requireUser } from "@/lib/authz";
import { t } from "@/lib/copy";
import { getSalesFilter, salesOptions } from "@/lib/salesFilter";
import { canOpenSettings, newLeadCount } from "@/lib/shell";
import { HideOnPhone } from "./HideOnPhone";
import { SalesFilter } from "./SalesFilter";
import { type NavItem, Sidebar } from "./Sidebar";
import { UserChip } from "./UserChip";

async function Shell() {
  const user = await requireUser();
  const [prospek, options, selected] = await Promise.all([newLeadCount(user), salesOptions(), getSalesFilter()]);
  const items: NavItem[] = [
    { href: "/beranda", label: t("nav.beranda"), icon: "home", also: ["/cari"] },
    { href: "/pipeline", label: t("nav.pipeline"), icon: "pipeline", also: ["/deal"] },
    { href: "/prospek", label: t("nav.prospek"), icon: "prospek", badge: prospek },
    { href: "/kontak", label: t("nav.kontak"), icon: "kontak" },
    { href: "/perusahaan", label: t("nav.perusahaan"), icon: "perusahaan" },
    { href: "/laporan", label: t("nav.laporan"), icon: "laporan" },
  ];
  const bottomItems: NavItem[] = [
    ...(canOpenSettings(user) ? [{ href: "/pengaturan", label: t("nav.pengaturan"), icon: "pengaturan" as const, also: ["/pengaturan/iklan"] }] : []),
    // marketing sees the ads screen only (CLAUDE.md Roles)
    ...(user.role === "marketing" ? [{ href: "/pengaturan/iklan", label: t("nav.iklan"), icon: "iklan" as const }] : []),
  ];

  return (
    <Sidebar
      items={items}
      bottomItems={bottomItems}
      labels={{ search: t("nav.search"), add: t("nav.add"), menu: t("nav.menu"), close: t("common.close"), main: t("nav.main"), shortcut: t("nav.shortcut") }}
      footer={
        <div className="flex flex-col gap-2">
          <SalesFilter
            // remount when the choice changes elsewhere, so the select shows it
            key={selected ?? "all"}
            options={options}
            selected={selected}
            allLabel={t("nav.allReps")}
            label={t("nav.salesFilter")}
          />
          <UserChip fullName={user.full_name} role={t(`pengaturan.role.${user.role}`)} />
        </div>
      }
    />
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      {/* usePathname() in HideOnPhone needs a Suspense boundary on dynamic routes like /deal/[id] */}
      <Suspense fallback={<div className="h-14 border-b border-line md:h-dvh md:w-60 md:border-b-0 md:border-r md:bg-paper" />}>
        <HideOnPhone path="/tambah">
          <Suspense fallback={<div className="h-14 border-b border-line md:h-dvh md:w-60 md:border-b-0 md:border-r md:bg-paper" />}>
            <Shell />
          </Suspense>
        </HideOnPhone>
      </Suspense>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
