import type { Profile } from "next-auth";
import postgres from "postgres";
import { sql } from "@/lib/db";

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
