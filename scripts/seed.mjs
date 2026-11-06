// Runs db/seeds/*.sql in name order, each file in its own transaction.
// Seeds must be re-runnable (upserts). *.local.sql files are gitignored and
// run only where they exist.
//   node scripts/seed.mjs          uses DATABASE_URL
//   node scripts/seed.mjs --test   uses DATABASE_URL_TEST
//   node scripts/seed.mjs --only seed_products.sql 90_users.local.sql   only these files (production: no example users)
import path from "node:path";
import { connect, databaseUrl, isMain, root, runFile, sqlFiles } from "./lib.mjs";

const DEMO_FILE = /^demo(\.|$)/;

/** @param {{ url: string, dir?: string, only?: string[], log?: (line: string) => void }} options */
export async function runSeeds({ url, dir = path.join(root, "db/seeds"), only, log = console.log }) {
  const all = await sqlFiles(dir);
  if (only) {
    const missing = only.filter((f) => !all.includes(f));
    if (missing.length) throw new Error(`no such seed file: ${missing.join(", ")}`);
    if (only.some((f) => DEMO_FILE.test(f))) throw new Error("demo data is loaded with npm run db:demo");
  }
  const files = only ? all.filter((f) => only.includes(f)) : all;
  const sql = connect(url);
  try {
    for (const file of files) {
      if (!only && DEMO_FILE.test(file)) continue; // demo data is loaded only on purpose: npm run db:demo
      try {
        await sql.begin((tx) => runFile(tx, dir, file));
      } catch (err) {
        err.sqlFile = file;
        throw err;
      }
      log(`seeded ${file}`);
    }
  } finally {
    await sql.end();
  }
}

if (isMain(import.meta)) {
  try {
    const at = process.argv.indexOf("--only");
    const only = at >= 0 ? process.argv.slice(at + 1).filter((a) => !a.startsWith("--")) : undefined;
    if (only && !only.length) throw new Error("--only needs at least one file name");
    await runSeeds({ url: databaseUrl(), only });
  } catch (err) {
    console.error(err.sqlFile ? `error ${err.sqlFile}: ${err.message}` : `error: ${err.message}`);
    process.exit(1);
  }
}
