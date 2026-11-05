import { AuthError } from "next-auth";
import Image from "next/image";
import { redirect } from "next/navigation";
import { connection } from "next/server";
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
    // A successful sign-in throws a redirect, and a database error is not a wrong password: both pass through.
    if (!(err instanceof AuthError) || err.type !== "CredentialsSignin") throw err;
    redirect(`/masuk?error=CredentialsSignin&next=${encodeURIComponent(next)}`);
  }
}

async function signInWithGoogle(formData: FormData) {
  "use server";
  await signIn("google", { redirectTo: safeNext(formData.get("next")?.toString()) });
}

const inputClass =
  "h-12 w-full rounded-sm border border-input bg-white px-3.5 text-base text-ink focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15";

async function SignInForm({ searchParams }: { searchParams: PageProps<"/masuk">["searchParams"] }) {
  await connection(); // the form reads the session and the URL: render it per request, never at build
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
        <label className="flex flex-col gap-1.5 text-sm font-medium text-slate">
          {t("authz.email")}
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-slate">
          {t("authz.password")}
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className={inputClass}
          />
        </label>
        <button type="submit" className="mt-1 h-12 w-full rounded-full bg-ink px-4 text-base font-semibold text-white hover:bg-ink/85">
          {t("authz.signIn")}
        </button>
      </form>
      {process.env.AUTH_GOOGLE_ID && (
        <form action={signInWithGoogle}>
          <input type="hidden" name="next" value={nextPath} />
          <button
            type="submit"
            className="h-12 w-full rounded-full border border-line bg-white px-4 text-base text-ink hover:bg-paper"
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
    <main className="flex flex-1 items-center justify-center bg-paper px-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-8 rounded-lg bg-white px-6 py-10 shadow-pop md:px-8">
        <Image
          src="/brand/fortu-logo-navy.png"
          alt="Fortu"
          width={136}
          height={40}
          priority
          className="h-8 w-auto"
        />
        <Suspense>
          <SignInForm searchParams={props.searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
