import { ArrowRight } from "lucide-react";
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
  "h-12 w-full rounded-[10px] border border-input bg-white px-3.5 text-base text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15 desk:h-10 desk:text-sm";

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
  const hasGoogle = Boolean(process.env.AUTH_GOOGLE_ID);

  return (
    <div className="flex w-full flex-col gap-5">
      {message && (
        <p role="alert" className="text-sm font-medium text-ink">
          {message}
        </p>
      )}
      {hasGoogle && (
        <>
          <form action={signInWithGoogle}>
            <input type="hidden" name="next" value={nextPath} />
            <button
              type="submit"
              className="flex h-12 w-full items-center justify-center gap-2.5 rounded-[10px] bg-accent px-4 text-base font-medium text-white hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/30 desk:h-10 desk:text-sm"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0 fill-current">
                <path d="M21.35 11.1H12v2.98h5.35c-.23 1.4-1.6 4.1-5.35 4.1a5.9 5.9 0 0 1 0-11.8c1.9 0 3.17.8 3.9 1.5l2.13-2.05A8.8 8.8 0 0 0 12 3.2a8.9 8.9 0 1 0 0 17.8c5.14 0 8.55-3.6 8.55-8.7 0-.6-.06-1.05-.2-1.2Z" />
              </svg>
              {t("authz.signInWithGoogle")}
            </button>
          </form>
          <div className="flex items-center gap-3 text-xs font-medium tracking-wide text-faint" >
            <span aria-hidden="true" className="h-px flex-1 bg-line" />
            <span className="uppercase">{t("authz.or")}</span>
            <span aria-hidden="true" className="h-px flex-1 bg-line" />
          </div>
        </>
      )}
      <form action={signInWithPassword} className="flex flex-col gap-3">
        <input type="hidden" name="next" value={nextPath} />
        <p className="text-sm font-medium text-slate">{t("authz.signInWithEmail")}</p>
        <label className="flex flex-col gap-1.5">
          <span className="sr-only">{t("authz.email")}</span>
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            placeholder={t("authz.emailPlaceholder")}
            className={inputClass}
          />
        </label>
        <div className="flex items-center gap-2">
          <label className="flex-1">
            <span className="sr-only">{t("authz.password")}</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              placeholder={t("authz.passwordPlaceholder")}
              className={inputClass}
            />
          </label>
          <button
            type="submit"
            aria-label={t("authz.signIn")}
            title={t("authz.signIn")}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent text-white hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/30 desk:h-10 desk:w-10"
          >
            <ArrowRight aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
      </form>
    </div>
  );
}

export default function MasukPage(props: PageProps<"/masuk">) {
  return (
    <main className="flex min-h-dvh flex-1 flex-col items-center justify-center gap-8 bg-white px-4 py-8 md:px-8">
      <Image src="/brand/fortu-logo-navy.png" alt="Fortu" width={136} height={40} priority className="h-8 w-auto" />
      <div className="grid w-full max-w-[1040px] overflow-hidden rounded-[18px] bg-white shadow-card md:min-h-[560px] md:grid-cols-2">
        <div className="flex flex-col justify-between gap-10 p-6 sm:p-10 md:p-12">
          <div className="flex flex-col gap-6">
            <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{t("authz.welcomeTitle")}</h1>
            <Suspense>
              <SignInForm searchParams={props.searchParams} />
            </Suspense>
          </div>
          <p className="text-xs leading-relaxed text-faint">{t("authz.legal")}</p>
        </div>
        <div
          aria-hidden="true"
          className="hidden items-center justify-center border-l border-line bg-gradient-to-b from-sky-soft to-paper p-12 md:flex"
        >
          <div className="flex max-w-sm flex-col gap-6 text-center">
            <p className="text-3xl font-semibold leading-snug tracking-tight text-ink">{t("authz.tagline")}</p>
            <p className="text-sm text-slate">{t("authz.taglineNote")}</p>
          </div>
        </div>
      </div>
    </main>
  );
}
