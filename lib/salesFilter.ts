import { cookies } from "next/headers";
import { sql } from "@/lib/db";

// "Semua sales" or one rep, chosen in the top bar and applied by every list and report.
// Anyone may pick any rep: this only filters what they view (view all, edit own).

export const SALES_COOKIE = "crm_sales";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The owner id a cookie value stands for, or null for all sales (also for unknown or inactive users). */
export async function resolveSalesFilter(value: string | null | undefined): Promise<string | null> {
  if (!value || value === "all" || !UUID.test(value)) return null;
  const [row] = await sql<{ id: string }[]>`SELECT id FROM users WHERE id = ${value} AND is_active`;
  return row?.id ?? null;
}

/** Effective owner id for queries on this request: null = all sales. */
export async function getSalesFilter(): Promise<string | null> {
  const store = await cookies();
  return resolveSalesFilter(store.get(SALES_COOKIE)?.value);
}

export type SalesOption = { id: string; full_name: string };

/** The reps shown in the filter: active sales_rep and sales_lead users. */
export async function salesOptions(): Promise<SalesOption[]> {
  return sql<SalesOption[]>`
    SELECT id, full_name FROM users
     WHERE is_active AND role IN ('sales_rep', 'sales_lead')
     ORDER BY full_name`;
}
