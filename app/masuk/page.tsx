import { AuthError } from "next-auth";
import Image from "next/image";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { auth, signIn } from "@/auth";
import { t } from "@/lib/copy";
import { safeNext } from "@/lib/publicPaths";

async function signInWithPassword(formData: FormData) {
  "use server";
  const next = safeNext(formData.get("next")?.toString());
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: next,
    });
  } catch (err) {
    // A successful sign-in throws a redirect, which must pass through.
    if (!(err instanceof AuthError)) throw err;
    redirect(`/masuk?error=CredentialsSignin&next=${encodeURIComponent(next)}`);
  }
}

async function signInWithGoogle(formData: FormData) {
  "use server";
  await signIn("google", { redirectTo: safeNext(formData.get("next")?.toString()) });
}

const inputClass =
  "h-12 w-full rounded-sm border border-input bg-white px-3 text-base text-ink";

async function SignInForm({ searchParams }: { searchParams: PageProps<"/masuk">["searchParams"] }) {
  const { error, next } = await searchParams;
  const nextPath = safeNext(typeof next === "string" ? next : undefined);
  if (await auth()) redirect(nextPath);

  const message =
    error === "AccessDenied"
      ? t("authz.notInvited")
      : error === "CredentialsSignin"
        ? t("authz.wrongCredentials")
        : null;

  return (
    <div className="flex w-full flex-col gap-4">
      <form action={signInWithPassword} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={nextPath} />
        <label className="flex flex-col gap-1 text-slate">
          {t("authz.email")}
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-slate">
          {t("authz.password")}
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className={inputClass}
          />
        </label>
        <button type="submit" className="h-12 w-full rounded-sm bg-navy px-4 text-base text-white">
          {t("authz.signIn")}
        </button>
      </form>
      {process.env.AUTH_GOOGLE_ID && (
        <form action={signInWithGoogle}>
          <input type="hidden" name="next" value={nextPath} />
          <button
            type="submit"
            className="h-12 w-full rounded-sm border border-input bg-white px-4 text-base text-ink"
          >
            {t("authz.signInWithGoogle")}
          </button>
        </form>
      )}
      {message && (
        <p role="alert" className="text-center text-slate">
          {message}
        </p>
      )}
    </div>
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
