import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "@/lib/db";
import { handleWebhookPost, signWebhook } from "@/lib/whatsapp/webhook";
import { createUser } from "./fixtures";

// Shared by the WhatsApp tests: recorded payloads from Meta's webhook reference (tests/fixtures/whatsapp-*.json)
// with fresh ids, a signed POST, and a line in each mode.

export const SECRET = "uji-rahasia-aplikasi-meta";
export const URL_ = "http://localhost/api/v1/webhooks/whatsapp";

export const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");
export const ip = () => `10.${digits(2)}.${digits(2)}.${digits(2)}`;

export type Vars = { PHONE_NUMBER_ID: string; WA_ID: string; BSUID: string; MSG_ID: string; TS: string; WABA_ID: string; AD_ID: string };
export function vars(o: Partial<Vars> = {}): Vars {
  return {
    PHONE_NUMBER_ID: digits(15), WA_ID: `62812${digits(8)}`, BSUID: `ID.${digits(19)}`, MSG_ID: `wamid.${randomUUID()}`,
    TS: String(Math.floor(Date.now() / 1000) - 60), WABA_ID: digits(15), AD_ID: digits(17), ...o,
  };
}
/** A recorded payload from Meta's webhook reference (tests/fixtures/whatsapp-*.json) with fresh ids. */
export function fixture(name: string, v: Vars): string {
  let s = readFileSync(`tests/fixtures/whatsapp-${name}.json`, "utf8");
  for (const [k, val] of Object.entries(v)) s = s.replaceAll(`{{${k}}}`, val);
  return JSON.stringify(JSON.parse(s));
}

/** A signed POST; the processing scheduled after the response runs before this returns (unless process: false). */
export async function post(body: string, o: { signature?: string | null; process?: boolean } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": ip() };
  const signature = o.signature === undefined ? signWebhook(SECRET, body) : o.signature;
  if (signature) headers["x-hub-signature-256"] = signature;
  const tasks: Promise<unknown>[] = [];
  const res = await handleWebhookPost(new Request(URL_, { method: "POST", body, headers }), {
    schedule: (task) => {
      if (o.process !== false) tasks.push(task());
    },
  });
  await Promise.all(tasks);
  return res;
}

export async function setupLine(o: { mode?: string; consent?: boolean; storeText?: boolean; active?: boolean } = {}) {
  const rep = await createUser({ role: "sales_rep" });
  const phoneNumberId = digits(15);
  const [line] = await sql<{ id: string }[]>`
    INSERT INTO wa_lines (user_id, phone_e164, label, mode, meta_waba_id, meta_phone_number_id, connected_at,
                          consent_at, consent_by, store_message_text, is_active)
    VALUES (${rep.id}, ${`+62811${digits(8)}`}, 'No_Uji', ${o.mode ?? "coexistence"}, ${digits(15)}, ${phoneNumberId}, now(),
            ${o.consent === false ? null : new Date()}, ${o.consent === false ? null : "Rudi Hartono"},
            ${o.storeText ?? false}, ${o.active ?? true})
    RETURNING id`;
  return { rep, lineId: line.id, phoneNumberId };
}

export const leadsOf = (phoneE164: string) => sql<{
  id: string; owner_user_id: string | null; wa_line_id: string | null; source_channel: string; capture_method: string;
  ad_id: string | null; ctwa_clid: string | null; first_message: string | null; first_response_at: Date | null; received_at: Date;
}[]>`
  SELECT l.* FROM leads l JOIN contacts c ON c.id = l.contact_id WHERE c.phone_e164 = ${phoneE164} ORDER BY l.received_at`;

