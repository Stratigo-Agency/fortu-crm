import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "@/lib/db";
import { processWebhookEvent } from "@/lib/whatsapp/process";
import { retryInbound } from "@/lib/whatsapp/retry";
import { fixture, leadsOf, SECRET, setupLine, vars } from "./whatsappHelpers";

beforeAll(() => {
  process.env.META_APP_SECRET = SECRET;
  process.env.META_VERIFY_TOKEN = "uji-verify-token";
  process.env.AUTH_SECRET ||= "uji-auth-secret";
});
afterEach(() => {
  vi.unstubAllGlobals();
  process.env.META_APP_SECRET = SECRET;
});

describe("retry job", () => {
  it("processes events left unprocessed for over 2 minutes, and leaves fresh ones alone", async () => {
    const { phoneNumberId } = await setupLine();
    const old = vars({ PHONE_NUMBER_ID: phoneNumberId });
    const fresh = vars({ PHONE_NUMBER_ID: phoneNumberId });
    for (const [v, ago] of [[old, "3 minutes"], [fresh, "30 seconds"]] as const) {
      await sql`
        INSERT INTO inbound_events (provider, external_id, payload, received_at)
        VALUES ('whatsapp_webhook', ${randomUUID()}, ${sql.json(JSON.parse(fixture("message-text", v)))}, now() - ${ago}::interval)`;
    }
    const counts = await retryInbound();
    expect(counts.processed).toBeGreaterThanOrEqual(1);
    expect(await leadsOf(`+${old.WA_ID}`)).toHaveLength(1);
    expect(await leadsOf(`+${fresh.WA_ID}`)).toHaveLength(0);
    // processing again is harmless
    const [ev] = await sql`SELECT id FROM inbound_events WHERE payload::text LIKE ${`%${old.MSG_ID}%`} AND provider = 'whatsapp_webhook'`;
    expect((await processWebhookEvent(ev.id)).status).toBe("skipped");
  });
});

