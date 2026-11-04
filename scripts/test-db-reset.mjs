// Drops and recreates the test database named in DATABASE_URL_TEST, then
// applies all migrations to it. Refuses any database whose name doesn't end in _test.
import { connect, isMain } from "./lib.mjs";
import { runMigrations } from "./migrate.mjs";

export async function resetTestDatabase({ url = process.env.DATABASE_URL_TEST, log = console.log } = {}) {
  if (!url) throw new Error("DATABASE_URL_TEST is not set (copy .env.example to .env.local)");
  const target = new URL(url);
  const name = decodeURIComponent(target.pathname.slice(1));
  if (!/^[a-z0-9_]+_test$/.test(name)) {
    throw new Error(`refusing to reset "${name}": the test database name must end in _test`);
  }

  const admin = new URL(url);
  admin.pathname = "/postgres";
  const sql = connect(admin.href);
  try {
    await sql`drop database if exists ${sql(name)} with (force)`;
    await sql`create database ${sql(name)}`;
  } finally {
    await sql.end();
  }
  log(`reset ${name}`);
  await runMigrations({ url, log });
}

if (isMain(import.meta)) {
  try {
    await resetTestDatabase();
  } catch (err) {
    console.error(err.sqlFile ? `error ${err.sqlFile}: ${err.message}` : `error: ${err.message}`);
    process.exit(1);
  }
}
