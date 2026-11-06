import type { Role } from "@/lib/auth";
import { ForbiddenError } from "@/lib/authz";
import { sql } from "@/lib/db";
import { graph, GraphError } from "./graph";
import { canManageWhatsApp } from "./onboard";
import { open } from "./secretBox";
import { clearLineText } from "./texts";

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
    // text can only be switched on for a line with consent
    const [line] = await tx<{ consent_at: Date | null }[]>`SELECT consent_at FROM wa_lines WHERE id = ${id} FOR UPDATE`;
    if (!line) throw new ForbiddenError();
    await tx`UPDATE wa_lines SET store_message_text = ${on && line.consent_at !== null} WHERE id = ${id}`;
    if (!on) await clearLineText(tx, id);
  });
}

export type RevokeResult = { unsubscribed: boolean };

/**
 * The rep withdrew consent. First the app is unsubscribed from the rep's WhatsApp account (Meta stops sending
 * webhooks), then the line goes back to business_app: consent, the text setting, kept text and the token are
 * cleared. When Meta cannot be reached the line is still switched off here, and the webhook drops anything that
 * still comes for it (no consent: nothing is stored).
 */
export async function revokeConsent(actor: { id: string; role: Role }, form: FormData): Promise<RevokeResult> {
  if (!canManageWhatsApp(actor)) throw new ForbiddenError();
  const id = lineIdOf(form);
  const [line] = await sql<{ meta_waba_id: string | null; meta_business_token_enc: string | null }[]>`
    SELECT meta_waba_id, meta_business_token_enc FROM wa_lines WHERE id = ${id}`;
  if (!line) throw new ForbiddenError();

  let unsubscribed = !line.meta_waba_id; // nothing to unsubscribe
  if (line.meta_waba_id && line.meta_business_token_enc) {
    try {
      await graph("unsubscribe", `${line.meta_waba_id}/subscribed_apps`, { method: "DELETE", token: open(line.meta_business_token_enc) });
      unsubscribed = true;
    } catch (err) {
      // a GraphError, a network failure, or a token that no longer opens (secret changed)
      const name = err instanceof GraphError ? `${err.step}:${err.status}:${err.code ?? ""}` : err instanceof Error ? err.name : "unknown";
      console.warn("whatsapp revoke: unsubscribe failed", { lineId: id, name });
    }
  }

  await sql.begin(async (tx) => {
    await tx`
      UPDATE wa_lines SET consent_at = NULL, consent_by = NULL, consent_recorded_by = ${actor.id},
                          store_message_text = false, meta_business_token_enc = NULL, mode = 'business_app'
       WHERE id = ${id}`;
    await clearLineText(tx, id);
  });
  return { unsubscribed };
}
