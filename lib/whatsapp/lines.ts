import type { Role } from "@/lib/auth";
import { ForbiddenError } from "@/lib/authz";
import { sql } from "@/lib/db";
import { canManageWhatsApp } from "./onboard";

// Pengaturan › WhatsApp: the lines, their consent and whether message text is kept. admin and ceo only.
// The business token is never selected here.

export type WaLineRow = {
  id: string;
  label: string;
  phone: string;
  ownerName: string | null;
  mode: "business_app" | "coexistence" | "cloud_api";
  consentAt: Date | null;
  consentBy: string | null;
  storeText: boolean;
  lastEventAt: Date | null;
  synced: boolean;
};

export async function getWaLines(): Promise<WaLineRow[]> {
  return sql<WaLineRow[]>`
    SELECT l.id, l.label, l.phone_e164 AS phone, u.full_name AS "ownerName", l.mode::text AS mode,
           l.consent_at AS "consentAt", l.consent_by AS "consentBy", l.store_message_text AS "storeText",
           l.last_event_at AS "lastEventAt", (l.history_sync_request_id IS NOT NULL) AS synced
      FROM wa_lines l LEFT JOIN users u ON u.id = l.user_id
     WHERE l.is_active
     ORDER BY u.full_name NULLS LAST, l.label`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function lineIdOf(form: FormData): string {
  const id = String(form.get("lineId") ?? "");
  if (!UUID.test(id)) throw new ForbiddenError();
  return id;
}

/** Keep message text for one line, or stop (deleting what was kept, so "off" means off). */
export async function saveLineText(actor: { id: string; role: Role }, form: FormData): Promise<void> {
  if (!canManageWhatsApp(actor)) throw new ForbiddenError();
  const id = lineIdOf(form);
  const on = form.get("storeText") === "on";
  await sql.begin(async (tx) => {
    await tx`UPDATE wa_lines SET store_message_text = ${on} WHERE id = ${id}`;
    if (!on) {
      await tx`DELETE FROM wa_message_texts t USING wa_messages m WHERE m.id = t.message_id AND m.wa_line_id = ${id}`;
    }
  });
}

/** The rep withdrew consent: nothing more is processed for the line, kept text is deleted, the token forgotten. */
export async function revokeConsent(actor: { id: string; role: Role }, form: FormData): Promise<void> {
  if (!canManageWhatsApp(actor)) throw new ForbiddenError();
  const id = lineIdOf(form);
  await sql.begin(async (tx) => {
    await tx`
      UPDATE wa_lines SET consent_at = NULL, consent_by = NULL, consent_recorded_by = ${actor.id},
                          store_message_text = false, meta_business_token_enc = NULL
       WHERE id = ${id}`;
    await tx`DELETE FROM wa_message_texts t USING wa_messages m WHERE m.id = t.message_id AND m.wa_line_id = ${id}`;
  });
}
