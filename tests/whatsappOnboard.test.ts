import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "@/lib/db";
import { connectLine, WhatsAppSetupError } from "@/lib/whatsapp/onboard";
import { revokeConsent, saveLineText } from "@/lib/whatsapp/lines";
import { open, seal } from "@/lib/whatsapp/secretBox";
import { createUser } from "./fixtures";
import { digits, fixture, leadsOf, post, SECRET, setupLine, vars } from "./whatsappHelpers";

beforeAll(() => {
  process.env.META_APP_SECRET = SECRET;
  process.env.META_VERIFY_TOKEN = "uji-verify-token";
  process.env.AUTH_SECRET ||= "uji-auth-secret";
});
afterEach(() => {
  vi.unstubAllGlobals();
  process.env.META_APP_SECRET = SECRET;
});

const TOKEN = "EAAG-uji-business-token";
function mockMeta(o: { phone?: string; failSync?: boolean; failUnsubscribe?: boolean } = {}) {
  const calls: { method: string; url: URL; auth: string | null; body: unknown }[] = [];
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  vi.stubGlobal("fetch", async (input: URL | string, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const headers = new Headers(init.headers);
    calls.push({ method: init.method ?? "GET", url, auth: headers.get("authorization"), body: init.body ? JSON.parse(String(init.body)) : null });
    expect(url.hostname).toBe("graph.facebook.com");
    if (url.pathname.endsWith("/oauth/access_token")) return json({ access_token: TOKEN, token_type: "bearer" });
    if (url.pathname.endsWith("/debug_token")) return json({ data: { granular_scopes: [{ scope: "whatsapp_business_management", target_ids: ["1234567890123"] }] } });
    if (url.pathname.endsWith("/phone_numbers")) return json({ data: [{ id: "998877665544", display_phone_number: o.phone ?? "+62 811-2233-4455" }] });
    if (url.pathname.endsWith("/subscribed_apps")) {
      return o.failUnsubscribe && init.method === "DELETE" ? json({ error: { code: 2 } }, 500) : json({ success: true });
    }
    if (url.pathname.endsWith("/smb_app_data")) return o.failSync ? json({ error: { code: 100 } }, 400) : json({ request_id: `req-${calls.length}` });
    return json({ display_phone_number: o.phone ?? "+62 811-2233-4455" });
  });
  return calls;
}

describe("Embedded Signup (Coexistence) onboarding", () => {
  it("exchanges the code server-side, subscribes, requests both syncs and stores the token encrypted", async () => {
    process.env.META_APP_ID = "111222333";
    const admin = await createUser({ role: "admin" });
    const rep = await createUser({ role: "sales_rep", fullName: "Rudi Hartono" });
    const phone = `+62811${digits(8)}`;
    const calls = mockMeta({ phone });
    const result = await connectLine(admin, { code: "AQ-code", ownerId: rep.id, consentBy: "Rudi Hartono", consent: true });
    expect(Object.keys(result).sort()).toEqual(["lineId", "synced"]);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(result.synced).toBe(true);

    const tokenCall = calls[0];
    expect(tokenCall.url.pathname).toMatch(/\/oauth\/access_token$/);
    expect(tokenCall.url.searchParams.get("client_id")).toBe("111222333");
    expect(tokenCall.url.searchParams.get("client_secret")).toBe(SECRET);
    expect(tokenCall.url.searchParams.get("code")).toBe("AQ-code");
    const sub = calls.find((c) => c.url.pathname.endsWith("/1234567890123/subscribed_apps"));
    expect(sub).toMatchObject({ method: "POST", auth: `Bearer ${TOKEN}` });
    const syncs = calls.filter((c) => c.url.pathname.endsWith("/998877665544/smb_app_data")).map((c) => c.body);
    expect(syncs).toEqual([
      { messaging_product: "whatsapp", sync_type: "smb_app_state_sync" },
      { messaging_product: "whatsapp", sync_type: "history" },
    ]);

    const [line] = await sql`SELECT * FROM wa_lines WHERE id = ${result.lineId}`;
    expect(line).toMatchObject({
      user_id: rep.id, phone_e164: phone, mode: "coexistence", meta_waba_id: "1234567890123", meta_phone_number_id: "998877665544",
      consent_by: "Rudi Hartono", consent_recorded_by: admin.id, store_message_text: false,
    });
    expect(line.consent_at).not.toBeNull();
    expect(line.history_sync_request_id).toBeTruthy();
    expect(line.meta_business_token_enc).not.toContain(TOKEN);
    expect(open(line.meta_business_token_enc)).toBe(TOKEN);
  });

  it("uses the ids from the signup event when given, and still saves the line when a sync fails", async () => {
    process.env.META_APP_ID = "111222333";
    const ceo = await createUser({ role: "ceo" });
    const rep = await createUser({ role: "sales_rep" });
    const calls = mockMeta({ phone: `62811${digits(8)}`, failSync: true });
    const r = await connectLine(ceo, { code: "c", wabaId: "5550001112223", phoneNumberId: "4440001112223", ownerId: rep.id, consentBy: "Uji", consent: true });
    expect(r.synced).toBe(false);
    expect(calls.some((c) => c.url.pathname.endsWith("/debug_token"))).toBe(false);
    const [line] = await sql`SELECT mode, meta_waba_id FROM wa_lines WHERE id = ${r.lineId}`;
    expect(line).toEqual({ mode: "coexistence", meta_waba_id: "5550001112223" });
  });

  it("a reconnect needs a fresh consent and starts with message text off, deleting what was kept", async () => {
    process.env.META_APP_ID = "111222333";
    const admin = await createUser({ role: "admin" });
    const rep = await createUser({ role: "sales_rep" });
    const phone = `+62811${digits(8)}`;
    mockMeta({ phone });
    const ids = { wabaId: digits(13), phoneNumberId: digits(13) };
    const first = await connectLine(admin, { code: "c1", ...ids, ownerId: rep.id, consentBy: "Rudi", consent: true });
    await sql`UPDATE wa_lines SET store_message_text = true WHERE id = ${first.lineId}`;
    const [m] = await sql`
      INSERT INTO wa_messages (wa_line_id, wa_message_id, direction, source, msg_type, sent_at)
      VALUES (${first.lineId}, ${`wamid.${digits(10)}`}, 'in', 'messages', 'text', now()) RETURNING id`;
    await sql`INSERT INTO wa_message_texts (message_id, body) VALUES (${m.id}, 'teks lama')`;

    await expect(connectLine(admin, { code: "c2", ...ids, ownerId: rep.id, consentBy: "Rudi", consent: false })).rejects.toMatchObject({ key: "consent" });
    const again = await connectLine(admin, { code: "c3", ...ids, ownerId: rep.id, consentBy: "Rudi H.", consent: true });
    expect(again.lineId).toBe(first.lineId);
    const [line] = await sql`SELECT store_message_text, consent_by FROM wa_lines WHERE id = ${first.lineId}`;
    expect(line).toEqual({ store_message_text: false, consent_by: "Rudi H." });
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM wa_message_texts WHERE message_id = ${m.id}`;
    expect(n).toBe(0);
  });

  it("refuses a rep, a missing consent and a number outside Indonesia, before or without saving", async () => {
    process.env.META_APP_ID = "111222333";
    const rep = await createUser({ role: "sales_rep" });
    const admin = await createUser({ role: "admin" });
    const calls = mockMeta();
    await expect(connectLine(rep, { code: "c", ownerId: rep.id, consentBy: "Uji", consent: true })).rejects.toMatchObject({ code: "forbidden" });
    await expect(connectLine(admin, { code: "c", ownerId: rep.id, consentBy: "Uji", consent: false })).rejects.toBeInstanceOf(WhatsAppSetupError);
    await expect(connectLine(admin, { code: "c", ownerId: rep.id, consentBy: " ", consent: true })).rejects.toMatchObject({ key: "consent" });
    expect(calls).toHaveLength(0);
    mockMeta({ phone: "+1 650-555-1234" });
    await expect(connectLine(admin, { code: "c", ownerId: rep.id, consentBy: "Uji", consent: true })).rejects.toMatchObject({ key: "phone" });
  });
});


describe("line settings", () => {
  const form = (o: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) f.set(k, v);
    return f;
  };

  it("turning text off or withdrawing consent deletes kept text; a rep may do neither", async () => {
    const { lineId, phoneNumberId } = await setupLine({ storeText: true });
    await post(fixture("message-text", vars({ PHONE_NUMBER_ID: phoneNumberId })));
    const kept = async () => {
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM wa_message_texts t JOIN wa_messages m ON m.id = t.message_id WHERE m.wa_line_id = ${lineId}`;
      return n;
    };
    expect(await kept()).toBe(1);

    const rep = await createUser({ role: "sales_rep" });
    await expect(saveLineText(rep, form({ lineId }))).rejects.toMatchObject({ code: "forbidden" });
    await expect(revokeConsent(rep, form({ lineId }))).rejects.toMatchObject({ code: "forbidden" });
    expect(await kept()).toBe(1);

    const ceo = await createUser({ role: "ceo" });
    await saveLineText(ceo, form({ lineId })); // checkbox not sent = off
    expect(await kept()).toBe(0);
    await saveLineText(ceo, form({ lineId, storeText: "on" }));
    await revokeConsent(ceo, form({ lineId }));
    const [line] = await sql`SELECT consent_at, store_message_text, meta_business_token_enc FROM wa_lines WHERE id = ${lineId}`;
    expect(line).toEqual({ consent_at: null, store_message_text: false, meta_business_token_enc: null });

    // nothing more is processed for that line
    const v = vars({ PHONE_NUMBER_ID: phoneNumberId });
    await post(fixture("message-text", v));
    expect(await leadsOf(`+${v.WA_ID}`)).toHaveLength(0);
  });

  it("text off also clears text that reached leads.first_message on that line (older rows), and only there", async () => {
    const { rep, lineId } = await setupLine({ storeText: true });
    const other = await setupLine({ storeText: true });
    const mk = async (line: string, method: string) => {
      const [c] = await sql`INSERT INTO contacts (phone_e164) VALUES (${`+62812${digits(8)}`}) RETURNING id`;
      const [l] = await sql`
        INSERT INTO leads (contact_id, owner_user_id, wa_line_id, source_channel, capture_method, first_message)
        VALUES (${c.id}, ${rep.id}, ${line}, 'whatsapp_direct', ${method}, 'isi chat lama') RETURNING id`;
      return l.id;
    };
    const webhookLead = await mk(lineId, "cloud_api_webhook");
    const typedByRep = await mk(lineId, "manual_quick_add");
    const otherLine = await mk(other.lineId, "cloud_api_webhook");
    const ceo = await createUser({ role: "ceo" });
    await saveLineText(ceo, form({ lineId }));
    const rows = await sql`SELECT id, first_message FROM leads WHERE id = ANY(${[webhookLead, typedByRep, otherLine]})`;
    const msg = (id: string) => rows.find((r) => r.id === id)?.first_message;
    expect(msg(webhookLead)).toBeNull();
    expect(msg(typedByRep)).toBe("isi chat lama"); // a quick-add note the rep typed is not a WhatsApp text
    expect(msg(otherLine)).toBe("isi chat lama");
  });

  it("text cannot be switched on for a line without consent", async () => {
    const { lineId } = await setupLine({ consent: false });
    const ceo = await createUser({ role: "ceo" });
    await saveLineText(ceo, form({ lineId, storeText: "on" }));
    const [line] = await sql`SELECT store_message_text FROM wa_lines WHERE id = ${lineId}`;
    expect(line.store_message_text).toBe(false);
  });

  it("withdrawing consent unsubscribes the app from the WhatsApp account first, then forgets the token", async () => {
    const { lineId } = await setupLine({ storeText: true });
    await sql`UPDATE wa_lines SET meta_business_token_enc = ${seal(TOKEN)} WHERE id = ${lineId}`;
    const [{ meta_waba_id }] = await sql`SELECT meta_waba_id FROM wa_lines WHERE id = ${lineId}`;
    const calls = mockMeta();
    const admin = await createUser({ role: "admin" });
    expect(await revokeConsent(admin, form({ lineId }))).toEqual({ unsubscribed: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "DELETE", auth: `Bearer ${TOKEN}` });
    expect(calls[0].url.pathname).toMatch(new RegExp(`/${meta_waba_id}/subscribed_apps$`));
    const [line] = await sql`SELECT mode, consent_at, store_message_text, meta_business_token_enc FROM wa_lines WHERE id = ${lineId}`;
    expect(line).toEqual({ mode: "business_app", consent_at: null, store_message_text: false, meta_business_token_enc: null });
  });

  it("when Meta cannot unsubscribe, the line is still switched off here and its webhooks are dropped", async () => {
    const { lineId, phoneNumberId } = await setupLine();
    await sql`UPDATE wa_lines SET meta_business_token_enc = ${seal(TOKEN)} WHERE id = ${lineId}`;
    mockMeta({ failUnsubscribe: true });
    const ceo = await createUser({ role: "ceo" });
    expect(await revokeConsent(ceo, form({ lineId }))).toEqual({ unsubscribed: false });
    const [line] = await sql`SELECT mode, consent_at, meta_business_token_enc FROM wa_lines WHERE id = ${lineId}`;
    expect(line).toEqual({ mode: "business_app", consent_at: null, meta_business_token_enc: null });
    const v = vars({ PHONE_NUMBER_ID: phoneNumberId });
    await post(fixture("message-text", v));
    const [{ e }] = await sql`SELECT count(*)::int AS e FROM inbound_events WHERE payload::text LIKE ${`%${v.MSG_ID}%`}`;
    expect(e).toBe(0);
  });

  it("a recorded consent always names who agreed (database check)", async () => {
    const { lineId } = await setupLine({ consent: false });
    await expect(sql`UPDATE wa_lines SET consent_at = now(), consent_by = NULL WHERE id = ${lineId}`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`UPDATE wa_lines SET consent_at = now(), consent_by = '  ' WHERE id = ${lineId}`).rejects.toMatchObject({ code: "23514" });
  });
});
