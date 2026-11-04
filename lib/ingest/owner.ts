import type postgres from "postgres";
import { MissingActorError } from "./errors";
import { formatPhone } from "./phone";

// Step 4 of ingestLead (docs/INTEGRATIONS.md): who owns a new lead. No customer is locked to a rep.

export type Tx = postgres.TransactionSql;
export type ProductInterest = "IFP" | "DSS" | "LED";
export type CaptureMethod = "manual_quick_add" | "web_form" | "wa_link_ref" | "cloud_api_webhook" | "import";
type OwnershipReason = "auto_assign" | "specialisation";

export type OwnerConflict = { contactName: string; repName: string };

export type OwnerDecision = {
  /** null when no rep is active and accepting leads: the lead stays unowned. */
  ownerId: string | null;
  reason: OwnershipReason;
  conflict?: OwnerConflict;
};

type OwnerInput = {
  captureMethod: CaptureMethod;
  /** The rep the WhatsApp line belongs to, if the lead came in on a line. */
  lineUserId?: string | null;
  productInterest?: ProductInterest;
};

/**
 * Quick-add → the rep who logged it (the chat is on their phone). A line → its rep.
 * Otherwise pick_lead_owner(product): active reps accepting leads whose product lines
 * cover it, fewest new leads first. Also reports an open deal of this contact that
 * another rep owns, so the screen can say so.
 */
export async function resolveOwner(
  tx: Tx,
  input: OwnerInput,
  contactId: string,
  actorId?: string,
): Promise<OwnerDecision> {
  let ownerId: string | null;
  let reason: OwnershipReason = "auto_assign";
  if (input.captureMethod === "manual_quick_add") {
    if (!actorId) throw new MissingActorError();
    ownerId = actorId;
  } else if (input.lineUserId) {
    ownerId = input.lineUserId;
  } else {
    const [row] = await tx<{ id: string | null }[]>`
      SELECT pick_lead_owner(${input.productInterest ?? null}::product_line) AS id`;
    ownerId = row.id;
    if (input.productInterest) reason = "specialisation";
  }

  const conflict = await findOwnerConflict(tx, contactId, ownerId);
  return { ownerId, reason, ...(conflict && { conflict }) };
}

/** An open deal of this contact owned by someone other than ownerId, as names for the screen. */
export async function findOwnerConflict(
  tx: Tx,
  contactId: string,
  ownerId: string | null,
): Promise<OwnerConflict | undefined> {
  const [other] = await tx<{ full_name: string | null; phone_e164: string; rep: string }[]>`
    SELECT c.full_name, c.phone_e164, u.full_name AS rep
      FROM deals d
      JOIN contacts c ON c.id = d.contact_id
      JOIN users u ON u.id = d.owner_user_id
      JOIN pipeline_stages s ON s.id = d.stage_id
     WHERE d.contact_id = ${contactId}
       AND s.key NOT IN ('done', 'lost')
       AND d.owner_user_id IS DISTINCT FROM ${ownerId}
     ORDER BY d.updated_at DESC
     LIMIT 1`;
  return other && { contactName: other.full_name ?? formatPhone(other.phone_e164), repName: other.rep };
}

/** Writes the assignment to ownership_changes (after the lead exists). Unowned leads write nothing. */
export async function recordOwnership(
  tx: Tx,
  leadId: string,
  decision: OwnerDecision,
  actorId?: string,
): Promise<void> {
  if (!decision.ownerId) return;
  await tx`
    INSERT INTO ownership_changes (lead_id, to_user_id, reason, changed_by)
    VALUES (${leadId}, ${decision.ownerId}, ${decision.reason}, ${actorId ?? null})`;
}
