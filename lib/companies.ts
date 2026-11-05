import type { SessionUser } from "@/lib/auth";
import { assertCanEditCompany, ForbiddenError } from "@/lib/authz";
import { sql } from "@/lib/db";
import { COMPANY_SORTS, type CompanyDetail, type CompanyRow, type CompanySort, INDUSTRIES } from "@/lib/contactTypes";
import { likePattern } from "@/lib/search";

type Actor = Pick<SessionUser, "id" | "role">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAN_CREATE = ["sales_rep", "sales_lead", "ceo", "admin"];

export function parseCompanySort(v: string | string[] | undefined): CompanySort {
  return COMPANY_SORTS.find((s) => s === v) ?? "name";
}

export class CompanyInputError extends Error {
  constructor(readonly field: "name" | "industry" | "form") {
    super(`Invalid company input: ${field}`);
    this.name = "CompanyInputError";
  }
}

/** A company with this name already exists (any letter case). */
export class DuplicateCompanyError extends Error {
  constructor() {
    super("Company name already exists");
    this.name = "DuplicateCompanyError";
  }
}

type ListOptions = { ownerId: string | null; q: string; sort: CompanySort; limit: number };

/** Companies for /perusahaan; numbers come from v_companies_enriched. */
export async function listCompanies(o: ListOptions): Promise<{ rows: CompanyRow[]; total: number; hasMore: boolean }> {
  const q = o.q.trim().slice(0, 100);
  const owner = o.ownerId ? sql`AND owner_user_id = ${o.ownerId}` : sql``;
  const search = q ? sql`AND (name ILIKE ${likePattern(q)} OR industry ILIKE ${likePattern(q)} OR city ILIKE ${likePattern(q)})` : sql``;
  const order =
    o.sort === "pipeline" ? sql`pipeline DESC`
    : o.sort === "won" ? sql`total_done DESC`
    : sql`lower(name) ASC`;
  const rows = await sql<CompanyRow[]>`
    SELECT id, name, industry, city, owner_name, contact_count, open_deals, pipeline::text AS pipeline,
           total_done::text AS total_done, last_chat_at
      FROM v_companies_enriched WHERE true ${owner} ${search}
     ORDER BY ${order}, lower(name), id LIMIT ${o.limit + 1}`;
  const [{ total }] = await sql<{ total: number }[]>`SELECT count(*)::int AS total FROM v_companies_enriched WHERE true ${owner}`;
  return { rows: rows.slice(0, o.limit), total, hasMore: rows.length > o.limit };
}

export async function getCompany(id: string, viewerId: string): Promise<CompanyDetail | null> {
  if (!UUID.test(id)) return null;
  const [c] = await sql<
    { id: string; name: string; industry: string | null; city: string | null; website: string | null; owner_name: string | null; can_edit: boolean }[]
  >`SELECT id, name, industry, city, website, owner_name, can_edit_company(${viewerId}, id) AS can_edit
      FROM v_companies_enriched WHERE id = ${id}`;
  if (!c) return null;
  const contacts = await sql<{ id: string; full_name: string | null; phone_e164: string; job_title: string | null }[]>`
    SELECT id, full_name, phone_e164, job_title FROM contacts WHERE company_id = ${id} ORDER BY lower(full_name) NULLS LAST`;
  const deals = await sql<{ id: string; name: string; stage_key: string; amount: string }[]>`
    SELECT d.id, d.name, s.key AS stage_key, d.amount::text AS amount
      FROM deals d JOIN pipeline_stages s ON s.id = d.stage_id WHERE d.company_id = ${id} ORDER BY d.created_at DESC`;
  return {
    id: c.id,
    name: c.name,
    industry: c.industry ?? "",
    city: c.city ?? "",
    website: c.website ?? "",
    ownerName: c.owner_name,
    canEdit: c.can_edit,
    contacts: contacts.map((x) => ({ id: x.id, name: x.full_name, phone: x.phone_e164, jobTitle: x.job_title })),
    deals: deals.map((d) => ({ id: d.id, name: d.name, stageKey: d.stage_key, amount: d.amount })),
  };
}

export type CompanyInput = { id: string | null; name: string; industry: string; city: string; website: string };

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function parseCompanyInput(raw: unknown): CompanyInput {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const id = clip(r.id, 40) || null;
  if (id && !UUID.test(id)) throw new CompanyInputError("form");
  const industry = clip(r.industry, 30);
  if (industry && !(INDUSTRIES as readonly string[]).includes(industry)) throw new CompanyInputError("industry");
  return { id, name: clip(r.name, 200), industry, city: clip(r.city, 100), website: clip(r.website, 200) };
}

/** Create or update a company. Names are unique, ignoring letter case. */
export async function saveCompany(actor: Actor, input: CompanyInput): Promise<string> {
  if (!input.name) throw new CompanyInputError("name");
  if (input.id === null) {
    const [u] = await sql`SELECT 1 FROM users WHERE id = ${actor.id} AND is_active AND role = ANY(${CAN_CREATE})`;
    if (!u) throw new ForbiddenError();
  } else {
    await assertCanEditCompany(actor, input.id);
  }
  return sql.begin(async (tx) => {
    const [dup] = await tx`SELECT 1 FROM companies WHERE lower(name) = lower(${input.name}) AND id IS DISTINCT FROM ${input.id}`;
    if (dup) throw new DuplicateCompanyError();
    if (input.id === null) {
      const [c] = await tx<{ id: string }[]>`
        INSERT INTO companies (name, industry, city, website, owner_user_id)
        VALUES (${input.name}, ${input.industry || null}, ${input.city || null}, ${input.website || null}, ${actor.id})
        RETURNING id`;
      return c.id;
    }
    const rows = await tx`
      UPDATE companies SET name = ${input.name}, industry = ${input.industry || null}, city = ${input.city || null},
                           website = ${input.website || null}
       WHERE id = ${input.id} AND can_edit_company(${actor.id}, id) RETURNING id`;
    if (rows.length === 0) throw new ForbiddenError();
    return input.id;
  });
}
