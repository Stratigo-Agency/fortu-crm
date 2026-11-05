import type { SessionUser } from "@/lib/auth";
import { assertCanEditDeal, ForbiddenError } from "@/lib/authz";
import { pgError, sql } from "@/lib/db";
import { DEAL_KINDS, type DealInput } from "@/lib/dealTypes";
import { InvalidPhoneError } from "@/lib/ingest/errors";
import type { Tx } from "@/lib/ingest/owner";
import { normalizePhone } from "@/lib/ingest/phone";
import { stageRuleOf } from "@/lib/pipeline";
import { STAGE_KEYS, type StageRule } from "@/lib/pipelineTypes";

// Saving a deal (CLAUDE.md rules 3, 4, 6, 11): one transaction that sets app.user_id (the stage history
// records who), creates or finds the company and the contact, replaces the product lines, and updates the
// deal with the permission repeated in the WHERE. The amount is never taken from the client: the database
// computes it from the lines, or uses est_amount while there are none.

type Actor = Pick<SessionUser, "id" | "role">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOST_REASONS = ["harga", "kompetitor", "budget", "timing", "no_response", "spec", "other", "stock_leadtime"];
const MANAGERS = ["sales_lead", "ceo", "admin"];
const CAN_CREATE = ["sales_rep", "sales_lead", "ceo", "admin"];
const MAX_AMOUNT = 9_999_999_999_999;

/** What was wrong with the input, as a field and a copy key (never raw text). */
export class DealInputError extends Error {
  constructor(
    readonly field: "name" | "phone" | "parent" | "lines" | "date" | "owner" | "form",
    readonly messageKey: "deal.nameRequired" | "quickAdd.invalidPhone" | "deal.parentRequired" | "deal.linesInvalid" | "errors.generic",
  ) {
    super(`Invalid deal input: ${field}`);
    this.name = "DealInputError";
  }
}

export type SaveDealResult = { ok: true; id: string } | { ok: false; rule: StageRule };

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const date = (v: unknown) => {
  const s = str(v, 10);
  if (!s) return null;
  if (!DATE.test(s) || Number.isNaN(Date.parse(s))) throw new DealInputError("date", "errors.generic");
  return s;
};
const whole = (v: unknown, max: number) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
};

/** Reads what the form sent (it may be anything) into a clean DealInput, or throws DealInputError. */
export function parseDealInput(raw: unknown): DealInput {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const id = str(r.id, 40) || null;
  if (id && !UUID.test(id)) throw new DealInputError("form", "errors.generic");
  const kind = DEAL_KINDS.find((k) => k === r.kind) ?? "new";
  const stageKey = STAGE_KEYS.find((k) => k === r.stageKey);
  if (!stageKey) throw new DealInputError("form", "errors.generic");
  const parent = str(r.parentDealId, 40) || null;
  if (parent && !UUID.test(parent)) throw new DealInputError("parent", "deal.parentRequired");
  const lines = Array.isArray(r.lines) ? r.lines : [];
  if (lines.length > 50) throw new DealInputError("lines", "deal.linesInvalid");
  const fromLead = str(r.fromLeadId, 40) || null;
  if (fromLead && !UUID.test(fromLead)) throw new DealInputError("form", "errors.generic");
  const ownerId = str(r.ownerId, 40);
  if (ownerId && !UUID.test(ownerId)) throw new DealInputError("owner", "errors.generic");

  return {
    id,
    name: str(r.name, 200),
    kind,
    parentDealId: parent,
    stageKey,
    ownerId,
    companyName: str(r.companyName, 200),
    contactName: str(r.contactName, 120),
    phone: str(r.phone, 40),
    expectedCloseDate: date(r.expectedCloseDate) ?? "",
    nextStep: str(r.nextStep, 200),
    nextStepDate: date(r.nextStepDate) ?? "",
    demoDate: date(r.demoDate) ?? "",
    paidDate: date(r.paidDate) ?? "",
    lostReason: LOST_REASONS.includes(str(r.lostReason, 30)) ? str(r.lostReason, 30) : "",
    competitor: str(r.competitor, 120),
    lostNote: str(r.lostNote, 1000),
    estAmount: whole(r.estAmount, MAX_AMOUNT) ?? 0,
    lines: lines.map((l) => {
      const x = (typeof l === "object" && l !== null ? l : {}) as Record<string, unknown>;
      const productId = str(x.productId, 40);
      const qty = whole(x.qty, 100_000);
      const unitPrice = whole(x.unitPrice, MAX_AMOUNT);
      if (!UUID.test(productId) || !qty || qty < 1 || unitPrice === null) throw new DealInputError("lines", "deal.linesInvalid");
      return { productId, qty, unitPrice };
    }),
    note: str(r.note, 2000),
    fromLeadId: fromLead,
  };
}

async function findOrCreateCompany(tx: Tx, name: string): Promise<string | null> {
  if (!name) return null;
  const [existing] = await tx<{ id: string }[]>`
    SELECT id FROM companies WHERE lower(name) = lower(${name}) ORDER BY created_at LIMIT 1`;
  if (existing) return existing.id;
  const [created] = await tx<{ id: string }[]>`INSERT INTO companies (name) VALUES (${name}) RETURNING id`;
  return created.id;
}

async function findOrCreateContact(tx: Tx, phone: string, name: string, companyId: string | null): Promise<string> {
  let e164: string;
  try {
    e164 = normalizePhone(phone);
  } catch (err) {
    if (err instanceof InvalidPhoneError) throw new DealInputError("phone", "quickAdd.invalidPhone");
    throw err;
  }
  const [c] = await tx<{ id: string }[]>`
    INSERT INTO contacts (phone_e164, full_name, company_id) VALUES (${e164}, ${name || null}, ${companyId})
    ON CONFLICT (phone_e164) DO UPDATE
       SET full_name = COALESCE(contacts.full_name, EXCLUDED.full_name),
           company_id = COALESCE(contacts.company_id, EXCLUDED.company_id)
    RETURNING id`;
  return c.id;
}

/** Create or update a deal as the actor. Returns the deal id, or the stage rule that stopped it. */
export async function saveDeal(actor: Actor, input: DealInput): Promise<SaveDealResult> {
  if (!input.name) throw new DealInputError("name", "deal.nameRequired");
  if (input.kind !== "new" && !input.parentDealId) throw new DealInputError("parent", "deal.parentRequired");
  const isNew = input.id === null;
  if (isNew) await assertCanCreate(actor);
  else await assertCanEditDeal(actor, input.id as string);

  try {
    return await sql.begin(async (tx): Promise<SaveDealResult> => {
      await tx`SELECT set_config('app.user_id', ${actor.id}, true)`; // = SET LOCAL app.user_id

      const companyId = await findOrCreateCompany(tx, input.companyName);
      const contactId = await findOrCreateContact(tx, input.phone, input.contactName, companyId);
      if (input.parentDealId) {
        const [p] = await tx`SELECT 1 FROM deals WHERE id = ${input.parentDealId} AND id IS DISTINCT FROM ${input.id}`;
        if (!p) throw new DealInputError("parent", "deal.parentRequired");
      }

      // The owner: only sales leads, the CEO and admins hand a deal to someone else.
      const manager = MANAGERS.includes(actor.role);
      const wantedOwner = manager && input.ownerId ? input.ownerId : null;
      if (wantedOwner) {
        const [o] = await tx`SELECT 1 FROM users WHERE id = ${wantedOwner} AND is_active AND role IN ('sales_rep', 'sales_lead')`;
        if (!o) throw new DealInputError("owner", "errors.generic");
      }

      const closed = input.stageKey === "done" || input.stageKey === "lost";
      const lostReason = input.stageKey === "lost" ? input.lostReason || null : null;
      const competitor = input.stageKey === "lost" ? input.competitor || null : null;
      const lostNote = input.stageKey === "lost" ? input.lostNote || null : null;

      let dealId: string;
      if (isNew) {
        const [d] = await tx<{ id: string }[]>`
          INSERT INTO deals (name, contact_id, company_id, owner_user_id, stage_id, deal_type, parent_deal_id,
                             next_step, next_step_date, est_amount, expected_close_date, demo_date)
          VALUES (${input.name}, ${contactId}, ${companyId}, ${wantedOwner ?? actor.id},
                  (SELECT id FROM pipeline_stages WHERE key = 'chat'), ${input.kind}, ${input.parentDealId},
                  ${input.nextStep || null}, ${input.nextStepDate || null}::date, ${input.estAmount},
                  ${input.expectedCloseDate || null}::date, ${input.demoDate || null}::date)
          RETURNING id`;
        dealId = d.id;
      } else {
        dealId = input.id as string;
        const [before] = await tx<{ key: string }[]>`
          SELECT s.key FROM deals d JOIN pipeline_stages s ON s.id = d.stage_id WHERE d.id = ${dealId} FOR UPDATE OF d`;
        if (!before) throw new ForbiddenError();
      }

      await replaceLines(tx, dealId, input);

      // Stage and the rest of the fields in one UPDATE: the trigger checks the stage rules with the lines in place.
      const rows = await tx`
        UPDATE deals SET
          name = ${input.name}, contact_id = ${contactId}, company_id = ${companyId},
          owner_user_id = COALESCE(${wantedOwner}, owner_user_id),
          deal_type = ${input.kind}, parent_deal_id = ${input.parentDealId},
          next_step = ${input.nextStep || null}, next_step_date = ${input.nextStepDate || null}::date,
          est_amount = ${input.estAmount}, expected_close_date = ${input.expectedCloseDate || null}::date,
          demo_date = ${input.demoDate || null}::date,
          stage_id = (SELECT id FROM pipeline_stages WHERE key = ${input.stageKey}),
          lost_reason = ${lostReason}::lost_reason, competitor = ${competitor}, lost_note = ${lostNote},
          -- a stage change picks today as the close date unless one was typed; staying put keeps the old one
          closed_on = CASE
            WHEN ${closed} AND stage_id IS DISTINCT FROM (SELECT id FROM pipeline_stages WHERE key = ${input.stageKey})
              THEN ${input.paidDate || null}::date
            WHEN ${closed} THEN COALESCE(${input.paidDate || null}::date, closed_on)
            ELSE NULL END
        WHERE id = ${dealId} AND can_edit_deal(${actor.id}, id)
        RETURNING id`;
      if (rows.length === 0) throw new ForbiddenError();

      if (isNew) {
        await tx`
          INSERT INTO activities (type, deal_id, contact_id, user_id, metadata)
          VALUES ('system', ${dealId}, ${contactId}, ${actor.id}, ${tx.json({ action: "created", fromLead: !!input.fromLeadId })})`;
      }
      if (input.note) {
        await tx`
          INSERT INTO activities (type, deal_id, contact_id, user_id, body)
          VALUES ('note', ${dealId}, ${contactId}, ${actor.id}, ${input.note})`;
      }
      return { ok: true, id: dealId };
    });
  } catch (err) {
    const rule = stageRuleOf(err);
    if (rule) return { ok: false, rule };
    if (pgError(err)?.code === "23514" && /deals_parent_required/.test(pgError(err)?.message ?? "")) {
      throw new DealInputError("parent", "deal.parentRequired");
    }
    throw err;
  }
}

/** Replaces all product lines of a deal with the input's (the database recomputes deals.amount). */
async function replaceLines(tx: Tx, dealId: string, input: DealInput) {
  await tx`DELETE FROM deal_line_items WHERE deal_id = ${dealId}`;
  for (const l of input.lines) {
    const [p] = await tx`SELECT 1 FROM products WHERE id = ${l.productId} AND is_active`;
    if (!p) throw new DealInputError("lines", "deal.linesInvalid");
    await tx`
      INSERT INTO deal_line_items (deal_id, product_id, qty, unit_price)
      VALUES (${dealId}, ${l.productId}, ${l.qty}, ${l.unitPrice})`;
  }
}

/** Who may create a deal: an active rep, sales lead, CEO or admin (not marketing). */
async function assertCanCreate(actor: Actor) {
  const [u] = await sql`SELECT 1 FROM users WHERE id = ${actor.id} AND is_active AND role = ANY(${CAN_CREATE})`;
  if (!u) throw new ForbiddenError();
}
