import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { markContacted } from "@/lib/leads";
import { digits, SECRET, setupLine } from "./whatsappHelpers";

beforeAll(() => {
  process.env.META_APP_SECRET = SECRET;
  process.env.AUTH_SECRET ||= "uji-auth-secret";
});
afterEach(async () => {
  await sql`UPDATE app_settings SET value = '5' WHERE key = 'wa_auto_reply_seconds'`;
});

/** A webhook lead received `agoMin` minutes ago, with the rep's messages `repliesAfterSec` seconds after it. */
async function webhookLead(rep: { id: string }, lineId: string, agoMin: number, repliesAfterSec: number[]) {
  const [c] = await sql`INSERT INTO contacts (phone_e164) VALUES (${`+62812${digits(8)}`}) RETURNING id`;
  const [l] = await sql`
    INSERT INTO leads (contact_id, owner_user_id, wa_line_id, source_channel, capture_method, received_at)
    VALUES (${c.id}, ${rep.id}, ${lineId}, 'whatsapp_direct', 'cloud_api_webhook', now() - make_interval(mins => ${agoMin}))
    RETURNING id, received_at`;
  for (const s of repliesAfterSec) {
    await sql`
      INSERT INTO wa_messages (wa_line_id, wa_message_id, direction, source, msg_type, sent_at, contact_id)
      VALUES (${lineId}, ${`wamid.${randomUUID()}`}, 'out', 'echo', 'text',
              ${l.received_at}::timestamptz + make_interval(secs => ${s}), ${c.id})`;
  }
  return { id: l.id as string, receivedAt: l.received_at as Date };
}

const firstReplyAfterMs = async (lead: { id: string; receivedAt: Date }) => {
  const [r] = await sql`SELECT first_reply_at FROM v_wa_lead_first_reply WHERE lead_id = ${lead.id}`;
  return r.first_reply_at === null ? null : (r.first_reply_at as Date).getTime() - lead.receivedAt.getTime();
};

describe("v_wa_response_times", () => {
  it("median first reply, shares within 15 min and 1 h, and chats unanswered over 2 h, per rep, from wa_messages", async () => {
    const { rep, lineId } = await setupLine();
    await webhookLead(rep, lineId, 600, [10 * 60, 20 * 60]);
    await webhookLead(rep, lineId, 500, [30 * 60]);
    await webhookLead(rep, lineId, 400, [90 * 60]);
    await webhookLead(rep, lineId, 300, []); // unanswered for 5 h
    await webhookLead(rep, lineId, 5, []); // too fresh to count against 15 min
    const [row] = await sql`SELECT * FROM v_wa_response_times WHERE owner_user_id = ${rep.id}`;
    expect(row).toMatchObject({ leads: 5, answered: 3, pct_within_15m: 25, pct_within_1h: 50, unanswered_over_2h: 1 });
    expect(Number(row.median_first_response_min)).toBe(30);
  });

  it("the Sudah dihubungi click is not a reply", async () => {
    const { rep, lineId } = await setupLine();
    const lead = await webhookLead(rep, lineId, 300, []);
    await markContacted({ id: rep.id, role: "sales_rep" }, lead.id);
    const [{ first_response_at }] = await sql`SELECT first_response_at FROM leads WHERE id = ${lead.id}`;
    expect(first_response_at).not.toBeNull();
    expect(await firstReplyAfterMs(lead)).toBeNull();
    const [row] = await sql`SELECT answered FROM v_wa_response_times WHERE owner_user_id = ${rep.id}`;
    expect(row.answered).toBe(0);
  });

  it("ignores likely greeting or away messages a few seconds after the customer's message (configurable)", async () => {
    const { rep, lineId } = await setupLine();
    const lead = await webhookLead(rep, lineId, 120, [2, 600]);
    expect(await firstReplyAfterMs(lead)).toBe(600_000);
    await sql`UPDATE app_settings SET value = '0' WHERE key = 'wa_auto_reply_seconds'`;
    expect(await firstReplyAfterMs(lead)).toBe(2_000);
  });
});
