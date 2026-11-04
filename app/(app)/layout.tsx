import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/lib/authz";
import { t } from "@/lib/copy";
import { canOpenSettings, newLeadCount } from "@/lib/shell";
import { type NavItem, TopNav } from "./TopNav";
import { UserChip } from "./UserChip";

async function TopBar() {
  const user = await requireUser();
  const prospek = await newLeadCount(user);
  const items: NavItem[] = [
    { href: "/pipeline", label: t("nav.pipeline"), also: ["/deal"] },
    { href: "/prospek", label: t("nav.prospek"), badge: prospek },
    { href: "/kontak", label: t("nav.kontak") },
    { href: "/perusahaan", label: t("nav.perusahaan") },
    { href: "/laporan", label: t("nav.laporan") },
    ...(canOpenSettings(user) ? [{ href: "/pengaturan", label: t("nav.pengaturan") }] : []),
  ];

  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-2 bg-navy px-4 py-2 md:min-h-16 md:flex-nowrap md:px-8 md:py-0">
      <Link href="/pipeline" className="flex h-11 shrink-0 items-center gap-3">
        <Image src="/brand/fortu-logo-white.png" alt="Fortu" width={104} height={31} priority />
        <span className="border-l border-white/30 pl-3 text-sm tracking-widest text-mist">
          {t("common.appName")}
        </span>
      </Link>
      <TopNav items={items} />
      <div className="ml-auto flex items-center gap-3" id="topbar-right">
        <UserChip fullName={user.full_name} />
      </div>
    </header>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={<div className="h-16 bg-navy" />}>
        <TopBar />
      </Suspense>
      <div className="flex-1">{children}</div>
    </>
  );
}
