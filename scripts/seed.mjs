// Runs db/seeds/*.sql in name order, each file in its own transaction.
// Seeds must be re-runnable (upserts). *.local.sql files are gitignored and
// run only where they exist.
//   node scripts/seed.mjs          uses DATABASE_URL
//   node scripts/seed.mjs --test   uses DATABASE_URL_TEST
import path from "node:path";
import { connect, databaseUrl, isMain, root, runFile, sqlFiles } from "./lib.mjs";

const DEMO_FILE = /^demo(\.|$)/;

export async function runSeeds({ url, dir = path.join(root, "db/seeds"), log = console.log }) {
  const sql = connect(url);
  try {
    for (const file of await sqlFiles(dir)) {
      if (DEMO_FILE.test(file)) continue; // demo data is loaded only on purpose: npm run db:demo
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
    await runSeeds({ url: databaseUrl() });
  } catch (err) {
    console.error(err.sqlFile ? `error ${err.sqlFile}: ${err.message}` : `error: ${err.message}`);
    process.exit(1);
  }
}
