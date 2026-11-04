import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import {
  InvalidActorError,
  InvalidTimeError,
  MissingActorError,
  UnknownLineError,
} from "@/lib/ingest/errors";
import { ingestLead, type LeadInput, type SourceChannel } from "@/lib/ingest/ingestLead";
import { normalizePhone } from "@/lib/ingest/phone";
import {
  createAd,
  createClick,
  createDealFor,
  createUser,
  createWaLine,
  nextCodeNumber,
  randomPhone,
} from "../fixtures";

const webForm = (phone: string, extra: Partial<LeadInput> = {}): LeadInput => ({
  phone,
  sourceChannel: "website_form",
  captureMethod: "web_form",
  ...extra,
});

const count = async (table: "leads" | "activities", contactId: string) => {
  const [{ n }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM ${sql(table)} WHERE contact_id = ${contactId}`;
  return n;
};

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

// pick_lead_owner looks at every rep, so tests that need a choice switch the others off.
async function onlyTheseRepsAccept(...ids: string[]) {
  await sql`UPDATE users SET accepting_leads = (id = ANY(${ids}::uuid[]))`;
}

describe("ingestLead · contact and phone", () => {
  it("files every way of writing one number under one contact", async () => {
    const digits = randomPhone().slice(4); // 8 random digits after 0812
    const forms = [`0812-${digits.slice(0, 4)}-${digits.slice(4)}`, `62812 ${digits}`, `+62 812-${digits}`, `812${digits}`];
    const results = [];
    for (const [i, phone] of forms.entries()) {
      results.push(await ingestLead(webForm(phone, { receivedAt: hoursAgo(100 * (i + 1)) })));
    }
    expect(new Set(results.map((r) => r.contactId)).size).toBe(1);
    const [c] = await sql`SELECT phone_e164 FROM contacts WHERE id = ${results[0].contactId}`;
    expect(c.phone_e164).toBe(`+62812${digits}`);
  });

  it("fills name and company only where empty", async () => {
    const phone = randomPhone();
    const company = `PT Uji ${randomUUID()}`;
    const first = await ingestLead(webForm(phone, { name: "Pak Hendra", company, receivedAt: hoursAgo(50) }));
    await ingestLead(webForm(phone, { name: "Orang Lain", company: "PT Lain", receivedAt: hoursAgo(1) }));
    const [c] = await sql`
      SELECT c.full_name, co.name AS company FROM contacts c LEFT JOIN companies co ON co.id = c.company_id
       WHERE c.id = ${first.contactId}`;
    expect(c).toEqual({ full_name: "Pak Hendra", company });
  });

  it("writes nothing for an invalid phone", async () => {
    await expect(ingestLead(webForm("12345"))).rejects.toMatchObject({ code: "invalid_phone" });
  });
});

describe("ingestLead · attribution", () => {
  it("links [F-IFP-01] in the first message to the ad, in any letter case", async () => {
    const code = `F-IFP-${nextCodeNumber()}`;
    const ad = await createAd(code, "Iklan IFP Sekolah");
    const r = await ingestLead(
      webForm(randomPhone(), {
        sourceChannel: "meta_ctwa",
        firstMessage: `Halo, saya mau tanya harga [${code.toLowerCase()}]`,
      }),
    );
    expect(r.adId).toBe(ad.id);
    const [lead] = await sql`SELECT ad_id FROM leads WHERE id = ${r.leadId}`;
    expect(lead.ad_id).toBe(ad.id);
    const [act] = await sql`SELECT type, metadata FROM activities WHERE lead_id = ${r.leadId}`;
    expect(act).toEqual({ type: "system", metadata: { via: "web_form", code, adName: "Iklan IFP Sekolah" } });
  });

  it("matches #W7K2 to the click, copies its UTMs and marks the click", async () => {
    const ref = randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase();
    const click = await createClick(ref, { source: "google", campaign: "sekolah-nov" });
    const r = await ingestLead(
      webForm(randomPhone(), {
        sourceChannel: "website_wa_link",
        firstMessage: `info harga ya #${ref.toLowerCase()}`,
        utm: { medium: "cpc" },
      }),
    );
    const [lead] = await sql`SELECT utm_source, utm_medium, utm_campaign FROM leads WHERE id = ${r.leadId}`;
    expect(lead).toEqual({ utm_source: "google", utm_medium: "cpc", utm_campaign: "sekolah-nov" });
    const [c] = await sql`SELECT matched_lead_id FROM wa_click_events WHERE id = ${click.id}`;
    expect(c.matched_lead_id).toBe(r.leadId);
  });

  it("ignores codes that match nothing", async () => {
    const r = await ingestLead(webForm(randomPhone(), { firstMessage: "[Q-LED-99] #ZZZZ" }));
    expect(r.adId).toBeUndefined();
    const [act] = await sql`SELECT metadata FROM activities WHERE lead_id = ${r.leadId}`;
    expect(act.metadata).toEqual({ via: "web_form", code: null, adName: null });
  });
});

describe("ingestLead · dedupe window", () => {
  it("adds an activity to a new lead from the last 24 h on the same line, and makes a new lead after", async () => {
    const rep = await createUser();
    const line = await createWaLine(rep.id);
    const phone = randomPhone();
    const quick = (receivedAt: string, firstMessage?: string): LeadInput => ({
      phone,
      sourceChannel: "whatsapp_direct",
      captureMethod: "manual_quick_add",
      receivedAt,
      firstMessage,
    });

    const first = await ingestLead(quick(hoursAgo(26)), { actorId: rep.id });
    expect(first.deduped).toBe(false);
    const again = await ingestLead(quick(hoursAgo(3)), { actorId: rep.id });
    expect(again).toMatchObject({ leadId: first.leadId, deduped: true });
    expect(await count("leads", first.contactId)).toBe(1);
    expect(await count("activities", first.contactId)).toBe(2);
    const [lead] = await sql`SELECT wa_line_id FROM leads WHERE id = ${first.leadId}`;
    expect(lead.wa_line_id).toBe(line.id); // quick-add used the rep's own line

    // 26 h - 3 h = 23 h apart → deduped. Now one 25 h after the latest lead's received_at:
    const later = await ingestLead(quick(new Date(Date.parse(hoursAgo(26)) + 25 * 3_600_000).toISOString()), {
      actorId: rep.id,
    });
    expect(later.deduped).toBe(false);
    expect(later.leadId).not.toBe(first.leadId);
    expect(await count("leads", first.contactId)).toBe(2);
  });

  it("doesn't dedupe across lines, or a lead that is no longer new", async () => {
    const rep = await createUser();
    const other = await createUser();
    const lineA = await createWaLine(rep.id);
    const lineB = await createWaLine(other.id);
    const phone = randomPhone();
    const viaLine = (waLineId: string): LeadInput => ({
      phone,
      sourceChannel: "meta_ctwa",
      captureMethod: "cloud_api_webhook",
      waLineId,
    });
    const a = await ingestLead(viaLine(lineA.id));
    const b = await ingestLead(viaLine(lineB.id));
    expect(b.deduped).toBe(false);
    expect(b.leadId).not.toBe(a.leadId);

    await sql`UPDATE leads SET status = 'contacted' WHERE id = ${a.leadId}`;
    const c = await ingestLead(viaLine(lineA.id));
    expect(c.deduped).toBe(false);
  });
});

describe("ingestLead · idempotent retries", () => {
  it("returns the first lead when the web form sends the same id twice", async () => {
    const id = `wf-${randomUUID()}`;
    const input = webForm(randomPhone(), { external: { provider: "web_form", id, payload: { name: "Bu Rina" } } });
    const first = await ingestLead(input);
    const second = await ingestLead(input);
    expect(second.leadId).toBe(first.leadId);
    expect(second.contactId).toBe(first.contactId);
    expect(await count("leads", first.contactId)).toBe(1);
    expect(await count("activities", first.contactId)).toBe(1);
    const [e] = await sql`SELECT processed_at FROM inbound_events WHERE provider = 'web_form' AND external_id = ${id}`;
    expect(e.processed_at).not.toBeNull();
  });

  it("returns the deduped-into lead when a deduped delivery is retried", async () => {
    const phone = randomPhone();
    const first = await ingestLead(webForm(phone));
    const input = webForm(phone, { external: { provider: "web_form", id: `wf-${randomUUID()}`, payload: {} } });
    const deduped = await ingestLead(input);
    expect(deduped).toMatchObject({ leadId: first.leadId, deduped: true });
    const retried = await ingestLead(input);
    expect(retried.leadId).toBe(first.leadId);
    expect(await count("activities", first.contactId)).toBe(2);
  });
});

describe("ingestLead · owner", () => {
  beforeEach(async () => {
    // keep pick_lead_owner predictable: nobody else accepts leads unless a test says so
    await sql`UPDATE users SET accepting_leads = false`;
  });

  it("gives a quick-add lead to the rep who logged it and records why", async () => {
    const rep = await createUser();
    const r = await ingestLead(
      { phone: randomPhone(), sourceChannel: "whatsapp_direct", captureMethod: "manual_quick_add" },
      { actorId: rep.id },
    );
    expect(r.ownerId).toBe(rep.id);
    const [oc] = await sql`SELECT to_user_id, reason, changed_by FROM ownership_changes WHERE lead_id = ${r.leadId}`;
    expect(oc).toEqual({ to_user_id: rep.id, reason: "auto_assign", changed_by: rep.id });
  });

  it("refuses a quick-add without the logging rep, writing nothing", async () => {
    const phone = randomPhone();
    await expect(
      ingestLead({ phone, sourceChannel: "whatsapp_direct", captureMethod: "manual_quick_add" }),
    ).rejects.toBeInstanceOf(MissingActorError);
    const [c] = await sql`SELECT count(*)::int AS n FROM contacts WHERE phone_e164 = ${normalizePhone(phone)}`;
    expect(c.n).toBe(0);
  });

  it("gives a lead on a rep's line to that rep", async () => {
    const rep = await createUser();
    const line = await createWaLine(rep.id);
    const r = await ingestLead({
      phone: randomPhone(),
      sourceChannel: "meta_ctwa",
      captureMethod: "cloud_api_webhook",
      waLineId: line.id,
    });
    expect(r.ownerId).toBe(rep.id);
  });

  it("refuses an unknown or inactive line", async () => {
    const off = await createWaLine(null, false);
    for (const waLineId of [off.id, randomUUID(), "not-a-uuid"]) {
      await expect(ingestLead(webForm(randomPhone(), { waLineId }))).rejects.toBeInstanceOf(UnknownLineError);
    }
  });

  it("without a line, picks the IFP rep with the fewest new leads", async () => {
    const busy = await createUser({ fullName: "Rep Sibuk", productLines: ["IFP"] });
    const free = await createUser({ fullName: "Rep Luang", productLines: ["IFP"] });
    const ledOnly = await createUser({ fullName: "Rep LED", productLines: ["LED"] });
    await onlyTheseRepsAccept(busy.id, free.id, ledOnly.id);
    for (let i = 0; i < 2; i++) {
      await ingestLead(
        { phone: randomPhone(), sourceChannel: "whatsapp_direct", captureMethod: "manual_quick_add" },
        { actorId: busy.id },
      );
    }

    const r = await ingestLead(webForm(randomPhone(), { productInterest: "IFP" }));
    expect(r.ownerId).toBe(free.id);
    const [oc] = await sql`SELECT reason, changed_by FROM ownership_changes WHERE lead_id = ${r.leadId}`;
    expect(oc).toEqual({ reason: "specialisation", changed_by: null });
  });

  it("leaves the lead unowned when no rep is available", async () => {
    const r = await ingestLead(webForm(randomPhone(), { productInterest: "DSS" }));
    expect(r.ownerId).toBeNull();
    const [lead] = await sql`SELECT owner_user_id FROM leads WHERE id = ${r.leadId}`;
    expect(lead.owner_user_id).toBeNull();
    const rows = await sql`SELECT 1 FROM ownership_changes WHERE lead_id = ${r.leadId}`;
    expect(rows).toHaveLength(0);
  });

  it("reports an open deal of this contact owned by another rep", async () => {
    const rep = await createUser();
    const other = await createUser({ fullName: "Siska" });
    const phone = randomPhone();
    const seed = await ingestLead(webForm(phone, { name: "Pak Hendra", receivedAt: hoursAgo(48) }));
    await createDealFor(seed.contactId, other.id);

    const r = await ingestLead(
      { phone, sourceChannel: "whatsapp_direct", captureMethod: "manual_quick_add" },
      { actorId: rep.id },
    );
    expect(r.ownerId).toBe(rep.id);
    expect(r.ownerConflict).toEqual({ contactName: "Pak Hendra", repName: "Siska" });
  });

  it("reports no conflict for the same rep's deal or a closed deal", async () => {
    const rep = await createUser();
    const other = await createUser();
    const phone = randomPhone();
    const seed = await ingestLead(webForm(phone, { receivedAt: hoursAgo(48) }));
    await createDealFor(seed.contactId, rep.id);
    await createDealFor(seed.contactId, other.id, { lost: true });
    const r = await ingestLead(
      { phone, sourceChannel: "whatsapp_direct", captureMethod: "manual_quick_add" },
      { actorId: rep.id },
    );
    expect(r.ownerConflict).toBeUndefined();
  });
});

describe("ingestLead · one transaction", () => {
  it("rolls everything back when the lead insert fails", async () => {
    const phone = randomPhone();
    const id = `wf-${randomUUID()}`;
    await expect(
      ingestLead(
        webForm(phone, {
          name: "Tidak Jadi",
          company: `PT Batal ${id}`,
          sourceChannel: "bogus" as SourceChannel,
          external: { provider: "web_form", id, payload: {} },
        }),
      ),
    ).rejects.toThrow(/source_channel/);
    const [c] = await sql`SELECT count(*)::int AS n FROM contacts WHERE phone_e164 = ${normalizePhone(phone)}`;
    const [e] = await sql`SELECT count(*)::int AS n FROM inbound_events WHERE external_id = ${id}`;
    const [co] = await sql`SELECT count(*)::int AS n FROM companies WHERE name = ${`PT Batal ${id}`}`;
    expect([c.n, e.n, co.n]).toEqual([0, 0, 0]);
  });
});

describe("ingestLead · review fixes", () => {
  beforeEach(async () => {
    await sql`UPDATE users SET accepting_leads = false`;
  });

  const quickAdd = (phone = randomPhone()): LeadInput => ({
    phone,
    sourceChannel: "whatsapp_direct",
    captureMethod: "manual_quick_add",
  });

  it("refuses a logging user who is marketing, inactive or not a user id, writing nothing", async () => {
    const marketing = await createUser({ role: "marketing" });
    const inactive = await createUser({ isActive: false });
    for (const actorId of [marketing.id, inactive.id, randomUUID(), "abc"]) {
      const phone = randomPhone();
      await expect(ingestLead(quickAdd(phone), { actorId })).rejects.toBeInstanceOf(InvalidActorError);
      const [c] = await sql`SELECT count(*)::int AS n FROM contacts WHERE phone_e164 = ${normalizePhone(phone)}`;
      expect(c.n).toBe(0);
    }
  });

  it("hands a lead on an unavailable rep's line to another rep, saying why", async () => {
    const away = await createUser({ fullName: "Rep Cuti" });
    const backup = await createUser({ fullName: "Rep Cadangan" });
    await onlyTheseRepsAccept(backup.id); // away is not accepting leads
    const line = await createWaLine(away.id);
    const r = await ingestLead({
      phone: randomPhone(),
      sourceChannel: "meta_ctwa",
      captureMethod: "cloud_api_webhook",
      waLineId: line.id,
    });
    expect(r.ownerId).toBe(backup.id);
    const [oc] = await sql`SELECT reason FROM ownership_changes WHERE lead_id = ${r.leadId}`;
    expect(oc.reason).toBe("rep_unavailable");
    const [lead] = await sql`SELECT wa_line_id FROM leads WHERE id = ${r.leadId}`;
    expect(lead.wa_line_id).toBe(line.id);
  });

  it("reads a time without a zone as Jakarta time and refuses future or unreadable times", async () => {
    const r = await ingestLead(webForm(randomPhone(), { receivedAt: "2026-11-01T10:00" }));
    const [lead] = await sql`SELECT received_at FROM leads WHERE id = ${r.leadId}`;
    expect((lead.received_at as Date).toISOString()).toBe("2026-11-01T03:00:00.000Z");

    const future = new Date(Date.now() + 3_600_000).toISOString();
    for (const receivedAt of [future, "kemarin", "2026-11-01", ""]) {
      await expect(ingestLead(webForm(randomPhone(), { receivedAt }))).rejects.toBeInstanceOf(InvalidTimeError);
    }
  });

  it("doesn't reuse a click already matched to another lead (a forwarded message)", async () => {
    const ref = randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase();
    const click = await createClick(ref, { source: "google", campaign: "sekolah-nov" });
    const first = await ingestLead(webForm(randomPhone(), { firstMessage: `halo #${ref}` }));
    const forwarded = await ingestLead(webForm(randomPhone(), { firstMessage: `halo #${ref}` }));

    const [lead] = await sql`SELECT utm_source, utm_campaign FROM leads WHERE id = ${forwarded.leadId}`;
    expect(lead).toEqual({ utm_source: null, utm_campaign: null });
    const [act] = await sql`SELECT metadata FROM activities WHERE lead_id = ${forwarded.leadId}`;
    expect(act.metadata.code).toBeNull();
    const [c] = await sql`SELECT matched_lead_id FROM wa_click_events WHERE id = ${click.id}`;
    expect(c.matched_lead_id).toBe(first.leadId);
  });

  it("keeps quick-adds without a line apart per rep", async () => {
    const a = await createUser();
    const b = await createUser();
    const phone = randomPhone();
    const ra = await ingestLead(quickAdd(phone), { actorId: a.id });
    const rb = await ingestLead(quickAdd(phone), { actorId: b.id });
    expect(rb.deduped).toBe(false);
    expect(rb.leadId).not.toBe(ra.leadId);
    expect(rb.ownerId).toBe(b.id);
    // the same rep again within 24 h is still deduped
    const ra2 = await ingestLead(quickAdd(phone), { actorId: a.id });
    expect(ra2).toMatchObject({ leadId: ra.leadId, deduped: true });
  });
});
