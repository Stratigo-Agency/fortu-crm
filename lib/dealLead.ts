import { ForbiddenError } from "@/lib/authz";
import type { SessionUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { emptyDeal, leadTrace } from "@/lib/deal";
import type { DealDetail } from "@/lib/dealTypes";
import { LeadClosedError } from "@/lib/leads";

const OPEN = ["new", "contacted", "qualified"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Actor = Pick<SessionUser, "id"> & { full_name?: string };

/**
 * Jadikan deal: a blank deal filled in from a prospect. The deal is named after the company (or the
 * contact) and the product the customer asked about, belongs to the prospect's owner, starts in
 * Chat masuk with the next step "Follow up WA" in two days. Nothing is saved until the form is.
 */
export async function leadPrefill(
  actor: Actor,
  leadId: string,
  texts: { nextStep: string; productLabel: (line: string) => string },
): Promise<DealDetail> {
  if (!UUID.test(leadId)) throw new ForbiddenError();
  const [l] = await sql<
    {
      id: string; status: string; source_channel: string; product_interest: string | null; owner_user_id: string | null;
      owner_name: string | null; full_name: string | null; phone_e164: string; company_name: string | null; can_edit: boolean;
    }[]
  >`
    SELECT l.id, l.status, l.source_channel, l.product_interest, l.owner_user_id, u.full_name AS owner_name,
           c.full_name, c.phone_e164, co.name AS company_name, can_edit_lead(${actor.id}, l.id) AS can_edit
      FROM leads l
      JOIN contacts c ON c.id = l.contact_id
      LEFT JOIN companies co ON co.id = c.company_id
      LEFT JOIN users u ON u.id = l.owner_user_id
     WHERE l.id = ${leadId}`;
  if (!l || !l.can_edit) throw new ForbiddenError();
  if (!OPEN.includes(l.status)) throw new LeadClosedError();

  const base = emptyDeal(l.owner_user_id ?? actor.id, l.owner_name ?? actor.full_name ?? null, texts.nextStep);
  const who = l.company_name ?? l.full_name ?? "";
  const product = l.product_interest ? texts.productLabel(l.product_interest) : "";
  return {
    ...base,
    name: [who, product].filter(Boolean).join(" · "),
    companyName: l.company_name ?? "",
    contactName: l.full_name ?? "",
    phone: l.phone_e164,
    leadId: l.id,
    sourceChannel: l.source_channel,
    leadTrace: await leadTrace(l.id),
  };
}

/**
 * Inside the save transaction of a new deal: the prospect becomes converted and points at the deal.
 * The permission is repeated in the UPDATE; a prospect that is gone or already handled stops the save.
 */
export async function convertLead(
  tx: import("@/lib/ingest/owner").Tx,
  actorId: string,
  leadId: string,
  dealId: string,
): Promise<void> {
  const rows = await tx<{ contact_id: string }[]>`
    UPDATE leads SET status = 'converted', deal_id = ${dealId}
     WHERE id = ${leadId} AND status = ANY(${OPEN}) AND can_edit_lead(${actorId}, id)
    RETURNING contact_id`;
  if (rows.length === 0) {
    const [row] = await tx<{ status: string; ok: boolean }[]>`
      SELECT status, can_edit_lead(${actorId}, id) AS ok FROM leads WHERE id = ${leadId}`;
    throw row?.ok && !OPEN.includes(row.status) ? new LeadClosedError() : new ForbiddenError();
  }
  await tx`UPDATE deals SET lead_id = ${leadId} WHERE id = ${dealId}`;
  await tx`
    INSERT INTO activities (type, lead_id, deal_id, contact_id, user_id, metadata)
    VALUES ('system', ${leadId}, ${dealId}, ${rows[0].contact_id}, ${actorId}, ${tx.json({ action: "converted" })})`;
}

/** + Deal from a contact: a blank deal with the contact's name, number and company filled in. */
export async function contactPrefill(
  actor: Actor,
  contactId: string,
  nextStep: string,
): Promise<DealDetail> {
  if (!UUID.test(contactId)) throw new ForbiddenError();
  const [c] = await sql<{ full_name: string | null; phone_e164: string; company_name: string | null; can_edit: boolean }[]>`
    SELECT c.full_name, c.phone_e164, co.name AS company_name, can_edit_contact(${actor.id}, c.id) AS can_edit
      FROM contacts c LEFT JOIN companies co ON co.id = c.company_id WHERE c.id = ${contactId}`;
  if (!c || !c.can_edit) throw new ForbiddenError();
  const base = emptyDeal(actor.id, actor.full_name ?? null, nextStep);
  return { ...base, name: c.company_name ?? c.full_name ?? "", companyName: c.company_name ?? "", contactName: c.full_name ?? "", phone: c.phone_e164 };
}
