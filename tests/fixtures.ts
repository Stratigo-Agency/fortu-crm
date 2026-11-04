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
}: {
  role?: Role;
  isActive?: boolean;
  email?: string;
  googleSub?: string | null;
  passwordHash?: string | null;
} = {}) {
  const [user] = await sql<{ id: string; email: string; role: Role }[]>`
    INSERT INTO users (full_name, email, role, is_active, google_sub, password_hash)
    VALUES (${`Uji ${role}`}, ${email}, ${role}, ${isActive}, ${googleSub}, ${passwordHash})
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
export async function createLead(ownerId: string | null) {
  const contact = await createContact();
  const [lead] = await sql<{ id: string }[]>`
    INSERT INTO leads (contact_id, source_channel, owner_user_id)
    VALUES (${contact.id}, 'whatsapp_direct', ${ownerId})
    RETURNING id`;
  return lead;
}
