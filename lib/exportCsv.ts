import { sql } from "@/lib/db";

// CSV for Excel and Numbers: UTF-8 with a BOM, ";" between columns (Indonesian Excel's default),
// Rupiah and counts as plain integers (no "Rp", no dots) so they stay numbers, dates as YYYY-MM-DD.

export type Cell = string | number | null | undefined;

const BOM = "﻿";

/** One field: quoted when it has ; " or a line break; text that starts like a formula is made harmless. */
export function csvField(v: Cell): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  let s = v;
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = `'${s}`;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: Cell[][]): string {
  return BOM + [header, ...rows].map((r) => r.map(csvField).join(";")).join("\r\n") + "\r\n";
}

type Row = Record<string, Cell | Date>;
const day = (v: Cell | Date) => (v instanceof Date ? v.toISOString().slice(0, 10) : (v as string | null));
/** +6281234567890 → 6281234567890: digits only, so no leading + that a spreadsheet would read as a formula. */
const phone = (v: Cell | Date) => (typeof v === "string" ? v.replace(/\D/g, "") : null);
const int = (v: Cell | Date) => (v === null || v === undefined ? null : Math.round(Number(v)));

export async function dealsCsv(): Promise<string> {
  const rows = await sql<Row[]>`
    SELECT d.id, d.name, d.stage_name, u.full_name AS owner, co.name AS company, c.full_name AS contact, c.phone_e164 AS phone,
           d.amount, d.weighted_amount, d.screen_units, d.expected_close_date::text AS expected_close, d.closed_on::text AS closed_on,
           d.next_step, d.next_step_date::text AS next_step_date, d.lost_reason::text AS lost_reason,
           (d.created_at AT TIME ZONE 'Asia/Jakarta')::date::text AS created
      FROM v_deals_enriched d
      LEFT JOIN users u ON u.id = d.owner_user_id
      LEFT JOIN companies co ON co.id = d.company_id
      LEFT JOIN contacts c ON c.id = d.contact_id
     ORDER BY d.created_at DESC, d.id`;
  return toCsv(
    ["id", "deal", "tahap", "sales", "perusahaan", "kontak", "no_whatsapp", "nilai_rp", "perkiraan_rp", "unit_layar", "perkiraan_close", "tanggal_close", "next_step", "tanggal_next_step", "alasan_lost", "dibuat"],
    rows.map((r) => [r.id as string, r.name as string, r.stage_name as string, r.owner as string, r.company as string, r.contact as string, phone(r.phone),
      int(r.amount), int(r.weighted_amount), int(r.screen_units), day(r.expected_close), day(r.closed_on), r.next_step as string, day(r.next_step_date), r.lost_reason as string, day(r.created)]),
  );
}

export async function contactsCsv(): Promise<string> {
  const rows = await sql<Row[]>`
    SELECT id, full_name, job_title, email, phone_e164, company_name, source_channel::text AS source, owner_name,
           (first_chat_at AT TIME ZONE 'Asia/Jakarta')::date::text AS first_chat, (last_chat_at AT TIME ZONE 'Asia/Jakarta')::date::text AS last_chat,
           open_deals, needs_followup
      FROM v_contacts_enriched ORDER BY last_chat_at DESC NULLS LAST, id`;
  return toCsv(
    ["id", "nama", "jabatan", "email", "no_whatsapp", "perusahaan", "sumber", "sales", "chat_pertama", "chat_terakhir", "deal_berjalan", "perlu_followup"],
    rows.map((r) => [r.id as string, r.full_name as string, r.job_title as string, r.email as string, phone(r.phone_e164), r.company_name as string,
      r.source as string, r.owner_name as string, day(r.first_chat), day(r.last_chat), int(r.open_deals), r.needs_followup ? "ya" : "tidak"]),
  );
}
