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

/** The Pengaturan page: everything for admin and ceo, only Target for a sales lead (lib/settings.ts). */
export function canOpenSettings(user: Pick<SessionUser, "role">): boolean {
  return user.role === "admin" || user.role === "ceo" || user.role === "sales_lead";
}

export { initials } from "@/lib/shellInitials";
