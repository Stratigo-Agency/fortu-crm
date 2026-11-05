import { ForbiddenError } from "@/lib/authz";
import type { Role } from "@/lib/auth";
import { pgError, sql } from "@/lib/db";
import { InvalidPhoneError } from "@/lib/ingest/errors";
import { normalizePhone } from "@/lib/ingest/phone";
import type { Tx } from "@/lib/ingest/owner";

// Pengaturan: what Pak Jovian (ceo) and the admin control. Reads and writes live here; the pages only
// show them. Every write checks the role again (CLAUDE.md rule 3) and reads its values from a form.

export type Actor = { id: string; role: Role };

export class SettingsError extends Error {
  constructor(readonly key: SettingsErrorKey) {
    super(`Invalid settings input: ${key}`);
    this.name = "SettingsError";
  }
}
export type SettingsErrorKey = "percent" | "number" | "email" | "emailTaken" | "phone" | "phoneTaken" | "month" | "self" | "name";

const OWNERS: Role[] = ["admin", "ceo"];
const TARGET_SETTERS: Role[] = ["admin", "ceo", "sales_lead"];

export function assertSettingsOwner(actor: Pick<Actor, "role">): void {
  if (!OWNERS.includes(actor.role)) throw new ForbiddenError();
}
export function assertTargetSetter(actor: Pick<Actor, "role">): void {
  if (!TARGET_SETTERS.includes(actor.role)) throw new ForbiddenError();
}

// ---- reading what a form sent ------------------------------------------------------------------------

/** Whole number from text like "1.500.000.000" or "Rp 40": digits only. null for blank. */
export function wholeNumber(raw: unknown, { min = 0, max = 9_999_999_999_999 }: { min?: number; max?: number } = {}): number | null {
  const s = typeof raw === "string" ? raw.replace(/[^\d]/g, "") : "";
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new SettingsError("number");
  return n;
}

/** A percentage 0–100, with a comma or dot decimal ("12,5"). null for blank. */
export function percentNumber(raw: unknown): number | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const n = Number(raw.trim().replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new SettingsError("percent");
  return Math.round(n * 100) / 100;
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** "2026-11" → "2026-11-01"; anything else is refused. */
export function monthStart(raw: unknown): string {
  if (typeof raw !== "string" || !MONTH.test(raw)) throw new SettingsError("month");
  return `${raw}-01`;
}

// ---- Target --------------------------------------------------------------------------------------------

export type TargetRow = { userId: string | null; name: string; amount: string | null; units: number | null };

/** Company and per-sales targets for one month (YYYY-MM-01). */
export async function getTargets(month: string): Promise<TargetRow[]> {
  return sql<TargetRow[]>`
    SELECT NULL::uuid AS "userId", ${""}::text AS name, t.target_amount::text AS amount, t.target_units AS units
      FROM (SELECT 1) x LEFT JOIN sales_targets t ON t.user_id IS NULL AND t.period_month = ${month}::date
    UNION ALL
    SELECT u.id, u.full_name, t.target_amount::text, t.target_units
      FROM users u LEFT JOIN sales_targets t ON t.user_id = u.id AND t.period_month = ${month}::date
     WHERE u.is_active AND u.role IN ('sales_rep', 'sales_lead')
     ORDER BY 1 NULLS FIRST, 2`;
}

/** Saves a month's targets. A blank amount and units removes that row's target. Form fields: amount:<id|company>, units:<id|company>. */
export async function saveTargets(actor: Actor, month: string, form: FormData): Promise<void> {
  assertTargetSetter(actor);
  const period = monthStart(month.slice(0, 7));
  const reps = await sql<{ id: string }[]>`SELECT id FROM users WHERE is_active AND role IN ('sales_rep', 'sales_lead')`;
  const owners: (string | null)[] = [null, ...reps.map((r) => r.id)];
  const rows = owners.map((id) => {
    const key = id ?? "company";
    return { id, amount: wholeNumber(form.get(`amount:${key}`)), units: wholeNumber(form.get(`units:${key}`), { min: 1, max: 1_000_000 }) };
  });
  await sql.begin(async (tx) => {
    for (const r of rows) {
      if (r.amount === null && r.units === null) {
        await tx`DELETE FROM sales_targets WHERE user_id IS NOT DISTINCT FROM ${r.id}::uuid AND period_month = ${period}::date`;
      } else {
        await tx`
          INSERT INTO sales_targets (user_id, period_month, target_amount, target_units)
          VALUES (${r.id}, ${period}::date, ${r.amount}, ${r.units})
          ON CONFLICT (user_id, period_month) DO UPDATE SET target_amount = EXCLUDED.target_amount, target_units = EXCLUDED.target_units`;
      }
    }
  });
}

// ---- Aturan, Peluang, Definisi -----------------------------------------------------------------------------

export type Rules = {
  maxDiscountPct: number; followupDays: number; projectMinUnits: number; projectMinAmount: number; highValueAmount: number;
};
export type StageSetting = {
  id: number; key: string; name: string; probabilityPct: number; staleDays: number; definition: string; isWon: boolean; isLost: boolean;
};

export async function getRules(): Promise<Rules> {
  const [r] = await sql<{ md: string; fd: string; pu: string; pa: string; hv: string }[]>`
    SELECT setting_num('max_discount_pct')::text AS md, setting_num('followup_days')::text AS fd,
           setting_num('project_min_units')::text AS pu, setting_num('project_min_amount')::text AS pa,
           setting_num('high_value_amount')::text AS hv`;
  return { maxDiscountPct: Number(r.md), followupDays: Number(r.fd), projectMinUnits: Number(r.pu), projectMinAmount: Number(r.pa), highValueAmount: Number(r.hv) };
}

export async function getStages(): Promise<StageSetting[]> {
  return sql<StageSetting[]>`
    SELECT id, key, name, ROUND(probability * 100)::int AS "probabilityPct", stale_after_days AS "staleDays",
           COALESCE(definition, '') AS definition, is_won AS "isWon", is_lost AS "isLost"
      FROM pipeline_stages ORDER BY position`;
}

async function setSetting(tx: Tx, key: string, value: number) {
  await tx`INSERT INTO app_settings (key, value) VALUES (${key}, ${String(value)}::jsonb)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
}

/** Aturan: the company-wide limits, and after how many days a deal in each stage counts as stale. */
export async function saveRules(actor: Actor, form: FormData): Promise<void> {
  assertSettingsOwner(actor);
  const need = <T>(v: T | null): T => {
    if (v === null) throw new SettingsError("number");
    return v;
  };
  const maxDiscount = need(percentNumber(form.get("maxDiscountPct")));
  const followup = need(wholeNumber(form.get("followupDays"), { min: 1, max: 365 }));
  const units = need(wholeNumber(form.get("projectMinUnits"), { min: 1, max: 100_000 }));
  const amount = need(wholeNumber(form.get("projectMinAmount")));
  const high = need(wholeNumber(form.get("highValueAmount")));
  const stages = await sql<{ id: number; is_won: boolean; is_lost: boolean }[]>`SELECT id, is_won, is_lost FROM pipeline_stages`;
  const stale = stages
    .filter((s) => !s.is_won && !s.is_lost)
    .map((s) => ({ id: s.id, days: need(wholeNumber(form.get(`stale:${s.id}`), { min: 1, max: 365 })) }));
  await sql.begin(async (tx) => {
    await setSetting(tx, "max_discount_pct", maxDiscount);
    await setSetting(tx, "followup_days", followup);
    await setSetting(tx, "project_min_units", units);
    await setSetting(tx, "project_min_amount", amount);
    await setSetting(tx, "high_value_amount", high);
    for (const s of stale) await tx`UPDATE pipeline_stages SET stale_after_days = ${s.days} WHERE id = ${s.id}`;
  });
}

/** Peluang per tahap: 0–100 for the open stages. Done deal is always 100% and Lost 0%, so they are never changed. */
export async function saveProbabilities(actor: Actor, form: FormData): Promise<void> {
  assertSettingsOwner(actor);
  const stages = await sql<{ id: number }[]>`SELECT id FROM pipeline_stages WHERE NOT is_won AND NOT is_lost`;
  const values = stages.map((s) => {
    // a probability out of range or blank says "0 sampai 100", not a general number error
    let n: number | null;
    try {
      n = wholeNumber(form.get(`prob:${s.id}`), { min: 0, max: 100 });
    } catch {
      throw new SettingsError("percent");
    }
    if (n === null) throw new SettingsError("percent");
    return { id: s.id, p: n / 100 };
  });
  await sql.begin(async (tx) => {
    for (const v of values) await tx`UPDATE pipeline_stages SET probability = ${v.p} WHERE id = ${v.id}`;
  });
}

/** Definisi tahap: the sentence shown as the column header tooltip on /pipeline. */
export async function saveDefinitions(actor: Actor, form: FormData): Promise<void> {
  assertSettingsOwner(actor);
  const stages = await sql<{ id: number }[]>`SELECT id FROM pipeline_stages`;
  await sql.begin(async (tx) => {
    for (const s of stages) {
      const def = text(form.get(`def:${s.id}`), 400);
      await tx`UPDATE pipeline_stages SET definition = ${def || null} WHERE id = ${s.id}`;
    }
  });
}

// ---- Tim sales -----------------------------------------------------------------------------------------------

export const TEAM_ROLES: Role[] = ["sales_rep", "sales_lead", "marketing", "ceo", "admin"];
export const PRODUCT_LINES = ["IFP", "DSS", "LED"] as const;

export type Member = {
  id: string; fullName: string; email: string; role: Role; isActive: boolean; acceptingLeads: boolean;
  productLines: string[]; waPhone: string; waLabel: string; deals: number;
};

export async function getTeam(): Promise<Member[]> {
  return sql<Member[]>`
    SELECT u.id, u.full_name AS "fullName", u.email, u.role, u.is_active AS "isActive", u.accepting_leads AS "acceptingLeads",
           u.product_lines::text[] AS "productLines", COALESCE(w.phone_e164, '') AS "waPhone", COALESCE(w.label, '') AS "waLabel",
           (SELECT count(*)::int FROM deals d WHERE d.owner_user_id = u.id) AS deals
      FROM users u
      LEFT JOIN LATERAL (SELECT phone_e164, label FROM wa_lines WHERE user_id = u.id ORDER BY is_active DESC, id LIMIT 1) w ON true
     ORDER BY u.is_active DESC, u.full_name`;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Adds a person by email so they can sign in (Google or password set by the admin). */
export async function addMember(actor: Actor, form: FormData): Promise<string> {
  assertSettingsOwner(actor);
  const name = text(form.get("name"), 120);
  const email = text(form.get("email"), 200).toLowerCase();
  const role = text(form.get("role"), 20) as Role;
  if (!name) throw new SettingsError("name");
  if (!EMAIL.test(email)) throw new SettingsError("email");
  if (!TEAM_ROLES.includes(role)) throw new ForbiddenError();
  try {
    const [u] = await sql<{ id: string }[]>`INSERT INTO users (full_name, email, role) VALUES (${name}, ${email}, ${role}::user_role) RETURNING id`;
    return u.id;
  } catch (err) {
    if (pgError(err)?.code === "23505") throw new SettingsError("emailTaken");
    throw err;
  }
}

/**
 * Saves the whole team table. Form fields per person: role:<id>, active:<id> (checkbox), accepting:<id> (checkbox),
 * lines:<id> (one or more of IFP/DSS/LED), wa:<id> (number), walabel:<id>.
 * Nobody can change their own role or switch themself off (that would lock them out).
 */
export async function saveTeam(actor: Actor, form: FormData): Promise<void> {
  assertSettingsOwner(actor);
  const people = await sql<{ id: string; role: Role; is_active: boolean }[]>`SELECT id, role, is_active FROM users`;
  const edits = people.map((p) => {
    const role = text(form.get(`role:${p.id}`), 20) as Role;
    if (!TEAM_ROLES.includes(role)) throw new ForbiddenError();
    const active = form.get(`active:${p.id}`) === "on";
    if (p.id === actor.id && (role !== p.role || active !== p.is_active)) throw new SettingsError("self");
    const lines = form.getAll(`lines:${p.id}`).map(String).filter((l) => (PRODUCT_LINES as readonly string[]).includes(l));
    const rawPhone = text(form.get(`wa:${p.id}`), 40);
    let phone: string | null = null;
    if (rawPhone) {
      try {
        phone = normalizePhone(rawPhone);
      } catch (err) {
        if (err instanceof InvalidPhoneError) throw new SettingsError("phone");
        throw err;
      }
    }
    return { id: p.id, role, active, accepting: form.get(`accepting:${p.id}`) === "on", lines, phone, label: text(form.get(`walabel:${p.id}`), 60) };
  });
  try {
    await sql.begin(async (tx) => {
      for (const e of edits) {
        await tx`UPDATE users SET role = ${e.role}::user_role, is_active = ${e.active}, accepting_leads = ${e.accepting},
                                  product_lines = ${e.lines}::product_line[] WHERE id = ${e.id}`;
        if (e.phone) {
          const [line] = await tx<{ id: string }[]>`SELECT id FROM wa_lines WHERE user_id = ${e.id} ORDER BY is_active DESC, id LIMIT 1`;
          if (line) await tx`UPDATE wa_lines SET phone_e164 = ${e.phone}, label = COALESCE(NULLIF(${e.label}, ''), label) WHERE id = ${line.id}`;
          else await tx`INSERT INTO wa_lines (user_id, phone_e164, label) VALUES (${e.id}, ${e.phone}, ${e.label || `No_${e.id.slice(0, 6)}`})`;
        }
      }
    });
  } catch (err) {
    if (pgError(err)?.code === "23505") throw new SettingsError("phoneTaken");
    throw err;
  }
}

// ---- Katalog produk ------------------------------------------------------------------------------------------------

export type CatalogRow = { id: string; sku: string; name: string; productLine: string; listPrice: string | null; maxDiscountPct: string | null };

export async function getCatalog(): Promise<CatalogRow[]> {
  return sql<CatalogRow[]>`
    SELECT id, sku, name, product_line::text AS "productLine", list_price::text AS "listPrice", max_discount_pct::text AS "maxDiscountPct"
      FROM products WHERE is_active ORDER BY product_line, sku`;
}

/** MSRP and the discount limit per product. A blank limit means "use the company limit". Fields: price:<id>, disc:<id>. */
export async function saveCatalog(actor: Actor, form: FormData): Promise<void> {
  assertSettingsOwner(actor);
  const products = await sql<{ id: string }[]>`SELECT id FROM products WHERE is_active`;
  const edits = products.map((p) => ({ id: p.id, price: wholeNumber(form.get(`price:${p.id}`)), disc: percentNumber(form.get(`disc:${p.id}`)) }));
  await sql.begin(async (tx) => {
    for (const e of edits) await tx`UPDATE products SET list_price = ${e.price}, max_discount_pct = ${e.disc} WHERE id = ${e.id}`;
  });
}
