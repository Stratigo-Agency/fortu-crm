import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";

// Rows in fortu_test. Every call makes unique values, so tests don't collide.

export type Role = "admin" | "ceo" | "sales_lead" | "sales_rep" | "marketing";

export async function createUser({
  role = "sales_rep",
  isActive = true,
  email = `user-${randomUUID()}@example.com`,
  googleSub = null,
}: { role?: Role; isActive?: boolean; email?: string; googleSub?: string | null } = {}) {
  const [user] = await sql<{ id: string; email: string }[]>`
    INSERT INTO users (full_name, email, role, is_active, google_sub)
    VALUES (${`Uji ${role}`}, ${email}, ${role}, ${isActive}, ${googleSub})
    RETURNING id, email`;
  return user;
}
