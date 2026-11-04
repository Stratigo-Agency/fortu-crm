import type { Role, SessionUser } from "@/lib/auth";
import { sql } from "@/lib/db";

/** Roles that see every lead in their counts; a sales_rep counts only their own. */
const SEES_ALL: Role[] = ["sales_lead", "ceo", "admin", "marketing"];

/** Prospek badge: new leads the user owns (reps) or all new leads (everyone else). */
export async function newLeadCount(user: Pick<SessionUser, "id" | "role">): Promise<number> {
  const all = SEES_ALL.includes(user.role);
  const [{ n }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM leads
     WHERE status = 'new' AND (${all} OR owner_user_id = ${user.id})`;
  return n;
}

/** Settings are for admin and ceo (T11 adds targets for sales_lead). */
export function canOpenSettings(user: Pick<SessionUser, "role">): boolean {
  return user.role === "admin" || user.role === "ceo";
}

const HONORIFICS = new Set(["pak", "bu", "ibu", "bapak"]);

/** Avatar initials: "Siska" → SI, "Rudi H" → RH, "Pak Jovian" → JO. */
export function initials(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  const named = words.length > 1 && HONORIFICS.has(words[0].toLowerCase()) ? words.slice(1) : words;
  if (named.length === 0) return "";
  const letters = named.length > 1 ? named[0][0] + named[1][0] : named[0].slice(0, 2);
  return letters.toUpperCase();
}
