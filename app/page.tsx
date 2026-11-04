import Image from "next/image";
import { connection } from "next/server";
import { Suspense } from "react";
import { t } from "@/lib/copy";
import { sql } from "@/lib/db";

// Temporary home page (T01): proves the app reaches the database.
// Replaced by the Pipeline in T07.

async function productCount(): Promise<number | null> {
  try {
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from products`;
    return n;
  } catch {
    return null;
  }
}

async function DbStatus() {
  await connection(); // read at request time, never at build
  const n = await productCount();
  return (
    <p>
      {n === null ? t("home.dbOffline") : t("home.dbConnected", { n: n.toLocaleString("id-ID") })}
    </p>
  );
}

export default function Home() {
  return (
    <>
      <header className="flex h-14 items-center gap-3 bg-navy px-4 text-white">
        <Image
          src="/brand/fortu-logo-white.png"
          alt="Fortu"
          width={82}
          height={24}
          priority
          className="h-6 w-auto"
        />
        <span className="text-lg font-bold">{t("home.appName")}</span>
      </header>
      <main className="flex-1 p-4">
        <Suspense>
          <DbStatus />
        </Suspense>
      </main>
    </>
  );
}
