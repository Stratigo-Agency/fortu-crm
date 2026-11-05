import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";

// Rows in fortu_test. Every call makes unique values, so tests don't collide.

export type Role = "admin" | "ceo" | "sales_lead" | "sales_rep" | "marketing";

export async function createUser({
  role = "sales_rep",
  isActive = true,
  email = `user-${randomUUID()}@example.com`,
  googleSub = null,
  passwordHash = null,
  fullName = `Uji ${role}`,
  acceptingLeads = true,
  productLines = [],
}: {
  role?: Role;
  isActive?: boolean;
  email?: string;
  googleSub?: string | null;
  passwordHash?: string | null;
  fullName?: string;
  acceptingLeads?: boolean;
  productLines?: string[];
} = {}) {
  const [user] = await sql<{ id: string; email: string; role: Role }[]>`
    INSERT INTO users (full_name, email, role, is_active, google_sub, password_hash, accepting_leads, product_lines)
    VALUES (${fullName}, ${email}, ${role}, ${isActive}, ${googleSub}, ${passwordHash}, ${acceptingLeads},
            ${productLines}::product_line[])
    RETURNING id, email, role`;
  return user;
}

export async function createContact() {
  const phone = `+628${String(Math.floor(Math.random() * 1e10)).padStart(10, "0")}`;
  const [contact] = await sql<{ id: string }[]>`
    INSERT INTO contacts (phone_e164) VALUES (${phone}) RETURNING id`;
  return contact;
}

/** An open deal at stage chat, with the next step the stage rules require. */
export async function createDeal(ownerId: string) {
  const contact = await createContact();
  const [deal] = await sql<{ id: string }[]>`
    INSERT INTO deals (name, contact_id, owner_user_id, stage_id, next_step, next_step_date)
    SELECT 'Uji deal', ${contact.id}, ${ownerId}, id, 'Telepon', current_date
      FROM pipeline_stages WHERE key = 'chat'
    RETURNING id`;
  return deal;
}

// Test fixture only: app code creates leads through ingestLead() (T04).
export async function createLead(
  ownerId: string | null,
  o: {
    status?: string;
    receivedAt?: string;
    loggedAt?: string;
    message?: string;
    name?: string;
    source?: string;
    adId?: string;
    product?: string;
  } = {},
) {
  const contact = await createContact();
  if (o.name) await sql`UPDATE contacts SET full_name = ${o.name} WHERE id = ${contact.id}`;
  const [lead] = await sql<{ id: string }[]>`
    INSERT INTO leads (contact_id, owner_user_id, source_channel, status, first_message, ad_id,
                       product_interest, received_at, logged_at)
    VALUES (${contact.id}, ${ownerId}, ${o.source ?? "whatsapp_direct"}, ${o.status ?? "new"},
            ${o.message ?? null}, ${o.adId ?? null}, ${o.product ?? null},
            COALESCE(${o.receivedAt ?? null}::timestamptz, now()),
            COALESCE(${o.loggedAt ?? null}::timestamptz, ${o.receivedAt ?? null}::timestamptz, now()))
    RETURNING id`;
  return { ...lead, contactId: contact.id };
}

/** A random Indonesian mobile number written the way a rep would type it. */
export function randomPhone() {
  return `0812${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
}

/** An ad prefill code like "F-IFP-07" that no ad in the test database uses yet (tests share one database). */
export async function freeAdCode(prefix: string) {
  const [row] = await sql<{ code: string }[]>`
    SELECT ${prefix} || '-' || lpad(n::text, 2, '0') AS code
      FROM generate_series(1, 99) n
     WHERE NOT EXISTS (SELECT 1 FROM ads WHERE prefill_code = ${prefix} || '-' || lpad(n::text, 2, '0'))
     ORDER BY random() LIMIT 1`;
  return row.code;
}

/** An ad with a prefill code like "F-IFP-01", with the campaign and ad set it needs. */
export async function createAd(prefillCode: string, name = "Iklan IFP Sekolah") {
  const key = randomUUID();
  const [ad] = await sql<{ id: string }[]>`
    WITH c AS (INSERT INTO ad_campaigns (meta_campaign_id, name) VALUES (${`c-${key}`}, 'Kampanye uji') RETURNING id),
         s AS (INSERT INTO ad_sets (meta_adset_id, campaign_id, name) SELECT ${`s-${key}`}, id, 'Set uji' FROM c RETURNING id)
    INSERT INTO ads (meta_ad_id, ad_set_id, name, prefill_code)
    SELECT ${`a-${key}`}, id, ${name}, ${prefillCode} FROM s
    RETURNING id`;
  return ad;
}

/** A rep's WhatsApp Business line. */
export async function createWaLine(userId: string | null, isActive = true) {
  const phone = `+62813${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
  const [line] = await sql<{ id: string }[]>`
    INSERT INTO wa_lines (user_id, phone_e164, label, is_active)
    VALUES (${userId}, ${phone}, 'WA uji', ${isActive}) RETURNING id`;
  return line;
}

/** A tracked /go/wa click with a ref code. */
export async function createClick(refCode: string, utm: { source?: string; campaign?: string } = {}) {
  const [click] = await sql<{ id: string }[]>`
    INSERT INTO wa_click_events (ref_code, source_channel, utm_source, utm_campaign)
    VALUES (${refCode}, 'website_wa_link', ${utm.source ?? null}, ${utm.campaign ?? null}) RETURNING id`;
  return click;
}

/** An open deal (stage chat) of a contact, owned by a rep; lost = closed as Lost. */
export async function createDealFor(contactId: string, ownerId: string, { lost = false } = {}) {
  const [deal] = await sql<{ id: string }[]>`
    INSERT INTO deals (name, contact_id, owner_user_id, stage_id, next_step, next_step_date, est_amount)
    SELECT 'Uji deal', ${contactId}, ${ownerId}, id, 'Telepon', current_date, 1000000
      FROM pipeline_stages WHERE key = 'chat'
    RETURNING id`;
  if (lost) {
    await sql`
      UPDATE deals SET stage_id = (SELECT id FROM pipeline_stages WHERE key = 'lost'),
                       lost_reason = 'harga', closed_on = current_date
       WHERE id = ${deal.id}`;
  }
  return deal;
}

/** A product of its own (tests share one database and don't rely on the product seed). */
export async function createProduct({ line = "IFP", listPrice = 30_000_000 }: { line?: string; listPrice?: number } = {}) {
  const sku = `T${randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`;
  const [p] = await sql<{ id: string; sku: string }[]>`
    INSERT INTO products (sku, name, product_line, list_price)
    VALUES (${sku}, ${`Produk uji ${sku}`}, ${line}, ${listPrice}) RETURNING id, sku`;
  return p;
}

/** Adds a product line to a deal (qty × unit price). */
export async function addLineItem(dealId: string, { qty = 2, unitPrice = 25_000_000 }: { qty?: number; unitPrice?: number } = {}) {
  const p = await createProduct();
  await sql`INSERT INTO deal_line_items (deal_id, product_id, qty, unit_price) VALUES (${dealId}, ${p.id}, ${qty}, ${unitPrice})`;
  return p;
}

/** A deal ready for Quotation: products and an expected close date. */
export async function createQuotableDeal(ownerId: string) {
  const contact = await createContact();
  const deal = await createDealFor(contact.id, ownerId);
  await addLineItem(deal.id);
  await sql`UPDATE deals SET expected_close_date = current_date + 30 WHERE id = ${deal.id}`;
  return deal;
}
