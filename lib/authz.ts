import { redirect } from "next/navigation";
import { auth } from "@/auth";
import type { Role, SessionUser } from "@/lib/auth";
import { t } from "@/lib/copy";
import { sql } from "@/lib/db";

// View all, edit own (CLAUDE.md rule 3). Every Server Action that writes calls an
// assert below AND repeats the condition in its UPDATE with canEdit*Sql():
//
//   await assertCanEditDeal(user, dealId);
//   await sql`UPDATE deals SET ... WHERE id = ${dealId} AND ${canEditDealSql(user.id)}`;

export class ForbiddenError extends Error {
  readonly code = "forbidden";
  constructor() {
    super(t("authz.forbidden"));
    this.name = "ForbiddenError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The signed-in user, or a redirect to /masuk. */
export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user?.id) redirect("/masuk");
  const { id, email, role, full_name } = session.user;
  return { id, email: email ?? "", role, full_name };
}

/** Throws ForbiddenError unless the user has one of the roles. */
export function assertRole(user: Pick<SessionUser, "role">, ...roles: Role[]): void {
  if (!roles.includes(user.role)) throw new ForbiddenError();
}

/** Owner, sales_lead, ceo or admin, and the user is active (SQL can_edit_deal). */
export async function assertCanEditDeal(user: Pick<SessionUser, "id">, dealId: string) {
  if (!UUID.test(dealId)) throw new ForbiddenError();
  const [{ ok }] = await sql<{ ok: boolean }[]>`SELECT can_edit_deal(${user.id}, ${dealId}) AS ok`;
  if (!ok) throw new ForbiddenError();
}

/** Owner or unowned lead, sales_lead, ceo or admin, and the user is active (SQL can_edit_lead). */
export async function assertCanEditLead(user: Pick<SessionUser, "id">, leadId: string) {
  if (!UUID.test(leadId)) throw new ForbiddenError();
  const [{ ok }] = await sql<{ ok: boolean }[]>`SELECT can_edit_lead(${user.id}, ${leadId}) AS ok`;
  if (!ok) throw new ForbiddenError();
}

/** WHERE fragment for UPDATE/DELETE on deals: the same check as assertCanEditDeal. */
export function canEditDealSql(userId: string) {
  return sql`can_edit_deal(${userId}, id)`;
}

/** WHERE fragment for UPDATE/DELETE on leads: the same check as assertCanEditLead. */
export function canEditLeadSql(userId: string) {
  return sql`can_edit_lead(${userId}, id)`;
}

/** Owner, sales_lead, ceo or admin may edit a contact (SQL can_edit_contact). */
export async function assertCanEditContact(user: Pick<SessionUser, "id">, contactId: string) {
  if (!UUID.test(contactId)) throw new ForbiddenError();
  const [{ ok }] = await sql<{ ok: boolean }[]>`SELECT can_edit_contact(${user.id}, ${contactId}) AS ok`;
  if (!ok) throw new ForbiddenError();
}

/** Owner, sales_lead, ceo or admin may edit a company (SQL can_edit_company). */
export async function assertCanEditCompany(user: Pick<SessionUser, "id">, companyId: string) {
  if (!UUID.test(companyId)) throw new ForbiddenError();
  const [{ ok }] = await sql<{ ok: boolean }[]>`SELECT can_edit_company(${user.id}, ${companyId}) AS ok`;
  if (!ok) throw new ForbiddenError();
}
