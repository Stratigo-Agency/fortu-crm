// Applies db/migrations/*.sql in name order, each file in its own transaction,
// and records it in schema_migrations. Stops at the first error.
//   node scripts/migrate.mjs          uses DATABASE_URL
//   node scripts/migrate.mjs --test   uses DATABASE_URL_TEST
import path from "node:path";
import { connect, databaseUrl, isMain, root, runFile, sqlFiles } from "./lib.mjs";

const LOCK_KEY = 5_130_141; // pg_advisory_lock key: one migrator at a time

export async function runMigrations({
  url,
  dir = path.join(root, "db/migrations"),
  log = console.log,
}) {
  const sql = connect(url);
  try {
    await sql`select pg_advisory_lock(${LOCK_KEY})`;
    await sql`
      create table if not exists schema_migrations (
        filename text primary key,
        applied_at timestamptz default now()
      )`;
    const done = new Set(
      (await sql`select filename from schema_migrations`).map((r) => r.filename),
    );
    for (const file of await sqlFiles(dir)) {
      if (done.has(file)) {
        log(`skipped ${file}`);
        continue;
      }
      try {
        await sql.begin(async (tx) => {
          await runFile(tx, dir, file);
          await tx`insert into schema_migrations (filename) values (${file})`;
        });
      } catch (err) {
        err.file = file;
        throw err;
      }
      log(`applied ${file}`);
    }
  } finally {
    await sql.end();
  }
}

if (isMain(import.meta)) {
  try {
    await runMigrations({ url: databaseUrl() });
  } catch (err) {
    console.error(err.file ? `error ${err.file}: ${err.message}` : `error: ${err.message}`);
    process.exit(1);
  }
}
