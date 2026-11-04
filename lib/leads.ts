import { assertCanEditLead, assertRole, ForbiddenError } from "@/lib/authz";
import type { SessionUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { NOT_FIT_REASONS } from "@/lib/leadReasons";

// Changes to a lead from /prospek. Every function checks the permission twice (CLAUDE.md rule 3):
// assertCanEditLead / assertRole first, then the same condition again in the UPDATE's WHERE.
// A request for someone else's lead changes nothing and throws ForbiddenError.

type Actor = Pick<SessionUser, "id" | "role">;


const OPEN = ["new", "contacted", "qualified"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The lead is already a deal or not a fit, so this action no longer applies. */
export class LeadClosedError extends Error {
  readonly code = "lead_closed";
  constructor() {
    super("Lead is no longer open");
    this.name = "LeadClosedError";
  }
}

/** Input that isn't one of the allowed values (reason, new owner). */
export class InvalidInputError extends Error {
  readonly code = "invalid_input";
  constructor(what: string) {
    super(`Invalid ${what}`);
    this.name = "InvalidInputError";
  }
}

/** 0 rows changed: the lead isn't open (LeadClosedError) or the actor may not edit it (ForbiddenError). */
async function whyNotChanged(actorId: string, leadId: string): Promise<Error> {
  const [row] = await sql<{ status: string; ok: boolean }[]>`
    SELECT status, can_edit_lead(${actorId}, id) AS ok FROM leads WHERE id = ${leadId}`;
  return row?.ok && !OPEN.includes(row.status) ? new LeadClosedError() : new ForbiddenError();
}

/** Tandai sudah dihubungi: new → contacted, and the first response time is kept. */
export async function markContacted(actor: Actor, leadId: string): Promise<void> {
  await assertCanEditLead(actor, leadId);
  const rows = await sql`
    UPDATE leads SET status = 'contacted', first_response_at = COALESCE(first_response_at, now())
     WHERE id = ${leadId} AND status IN ('new', 'contacted') AND can_edit_lead(${actor.id}, id)
    RETURNING id`;
  if (rows.length === 0) throw await whyNotChanged(actor.id, leadId);
}

/** Tidak cocok: the lead is disqualified with a reason; a note, if given, goes to the contact's activity. */
export async function markNotFit(actor: Actor, leadId: string, reason: string, note?: string): Promise<void> {
  if (!(NOT_FIT_REASONS as readonly string[]).includes(reason)) throw new InvalidInputError("reason");
  await assertCanEditLead(actor, leadId);
  const text = note?.trim().slice(0, 1000) || null;
  await sql.begin(async (tx) => {
    const rows = await tx<{ contact_id: string }[]>`
      UPDATE leads SET status = 'disqualified', disqualify_reason = ${reason}
       WHERE id = ${leadId} AND status = ANY(${OPEN}) AND can_edit_lead(${actor.id}, id)
      RETURNING contact_id`;
    if (rows.length === 0) throw await whyNotChanged(actor.id, leadId);
    if (text) {
      await tx`
        INSERT INTO activities (type, contact_id, lead_id, user_id, body, metadata)
        VALUES ('note', ${rows[0].contact_id}, ${leadId}, ${actor.id}, ${text},
                ${tx.json({ action: "disqualified", reason })})`;
    }
  });
}

/** Alihkan: only sales_lead, ceo and admin. The change is recorded in ownership_changes. */
export async function reassignLead(actor: Actor, leadId: string, newOwnerId: string): Promise<void> {
  assertRole(actor, "sales_lead", "ceo", "admin");
  await assertCanEditLead(actor, leadId);
  if (!UUID.test(newOwnerId)) throw new InvalidInputError("owner");
  await sql.begin(async (tx) => {
    const [target] = await tx`
      SELECT 1 FROM users WHERE id = ${newOwnerId} AND is_active AND role IN ('sales_rep', 'sales_lead')`;
    if (!target) throw new InvalidInputError("owner");

    const [before] = await tx<{ owner_user_id: string | null }[]>`
      SELECT owner_user_id FROM leads WHERE id = ${leadId} FOR UPDATE`;
    if (before?.owner_user_id === newOwnerId) return; // already theirs

    const rows = await tx`
      UPDATE leads SET owner_user_id = ${newOwnerId}
       WHERE id = ${leadId} AND status = ANY(${OPEN}) AND can_edit_lead(${actor.id}, id)
         AND EXISTS (SELECT 1 FROM users a WHERE a.id = ${actor.id} AND a.is_active
                       AND a.role IN ('sales_lead', 'ceo', 'admin'))
      RETURNING id`;
    if (rows.length === 0) throw await whyNotChanged(actor.id, leadId);
    await tx`
      INSERT INTO ownership_changes (lead_id, from_user_id, to_user_id, reason, changed_by)
      VALUES (${leadId}, ${before?.owner_user_id ?? null}, ${newOwnerId}, 'manual_reassign', ${actor.id})`;
  });
}
