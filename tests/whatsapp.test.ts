import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "@/lib/db";
import { isPublicPath } from "@/lib/publicPaths";
import { leadTrace } from "@/lib/deal";
import { listProspects } from "@/lib/prospek";
import { redactValue, type WaValue } from "@/lib/whatsapp/payload";
import { lineGate, processWebhookEvent } from "@/lib/whatsapp/process";
import { firstChatTexts, readMessageTexts } from "@/lib/whatsapp/texts";
import { handleVerify, handleWebhookPost, signWebhook, verifyWebhookSignature } from "@/lib/whatsapp/webhook";
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

  it("a line without consent, in business_app mode or unknown is not processed and nothing is stored", async () => {
    for (const o of [{ consent: false }, { mode: "business_app" }, { active: false }]) {
      const { phoneNumberId } = await setupLine(o);
      const v = vars({ PHONE_NUMBER_ID: phoneNumberId });
      expect((await post(fixture("message-text", v))).status).toBe(200);
      expect(await leadsOf(`+${v.WA_ID}`)).toHaveLength(0);
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM wa_messages WHERE wa_message_id = ${v.MSG_ID}`;
      expect(n).toBe(0);
      const [{ e }] = await sql`
        SELECT count(*)::int AS e FROM inbound_events
         WHERE provider = 'whatsapp_webhook' AND payload::text LIKE ${`%${phoneNumberId}%`}`;
      expect(e).toBe(0);
    }
    expect(lineGate({ id: "x", user_id: null, mode: "cloud_api", consent_at: new Date(), store_message_text: false, is_active: true })).toBeNull();
  });

  it("keeps the text only when the line's setting is on, never in leads.first_message, readable by owner, ceo and admin only", async () => {
    const { rep, phoneNumberId } = await setupLine({ storeText: true });
    const v = vars({ PHONE_NUMBER_ID: phoneNumberId });
    await post(fixture("message-text", v));
    const [lead] = await leadsOf(`+${v.WA_ID}`);
    expect(lead.first_message).toBeNull(); // every user can read and search first_message
    const events = await sql`SELECT payload::text AS p FROM inbound_events WHERE payload::text LIKE ${`%${v.MSG_ID}%`}`;
    for (const e of events) expect(e.p).not.toContain("harga IFP");

    const other = await createUser({ role: "sales_rep" });
    const lead2 = await createUser({ role: "sales_lead" });
    const ceo = await createUser({ role: "ceo" });
    const admin = await createUser({ role: "admin" });
    expect((await readMessageTexts(rep, lead.id)).map((m) => m.body)).toEqual(["Halo, harga IFP 75 inch berapa?"]);
    expect(await readMessageTexts(ceo, lead.id)).toHaveLength(1);
    expect(await readMessageTexts(other, lead.id)).toHaveLength(0);
    expect(await readMessageTexts(lead2, lead.id)).toHaveLength(0);
    for (const [u, seen] of [[rep, true], [ceo, true], [admin, true], [other, false], [lead2, false]] as const) {
      expect((await firstChatTexts(u, [lead.id])).get(lead.id) ?? null).toBe(seen ? "Halo, harga IFP 75 inch berapa?" : null);
    }

    // Prospek and the deal show it to the owner only (and ceo/admin); nobody finds the lead by searching the text
    const list = async (viewerId: string, q = "") =>
      (await listProspects({ viewerId, ownerId: rep.id, tab: "semua", q, limit: 50 })).rows.find((r) => r.id === lead.id);
    expect((await list(rep.id))?.first_message).toBe("Halo, harga IFP 75 inch berapa?");
    expect((await list(ceo.id))?.first_message).toBe("Halo, harga IFP 75 inch berapa?");
    expect((await list(other.id))?.first_message).toBeNull();
    expect(await list(other.id, "harga IFP")).toBeUndefined();
    expect((await leadTrace(lead.id, rep.id))?.firstChat).toBe("Halo, harga IFP 75 inch berapa?");
    expect((await leadTrace(lead.id, lead2.id))?.firstChat).toBeNull();
  });

  it("a retried event (no text in memory) keeps metadata only, even on a line that keeps text", async () => {
    const { phoneNumberId } = await setupLine({ storeText: true });
    const v = vars({ PHONE_NUMBER_ID: phoneNumberId });
    const res = await post(fixture("message-text", v), { process: false });
    expect(res.status).toBe(200);
    const [ev] = await sql`SELECT id FROM inbound_events WHERE provider = 'whatsapp_webhook' AND payload::text LIKE ${`%${v.MSG_ID}%`}`;
    expect((await processWebhookEvent(ev.id)).status).toBe("processed");
    const [{ n }] = await sql`
      SELECT count(*)::int AS n FROM wa_message_texts t JOIN wa_messages m ON m.id = t.message_id WHERE m.wa_message_id = ${v.MSG_ID}`;
    expect(n).toBe(0);
    const [contact] = await sql`SELECT full_name FROM contacts WHERE phone_e164 = ${`+${v.WA_ID}`}`;
    expect(contact.full_name).toBeNull(); // the name was never stored either
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

  it("a rep disconnecting in the phone app (PARTNER_REMOVED) switches the line off and clears consent and text", async () => {
    const { lineId, phoneNumberId } = await setupLine({ storeText: true });
    await post(fixture("message-text", vars({ PHONE_NUMBER_ID: phoneNumberId })));
    const [{ meta_waba_id }] = await sql`SELECT meta_waba_id FROM wa_lines WHERE id = ${lineId}`;
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ id: meta_waba_id, changes: [{ field: "account_update", value: { event: "PARTNER_REMOVED" } }] }],
    });
    await post(body);
    const [line] = await sql`SELECT mode, consent_at, consent_by, store_message_text, meta_business_token_enc FROM wa_lines WHERE id = ${lineId}`;
    expect(line).toEqual({ mode: "business_app", consent_at: null, consent_by: null, store_message_text: false, meta_business_token_enc: null });
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM wa_message_texts t JOIN wa_messages m ON m.id = t.message_id WHERE m.wa_line_id = ${lineId}`;
    expect(n).toBe(0);

    // an account_update for a WhatsApp account the CRM does not know is not stored
    const stranger = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ id: digits(15), changes: [{ field: "account_update", value: { event: "PARTNER_REMOVED" } }] }],
    });
    await post(stranger);
    const [{ e }] = await sql`SELECT count(*)::int AS e FROM inbound_events WHERE external_id = ${sha256(stranger)}`;
    expect(e).toBe(0);
  });
});

describe("what is stored (trimmed before insert)", () => {
  it("a message keeps ids, time, type, referral ids and the ad code; no text, names or contact cards", async () => {
    const { phoneNumberId } = await setupLine({ storeText: true });
    const code = `Z-IFP-${digits(2)}`;
    const v = vars({ PHONE_NUMBER_ID: phoneNumberId });
    const body = JSON.parse(fixture("message-referral", v));
    const value = body.entry[0].changes[0].value;
    value.messages[0].text = { body: `Halo rahasia [${code}]` };
    value.contacts[0].profile.username = "@sheena";
    await post(JSON.stringify(body), { process: false });
    const [ev] = await sql`SELECT payload FROM inbound_events WHERE provider = 'whatsapp_webhook' AND payload::text LIKE ${`%${v.MSG_ID}%`}`;
    const p = JSON.stringify(ev.payload);
    for (const gone of ["rahasia", "Sheena", "@sheena", "headline", "body", "profile"]) expect(p).not.toContain(gone);
    const m = ev.payload.entry[0].changes[0].value.messages[0];
    expect(m).toMatchObject({ id: v.MSG_ID, from: v.WA_ID, type: "text", crm_codes: { adCode: code } });
    expect(m.referral.source_id).toBe(v.AD_ID);
    expect(ev.payload.entry[0].changes[0].value.contacts).toEqual([{ wa_id: v.WA_ID, user_id: v.BSUID }]);
  });

  it("the phone's address book (smb_app_state_sync) and delivery statuses are not stored at all", async () => {
    const { phoneNumberId } = await setupLine();
    const sync = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ id: digits(15), changes: [{ field: "smb_app_state_sync", value: {
        messaging_product: "whatsapp", metadata: { phone_number_id: phoneNumberId },
        state_sync: [{ type: "contact", contact: { full_name: "Budi Teman Lama", phone_number: "6281299998888" }, action: "add" }],
      } }] }],
    });
    expect((await post(sync)).status).toBe(200);
    const status = fixture("status", vars({ PHONE_NUMBER_ID: phoneNumberId }));
    expect((await post(status)).status).toBe(200);
    const [{ e }] = await sql`
      SELECT count(*)::int AS e FROM inbound_events WHERE external_id = ANY(${[sha256(sync), sha256(status)]})`;
    expect(e).toBe(0);
  });

  it("redactValue drops profile names, usernames and the context of history threads that are not customers", () => {
    const value: WaValue = {
      metadata: { display_phone_number: "6281100000001", phone_number_id: "123" },
      contacts: [{ wa_id: "6281211112222", user_id: "ID.1", profile: { name: "Sheena", username: "@sheena" } }],
      history: [{ threads: [
        { id: "6281233334444", context: { wa_id: "6281233334444", user_id: "ID.2", username: "@teman" } as never,
          messages: [{ id: "a", from: "6281233334444", timestamp: "1", type: "text", text: { body: "rahasia" } }] },
        { id: "6281255556666", context: { wa_id: "6281255556666", user_id: "ID.3" },
          messages: [{ id: "b", from: "6281100000001", timestamp: "1", type: "text" }] },
      ] }],
    };
    const out = redactValue(value, (waId) => waId === "6281255556666");
    expect(out.contacts).toEqual([{ wa_id: "6281211112222", user_id: "ID.1" }]);
    const [stranger, customer] = out.history![0].threads!;
    expect(stranger.context).toEqual({ user_id: "ID.2" });
    expect(stranger.messages).toEqual([{ id: "a", from_user_id: undefined, timestamp: "1", type: "text", dir: "in" }].map(clean));
    expect(customer.context).toEqual({ wa_id: "6281255556666", user_id: "ID.3" });
    expect(customer.messages![0]).toMatchObject({ id: "b", from: "6281100000001", dir: "out" });
    expect(JSON.stringify(out)).not.toMatch(/rahasia|Sheena|@sheena|@teman|6281233334444|display_phone_number/);
  });

  it("history direction uses the BSUID when the number is hidden (no `from`)", async () => {
    const { phoneNumberId } = await setupLine();
    const v = vars({ PHONE_NUMBER_ID: phoneNumberId });
    const body = JSON.parse(fixture("history", v));
    const thread = body.entry[0].changes[0].value.history[0].threads[0];
    delete thread.context.wa_id;
    thread.id = v.BSUID;
    thread.messages[0] = { ...thread.messages[0], from: undefined, from_user_id: v.BSUID };
    thread.messages[1] = { ...thread.messages[1], from: undefined, from_user_id: `ID.${digits(19)}` };
    await post(JSON.stringify(body));
    const rows = await sql`SELECT wa_message_id, direction FROM wa_messages WHERE wa_message_id LIKE ${`${v.MSG_ID}%`} ORDER BY wa_message_id`;
    expect(rows.map((r) => r.direction)).toEqual(["in", "out"]);
  });
});

describe("request limits", () => {
  it("hashes the raw bytes for the signature: a body that is not valid UTF-8 still verifies", async () => {
    const { phoneNumberId } = await setupLine();
    const v = vars({ PHONE_NUMBER_ID: phoneNumberId });
    const text = fixture("message-text", v).replace("Sheena Nelson", "Sheena NELSON\u00e9");
    // a latin-1 byte inside a JSON string: decoding to text and back would change it
    const raw = Buffer.concat([Buffer.from(text.slice(0, 20)), Buffer.from([0xe9]), Buffer.from(text.slice(20))]);
    expect(verifyWebhookSignature(SECRET, signWebhook(SECRET, raw), raw)).toBe(true);
    expect(verifyWebhookSignature(SECRET, signWebhook(SECRET, raw), raw.toString("utf8"))).toBe(false);
  });

  it("refuses a body over 3 MB with 413 before storing anything", async () => {
    const body = JSON.stringify({ object: "whatsapp_business_account", pad: "x".repeat(3 * 1024 * 1024) });
    const res = await post(body);
    expect(res.status).toBe(413);
  });

  it("answers 429 to an address after 60 failures, even with a good signature", async () => {
    const from = ip();
    const body = '{"object":"whatsapp_business_account","entry":[]}';
    const send = (signature: string) =>
      handleWebhookPost(new Request(URL_, { method: "POST", body, headers: { "x-forwarded-for": from, "x-hub-signature-256": signature } }), { schedule: () => {} });
    for (let i = 0; i < 60; i++) expect((await send(signWebhook("salah", body))).status).toBe(401);
    expect((await send(signWebhook(SECRET, body))).status).toBe(429);
    // another address is not affected
    expect((await post(body)).status).toBe(200);
  });
});

function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
