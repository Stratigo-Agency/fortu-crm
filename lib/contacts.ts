import type { SessionUser } from "@/lib/auth";
import { assertCanEditContact, ForbiddenError } from "@/lib/authz";
import { pgError, sql } from "@/lib/db";
import {
  ACTIVITY_TYPES,
  type ActivityType,
  CONTACT_SORTS,
  type ContactDetail,
  type ContactRow,
  type ContactSort,
  type TimelineItem,
} from "@/lib/contactTypes";
import { findOrCreateCompany } from "@/lib/dealSave";
import { InvalidPhoneError } from "@/lib/ingest/errors";
import { normalizePhone } from "@/lib/ingest/phone";
import { likePattern, phonePatterns } from "@/lib/search";

// Kontak: the list, one contact with its activity log, and the changes. One phone number = one contact.

type Actor = Pick<SessionUser, "id" | "role">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAN_CREATE = ["sales_rep", "sales_lead", "ceo", "admin"];

export function parseContactSort(v: string | string[] | undefined): ContactSort {
  return CONTACT_SORTS.find((s) => s === v) ?? "last_new";
}

/** The number is already a contact: who it is and which sales has them (for the message). */
export class DuplicatePhoneError extends Error {
  readonly code = "duplicate_phone";
  constructor(
    readonly contactName: string | null,
    readonly phone: string,
    readonly repName: string | null,
  ) {
    super("Phone number already belongs to a contact");
    this.name = "DuplicatePhoneError";
  }
}

export class ContactInputError extends Error {
  constructor(readonly field: "phone" | "date" | "type" | "name" | "email" | "form") {
    super(`Invalid contact input: ${field}`);
    this.name = "ContactInputError";
  }
}

type ListOptions = { ownerId: string | null; q: string; sort: ContactSort; followupOnly: boolean; limit: number };

/** Contacts for /kontak. total and followup are counted for the sales filter (not the search). */
export async function listContacts(o: ListOptions): Promise<{ rows: ContactRow[]; total: number; followup: number; hasMore: boolean }> {
  const q = o.q.trim().slice(0, 100);
  const phones = phonePatterns(q);
  const owner = o.ownerId ? sql`AND owner_user_id = ${o.ownerId}` : sql``;
  const search = q
    ? sql`AND (full_name ILIKE ${likePattern(q)} OR company_name ILIKE ${likePattern(q)}
               ${phones.length ? sql`OR phone_e164 LIKE ANY(${phones})` : sql``})`
    : sql``;
  const order =
    o.sort === "last_old" ? sql`last_chat_at ASC`
    : o.sort === "first_new" ? sql`first_chat_at DESC`
    : o.sort === "name" ? sql`lower(full_name) ASC NULLS LAST`
    : sql`last_chat_at DESC`;

  const rows = await sql<ContactRow[]>`
    SELECT id, full_name, job_title, phone_e164, company_name, source_channel, owner_name, first_chat_at,
           last_chat_at, open_deals, needs_followup, followup_days
      FROM v_contacts_enriched
     WHERE true ${owner} ${search} ${o.followupOnly ? sql`AND needs_followup` : sql``}
     ORDER BY ${order}, id
     LIMIT ${o.limit + 1}`;
  const [counts] = await sql<{ total: number; followup: number }[]>`
    SELECT count(*)::int AS total, count(*) FILTER (WHERE needs_followup)::int AS followup
      FROM v_contacts_enriched WHERE true ${owner}`;
  return { rows: rows.slice(0, o.limit), total: counts.total, followup: counts.followup, hasMore: rows.length > o.limit };
}

/** One contact with its timeline (activities and chats that came in) and deals; null when unknown. */
export async function getContact(id: string, viewerId: string): Promise<ContactDetail | null> {
  if (!UUID.test(id)) return null;
  const [c] = await sql<
    {
      id: string; full_name: string | null; job_title: string | null; email: string | null; phone_e164: string;
      company_name: string | null; owner_name: string | null; last_chat_at: Date; needs_followup: boolean; can_edit: boolean;
    }[]
  >`
    SELECT id, full_name, job_title, email, phone_e164, company_name, owner_name, last_chat_at, needs_followup,
           can_edit_contact(${viewerId}, id) AS can_edit
      FROM v_contacts_enriched WHERE id = ${id}`;
  if (!c) return null;

  const acts = await sql<{ id: string; type: ActivityType; at: Date; by: string | null; body: string | null }[]>`
    SELECT a.id::text AS id, a.type::text AS type, a.created_at AS at, u.full_name AS by, a.body
      FROM activities a LEFT JOIN users u ON u.id = a.user_id
     WHERE a.contact_id = ${id} AND a.type = ANY(${[...ACTIVITY_TYPES]})`;
  const leads = await sql<{ id: string; at: Date; msg: string | null }[]>`
    SELECT id::text AS id, received_at AS at, first_message AS msg FROM leads WHERE contact_id = ${id}`;
  const timeline: TimelineItem[] = [
    ...acts.map((a) => ({ id: `a${a.id}`, kind: "activity" as const, type: a.type, at: a.at.toISOString(), by: a.by, text: a.body })),
    ...leads.map((l) => ({ id: `l${l.id}`, kind: "lead" as const, type: "lead" as const, at: l.at.toISOString(), by: null, text: l.msg })),
  ].sort((x, y) => y.at.localeCompare(x.at));

  const deals = await sql<{ id: string; name: string; stage_key: string; amount: string }[]>`
    SELECT d.id, d.name, s.key AS stage_key, d.amount::text AS amount
      FROM deals d JOIN pipeline_stages s ON s.id = d.stage_id
     WHERE d.contact_id = ${id} ORDER BY d.created_at DESC`;

  return {
    id: c.id,
    name: c.full_name ?? "",
    jobTitle: c.job_title ?? "",
    email: c.email ?? "",
    phone: c.phone_e164,
    companyName: c.company_name ?? "",
    ownerName: c.owner_name,
    canEdit: c.can_edit,
    lastChatAt: c.last_chat_at.toISOString(),
    needsFollowup: c.needs_followup,
    timeline,
    deals: deals.map((d) => ({ id: d.id, name: d.name, stageKey: d.stage_key, amount: d.amount })),
  };
}

export type ContactInput = {
  id: string | null;
  name: string;
  jobTitle: string;
  email: string;
  phone: string;
  companyName: string;
};

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** What the form sent (it may be anything), as a clean ContactInput. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseContactInput(raw: unknown): ContactInput {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const id = clip(r.id, 40) || null;
  if (id && !UUID.test(id)) throw new ContactInputError("form");
  const email = clip(r.email, 200);
  if (email && !EMAIL.test(email)) throw new ContactInputError("email");
  return {
    id,
    name: clip(r.name, 120),
    jobTitle: clip(r.jobTitle, 120),
    email,
    phone: clip(r.phone, 40),
    companyName: clip(r.companyName, 200),
  };
}

/** Create or update a contact. A number that already belongs to another contact is refused. */
export async function saveContact(actor: Actor, input: ContactInput): Promise<string> {
  let phone: string;
  try {
    phone = normalizePhone(input.phone);
  } catch (err) {
    if (err instanceof InvalidPhoneError) throw new ContactInputError("phone");
    throw err;
  }
  if (input.id === null) {
    const [u] = await sql`SELECT 1 FROM users WHERE id = ${actor.id} AND is_active AND role = ANY(${CAN_CREATE})`;
    if (!u) throw new ForbiddenError();
  } else {
    await assertCanEditContact(actor, input.id);
  }

  const run = () => sql.begin(async (tx) => {
    const [taken] = await tx<{ id: string; full_name: string | null; owner: string | null }[]>`
      SELECT c.id, c.full_name, u.full_name AS owner
        FROM contacts c LEFT JOIN users u ON u.id = contact_effective_owner(c.id)
       WHERE c.phone_e164 = ${phone} AND c.id IS DISTINCT FROM ${input.id}`;
    if (taken) throw new DuplicatePhoneError(taken.full_name, phone, taken.owner);

    const companyId = await findOrCreateCompany(tx, input.companyName, actor.id);
    if (input.id === null) {
      const [c] = await tx<{ id: string }[]>`
        INSERT INTO contacts (phone_e164, full_name, job_title, email, company_id, owner_user_id)
        VALUES (${phone}, ${input.name || null}, ${input.jobTitle || null}, ${input.email || null}, ${companyId}, ${actor.id})
        RETURNING id`;
      return c.id;
    }
    const rows = await tx`
      UPDATE contacts SET phone_e164 = ${phone}, full_name = ${input.name || null}, job_title = ${input.jobTitle || null},
                          email = ${input.email || null}, company_id = ${companyId}
       WHERE id = ${input.id} AND can_edit_contact(${actor.id}, id)
      RETURNING id`;
    if (rows.length === 0) throw new ForbiddenError();
    return input.id;
  });
  try {
    return await run();
  } catch (err) {
    // two saves with the same number at once: the database refuses the second, so answer like the check does
    if (pgError(err)?.code === "23505") return await run();
    throw err;
  }
}

function jakartaToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
}

/**
 * Catat: logs an activity (chat, call, meeting, visit, email, note) on a contact. "Chat terakhir" is
 * derived from activities, so this updates it. A past date is allowed, the future is not.
 */
export async function logActivity(actor: Actor, contactId: string, type: string, date: string, note: string): Promise<void> {
  if (!(ACTIVITY_TYPES as readonly string[]).includes(type)) throw new ContactInputError("type");
  const day = date.trim();
  const real = /^\d{4}-\d{2}-\d{2}$/.test(day) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
  if (!real || day > jakartaToday()) throw new ContactInputError("date");
  await assertCanEditContact(actor, contactId);
  const when = day === jakartaToday() ? null : `${day}T12:00:00+07:00`;
  const rows = await sql`
    INSERT INTO activities (type, contact_id, user_id, body, created_at)
    SELECT ${type}::activity_type, c.id, ${actor.id}, ${clip(note, 2000) || null}, COALESCE(${when}::timestamptz, now())
      FROM contacts c WHERE c.id = ${contactId} AND can_edit_contact(${actor.id}, c.id)
    RETURNING id`;
  if (rows.length === 0) throw new ForbiddenError();
}
