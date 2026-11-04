import type postgres from "postgres";
import { sql } from "@/lib/db";
import { parseCodes } from "./codes";
import { MissingActorError, UnknownLineError } from "./errors";
import {
  type CaptureMethod,
  findOwnerConflict,
  type OwnerConflict,
  type ProductInterest,
  recordOwnership,
  resolveOwner,
  type Tx,
} from "./owner";
import { normalizePhone } from "./phone";

// The one way a lead enters the CRM (CLAUDE.md rule 2, docs/INTEGRATIONS.md · One ingestion function).
// Quick-add, the web-form route, /go/wa matching and the WhatsApp webhook all call this.

export type SourceChannel =
  | "meta_ctwa" | "meta_leadform" | "website_form" | "website_wa_link" | "google_ads"
  | "instagram_dm" | "whatsapp_direct" | "referral" | "event" | "other"
  | "partner_si" | "repeat_order" | "tender" | "walk_in";

export type LeadInput = {
  phone: string; // any format; normalised to E.164
  name?: string;
  company?: string;
  sourceChannel: SourceChannel;
  captureMethod: CaptureMethod;
  waLineId?: string; // quick-add: the rep's own line (defaults to the logging rep's line)
  firstMessage?: string; // scanned for [F-IFP-01] and #W7K2 codes
  productInterest?: ProductInterest;
  utm?: Partial<Record<"source" | "medium" | "campaign" | "content", string>>;
  receivedAt?: string; // ISO 8601; defaults to now
  external?: { provider: "whatsapp" | "web_form"; id: string; payload: unknown };
};

export type LeadResult = {
  leadId: string;
  contactId: string;
  /** null when no rep was available: the lead is unowned and anyone may pick it up. */
  ownerId: string | null;
  deduped: boolean;
  adId?: string;
  ownerConflict?: OwnerConflict;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (s: string | undefined) => s?.trim() || null;

type Line = { id: string; user_id: string | null };
type Utm = { source: string | null; medium: string | null; campaign: string | null; content: string | null };

export async function ingestLead(input: LeadInput, opts: { actorId?: string } = {}): Promise<LeadResult> {
  const phone = normalizePhone(input.phone); // step 2, checked before anything is written
  const actorId = opts.actorId ?? null;
  if (input.captureMethod === "manual_quick_add" && !actorId) throw new MissingActorError();
  if (input.waLineId && !UUID.test(input.waLineId)) throw new UnknownLineError(input.waLineId);
  const receivedAt = input.receivedAt ?? null;

  return sql.begin(async (tx) => {
    // 1. Idempotency: a retried delivery returns the lead it made the first time.
    let eventId: string | null = null;
    if (input.external) {
      const inserted = await tx<{ id: string }[]>`
        INSERT INTO inbound_events (provider, external_id, payload)
        VALUES (${input.external.provider}, ${input.external.id},
                ${tx.json((input.external.payload ?? {}) as postgres.JSONValue)})
        ON CONFLICT (provider, external_id) DO NOTHING
        RETURNING id`;
      if (inserted.length === 0) return replay(tx, input.external.provider, input.external.id);
      eventId = inserted[0].id;
    }

    const line = await findLine(tx, input, actorId);

    // 3. The contact, filling name and company only where empty.
    const [contact] = await tx<{ id: string; company_id: string | null }[]>`
      INSERT INTO contacts (phone_e164, full_name) VALUES (${phone}, ${clean(input.name)})
      ON CONFLICT (phone_e164) DO UPDATE SET full_name = COALESCE(contacts.full_name, EXCLUDED.full_name)
      RETURNING id, company_id`;
    // One ingestion per contact at a time, so two messages at once can't make two leads.
    await tx`SELECT pg_advisory_xact_lock(144, hashtext(${contact.id}))`;
    const company = clean(input.company);
    if (company && !contact.company_id) await attachCompany(tx, contact.id, company);

    // 5. Attribution codes in the first message.
    const codes = parseCodes(input.firstMessage);
    const [ad] = codes.adCode
      ? await tx<{ id: string; name: string }[]>`
          SELECT id, name FROM ads WHERE upper(prefill_code) = ${codes.adCode}`
      : [];
    const [click] = codes.clickCode
      ? await tx<{ id: string; utm_source: string | null; utm_medium: string | null;
                   utm_campaign: string | null; utm_content: string | null }[]>`
          SELECT id, utm_source, utm_medium, utm_campaign, utm_content
            FROM wa_click_events WHERE upper(ref_code) = ${codes.clickCode}`
      : [];
    const utm: Utm = {
      source: clean(input.utm?.source) ?? click?.utm_source ?? null,
      medium: clean(input.utm?.medium) ?? click?.utm_medium ?? null,
      campaign: clean(input.utm?.campaign) ?? click?.utm_campaign ?? null,
      content: clean(input.utm?.content) ?? click?.utm_content ?? null,
    };
    const metadata = {
      via: input.captureMethod,
      code: (ad && codes.adCode) ?? (click && codes.clickCode) ?? null,
      adName: ad?.name ?? null,
      ...(eventId && { inbound_event_id: eventId }),
    };

    // 6. Dedupe: a new lead from this contact on this line in the last 24 h gets an activity instead.
    const [recent] = await tx<{ id: string; owner_user_id: string | null; ad_id: string | null }[]>`
      SELECT id, owner_user_id, ad_id FROM leads
       WHERE contact_id = ${contact.id}
         AND status = 'new'
         AND wa_line_id IS NOT DISTINCT FROM ${line?.id ?? null}
         AND received_at > COALESCE(${receivedAt}::timestamptz, now()) - interval '24 hours'
       ORDER BY received_at DESC
       LIMIT 1
       FOR UPDATE`;
    if (recent) {
      await tx`
        UPDATE leads SET ad_id        = COALESCE(ad_id, ${ad?.id ?? null}),
                         utm_source   = COALESCE(utm_source, ${utm.source}),
                         utm_medium   = COALESCE(utm_medium, ${utm.medium}),
                         utm_campaign = COALESCE(utm_campaign, ${utm.campaign}),
                         utm_content  = COALESCE(utm_content, ${utm.content})
         WHERE id = ${recent.id}`;
      if (click) await matchClick(tx, click.id, recent.id);
      await addActivity(tx, contact.id, recent.id, actorId, { ...metadata, deduped: true });
      if (eventId) await tx`UPDATE inbound_events SET processed_at = now() WHERE id = ${eventId}`;
      const conflict = await findOwnerConflict(tx, contact.id, recent.owner_user_id);
      const adId = recent.ad_id ?? ad?.id;
      return {
        leadId: recent.id,
        contactId: contact.id,
        ownerId: recent.owner_user_id,
        deduped: true,
        ...(adId && { adId }),
        ...(conflict && { ownerConflict: conflict }),
      };
    }

    // 4. The owner (only for a new lead).
    const decision = await resolveOwner(
      tx,
      { captureMethod: input.captureMethod, lineUserId: line?.user_id, productInterest: input.productInterest },
      contact.id,
      actorId ?? undefined,
    );

    // 7. The lead, its ownership record and a system activity.
    const [lead] = await tx<{ id: string }[]>`
      INSERT INTO leads (contact_id, owner_user_id, wa_line_id, source_channel, capture_method,
                         product_interest, ad_id, utm_source, utm_medium, utm_campaign, utm_content,
                         first_message, inbound_event_id, received_at)
      VALUES (${contact.id}, ${decision.ownerId}, ${line?.id ?? null}, ${input.sourceChannel},
              ${input.captureMethod}, ${input.productInterest ?? null}, ${ad?.id ?? null},
              ${utm.source}, ${utm.medium}, ${utm.campaign}, ${utm.content},
              ${clean(input.firstMessage)}, ${eventId}, COALESCE(${receivedAt}::timestamptz, now()))
      RETURNING id`;
    await recordOwnership(tx, lead.id, decision, actorId ?? undefined);
    if (click) await matchClick(tx, click.id, lead.id);
    await tx`UPDATE contacts SET first_lead_id = ${lead.id} WHERE id = ${contact.id} AND first_lead_id IS NULL`;
    await addActivity(tx, contact.id, lead.id, actorId, metadata);
    if (eventId) await tx`UPDATE inbound_events SET processed_at = now() WHERE id = ${eventId}`;

    return {
      leadId: lead.id,
      contactId: contact.id,
      ownerId: decision.ownerId,
      deduped: false,
      ...(ad && { adId: ad.id }),
      ...(decision.conflict && { ownerConflict: decision.conflict }),
    };
  });
}

/** The WhatsApp line: the one given, or for quick-add the logging rep's own active line. */
async function findLine(tx: Tx, input: LeadInput, actorId: string | null): Promise<Line | undefined> {
  if (input.waLineId) {
    const [line] = await tx<Line[]>`
      SELECT id, user_id FROM wa_lines WHERE id = ${input.waLineId} AND is_active`;
    if (!line) throw new UnknownLineError(input.waLineId);
    return line;
  }
  if (input.captureMethod === "manual_quick_add" && actorId) {
    const [line] = await tx<Line[]>`
      SELECT id, user_id FROM wa_lines WHERE user_id = ${actorId} AND is_active
       ORDER BY connected_at DESC NULLS LAST LIMIT 1`;
    return line;
  }
  return undefined;
}

/** Links the contact to a company with this name (any letter case), creating it if needed. */
async function attachCompany(tx: Tx, contactId: string, name: string) {
  const [existing] = await tx<{ id: string }[]>`
    SELECT id FROM companies WHERE lower(name) = lower(${name}) ORDER BY created_at LIMIT 1`;
  const id = existing?.id ?? (await tx<{ id: string }[]>`
    INSERT INTO companies (name) VALUES (${name}) RETURNING id`)[0].id;
  await tx`UPDATE contacts SET company_id = ${id} WHERE id = ${contactId} AND company_id IS NULL`;
}

async function matchClick(tx: Tx, clickId: string, leadId: string) {
  await tx`UPDATE wa_click_events SET matched_lead_id = ${leadId} WHERE id = ${clickId} AND matched_lead_id IS NULL`;
}

async function addActivity(
  tx: Tx,
  contactId: string,
  leadId: string,
  actorId: string | null,
  metadata: Record<string, unknown>,
) {
  await tx`
    INSERT INTO activities (type, contact_id, lead_id, user_id, metadata)
    VALUES ('system', ${contactId}, ${leadId}, ${actorId}, ${tx.json(metadata as postgres.JSONValue)})`;
}

/** A retried delivery: the lead the first delivery made or was deduped into. */
async function replay(tx: Tx, provider: string, externalId: string): Promise<LeadResult> {
  const [row] = await tx<{ id: string; contact_id: string; owner_user_id: string | null; ad_id: string | null }[]>`
    SELECT l.id, l.contact_id, l.owner_user_id, l.ad_id
      FROM inbound_events e
      JOIN leads l ON l.inbound_event_id = e.id
                   OR l.id = (SELECT a.lead_id FROM activities a
                               WHERE a.metadata->>'inbound_event_id' = e.id::text LIMIT 1)
     WHERE e.provider = ${provider} AND e.external_id = ${externalId}
     LIMIT 1`;
  if (!row) throw new Error(`inbound event ${provider}/${externalId} has no lead`);
  return {
    leadId: row.id,
    contactId: row.contact_id,
    ownerId: row.owner_user_id,
    deduped: true,
    ...(row.ad_id && { adId: row.ad_id }),
  };
}
