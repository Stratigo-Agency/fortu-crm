import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "@/lib/db";
import { processWebhookEvent } from "@/lib/whatsapp/process";
import { retryInbound } from "@/lib/whatsapp/retry";
import { MAX_ATTEMPTS } from "@/lib/whatsapp/retry";
import { fixture, leadsOf, post, SECRET, setupLine, vars } from "./whatsappHelpers";

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

  it("the live request and the retry job never process the same event twice at once", async () => {
    const { phoneNumberId } = await setupLine();
    const v = vars({ PHONE_NUMBER_ID: phoneNumberId });
    const [ev] = await sql`
      INSERT INTO inbound_events (provider, external_id, payload, received_at)
      VALUES ('whatsapp_webhook', ${randomUUID()}, ${sql.json(JSON.parse(fixture("message-text", v)))}, now() - interval '3 minutes')
      RETURNING id`;
    const [a, , b] = await Promise.all([processWebhookEvent(ev.id), retryInbound(), processWebhookEvent(ev.id)]);
    expect([a.status, b.status].filter((s) => s === "processed").length).toBeLessThanOrEqual(1);
    // one claim, one run: the retry job may count other old events of parallel test files, so the row is the proof
    const [row] = await sql`SELECT attempts, processed_at, claimed_at FROM inbound_events WHERE id = ${ev.id}`;
    expect(row.attempts).toBe(1);
    expect(row.processed_at).not.toBeNull();
    expect(await leadsOf(`+${v.WA_ID}`)).toHaveLength(1);
  });

  it("a claim is respected for 5 minutes, then taken as abandoned", async () => {
    const { phoneNumberId } = await setupLine();
    const v = vars({ PHONE_NUMBER_ID: phoneNumberId });
    const [ev] = await sql`
      INSERT INTO inbound_events (provider, external_id, payload, received_at, claimed_at)
      VALUES ('whatsapp_webhook', ${randomUUID()}, ${sql.json(JSON.parse(fixture("message-text", v)))}, now() - interval '10 minutes', now() - interval '1 minute')
      RETURNING id`;
    expect((await processWebhookEvent(ev.id)).status).toBe("skipped");
    await sql`UPDATE inbound_events SET claimed_at = now() - interval '6 minutes' WHERE id = ${ev.id}`;
    expect((await processWebhookEvent(ev.id)).status).toBe("processed");
  });

  it("a poison event fails without keeping any message text or name, and stops after the last attempt", async () => {
    const { phoneNumberId } = await setupLine({ storeText: true });
    // a timestamp a day ahead: ingestLead refuses times in the future, every time
    const v = vars({ PHONE_NUMBER_ID: phoneNumberId, TS: String(Math.floor(Date.now() / 1000) + 86_400) });
    await post(fixture("message-text", v));
    const [ev] = await sql`
      SELECT id, payload::text AS p, error, attempts, processed_at, claimed_at FROM inbound_events
       WHERE provider = 'whatsapp_webhook' AND payload::text LIKE ${`%${v.MSG_ID}%`}`;
    expect(ev).toMatchObject({ error: "InvalidTimeError", attempts: 1, processed_at: null, claimed_at: null });
    expect(ev.p).not.toContain("harga IFP");
    expect(ev.p).not.toContain("Sheena");
    await sql`UPDATE inbound_events SET received_at = now() - interval '3 minutes' WHERE id = ${ev.id}`;
    for (let i = 1; i < MAX_ATTEMPTS + 2; i++) await retryInbound();
    const [after] = await sql`SELECT payload::text AS p, attempts, processed_at FROM inbound_events WHERE id = ${ev.id}`;
    expect(after.attempts).toBe(MAX_ATTEMPTS);
    expect(after.processed_at).toBeNull();
    expect(after.p).not.toContain("harga IFP");
  });
});
