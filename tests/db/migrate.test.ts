import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../scripts/migrate.mjs";
import { runSeeds } from "../../scripts/seed.mjs";

const url = process.env.DATABASE_URL_TEST as string;
const sql = postgres(url, { max: 1, onnotice: () => {} });
const run = promisify(execFile);

afterAll(() => sql.end());

const MIGRATIONS = [
  "001_init.sql",
  "002_routing_products.sql",
  "003_bahasa_targets_authz.sql",
  "004_jovian_flow.sql",
  "005_password_login.sql",
  "006_prospek.sql",
  "007_pipeline.sql",
  "008_contacts.sql",
  "009_contact_integrity.sql",
  "010_reports.sql",
  "011_reports_full.sql",
];

describe("migrations", () => {
  it("skips every file on a second run", async () => {
    // global setup already applied all migrations once
    const { stdout } = await run(process.execPath, ["scripts/migrate.mjs", "--test"], {
      env: process.env,
    });
    expect(stdout.trim().split("\n")).toEqual(MIGRATIONS.map((f) => `skipped ${f}`));

    const rows = await sql`select filename from schema_migrations order by filename`;
    expect(rows.map((r) => r.filename)).toEqual(MIGRATIONS);
  });

  it("stops at a failing file and rolls it back", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "fortu-migrations-"));
    try {
      await writeFile(
        path.join(dir, "998_bad.sql"),
        "create table t_partial (id int);\nselect 1 / 0;\n",
      );
      await writeFile(path.join(dir, "999_after.sql"), "create table t_after (id int);\n");

      await expect(runMigrations({ url, dir, log: () => {} })).rejects.toMatchObject({
        sqlFile: "998_bad.sql",
      });

      const tables = await sql`
        select table_name from information_schema.tables
        where table_name in ('t_partial', 't_after')`;
      expect(tables).toHaveLength(0);
      const recorded = await sql`
        select filename from schema_migrations where filename in ('998_bad.sql', '999_after.sql')`;
      expect(recorded).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("seeds", () => {
  it("loads 32 products and can run twice", async () => {
    for (let i = 0; i < 2; i++) {
      await runSeeds({ url, log: () => {} });
      const [{ count }] = await sql`select count(*)::int as count from products where name not like 'Produk uji %'`; // other tests add their own
      expect(count).toBe(32);
    }
  });
});
