import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../scripts/migrate.mjs";
import { describeTarget, runDemo } from "../../scripts/demo.mjs";
import { runSeeds } from "../../scripts/seed.mjs";
import { INDUSTRIES } from "@/lib/contactTypes";
import { sampleDataConnection } from "@/lib/sampleData";

// The demo data runs against its own throwaway database, so it never mixes with the shared fortu_test rows.
const base = new URL(process.env.DATABASE_URL_TEST as string);
const NAME = "fortu_demo_check_test";
const admin = new URL(base);
admin.pathname = "/postgres";
const target = new URL(base);
target.pathname = `/${NAME}`;
const quiet = () => {};

let sql: postgres.Sql;

beforeAll(async () => {
  const root = postgres(admin.href, { max: 1, onnotice: quiet });
  await root`drop database if exists ${root(NAME)} with (force)`;
  await root`create database ${root(NAME)}`;
  await root.end();
  await runMigrations({ url: target.href, log: quiet });
  sql = postgres(target.href, { max: 1, onnotice: quiet });
});

afterAll(async () => {
  await sql.end();
  const root = postgres(admin.href, { max: 1, onnotice: quiet });
  await root`drop database if exists ${root(NAME)} with (force)`;
  await root.end();
});

const counts = async () =>
  (await sql`
    SELECT (SELECT count(*) FROM deals)::int AS deals, (SELECT count(*) FROM deals WHERE is_sample)::int AS sample_deals,
           (SELECT count(*) FROM leads)::int AS leads, (SELECT count(*) FROM contacts WHERE NOT is_sample)::int AS real_contacts,
           (SELECT count(*) FROM users WHERE email LIKE '%@demo.fortu.invalid')::int AS users, (SELECT count(*) FROM products WHERE sku LIKE 'DEMO-%')::int AS products,
           (SELECT count(*) FROM companies)::int AS companies, (SELECT count(*) FROM contacts)::int AS contacts,
           (SELECT count(*) FROM ads WHERE meta_ad_id LIKE 'demo-%')::int AS ads,
           (SELECT count(*) FROM wa_click_events WHERE ref_code LIKE 'demo-%')::int AS clicks,
           (SELECT count(*) FROM inbound_events WHERE external_id LIKE 'demo-%')::int AS forms`)[0];

describe("demo data", () => {
  it("is not loaded by db:seed", async () => {
    await runSeeds({ url: target.href, log: quiet });
    expect((await counts()).deals).toBe(0);
  });

  it("refuses to load without ALLOW_DEMO and names the database", async () => {
    const lines: string[] = [];
    await expect(runDemo("load", { url: target.href, allow: false, log: (l: string) => lines.push(l) })).rejects.toThrow(/refusing/);
    expect(lines[0]).toBe(`database: ${describeTarget(target.href)}`);
    expect(lines[0]).toContain(NAME);
    expect(lines[0]).not.toContain("dev@");
    expect((await counts()).deals).toBe(0);
  });

  it("refuses to load into a database that holds real data, unless told", async () => {
    await sql`INSERT INTO companies (name) VALUES ('Perusahaan asli')`;
    await expect(runDemo("load", { url: target.href, allow: true, log: quiet })).rejects.toThrow(/already holds real data/);
    expect((await counts()).deals).toBe(0);
    await sql`DELETE FROM companies WHERE name = 'Perusahaan asli'`;
  });

  it("loads 25 deals across all stages, marked as sample, and can be re-run", async () => {
    await runDemo("load", { url: target.href, allow: true, log: quiet });
    await runDemo("load", { url: target.href, allow: true, log: quiet });
    const c = await counts();
    expect(c).toMatchObject({ deals: 25, sample_deals: 25, leads: 35, real_contacts: 0, users: 4, products: 5, ads: 4 });
    const byStage = await sql`
      SELECT stage_key, count(*)::int AS n, count(*) FILTER (WHERE next_step_overdue)::int AS overdue,
             count(*) FILTER (WHERE is_stale)::int AS stale, count(*) FILTER (WHERE is_project)::int AS project,
             count(*) FILTER (WHERE needs_discount_approval)::int AS discount
        FROM v_deals_enriched GROUP BY stage_key`;
    const get = (k: string) => byStage.find((r) => r.stage_key === k)!;
    expect(["chat", "quotation", "negotiation", "po", "done", "lost"].map((k) => get(k).n)).toEqual([6, 6, 4, 2, 4, 3]);
    const sum = (f: string) => byStage.reduce((n, r) => n + Number(r[f]), 0);
    expect(sum("overdue")).toBeGreaterThanOrEqual(3);
    expect(sum("stale")).toBeGreaterThanOrEqual(3);
    expect(sum("project")).toBeGreaterThanOrEqual(2);
    expect(sum("discount")).toBe(1);
  });

  it("gives every deal the lead it came from, from every source group, with sensible industries and chat dates", async () => {
    const [d] = await sql`
      SELECT count(*) FILTER (WHERE d.lead_id IS NULL)::int AS without_lead,
             count(*) FILTER (WHERE l.deal_id IS DISTINCT FROM d.id)::int AS unlinked,
             count(*) FILTER (WHERE l.received_at >= d.created_at)::int AS lead_after_deal
        FROM deals d LEFT JOIN leads l ON l.id = d.lead_id WHERE d.is_sample`;
    expect(d).toEqual({ without_lead: 0, unlinked: 0, lead_after_deal: 0 });

    const groups = await sql<{ g: string; n: number }[]>`
      SELECT source_group(source_channel) AS g, count(*)::int AS n FROM leads WHERE is_sample GROUP BY 1`;
    expect(groups.map((r) => r.g).sort()).toEqual(["meta", "offline", "wa_direct", "website"]);
    // Meta leads carry their ad (and its code); website leads their UTM and landing page
    const [meta] = await sql`
      SELECT count(*) FILTER (WHERE ad_id IS NULL)::int AS no_ad, count(*) FILTER (WHERE first_message !~ ad_code)::int AS no_code
        FROM v_leads_enriched WHERE is_sample AND source_channel = 'meta_ctwa'`;
    expect(meta).toEqual({ no_ad: 0, no_code: 0 });
    const [web] = await sql`
      SELECT count(*)::int AS n, count(*) FILTER (WHERE landing_url IS NULL)::int AS no_page,
             count(*) FILTER (WHERE utm_source IS NULL)::int AS no_utm
        FROM v_leads_enriched WHERE is_sample AND source_group = 'website' AND source_channel <> 'google_ads'`;
    expect(web.n).toBeGreaterThanOrEqual(5);
    expect(web.no_page).toBe(0);
    const [insights] = await sql`SELECT count(DISTINCT ad_id)::int AS ads, count(*)::int AS days FROM ad_insights_daily`;
    expect(insights).toEqual({ ads: 4, days: 56 });

    const industries = await sql<{ industry: string }[]>`SELECT DISTINCT industry FROM companies WHERE is_sample`;
    for (const { industry } of industries) expect(INDUSTRIES).toContain(industry);
    expect(industries.length).toBeGreaterThanOrEqual(6);
    const [hotel] = await sql`SELECT industry FROM companies WHERE name = 'Hotel Samudra'`;
    expect(hotel.industry).toBe("hotel");

    const [chats] = await sql`
      SELECT count(DISTINCT (first_chat_at AT TIME ZONE 'Asia/Jakarta')::date)::int AS first_days,
             count(DISTINCT (last_chat_at AT TIME ZONE 'Asia/Jakarta')::date)::int AS last_days,
             count(*) FILTER (WHERE needs_followup)::int AS followup
        FROM v_contacts_enriched WHERE id IN (SELECT id FROM contacts WHERE is_sample)`;
    expect(chats.first_days).toBeGreaterThanOrEqual(20);
    expect(chats.last_days).toBeGreaterThanOrEqual(10);
    expect(chats.followup).toBeGreaterThanOrEqual(1);
  });

  it("keeps sample rows out of the funnel and Prospek figures unless SHOW_SAMPLE_DATA=1", async () => {
    const funnel = (q: postgres.Sql) => q`
      SELECT leads FROM lead_funnel((jakarta_today() - 120), jakarta_today()) WHERE is_total`;
    const stats = (q: postgres.Sql) => q`SELECT open_count FROM v_prospek_stats WHERE is_total AND all_groups`;
    expect((await funnel(sql))[0].leads).toBe(0);
    expect((await stats(sql))[0]?.open_count ?? 0).toBe(0);
    const staging = postgres(target.href, { max: 1, onnotice: quiet, connection: sampleDataConnection({ SHOW_SAMPLE_DATA: "1" }) });
    try {
      expect((await funnel(staging))[0].leads).toBe(35);
      expect((await stats(staging))[0].open_count).toBe(9);
    } finally {
      await staging.end();
    }
  });

  it("says what blocks the clean-up when a real deal uses a demo rep, and changes nothing", async () => {
    const [{ id: demoRep }] = await sql`SELECT id FROM users WHERE email = 'rina@demo.fortu.invalid'`;
    const [{ id: realContact }] = await sql`INSERT INTO contacts (phone_e164, full_name) VALUES ('+628111000999', 'Kontak asli') RETURNING id`;
    const [{ id: realDeal }] = await sql`
      INSERT INTO deals (name, contact_id, owner_user_id, stage_id, next_step, next_step_date)
      SELECT 'Deal asli', ${realContact}, ${demoRep}, id, 'Telepon', jakarta_today() + 3 FROM pipeline_stages WHERE key = 'chat' RETURNING id`;
    await expect(runDemo("clear", { url: target.href, allow: false, log: quiet })).rejects.toThrow(/real rows still use it/);
    expect((await counts()).sample_deals).toBe(25);
    await sql`DELETE FROM deals WHERE id = ${realDeal}`;
    await sql`DELETE FROM contacts WHERE id = ${realContact}`;
  });

  it("clears everything it made and nothing else", async () => {
    // what people do on sample rows while testing must not block the clean-up
    await sql`
      INSERT INTO activities (type, deal_id, user_id, body)
      SELECT 'note', id, owner_user_id, 'catatan uji' FROM deals WHERE is_sample LIMIT 1`;
    await sql`
      INSERT INTO activities (type, lead_id, body) SELECT 'note', id, 'catatan prospek' FROM leads WHERE is_sample LIMIT 1`;
    await sql`
      INSERT INTO notifications (user_id, kind, deal_id)
      SELECT owner_user_id, 'stale_deal', id FROM deals WHERE is_sample LIMIT 1`;
    await sql`INSERT INTO companies (name) VALUES ('Perusahaan asli')`;
    await runDemo("clear", { url: target.href, allow: false, log: quiet });
    expect(await counts()).toEqual({
      deals: 0, sample_deals: 0, leads: 0, real_contacts: 0, users: 0, products: 0, companies: 1, contacts: 0, ads: 0, clicks: 0, forms: 0,
    });
  });
});
