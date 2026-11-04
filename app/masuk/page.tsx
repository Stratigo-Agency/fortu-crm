import Image from "next/image";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { auth, signIn } from "@/auth";
import { t } from "@/lib/copy";
import { safeNext } from "@/lib/publicPaths";

async function signInWithGoogle(formData: FormData) {
  "use server";
  await signIn("google", { redirectTo: safeNext(formData.get("next")?.toString()) });
}

async function SignInForm({ searchParams }: { searchParams: PageProps<"/masuk">["searchParams"] }) {
  const { error, next } = await searchParams;
  const nextPath = safeNext(typeof next === "string" ? next : undefined);
  if (await auth()) redirect(nextPath);

  return (
    <form action={signInWithGoogle} className="flex w-full flex-col gap-4">
      <input type="hidden" name="next" value={nextPath} />
      <button
        type="submit"
        className="h-12 w-full rounded-sm bg-navy px-4 text-base text-white"
      >
        {t("authz.signInWithGoogle")}
      </button>
      {error === "AccessDenied" && (
        <p role="alert" className="text-center text-slate">
          {t("authz.notInvited")}
        </p>
      )}
    </form>
  );
}

export default function MasukPage(props: PageProps<"/masuk">) {
  return (
    <main className="flex flex-1 items-center justify-center px-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-10">
        <Image
          src="/brand/fortu-logo-navy.png"
          alt="Fortu"
          width={136}
          height={40}
          priority
          className="h-10 w-auto"
        />
        <Suspense>
          <SignInForm searchParams={props.searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
