import type { Profile } from "next-auth";
import type { JWT } from "next-auth/jwt";
import postgres from "postgres";
import { sql } from "@/lib/db";

export type Role = "admin" | "ceo" | "sales_lead" | "sales_rep" | "marketing";

/** Who is signed in, as every request sees it (session.user). */
export type SessionUser = { id: string; email: string; role: Role; full_name: string };

/** Role and name are re-read at most this often, so changes apply without re-login. */
export const ROLE_RECHECK_MS = 5 * 60 * 1000;

/**
 * Sign-in gate (docs/INTEGRATIONS.md · Sign-in). Lets a Google account in only
 * when its email is verified and matches one active users row. The first
 * sign-in binds the Google sub; a different sub for the same email is refused.
 * Never checks `hd`: the team's Hostinger addresses don't carry it.
 */
export async function signInGate(profile: Profile | undefined): Promise<boolean> {
  if (!profile?.email || !profile.sub || profile.email_verified !== true) return false;
  try {
    const rows = await sql`
      UPDATE users
         SET google_sub = COALESCE(google_sub, ${profile.sub}), last_login_at = now()
       WHERE lower(email) = lower(${profile.email})
         AND is_active
         AND (google_sub IS NULL OR google_sub = ${profile.sub})
      RETURNING id`;
    return rows.length === 1;
  } catch (err) {
    // This Google account is already bound to another user row.
    if (err instanceof postgres.PostgresError && err.code === "23505") return false;
    throw err;
  }
}

/** The active user behind a Google sub or a user id, or null. */
export async function loadSessionUser(
  by: { sub: string } | { id: string },
): Promise<SessionUser | null> {
  const rows =
    "sub" in by
      ? await sql<SessionUser[]>`
          SELECT id, email, role, full_name FROM users WHERE google_sub = ${by.sub} AND is_active`
      : await sql<SessionUser[]>`
          SELECT id, email, role, full_name FROM users WHERE id = ${by.id} AND is_active`;
  return rows[0] ?? null;
}

/**
 * Auth.js jwt callback. On sign-in it loads the user by Google sub; later it
 * re-reads the row once ROLE_RECHECK_MS has passed. Returns null (signs the
 * person out) when the user is gone or no longer active.
 */
export async function refreshToken(
  token: JWT,
  profile?: Profile,
  now = Date.now(),
): Promise<JWT | null> {
  let user: SessionUser | null;
  if (profile?.sub) {
    user = await loadSessionUser({ sub: profile.sub });
  } else if (!token.id) {
    return null;
  } else if (now - (token.roleCheckedAt ?? 0) < ROLE_RECHECK_MS) {
    return token;
  } else {
    user = await loadSessionUser({ id: token.id });
  }
  if (!user) return null;
  return {
    ...token,
    id: user.id,
    email: user.email,
    role: user.role,
    full_name: user.full_name,
    roleCheckedAt: now,
  };
}
