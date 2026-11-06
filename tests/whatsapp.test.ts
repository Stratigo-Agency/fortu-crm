import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "@/lib/db";
import { isPublicPath } from "@/lib/publicPaths";
import { lineGate } from "@/lib/whatsapp/process";
import { readMessageTexts } from "@/lib/whatsapp/texts";
import { handleVerify, signWebhook, verifyWebhookSignature } from "@/lib/whatsapp/webhook";
import { createAd, createUser } from "./fixtures";
import { digits, fixture, ip, leadsOf, post, SECRET, setupLine, URL_, vars } from "./whatsappHelpers";

beforeAll(() => {
  process.env.META_APP_SECRET = SECRET;
  process.env.META_VERIFY_TOKEN = "uji-verify-token";
  process.env.AUTH_SECRET ||= "uji-auth-secret";
});
afterEach(() => {
  vi.unstubAllGlobals();
  process.env.META_APP_SECRET = SECRET;
});

describe("signature and verification", () => {
  it("accepts Meta's sha256 HMAC of the raw body and nothing else", () => {
    const body = '{"object":"whatsapp_business_account"}';
    expect(verifyWebhookSignature(SECRET, signWebhook(SECRET, body), body)).toBe(true);
    expect(verifyWebhookSignature(SECRET, signWebhook("lain", body), body)).toBe(false);
    expect(verifyWebhookSignature(SECRET, signWebhook(SECRET, body), `${body} `)).toBe(false);
    expect(verifyWebhookSignature(SECRET, null, body)).toBe(false);
    expect(verifyWebhookSignature(SECRET, "sha256=zz", body)).toBe(false);
  });

  it("GET echoes hub.challenge only for the right verify token", async () => {
    const get = (q: string) => handleVerify(new Request(`${URL_}?${q}`, { headers: { "x-forwarded-for": ip() } }));
    const ok = get("hub.mode=subscribe&hub.verify_token=uji-verify-token&hub.challenge=1158201444");
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("1158201444");
    expect(get("hub.mode=subscribe&hub.verify_token=salah&hub.challenge=1").status).toBe(403);
    expect(get("hub.mode=unsubscribe&hub.verify_token=uji-verify-token&hub.challenge=1").status).toBe(403);
  });

  it("the webhook is public (Meta does not sign in)", () => {
    expect(isPublicPath("/api/v1/webhooks/whatsapp")).toBe(true);
    expect(isPublicPath("/api/v1/webhooks/other")).toBe(false);
  });
});

describe("POST /api/v1/webhooks/whatsapp", () => {
  it("a valid signed message from a new contact makes one lead for the line's owner, without keeping the text", async () => {
    const { rep, lineId, phoneNumberId } = await setupLine();
    const v = vars({ PHONE_NUMBER_ID: phoneNumberId });
    const res = await post(fixture("message-text", v));
    expect(res.status).toBe(200);

    const [lead] = await leadsOf(`+${v.WA_ID}`);
    expect(lead).toMatchObject({
      owner_user_id: rep.id, wa_line_id: lineId, source_channel: "whatsapp_direct", capture_method: "cloud_api_webhook",
      first_message: null, // store_message_text is off
    });
    expect(lead.received_at.toISOString()).toBe(new Date(Number(v.TS) * 1000).toISOString());
    const [contact] = await sql`SELECT full_name FROM contacts WHERE phone_e164 = ${`+${v.WA_ID}`}`;
    expect(contact.full_name).toBe("Sheena Nelson");

    const msgs = await sql`SELECT direction, source, msg_type, lead_id FROM wa_messages WHERE wa_message_id = ${v.MSG_ID}`;
    expect(msgs).toEqual([{ direction: "in", source: "messages", msg_type: "text", lead_id: lead.id }]);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM wa_message_texts t JOIN wa_messages m ON m.id = t.message_id WHERE m.wa_line_id = ${lineId}`;
    expect(n).toBe(0);
    // the stored events keep no text
    const events = await sql`SELECT payload::text AS p, processed_at FROM inbound_events WHERE payload::text LIKE ${`%${v.MSG_ID}%`}`;
    expect(events.length).toBeGreaterThanOrEqual(2); // the webhook and the message
    for (const e of events) {
      expect(e.p).not.toContain("harga IFP");
      expect(e.processed_at).not.toBeNull();
    }
    const [line] = await sql`SELECT last_event_at FROM wa_lines WHERE id = ${lineId}`;
    expect(line.last_event_at).not.toBeNull();
  });

  it("a bad or missing signature is refused with 401 and nothing is stored", async () => {
    const { phoneNumberId } = await setupLine();
    const v = vars({ PHONE_NUMBER_ID: phoneNumberId });
    const body = fixture("message-text", v);
    expect((await post(body, { signature: signWebhook("salah", body) })).status).toBe(401);
    expect((await post(body, { signature: null })).status).toBe(401);
    expect((await post(body, { signature: "sha256=abc" })).status).toBe(401);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM inbound_events WHERE payload::text LIKE ${`%${v.MSG_ID}%`}`;
    expect(n).toBe(0);
    expect(await leadsOf(`+${v.WA_ID}`)).toHaveLength(0);
  });

  it("the same message id twice (a retried delivery, even in a new envelope) is one lead", async () => {
    const { phoneNumberId } = await setupLine();
    const v = vars({ PHONE_NUMBER_ID: phoneNumberId });
    const body = fixture("message-text", v);
    expect((await post(body)).status).toBe(200);
    expect((await post(body)).status).toBe(200);
    const other = JSON.parse(body);
    other.entry[0].changes[0].value.contacts[0].profile.name = "Sheena N.";
    expect((await post(JSON.stringify(other))).status).toBe(200);
    expect(await leadsOf(`+${v.WA_ID}`)).toHaveLength(1);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM wa_messages WHERE wa_message_id = ${v.MSG_ID}`;
    expect(n).toBe(1);
  });

  it("a Click-to-WhatsApp referral maps source_id to the ad, and keeps the click id", async () => {
    const { phoneNumberId } = await setupLine();
    const ad = await createAd(null as unknown as string, "Iklan Smartboard");
    const [{ meta_ad_id }] = await sql`SELECT meta_ad_id FROM ads WHERE id = ${ad.id}`;
    const v = vars({ PHONE_NUMBER_ID: phoneNumberId, AD_ID: meta_ad_id });
    await post(fixture("message-referral", v));
    const [lead] = await leadsOf(`+${v.WA_ID}`);
    expect(lead).toMatchObject({ ad_id: ad.id, source_channel: "meta_ctwa" });
    expect(lead.ctwa_clid).toMatch(/^ARAk/);
  });

  it("an ad code in the prefilled text is still read", async () => {
    const { phoneNumberId } = await setupLine();
    const code = `Z-IFP-${digits(2)}`;
    await sql`DELETE FROM ads WHERE prefill_code = ${code}`.catch(() => {});
    const ad = await createAd(code);
    const v = vars({ PHONE_NUMBER_ID: phoneNumberId });
    const body = JSON.parse(fixture("message-text", v));
    body.entry[0].changes[0].value.messages[0].text.body = `Halo, saya mau info [${code}]`;
    await post(JSON.stringify(body));
    const [lead] = await leadsOf(`+${v.WA_ID}`);
    expect(lead).toMatchObject({ ad_id: ad.id, source_channel: "meta_ctwa", first_message: null });
  });

  it("a reply typed in the phone app (echo) sets first_response_at once", async () => {
    const { phoneNumberId } = await setupLine();
    const v = vars({ PHONE_NUMBER_ID: phoneNumberId, TS: String(Math.floor(Date.now() / 1000) - 600) });
    await post(fixture("message-text", v));
    const reply = vars({ ...v, MSG_ID: `wamid.${randomUUID()}`, TS: String(Number(v.TS) + 420) });
    await post(fixture("echo", reply));
    const later = vars({ ...v, MSG_ID: `wamid.${randomUUID()}`, TS: String(Number(v.TS) + 500) });
    await post(fixture("echo", later));
    const [lead] = await leadsOf(`+${v.WA_ID}`);
    expect(lead.first_response_at?.toISOString()).toBe(new Date(Number(reply.TS) * 1000).toISOString());
    const out = await sql`SELECT direction, source, lead_id FROM wa_messages WHERE wa_message_id = ${reply.MSG_ID}`;
    expect(out).toEqual([{ direction: "out", source: "echo", lead_id: lead.id }]);
  });

  it("a second message in the same conversation is metadata only, not a new lead", async () => {
    const { phoneNumberId } = await setupLine();
    const v = vars({ PHONE_NUMBER_ID: phoneNumberId });
    await post(fixture("message-text", v));
    await post(fixture("message-text", { ...v, MSG_ID: `wamid.${randomUUID()}`, TS: String(Number(v.TS) + 30) }));
    const leads = await leadsOf(`+${v.WA_ID}`);
    expect(leads).toHaveLength(1);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM wa_messages WHERE lead_id = ${leads[0].id}`;
    expect(n).toBe(2);
  });

  it("a line without consent, in business_app mode or unknown is not processed and keeps nothing", async () => {
    for (const o of [{ consent: false }, { mode: "business_app" }, { active: false }]) {
      const { phoneNumberId } = await setupLine(o);
      const v = vars({ PHONE_NUMBER_ID: phoneNumberId });
      expect((await post(fixture("message-text", v))).status).toBe(200);
      expect(await leadsOf(`+${v.WA_ID}`)).toHaveLength(0);
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM wa_messages WHERE wa_message_id = ${v.MSG_ID}`;
      expect(n).toBe(0);
      const [ev] = await sql`
        SELECT payload, processed_at FROM inbound_events
         WHERE provider = 'whatsapp_webhook' AND payload::text LIKE ${`%${phoneNumberId}%`}`;
      expect(ev.processed_at).not.toBeNull();
      expect(JSON.stringify(ev.payload)).not.toContain(v.WA_ID);
      expect(JSON.stringify(ev.payload)).not.toContain("Sheena");
    }
    expect(lineGate({ id: "x", user_id: null, mode: "cloud_api", consent_at: new Date(), store_message_text: false, is_active: true })).toBeNull();
  });

  it("keeps the text only when the line's setting is on, readable by the line owner, ceo and admin only", async () => {
    const { rep, phoneNumberId } = await setupLine({ storeText: true });
    const v = vars({ PHONE_NUMBER_ID: phoneNumberId });
    await post(fixture("message-text", v));
    const [lead] = await leadsOf(`+${v.WA_ID}`);
    expect(lead.first_message).toBe("Halo, harga IFP 75 inch berapa?");

    const other = await createUser({ role: "sales_rep" });
    const lead2 = await createUser({ role: "sales_lead" });
    const ceo = await createUser({ role: "ceo" });
    expect((await readMessageTexts(rep, lead.id)).map((m) => m.body)).toEqual(["Halo, harga IFP 75 inch berapa?"]);
    expect(await readMessageTexts(ceo, lead.id)).toHaveLength(1);
    expect(await readMessageTexts(other, lead.id)).toHaveLength(0);
    expect(await readMessageTexts(lead2, lead.id)).toHaveLength(0);
  });

  it("a BSUID-only message (no phone number) makes no lead until the user is known, then joins their contact", async () => {
    const { phoneNumberId } = await setupLine();
    const v = vars({ PHONE_NUMBER_ID: phoneNumberId });
    await post(fixture("bsuid-only", v));
    const [first] = await sql`SELECT contact_id, lead_id, peer_bsuid FROM wa_messages WHERE wa_message_id = ${v.MSG_ID}`;
    expect(first).toEqual({ contact_id: null, lead_id: null, peer_bsuid: v.BSUID });
    const [ev] = await sql`SELECT payload FROM inbound_events WHERE provider = 'whatsapp_webhook' AND payload::text LIKE ${`%${v.MSG_ID}%`}`;
    expect(ev.payload.crm.notes).toContain("no_phone");

    // the same user writes once with the number visible: from then on the BSUID finds the contact
    await post(fixture("message-text", { ...v, MSG_ID: `wamid.${randomUUID()}` }));
    const later = { ...v, MSG_ID: `wamid.${randomUUID()}`, TS: String(Number(v.TS) + 10) };
    await post(fixture("bsuid-only", later));
    const [lead] = await leadsOf(`+${v.WA_ID}`);
    const [m] = await sql`SELECT lead_id FROM wa_messages WHERE wa_message_id = ${later.MSG_ID}`;
    expect(m.lead_id).toBe(lead.id);
  });

  it("history from onboarding is metadata only, never leads", async () => {
    const { phoneNumberId } = await setupLine();
    const v = vars({ PHONE_NUMBER_ID: phoneNumberId });
    await post(fixture("history", v));
    expect(await leadsOf(`+${v.WA_ID}`)).toHaveLength(0);
    const rows = await sql`SELECT direction, source, msg_type FROM wa_messages WHERE wa_message_id LIKE ${`${v.MSG_ID}%`} ORDER BY wa_message_id`;
    expect(rows).toEqual([
      { direction: "in", source: "history", msg_type: "text" },
      { direction: "out", source: "history", msg_type: "media_placeholder" },
    ]);
    const [ev] = await sql`SELECT payload::text AS p FROM inbound_events WHERE provider = 'whatsapp_webhook' AND payload::text LIKE ${`%${v.MSG_ID}%`}`;
    expect(ev.p).not.toContain("penawaran");
  });

  it("delivery statuses are ignored", async () => {
    const { phoneNumberId } = await setupLine();
    const v = vars({ PHONE_NUMBER_ID: phoneNumberId });
    expect((await post(fixture("status", v))).status).toBe(200);
    expect(await leadsOf(`+${v.WA_ID}`)).toHaveLength(0);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM wa_messages WHERE wa_message_id = ${v.MSG_ID}`;
    expect(n).toBe(0);
  });

  it("a rep disconnecting in the phone app (PARTNER_REMOVED) switches the line off", async () => {
    const { lineId } = await setupLine();
    const [{ meta_waba_id }] = await sql`SELECT meta_waba_id FROM wa_lines WHERE id = ${lineId}`;
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ id: meta_waba_id, changes: [{ field: "account_update", value: { event: "PARTNER_REMOVED" } }] }],
    });
    await post(body);
    const [line] = await sql`SELECT mode FROM wa_lines WHERE id = ${lineId}`;
    expect(line.mode).toBe("business_app");
  });
});

