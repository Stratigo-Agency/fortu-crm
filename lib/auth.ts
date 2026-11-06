import type { Profile } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { pgError, sql } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password.mjs";
import { clientIp, createRateLimiter, type RateLimiter } from "@/lib/webform/rateLimit";

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
    if (pgError(err)?.code === "23505") return false;
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
  signedInUserId?: string,
): Promise<JWT | null> {
  let user: SessionUser | null;
  if (profile?.sub) {
    user = await loadSessionUser({ sub: profile.sub });
  } else if (signedInUserId) {
    user = await loadSessionUser({ id: signedInUserId });
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

// Hash checked when the email is unknown, so a wrong email and a wrong password take the same time.
// Computed on first use: random bytes at import time break prerendering.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword("tidak-ada-user"));

// Wrong-password limits, in memory like the other limiters (lib/webform/rateLimit.ts). Only misses count, so
// signing in right never uses them up (a slot is reserved before the password is checked, and given back on success).
//  - 10 misses per email AND address in 15 minutes: that pair is locked, even for the right password. Someone
//    guessing from their own address can't lock a colleague out, because the colleague comes from another address.
//  - 30 misses per address, across all emails.
//  - per email alone the counter only slows: from 10 misses every try waits a moment, and only 50 misses in
//    15 minutes (guessing spread over many addresses) refuse the email outright.
//  - when the address is unknown (no proxy header) there is no pair: 20 misses per email, nothing shared.
const MISS_WINDOW_MS = 15 * 60_000;
export const missesPerEmailIp = createRateLimiter(10, MISS_WINDOW_MS);
export const missesPerEmail = createRateLimiter(50, MISS_WINDOW_MS);
export const missesPerEmailNoIp = createRateLimiter(20, MISS_WINDOW_MS);
export const missesPerIp = createRateLimiter(30, MISS_WINDOW_MS);
const SLOW_AFTER_EMAIL_MISSES = 10;
export const SLOW_DELAY_MS = 800;

/**
 * Email + password sign-in. Returns the user id, or null for an unknown email,
 * an inactive user, a user with no password, a wrong password, or too many misses in a row.
 * `headers` are the request's, to tell visitors apart by address.
 */
export async function authorizeCredentials(
  email: unknown,
  password: unknown,
  headers?: Pick<Headers, "get">,
): Promise<{ id: string } | null> {
  if (typeof email !== "string" || typeof password !== "string" || !email || !password) return null;
  const emailKey = email.trim().toLowerCase().slice(0, 200);
  const ip = headers ? clientIp(headers) : "unknown";
  const known = ip !== "unknown";
  const slow = missesPerEmail.count(emailKey) >= SLOW_AFTER_EMAIL_MISSES;

  // Reserve a slot in each limiter before the (slow) password check, so parallel tries can't all pass the gate.
  const limiters: [RateLimiter, string][] = known
    ? [[missesPerEmailIp, `${emailKey}|${ip}`], [missesPerEmail, emailKey], [missesPerIp, ip]]
    : [[missesPerEmailNoIp, emailKey], [missesPerEmail, emailKey]];
  const reserved: [RateLimiter, string][] = [];
  for (const [limiter, key] of limiters) {
    if (!limiter.hit(key)) {
      for (const [l, k] of reserved) l.release(k);
      return null;
    }
    reserved.push([limiter, key]);
  }

  if (slow) await new Promise((resolve) => setTimeout(resolve, SLOW_DELAY_MS));
  let user: { id: string } | null;
  try {
    user = await checkPassword(email, password);
  } catch (err) {
    for (const [l, k] of reserved) l.release(k); // a database error is not a wrong password
    throw err;
  }
  if (!user) return null; // the reserved slots stay: this was a miss
  for (const [l, k] of reserved) l.release(k);
  await sql`UPDATE users SET last_login_at = now() WHERE id = ${user.id}`;
  return { id: user.id };
}

async function checkPassword(email: string, password: string): Promise<{ id: string } | null> {
  const [user] = await sql<{ id: string; password_hash: string | null }[]>`
    SELECT id, password_hash FROM users WHERE lower(email) = lower(${email.trim()}) AND is_active`;
  const ok = await verifyPassword(password, user?.password_hash ?? (await getDummyHash()));
  return user && user.password_hash && ok ? { id: user.id } : null;
}
