import type { Role } from "@/lib/auth";
import { ForbiddenError } from "@/lib/authz";
import { sql } from "@/lib/db";
import { InvalidPhoneError } from "@/lib/ingest/errors";
import { normalizePhone } from "@/lib/ingest/phone";
import { graph, GraphError } from "./graph";
import { seal } from "./secretBox";
import { clearLineText } from "./texts";

// After Embedded Signup (Coexistence) in Pengaturan › WhatsApp: everything server to server.
// https://developers.facebook.com/docs/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider
// https://developers.facebook.com/docs/whatsapp/embedded-signup/custom-flows/onboarding-business-app-users
//   1. code → business token        GET  /oauth/access_token?client_id&client_secret&code (the code lives 30 s)
//   2. the WABA and the number       from the signup event, else debug_token / phone_numbers
//   3. the line, with the consent    wa_lines (mode coexistence, token encrypted)
//   4. webhooks for the WABA         POST /<WABA_ID>/subscribed_apps
//   5. contacts and history sync     POST /<PHONE_NUMBER_ID>/smb_app_data, sync_type smb_app_state_sync, then
//                                    history (once each, within 24 h of onboarding)
// The token never leaves the server: the result holds the line id only.

const MANAGE: Role[] = ["admin", "ceo"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const META_ID = /^\d{5,25}$/;

export function canManageWhatsApp(user: { role: Role }): boolean {
  return MANAGE.includes(user.role);
}

export type SetupErrorKey = "env" | "consent" | "owner" | "code" | "waba" | "phone" | "taken";
export class WhatsAppSetupError extends Error {
  constructor(readonly key: SetupErrorKey) {
    super(`WhatsApp setup: ${key}`);
    this.name = "WhatsAppSetupError";
  }
}

export type ConnectInput = {
  code: string;
  wabaId?: string | null;
  phoneNumberId?: string | null;
  ownerId: string;
  consentBy: string;
  consent: boolean;
};

export type ConnectResult = { lineId: string; synced: boolean };

/** True when the page can offer the button (the app id, configuration id and secret are set). */
export function signupConfigured(): boolean {
  return Boolean(process.env.META_APP_ID && process.env.META_ES_CONFIG_ID && process.env.META_APP_SECRET);
}

export async function connectLine(actor: { id: string; role: Role }, input: ConnectInput): Promise<ConnectResult> {
  if (!canManageWhatsApp(actor)) throw new ForbiddenError();
  const consentBy = (input.consentBy ?? "").trim();
  if (input.consent !== true || consentBy.length < 2 || consentBy.length > 120) throw new WhatsAppSetupError("consent");
  if (!UUID.test(input.ownerId ?? "")) throw new WhatsAppSetupError("owner");
  const [owner] = await sql<{ id: string; full_name: string }[]>`
    SELECT id, full_name FROM users
     WHERE id = ${input.ownerId} AND is_active AND role IN ('sales_rep', 'sales_lead', 'ceo', 'admin')`;
  if (!owner) throw new WhatsAppSetupError("owner");
  if (typeof input.code !== "string" || !input.code || input.code.length > 4000) throw new WhatsAppSetupError("code");
  for (const id of [input.wabaId, input.phoneNumberId]) if (id && !META_ID.test(id)) throw new WhatsAppSetupError("waba");

  const appId = process.env.META_APP_ID;
  const secret = process.env.META_APP_SECRET;
  if (!appId || !secret) throw new WhatsAppSetupError("env");

  // 1. The business token (server to server; the code expires 30 s after the signup finished).
  const { access_token: token } = await graph<{ access_token?: string }>("token", "oauth/access_token", {
    query: { client_id: appId, client_secret: secret, code: input.code },
  });
  if (!token) throw new WhatsAppSetupError("code");

  // 2. Which WhatsApp account and number were shared.
  const wabaId = input.wabaId || (await wabaFromToken(token, appId, secret));
  if (!wabaId) throw new WhatsAppSetupError("waba");
  const number = input.phoneNumberId
    ? { id: input.phoneNumberId, ...(await graph<{ display_phone_number?: string }>("phone", input.phoneNumberId, {
        token, query: { fields: "display_phone_number" },
      })) }
    : (await graph<{ data?: { id: string; display_phone_number?: string }[] }>("phone", `${wabaId}/phone_numbers`, {
        token, query: { fields: "id,display_phone_number" },
      })).data?.[0];
  if (!number?.id || !number.display_phone_number) throw new WhatsAppSetupError("phone");
  let phone: string;
  try {
    phone = normalizePhone(number.display_phone_number);
  } catch (err) {
    if (err instanceof InvalidPhoneError) throw new WhatsAppSetupError("phone");
    throw err;
  }

  // 3. The line, with who agreed. Saved before the calls below, so the first webhooks find it.
  // A reconnect is a fresh start: the new consent replaces the old one, message text is off again and whatever was
  // kept under the old consent is deleted.
  const label = `No_${owner.full_name.split(" ")[0]}`;
  let lineId = "";
  try {
    await sql.begin(async (tx) => {
      [{ id: lineId }] = await tx<{ id: string }[]>`
        INSERT INTO wa_lines (user_id, phone_e164, label, mode, meta_waba_id, meta_phone_number_id, connected_at,
                              consent_at, consent_by, consent_recorded_by, meta_business_token_enc)
        VALUES (${owner.id}, ${phone}, ${label}, 'coexistence', ${wabaId}, ${number.id}, now(),
                now(), ${consentBy}, ${actor.id}, ${seal(token)})
        ON CONFLICT (phone_e164) DO UPDATE
           SET user_id = EXCLUDED.user_id, mode = 'coexistence', meta_waba_id = EXCLUDED.meta_waba_id,
               meta_phone_number_id = EXCLUDED.meta_phone_number_id, connected_at = now(), is_active = true,
               consent_at = now(), consent_by = EXCLUDED.consent_by, consent_recorded_by = EXCLUDED.consent_recorded_by,
               store_message_text = false, meta_business_token_enc = EXCLUDED.meta_business_token_enc,
               contacts_sync_request_id = NULL, history_sync_request_id = NULL
        RETURNING id`;
      await clearLineText(tx, lineId);
    });
  } catch (err) {
    // the Meta number id already belongs to another line
    if ((err as { code?: string }).code === "23505") throw new WhatsAppSetupError("taken");
    throw err;
  }

  // 4. Webhooks for this WhatsApp account.
  await graph("subscribe", `${wabaId}/subscribed_apps`, { method: "POST", token });

  // 5. Contacts, then chat history: each may run once per onboarding, within 24 hours.
  let synced = true;
  try {
    for (const syncType of ["smb_app_state_sync", "history"] as const) {
      const r = await graph<{ request_id?: string }>("sync", `${number.id}/smb_app_data`, {
        method: "POST", token, body: { messaging_product: "whatsapp", sync_type: syncType },
      });
      const requestId = r.request_id ?? "ok";
      if (syncType === "history") await sql`UPDATE wa_lines SET history_sync_request_id = ${requestId} WHERE id = ${lineId}`;
      else await sql`UPDATE wa_lines SET contacts_sync_request_id = ${requestId} WHERE id = ${lineId}`;
    }
  } catch (err) {
    if (!(err instanceof GraphError)) throw err;
    console.warn("whatsapp onboarding: sync request failed", { step: err.step, status: err.status, code: err.code });
    synced = false;
  }
  return { lineId, synced };
}

/** The WABA the business shared, from the token's granular scopes (when the signup event did not say). */
async function wabaFromToken(token: string, appId: string, secret: string): Promise<string | null> {
  const r = await graph<{ data?: { granular_scopes?: { scope: string; target_ids?: string[] }[] } }>("debug", "debug_token", {
    query: { input_token: token, access_token: `${appId}|${secret}` },
  });
  const scope = r.data?.granular_scopes?.find((s) => s.scope === "whatsapp_business_management");
  return scope?.target_ids?.[0] ?? null;
}
