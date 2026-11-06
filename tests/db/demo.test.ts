import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../scripts/migrate.mjs";
import { describeTarget, runDemo } from "../../scripts/demo.mjs";
import { runSeeds } from "../../scripts/seed.mjs";

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
           (SELECT count(*) FROM companies)::int AS companies, (SELECT count(*) FROM contacts)::int AS contacts`)[0];

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

  it("loads 25 deals across all stages, marked as sample, and can be re-run", async () => {
    await runDemo("load", { url: target.href, allow: true, log: quiet });
    await runDemo("load", { url: target.href, allow: true, log: quiet });
    const c = await counts();
    expect(c).toMatchObject({ deals: 25, sample_deals: 25, leads: 6, real_contacts: 0, users: 4, products: 5 });
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
    expect(await counts()).toEqual({ deals: 0, sample_deals: 0, leads: 0, real_contacts: 0, users: 0, products: 0, companies: 1, contacts: 0 });
  });
});
