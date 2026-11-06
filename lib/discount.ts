import type { SessionUser } from "@/lib/auth";
import { ForbiddenError } from "@/lib/authz";
import { sql } from "@/lib/db";
import { linesFingerprint } from "@/lib/linesFingerprint";

// Approving a discount (CLAUDE.md rule 10): only the CEO or an admin. The approval covers the prices on the
// deal at that moment; saveDeal clears it as soon as a product, quantity or price changes.

type Actor = Pick<SessionUser, "id" | "role">;

const APPROVERS = ["ceo", "admin"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Approval = "approved" | "nothing" | "changed";

/**
 * Marks the deal's discount as approved by the actor, for the product lines the actor saw (`seenFingerprint`).
 * "changed": the lines were saved again since then, nothing was approved. "nothing": the deal is within the
 * limit, already approved, or gone. Throws ForbiddenError for anyone who is not an active CEO or admin.
 */
export async function approveDiscount(actor: Actor, dealId: string, seenFingerprint: string): Promise<Approval> {
  if (!APPROVERS.includes(actor.role) || !UUID.test(dealId)) throw new ForbiddenError();
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('app.user_id', ${actor.id}, true)`; // rule 11
    // The role is checked again in the statement, against the database, not only the session.
    const rows = await tx`
      UPDATE deals d SET discount_approved_by = ${actor.id}, discount_approved_at = now()
       WHERE d.id = ${dealId}
         AND EXISTS (SELECT 1 FROM users u WHERE u.id = ${actor.id} AND u.is_active AND u.role = ANY(${APPROVERS}))
         AND can_edit_deal(${actor.id}, d.id)
         AND (SELECT e.needs_discount_approval FROM v_deals_enriched e WHERE e.id = d.id)
         AND ${linesFingerprint("d.id")} = ${seenFingerprint}
       RETURNING d.id`;
    if (rows.length > 0) return "approved";
    const [active] = await tx`SELECT 1 FROM users WHERE id = ${actor.id} AND is_active AND role = ANY(${APPROVERS})`;
    if (!active) throw new ForbiddenError();
    const [now] = await tx<{ fp: string }[]>`SELECT ${linesFingerprint("d.id")} AS fp FROM deals d WHERE d.id = ${dealId}`;
    return now && now.fp !== seenFingerprint ? "changed" : "nothing";
  });
}
