import { Building2, KanbanSquare, User } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/lib/authz";
import { t } from "@/lib/copy";
import { searchAll, type SearchHit } from "@/lib/globalSearch";
import { kontakHref } from "@/lib/kontakHref";
import { perusahaanHref } from "@/lib/perusahaanHref";
import { SearchBox } from "./SearchBox";

type Props = { searchParams: Promise<{ q?: string | string[] }> };

export default function Page({ searchParams }: Props) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-8 md:pt-16">
      <Suspense>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

function Group({ title, hits, href, Icon }: { title: string; hits: SearchHit[]; href: (h: SearchHit) => string; Icon: typeof User }) {
  if (hits.length === 0) return null;
  return (
    <section aria-label={title} className="mt-6">
      <h2 className="px-3 text-sm font-medium text-faint">{title}</h2>
      <ul className="mt-1">
        {hits.map((h) => (
          <li key={h.id}>
            <Link href={href(h)} className="flex min-h-11 items-center gap-3 rounded-sm px-3 py-2 hover:bg-paper">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-paper text-slate">
                <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink">{h.title}</span>
                {h.detail && <span className="block truncate text-sm text-slate">{h.detail}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

async function Content({ searchParams }: Props) {
  await requireUser();
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  const r = await searchAll(q);
  const none = r.deals.length + r.contacts.length + r.companies.length === 0;
  return (
    <>
      <h1 className="sr-only">{t("cari.title")}</h1>
      <SearchBox value={q} autoFocus placeholder={t("beranda.searchPlaceholder")} label={t("cari.title")} />
      {q.length > 0 && q.length < 2 && <p className="mt-6 px-3 text-slate">{t("cari.tooShort")}</p>}
      {q.length >= 2 && none && <p className="mt-6 px-3 text-slate">{t("cari.none")}</p>}
      <Group title={t("cari.deals")} hits={r.deals} href={(h) => `/deal/${h.id}`} Icon={KanbanSquare} />
      <Group title={t("cari.contacts")} hits={r.contacts} href={(h) => kontakHref({ contact: h.id })} Icon={User} />
      <Group title={t("cari.companies")} hits={r.companies} href={(h) => perusahaanHref({ company: h.id })} Icon={Building2} />
    </>
  );
}
